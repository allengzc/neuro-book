import {appendFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import type {AgentMessage, JsonValue, Message} from "nbook/server/agent/messages/types";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {
    CompactionSessionEntry,
    LinkedAgentSummary,
    NeuroSessionContext,
    SessionEntry,
    SessionEntryId,
    SessionFileRecord,
    SessionId,
    SessionMetadata,
    SessionProjectionScope,
    SessionSnapshot,
    SessionTreeNode,
    SessionEntryDraft,
} from "nbook/server/agent/session/types";
import type {AgentSessionListQueryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

type CreateSessionInput = {
    profileKey: string;
    input: JsonValue;
    workspaceRoot: string;
    workspaceKey?: string;
    projectPath?: string;
    parentSessionId?: SessionId;
    systemRole?: SessionMetadata["systemRole"];
    title?: string;
};

type AppendEntryInput = SessionEntryDraft & {
    id?: SessionEntryId;
    parentId?: SessionEntryId | null;
    timestamp?: number;
};
type AppendBatchEntryInput = Exclude<AppendEntryInput, {type: "leaf"}>;

/**
 * JSONL session 仓库。所有状态变化都通过 append entry 表达。
 */
export class JsonlSessionRepository {
    readonly rootWorkspace: string;

    constructor(rootWorkspace = resolve(process.cwd(), "workspace")) {
        this.rootWorkspace = rootWorkspace;
    }

    /**
     * 创建一个空 session，只写 header 和初始 leaf。
     */
    async createSession(input: CreateSessionInput): Promise<SessionSnapshot> {
        const sessionId = await this.nextSessionId();
        const now = Date.now();
        const metadata: SessionMetadata = {
            sessionId,
            profileKey: input.profileKey,
            input: input.input,
            workspaceRoot: input.workspaceRoot,
            workspaceKey: input.workspaceKey ?? "global",
            projectPath: input.projectPath,
            parentSessionId: input.parentSessionId,
            systemRole: input.systemRole,
            createdAt: now,
            title: input.title,
        };
        const sessionPath = this.sessionPath(sessionId);
        await mkdir(dirname(sessionPath), {recursive: true});
        await writeFile(sessionPath, `${JSON.stringify({kind: "header", metadata} satisfies SessionFileRecord)}\n`, "utf8");
        await this.appendEntry(sessionId, {
            type: "leaf",
            leafId: null,
        }, metadata.workspaceKey);
        return this.readSession(sessionId, metadata.workspaceKey);
    }

    /**
     * 读取 session。workspaceKey 仅为旧调用点保留，不参与路径定位。
     */
    async readSession(sessionId: SessionId, workspaceKey?: string): Promise<SessionSnapshot> {
        const sessionPath = this.sessionPath(sessionId);
        const text = await readFile(sessionPath, "utf8");
        const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SessionFileRecord);
        const header = records.find((record): record is Extract<SessionFileRecord, {kind: "header"}> => record.kind === "header");
        if (!header) {
            throw new Error(`session ${sessionId} 缺少 header`);
        }

        const entries = records.flatMap((record) => {
            if (record.kind === "entry") {
                return [record.entry];
            }
            if (record.kind === "batch") {
                return record.entries;
            }
            return [];
        });
        return {
            metadata: header.metadata,
            entries,
            leafId: this.resolveLeaf(entries),
        };
    }

    /**
     * 列出指定 workspace 下的 session 摘要。默认隐藏 archived session。
     */
    async listSessions(input: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> {
        const sessionsRoot = join(this.rootWorkspace, ".nbook", "agent", "sessions");
        const files = await readdir(sessionsRoot, {withFileTypes: true}).catch(() => []);
        const summaries: AgentSessionSummaryDto[] = [];

        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith(".jsonl")) {
                continue;
            }
            const sessionId = Number(file.name.slice(0, -".jsonl".length));
            if (!Number.isInteger(sessionId) || sessionId <= 0) {
                continue;
            }
            const snapshot = await this.readSession(sessionId);
            const summary = this.summary(snapshot);
            if (!this.matchesSessionListFilter(summary, input)) {
                continue;
            }
            summaries.push(summary);
        }

        const sorted = summaries.sort((left, right) => right.updatedAt - left.updatedAt);
        return input.limit ? sorted.slice(0, input.limit) : sorted;
    }

    /**
     * 判断 session 摘要是否符合列表查询筛选条件。
     */
    private matchesSessionListFilter(summary: AgentSessionSummaryDto, input: AgentSessionListQueryDto): boolean {
        if (!input.includeSystem && summary.systemRole) {
            return false;
        }
        if (!input.includeArchived && summary.archived) {
            return false;
        }
        if (input.profileGroup === "leader" && !this.isLeaderProfile(summary.profileKey)) {
            return false;
        }
        if (input.workspaceKey && summary.workspaceKey !== input.workspaceKey) {
            return false;
        }
        if (input.relation === "top" && summary.parentSessionId) {
            return false;
        }
        if (input.relation === "child" && !summary.parentSessionId) {
            return false;
        }
        if (!input.status || input.status === "all") {
            return true;
        }
        if (input.status === "running" || input.status === "waiting") {
            return false;
        }
        if (input.status === "active") {
            return !summary.archived;
        }
        return summary.status === input.status;
    }

    /**
     * Leader profile 采用 profileKey 命名约定筛选。
     */
    private isLeaderProfile(profileKey: string): boolean {
        return profileKey === "leader.default" || profileKey === "leader.assets" || profileKey.startsWith("leader.");
    }

    /**
     * 追加 entry，并在非 leaf entry 后自动移动 leaf。
     */
    async appendEntry(sessionId: SessionId, input: AppendEntryInput, workspaceKey?: string): Promise<SessionEntry> {
        const snapshot = await this.readSession(sessionId);
        const currentLeafId = this.resolveLeaf(snapshot.entries);
        const parentId = input.parentId === undefined ? currentLeafId : input.parentId;
        const entry = {
            ...input,
            id: input.id ?? this.createEntryId(),
            parentId,
            timestamp: input.timestamp ?? Date.now(),
        } as SessionEntry;
        const sessionPath = this.sessionPath(sessionId);

        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "entry", entry});
        if (entry.type !== "leaf") {
            await this.appendLine(sessionPath, {
                kind: "entry",
                entry: {
                    id: this.createEntryId(),
                    parentId: entry.id,
                    timestamp: Date.now(),
                    type: "leaf",
                    leafId: entry.id,
                },
            });
        }
        return entry;
    }

    /**
     * 追加投影型 entry，但不移动 active leaf。用于后台元数据，不改变用户当前分支。
     */
    async appendProjectionEntry(sessionId: SessionId, input: AppendEntryInput, projectionScope?: SessionProjectionScope, workspaceKey?: string): Promise<SessionEntry> {
        const snapshot = await this.readSession(sessionId);
        const currentLeafId = this.resolveLeaf(snapshot.entries);
        const entry = {
            ...input,
            origin: input.type === "custom" || input.type === "session_update" ? "projection" : undefined,
            projectionScope: input.type === "custom" || input.type === "session_update" ? projectionScope : undefined,
            id: input.id ?? this.createEntryId(),
            parentId: input.parentId === undefined ? currentLeafId : input.parentId,
            timestamp: input.timestamp ?? Date.now(),
        } as SessionEntry;
        const sessionPath = this.sessionPath(sessionId);

        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "entry", entry});
        return entry;
    }

    /**
     * 一次性追加多条 entry，并只在 batch 最后移动 leaf。
     * 用于普通 agent turn commit，避免 assistant/toolResult 之间出现可见半提交状态。
     */
    async appendEntries(sessionId: SessionId, inputs: AppendBatchEntryInput[], workspaceKey?: string): Promise<SessionEntry[]> {
        if (inputs.length === 0) {
            return [];
        }
        const snapshot = await this.readSession(sessionId);
        const entries: SessionEntry[] = [];
        let currentParentId = this.resolveLeaf(snapshot.entries);

        for (const input of inputs) {
            const parentId = input.parentId === undefined ? currentParentId : input.parentId;
            const entry = {
                ...input,
                id: input.id ?? this.createEntryId(),
                parentId,
                timestamp: input.timestamp ?? Date.now(),
            } as SessionEntry;
            entries.push(entry);
            if (entry.type !== "leaf") {
                currentParentId = entry.id;
            }
        }

        const lastNonLeaf = [...entries].reverse().find((entry) => entry.type !== "leaf");
        if (lastNonLeaf) {
            entries.push({
                id: this.createEntryId(),
                parentId: lastNonLeaf.id,
                timestamp: Date.now(),
                type: "leaf",
                leafId: lastNonLeaf.id,
            });
        }

        const sessionPath = this.sessionPath(sessionId);
        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "batch", entries});
        return entries.filter((entry) => entry.type !== "leaf");
    }

    /**
     * 追加普通 message entry。
     */
    async appendMessage(sessionId: SessionId, message: Message, workspaceKey?: string, origin?: "prompt" | "harness" | "manual" | "ingest"): Promise<SessionEntry> {
        return this.appendEntry(sessionId, {
            type: "message",
            message,
            origin,
        }, workspaceKey);
    }

    /**
     * 追加用户输入 message。
     */
    async appendUserMessage(sessionId: SessionId, text: string, workspaceKey?: string): Promise<SessionEntry> {
        return this.appendMessage(sessionId, createUserMessage({text}), workspaceKey, "manual");
    }

    /**
     * 移动 active leaf，不删除任何历史。
     */
    async moveLeaf(sessionId: SessionId, leafId: SessionEntryId | null, workspaceKey?: string): Promise<SessionEntry> {
        return this.appendEntry(sessionId, {
            type: "leaf",
            leafId,
        }, workspaceKey);
    }

    /**
     * 从当前 leaf 回溯到 root。
     */
    activePath(snapshot: SessionSnapshot): SessionEntry[] {
        if (!snapshot.leafId) {
            return [];
        }
        const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
        const path: SessionEntry[] = [];
        let cursor: SessionEntryId | null = snapshot.leafId;

        while (cursor) {
            const entry = byId.get(cursor);
            if (!entry) {
                break;
            }
            if (entry.type !== "leaf") {
                path.push(entry);
            }
            cursor = entry.parentId;
        }

        return path.reverse();
    }

    /**
     * 将 active path reduce 成 harness context。
     */
    reduce(snapshot: SessionSnapshot): NeuroSessionContext {
        const path = this.activePath(snapshot);
        const pathIds = new Set(path.map((entry) => entry.id));
        const messages: AgentMessage[] = [];
        const customState: Record<string, JsonValue> = {};
        let profileKey = snapshot.metadata.profileKey;
        let model: NeuroSessionContext["model"] = null;
        let thinkingLevel: NeuroSessionContext["thinkingLevel"] = null;
        let title = snapshot.metadata.title;
        let summary = snapshot.metadata.summary;
        let compaction: CompactionSessionEntry | null = null;
        const linkedAgents = new Map<SessionId, LinkedAgentSummary>();
        let archived = false;
        let planModeActive = false;

        const reduceEntries = snapshot.entries.filter((entry) => {
            if (pathIds.has(entry.id)) {
                return true;
            }
            return (entry.type === "custom" || entry.type === "session_update")
                && entry.origin === "projection"
                && this.projectionApplies(entry.projectionScope, pathIds);
        });

        for (const entry of reduceEntries) {
            if (entry.type === "message") {
                messages.push(entry.message);
                continue;
            }
            if (entry.type === "custom_message" && entry.visibleToModel) {
                messages.push(entry.message);
                continue;
            }
            if (entry.type === "custom") {
                customState[entry.key] = entry.value;
                if (entry.origin !== "projection") {
                    this.reduceLinkedAgent(entry.key, entry.value, linkedAgents);
                }
                if (entry.origin !== "projection" && entry.key === "ui.planMode.active") {
                    planModeActive = entry.value === true;
                }
                continue;
            }
            if (entry.type === "session_update") {
                title = entry.updates.title ?? title;
                summary = entry.updates.summary ?? summary;
                continue;
            }
            if (entry.type === "model_change") {
                model = entry.model;
                continue;
            }
            if (entry.type === "thinking_level_change") {
                thinkingLevel = entry.thinkingLevel;
                continue;
            }
            if (entry.type === "profile_change") {
                profileKey = entry.profileKey;
                continue;
            }
            if (entry.type === "variable_patch") {
                customState[`variablePatch:${entry.namespace}.${entry.path}`] = {
                    operations: entry.operations,
                    source: entry.source,
                    invocationId: entry.invocationId ?? null,
                    toolCallId: entry.toolCallId ?? null,
                };
                continue;
            }
            if (entry.type === "session_archived") {
                archived = true;
                continue;
            }
            if (entry.type === "compaction") {
                compaction = entry;
            }
        }

        const compactedMessages = compaction ? this.applyCompaction(path, compaction, messages) : messages;

        return {
            systemPrompt: "",
            messages: compactedMessages,
            model,
            thinkingLevel,
            profileKey,
            workspaceRoot: snapshot.metadata.workspaceRoot,
            projectPath: snapshot.metadata.projectPath,
            customState,
            linkedAgents: [...linkedAgents.values()].sort((left, right) => left.sessionId - right.sessionId),
            title,
            summary,
            archived,
            planModeActive,
        };
    }

    /**
     * 从 session active path 生成前端列表摘要。
     */
    summary(snapshot: SessionSnapshot): AgentSessionSummaryDto {
        const context = this.reduce(snapshot);
        const path = this.activePath(snapshot);
        const lastMessage = [...path].reverse().find((entry) => entry.type === "message");
        const lastAssistant = [...context.messages].reverse().find((message) => message.role === "assistant");
        const updatedAt = path.at(-1)?.timestamp ?? snapshot.metadata.createdAt;
        const interrupted = [...path].reverse().find((entry) => entry.type === "invocation_lifecycle");

        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: context.profileKey,
            workspaceKey: snapshot.metadata.workspaceKey,
            workspaceRoot: context.workspaceRoot,
            parentSessionId: snapshot.metadata.parentSessionId,
            systemRole: snapshot.metadata.systemRole,
            title: context.title,
            summary: context.summary,
            status: context.archived
                ? "archived"
                : interrupted?.type === "invocation_lifecycle" && interrupted.status === "start" ? "interrupted" : "idle",
            updatedAt,
            archived: context.archived,
            lastMessagePreview: lastMessage?.type === "message" ? messageText(lastMessage.message).slice(0, 160) : undefined,
            usage: lastAssistant?.role === "assistant" ? lastAssistant.usage : undefined,
        };
    }

    /**
     * 返回树节点摘要，供 /tree 展示或测试断言。
     */
    tree(snapshot: SessionSnapshot): SessionTreeNode[] {
        const activeIds = new Set(this.activePath(snapshot).map((entry) => entry.id));
        const childCountByParentId = new Map<SessionEntryId | null, number>();
        const labelsByTargetId = new Map<SessionEntryId, string>();
        for (const entry of snapshot.entries) {
            if (entry.type === "leaf" || ("origin" in entry && entry.origin === "projection")) {
                continue;
            }
            childCountByParentId.set(entry.parentId, (childCountByParentId.get(entry.parentId) ?? 0) + 1);
            if (entry.type === "label") {
                labelsByTargetId.set(entry.targetEntryId, entry.label);
            }
        }
        return snapshot.entries
            .filter((entry) => entry.type !== "leaf" && (!("origin" in entry) || entry.origin !== "projection"))
            .map((entry) => ({
                id: entry.id,
                parentId: entry.parentId,
                type: entry.type,
                timestamp: entry.timestamp,
                active: activeIds.has(entry.id),
                terminal: !childCountByParentId.has(entry.id),
                childCount: childCountByParentId.get(entry.id) ?? 0,
                role: entry.type === "message" ? entry.message.role : entry.type === "custom_message" ? entry.message.role : undefined,
                messageId: entry.type === "message" || entry.type === "custom_message" ? entry.id : undefined,
                preview: this.treeNodePreview(entry),
                toolName: entry.type === "message" && entry.message.role === "toolResult"
                    ? entry.message.toolName
                    : undefined,
                label: labelsByTargetId.get(entry.id),
            }));
    }

    /**
     * 生成 tree 面板用的短预览。只用于 UI 摘要，不参与 reduce。
     */
    private treeNodePreview(entry: SessionEntry): string | undefined {
        if (entry.type === "message") {
            return messageText(entry.message).replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
        }
        if (entry.type === "custom_message") {
            return entry.message.role;
        }
        if (entry.type === "compaction") {
            return entry.summary.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
        }
        if (entry.type === "branch_summary") {
            return entry.summary.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
        }
        if (entry.type === "session_update") {
            return entry.updates.title || entry.updates.summary;
        }
        if (entry.type === "label") {
            return entry.label;
        }
        if (entry.type === "invocation_lifecycle") {
            return `${entry.invocationId} ${entry.status}`;
        }
        if (entry.type === "custom") {
            return entry.key;
        }
        return undefined;
    }

    /**
     * 创建新 session，并从指定 entry 附带 parent session 信息。
     */
    async forkSession(sessionId: SessionId, entryId?: SessionEntryId): Promise<SessionSnapshot> {
        const snapshot = await this.readSession(sessionId);
        const fork = await this.createSession({
            profileKey: snapshot.metadata.profileKey,
            input: snapshot.metadata.input,
            workspaceRoot: snapshot.metadata.workspaceRoot,
            workspaceKey: snapshot.metadata.workspaceKey,
            projectPath: snapshot.metadata.projectPath,
            parentSessionId: sessionId,
            title: snapshot.metadata.title,
        });
        if (entryId) {
            await this.appendEntry(fork.metadata.sessionId, {
                type: "custom",
                key: "fork.fromEntryId",
                value: entryId,
            }, fork.metadata.workspaceKey);
        }
        return this.readSession(fork.metadata.sessionId, fork.metadata.workspaceKey);
    }

    private applyCompaction(path: SessionEntry[], compaction: CompactionSessionEntry, messages: AgentMessage[]): AgentMessage[] {
        const summaryMessage: AgentMessage = {
            role: "user",
            content: [{
                type: "text",
                text: compaction.summary,
            }],
            timestamp: compaction.timestamp,
        };
        if (!compaction.firstKeptEntryId) {
            return [summaryMessage];
        }

        const keptEntryIds = new Set(path.slice(path.findIndex((entry) => entry.id === compaction.firstKeptEntryId)).map((entry) => entry.id));
        const keptMessages: AgentMessage[] = [];
        for (const entry of path) {
            if (!keptEntryIds.has(entry.id)) {
                continue;
            }
            if (entry.type === "message") {
                keptMessages.push(entry.message);
            }
            if (entry.type === "custom_message" && entry.visibleToModel) {
                keptMessages.push(entry.message);
            }
        }
        return [summaryMessage, ...keptMessages.length ? keptMessages : messages.slice(-4)];
    }

    private reduceLinkedAgent(key: string, value: JsonValue, linkedAgents: Map<SessionId, LinkedAgentSummary>): void {
        if (key.startsWith("agent.link.") && this.isLinkedAgentValue(value)) {
            const current = linkedAgents.get(value.sessionId);
            linkedAgents.set(value.sessionId, {
                sessionId: value.sessionId,
                profileKey: value.profileKey,
                detached: current?.detached ?? false,
            });
            return;
        }
        if (key.startsWith("agent.detach.") && this.isDetachedAgentValue(value)) {
            const current = linkedAgents.get(value.sessionId);
            linkedAgents.set(value.sessionId, {
                sessionId: value.sessionId,
                profileKey: current?.profileKey ?? "unknown",
                detached: true,
            });
        }
    }

    private projectionApplies(scope: SessionProjectionScope | undefined, activePathIds: Set<SessionEntryId>): boolean {
        if (!scope) {
            return true;
        }
        return scope.scope === "activeLeaf" && (scope.leafId === null ? activePathIds.size === 0 : activePathIds.has(scope.leafId));
    }

    private isLinkedAgentValue(value: JsonValue): value is {sessionId: number; profileKey: string} {
        return Boolean(
            value
            && typeof value === "object"
            && !Array.isArray(value)
            && typeof value.sessionId === "number"
            && typeof value.profileKey === "string",
        );
    }

    private isDetachedAgentValue(value: JsonValue): value is {sessionId: number} {
        return Boolean(
            value
            && typeof value === "object"
            && !Array.isArray(value)
            && typeof value.sessionId === "number",
        );
    }

    private async nextSessionId(): Promise<SessionId> {
        const seqPath = join(this.rootWorkspace, ".nbook", "agent", "session-seq.json");
        await mkdir(dirname(seqPath), {recursive: true});
        let next = 1;
        try {
            const current = JSON.parse(await readFile(seqPath, "utf8")) as {next?: unknown};
            if (typeof current.next === "number" && Number.isInteger(current.next) && current.next > 0) {
                next = current.next;
            }
        } catch {
            next = 1;
        }
        await writeFile(seqPath, JSON.stringify({next: next + 1}, null, 2), "utf8");
        return next;
    }

    private resolveLeaf(entries: SessionEntry[]): SessionEntryId | null {
        let leafId: SessionEntryId | null = null;
        for (const entry of entries) {
            if (entry.type === "leaf") {
                leafId = entry.leafId;
            }
        }
        return leafId;
    }

    private sessionPath(sessionId: SessionId): string {
        return join(this.rootWorkspace, ".nbook", "agent", "sessions", `${sessionId}.jsonl`);
    }

    private createEntryId(): SessionEntryId {
        return randomUUID();
    }

    private async appendLine(path: string, record: SessionFileRecord): Promise<void> {
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    }
}
