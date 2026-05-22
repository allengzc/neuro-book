import type {AgentStreamEvent, AgentThreadStatus, LiveRunSnapshot, LiveToolState, ProfileKey, ThreadId} from "nbook/server/agent/types";

type QueueItem = IteratorResult<AgentStreamEvent>;

type Subscriber = {
    push(event: AgentStreamEvent): void;
    close(): void;
};

/**
 * 归一化流式文本 chunk，兼容 provider 返回累计文本或带重叠前后缀的情况。
 */
function consumeStreamingText(previousText: string, rawChunk: string): string {
    if (!rawChunk) {
        return "";
    }
    if (rawChunk.startsWith(previousText)) {
        return rawChunk.slice(previousText.length);
    }
    const maxOverlap = Math.min(previousText.length, rawChunk.length);
    let overlapLength = 0;
    for (let index = maxOverlap; index > 0; index -= 1) {
        if (previousText.endsWith(rawChunk.slice(0, index))) {
            overlapLength = index;
            break;
        }
    }
    const shouldTrimOverlap = overlapLength >= Math.max(2, Math.ceil(rawChunk.length / 2));
    return shouldTrimOverlap ? rawChunk.slice(overlapLength) : rawChunk;
}

/**
 * 简单异步队列。
 * 用于把单个 live run 广播给多个订阅者。
 */
class AsyncEventQueue implements AsyncIterable<AgentStreamEvent>, AsyncIterator<AgentStreamEvent>, Subscriber {
    private readonly buffered: QueueItem[] = [];
    private readonly waiting: Array<(item: QueueItem) => void> = [];
    private ended = false;

    /**
     * 推入一条事件。
     */
    push(event: AgentStreamEvent): void {
        if (this.ended) {
            return;
        }
        const item: QueueItem = {done: false, value: event};
        const resolver = this.waiting.shift();
        if (resolver) {
            resolver(item);
            return;
        }
        this.buffered.push(item);
    }

    /**
     * 结束队列。
     */
    close(): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        const item: QueueItem = {done: true, value: undefined};
        for (const resolver of this.waiting.splice(0)) {
            resolver(item);
        }
    }

    /**
     * AsyncIterator.next。
     */
    next(): Promise<QueueItem> {
        const nextItem = this.buffered.shift();
        if (nextItem) {
            return Promise.resolve(nextItem);
        }
        if (this.ended) {
            return Promise.resolve({done: true, value: undefined});
        }
        return new Promise<QueueItem>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    /**
     * AsyncIterator.return。
     */
    async return(): Promise<QueueItem> {
        this.close();
        return {done: true, value: undefined};
    }

    [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent> {
        return this;
    }
}

/**
 * 当前活跃 run 会话。
 */
export class ActiveRunSession {
    private readonly subscribers = new Set<Subscriber>();
    private readonly tools = new Map<string, LiveToolState>();
    private readonly toolNodeIdsByCallIndex = new Map<number, string>();
    private readonly toolNodeIdsByToolCallId = new Map<string, string>();
    private readonly abortController = new AbortController();
    private assistantText = "";
    private thinkingText = "";
    private status: AgentThreadStatus = "running";
    private messageId = this.createMessageId();

    constructor(
        readonly threadId: ThreadId,
        readonly profileKey: ProfileKey,
    ) {}

    /**
     * 注册一个订阅者。
     */
    subscribe(_includeSnapshot = false): AsyncIterable<AgentStreamEvent> {
        const queue = new AsyncEventQueue();
        this.subscribers.add(queue);

        const self = this;
        return {
            [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent> {
                const iterator = queue[Symbol.asyncIterator]();
                return {
                    async next() {
                        return iterator.next();
                    },
                    async return() {
                        self.subscribers.delete(queue);
                        return iterator.return ? iterator.return() : {done: true, value: undefined};
                    },
                };
            },
        };
    }

    /**
     * 累积 assistant 文本。
     */
    appendAssistantText(chunkText: string): string {
        const nextDelta = consumeStreamingText(this.assistantText, chunkText);
        this.assistantText = `${this.assistantText}${nextDelta}`;
        return nextDelta;
    }

    /**
     * 累积 thinking 文本。
     */
    appendThinkingText(chunkText: string): string {
        const nextDelta = consumeStreamingText(this.thinkingText, chunkText);
        this.thinkingText = `${this.thinkingText}${nextDelta}`;
        return nextDelta;
    }

    /**
     * 重置当前 assistant 迭代快照。
     * 用于 LLM -> tools -> LLM 跨迭代时切分新的 assistant 气泡。
     */
    resetIteration(): void {
        this.assistantText = "";
        this.thinkingText = "";
        this.tools.clear();
        this.toolNodeIdsByCallIndex.clear();
        this.toolNodeIdsByToolCallId.clear();
        this.messageId = this.createMessageId();
    }

    /**
     * 确保工具草稿存在，并返回当前工具快照。
     */
    ensureToolDraft(chunk: {
        callIndex: number;
        toolName: string;
        toolCallId?: string;
        subagentThreadId?: string;
    }): LiveToolState {
        const existingByToolCallId = chunk.toolCallId ? this.toolNodeIdsByToolCallId.get(chunk.toolCallId) : undefined;
        const existingByCallIndex = this.toolNodeIdsByCallIndex.get(chunk.callIndex);
        const callIndex = this.resolveToolCallIndex(chunk.callIndex, existingByToolCallId, existingByCallIndex, chunk.toolCallId);
        const toolNodeId = existingByToolCallId ?? this.toolNodeIdsByCallIndex.get(callIndex) ?? this.createToolNodeId(callIndex);
        const previous = this.tools.get(toolNodeId);
        const next: LiveToolState = {
            toolNodeId,
            assistantMessageId: this.messageId,
            callIndex,
            toolCallId: chunk.toolCallId ?? previous?.toolCallId,
            toolName: chunk.toolName,
            argsText: previous?.argsText ?? "",
            status: previous?.status ?? "drafting",
            outputText: previous?.outputText ?? "",
            subagentThreadId: chunk.subagentThreadId ?? previous?.subagentThreadId,
        };
        this.toolNodeIdsByCallIndex.set(callIndex, toolNodeId);
        if (next.toolCallId) {
            this.toolNodeIdsByToolCallId.set(next.toolCallId, toolNodeId);
        }
        this.tools.set(toolNodeId, next);
        return next;
    }

    /**
     * 追加工具参数增量。
     */
    appendToolArgs(toolNodeId: string, argsChunk: string, subagentThreadId?: string): LiveToolState | null {
        const previous = this.tools.get(toolNodeId);
        if (!previous) {
            return null;
        }
        const next: LiveToolState = {
            ...previous,
            argsText: `${previous.argsText}${argsChunk}`,
            subagentThreadId: subagentThreadId ?? previous.subagentThreadId,
        };
        this.tools.set(toolNodeId, next);
        return next;
    }

    /**
     * 标记工具真正开始执行。
     */
    startToolExecution(toolNodeId: string, toolCallId?: string, subagentThreadId?: string): LiveToolState | null {
        const previous = this.tools.get(toolNodeId);
        if (!previous) {
            return null;
        }
        const next: LiveToolState = {
            ...previous,
            toolCallId: toolCallId ?? previous.toolCallId,
            status: "running",
            subagentThreadId: subagentThreadId ?? previous.subagentThreadId,
        };
        if (next.toolCallId) {
            this.toolNodeIdsByToolCallId.set(next.toolCallId, toolNodeId);
        }
        this.tools.set(toolNodeId, next);
        return next;
    }

    /**
     * 根据 toolCallId 追加工具输出。
     */
    appendToolOutput(toolCallId: string, outputChunk: string): LiveToolState | null {
        const toolNodeId = this.toolNodeIdsByToolCallId.get(toolCallId);
        if (!toolNodeId) {
            return null;
        }
        const previous = this.tools.get(toolNodeId);
        if (!previous) {
            return null;
        }
        const next: LiveToolState = {
            ...previous,
            outputText: `${previous.outputText}${outputChunk}`,
        };
        this.tools.set(toolNodeId, next);
        return next;
    }

    /**
     * 标记工具结束。
     */
    finishTool(toolNodeId: string, toolCallId: string | undefined, outputText: string, status: "success" | "error", subagentThreadId?: string): LiveToolState | null {
        const previous = this.tools.get(toolNodeId);
        if (!previous) {
            return null;
        }
        const next: LiveToolState = {
            ...previous,
            toolCallId: toolCallId ?? previous.toolCallId,
            status,
            outputText,
            subagentThreadId: subagentThreadId ?? previous.subagentThreadId,
        };
        if (next.toolCallId) {
            this.toolNodeIdsByToolCallId.set(next.toolCallId, toolNodeId);
        }
        this.tools.set(toolNodeId, next);
        return next;
    }

    /**
     * 通过 toolCallId 查询 toolNodeId。
     */
    getToolNodeId(toolCallId: string): string | undefined {
        return this.toolNodeIdsByToolCallId.get(toolCallId);
    }

    /**
     * 更新线程状态。
     */
    setStatus(status: AgentThreadStatus): void {
        this.status = status;
    }

    /**
     * 主动停止本次运行。
     */
    stop(): void {
        this.abortController.abort();
    }

    /**
     * 广播事件。
     */
    publish(event: AgentStreamEvent): void {
        for (const subscriber of this.subscribers) {
            subscriber.push(event);
        }
    }

    /**
     * 关闭全部订阅者。
     */
    complete(): void {
        for (const subscriber of this.subscribers) {
            subscriber.close();
        }
        this.subscribers.clear();
    }

    /**
     * 当前快照。
     */
    get snapshot(): LiveRunSnapshot {
        return {
            threadId: this.threadId,
            status: this.status,
            messageId: this.messageId,
            text: this.assistantText,
            thinkingText: this.thinkingText,
            tools: [...this.tools.values()].sort((left, right) => left.callIndex - right.callIndex),
        };
    }

    /**
     * 暴露当前运行的 abort signal。
     */
    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    private createMessageId(): string {
        return `${this.threadId}-assistant-${crypto.randomUUID()}`;
    }

    private createToolNodeId(callIndex: number): string {
        return `${this.messageId}-tool-${String(callIndex)}`;
    }

    /**
     * 兼容部分 provider 重复返回 callIndex 的情况。
     * toolCallId 不同表示不同工具调用，需要分配新的本地序号，避免 toolNodeId 撞车。
     */
    private resolveToolCallIndex(
        requestedCallIndex: number,
        existingByToolCallId: string | undefined,
        existingByCallIndex: string | undefined,
        nextToolCallId: string | undefined,
    ): number {
        if (existingByToolCallId) {
            return this.tools.get(existingByToolCallId)?.callIndex ?? requestedCallIndex;
        }
        if (!existingByCallIndex) {
            return requestedCallIndex;
        }
        const previous = this.tools.get(existingByCallIndex);
        if (!previous?.toolCallId || !nextToolCallId || previous.toolCallId === nextToolCallId) {
            return requestedCallIndex;
        }
        let nextCallIndex = requestedCallIndex;
        while (this.toolNodeIdsByCallIndex.has(nextCallIndex)) {
            nextCallIndex += 1;
        }
        return nextCallIndex;
    }
}

/**
 * live run 注册表。
 */
export class LiveRunRegistry {
    private readonly sessions = new Map<ThreadId, ActiveRunSession>();

    /**
     * 打开活跃会话。
     */
    open(threadId: ThreadId, profileKey: ProfileKey): ActiveRunSession {
        if (this.sessions.has(threadId)) {
            throw new Error(`thread ${threadId} 当前已有活跃 run`);
        }
        const session = new ActiveRunSession(threadId, profileKey);
        this.sessions.set(threadId, session);
        return session;
    }

    /**
     * 获取当前活跃会话。
     */
    get(threadId: ThreadId): ActiveRunSession | null {
        return this.sessions.get(threadId) ?? null;
    }

    /**
     * 关闭会话。
     */
    close(threadId: ThreadId): void {
        const session = this.sessions.get(threadId);
        if (!session) {
            return;
        }
        session.complete();
        this.sessions.delete(threadId);
    }
}
