import type {
    AgentSubagentVariables,
    AgentVariableScope,
    AgentVariables,
    ClientVariables,
    IdeVariables,
    JsonObject,
    JsonValue,
    ProfileInput,
    ProfileInputMap,
    ProfileKey,
    StudioVariables,
    ThreadId,
} from "nbook/server/agent/types";

type MutableAgentVariableScope = {
    ide: IdeVariables;
    studio: StudioVariables;
    agent: AgentVariables;
    input: ProfileInput<ProfileKey>;
};

/**
 * 判断原始对象是否包含某个 key。
 */
function hasOwn(source: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * 读取字符串值。
 * 空字符串会归一化为 null，保持现有 prompt 语义。
 */
function readString(value: JsonValue | undefined): string | null {
    return typeof value === "string" && value ? value : null;
}

/**
 * 读取布尔值。
 */
function readBoolean(value: JsonValue | undefined): boolean {
    return typeof value === "boolean" ? value : false;
}

/**
 * 读取数字值。
 */
function readNumber(value: JsonValue | undefined): number | null {
    return typeof value === "number" ? value : null;
}

/**
 * 读取当前工作区类型。
 */
function readWorkspaceKind(value: JsonValue | undefined): StudioVariables["workspaceKind"] {
    return value === "novel" || value === "user-assets" ? value : null;
}

/**
 * 创建一个默认变量快照。
 */
function createDefaultScope(): MutableAgentVariableScope {
    return {
        ide: {
            panel: null,
            activePanel: null,
            theme: null,
            extra: {},
        },
        studio: {
            novelId: null,
            selectedChapterId: null,
            previousSelectedChapterId: null,
            currentChapterTitle: null,
            previousChapterTitle: null,
            currentChapterLabel: null,
            previousChapterLabel: null,
            workspace: null,
            workspaceKind: null,
            didSwitchChapter: false,
            selectionVersion: null,
            extra: {},
        },
        agent: {
            thread: {
                id: "",
                title: "",
                summary: "",
                status: "idle",
            },
            profileKey: "leader.default",
            kind: "leader",
            tools: [],
            subagents: [],
            tasks: null,
        },
        input: {
            prompt: "",
        },
    };
}

/**
 * 克隆为只读 scope。
 * 这里通过 unknown 做泛型桥接：运行时 scope 已由 setAgent/setInput 保证和 TKey 对齐。
 */
function cloneReadonlyScope<TKey extends ProfileKey = ProfileKey, TInput = ProfileInput<TKey>>(scope: MutableAgentVariableScope): AgentVariableScope<TKey, TInput> {
    return structuredClone(scope) as unknown as AgentVariableScope<TKey, TInput>;
}

/**
 * Agent 全局变量 store。
 * 以 threadId 作为隔离粒度，保存每个线程的最新变量快照。
 */
export class AgentVariableStore {
    private readonly scopes = new Map<ThreadId, MutableAgentVariableScope>();

    /**
     * 读取当前线程的变量快照。
     */
    getScope<TKey extends ProfileKey, TInput = ProfileInput<TKey>>(threadId: ThreadId): AgentVariableScope<TKey, TInput> {
        return cloneReadonlyScope<TKey, TInput>(this.ensureScope(threadId));
    }

    /**
     * 删除线程变量快照。
     */
    deleteScope(threadId: ThreadId): void {
        this.scopes.delete(threadId);
    }

    /**
     * 用前端快照更新 ide/studio 命名空间。
     */
    syncClientVariables(threadId: ThreadId, clientVariables: ClientVariables): AgentVariableScope {
        const scope = this.ensureScope(threadId);
        if (clientVariables.ide) {
            this.patchIde(scope.ide, clientVariables.ide);
        }
        if (clientVariables.studio) {
            this.patchStudio(scope.studio, clientVariables.studio);
        }
        return cloneReadonlyScope(scope);
    }

    /**
     * 覆盖当前线程的输入快照。
     */
    setInput<TKey extends ProfileKey, TInput = ProfileInput<TKey>>(threadId: ThreadId, input: TInput): AgentVariableScope<TKey, TInput> {
        const scope = this.ensureScope(threadId);
        scope.input = structuredClone(input) as ProfileInput<ProfileKey>;
        return cloneReadonlyScope<TKey, TInput>(scope);
    }

    /**
     * 覆盖当前线程的 agent 命名空间。
     */
    setAgent<TKey extends ProfileKey, TInput = ProfileInput<TKey>>(threadId: ThreadId, agent: AgentVariables<TKey>): AgentVariableScope<TKey, TInput> {
        const scope = this.ensureScope(threadId);
        scope.agent = structuredClone(agent) as AgentVariables;
        return cloneReadonlyScope<TKey, TInput>(scope);
    }

    /**
     * 由 tool 显式更新 ide 命名空间。
     */
    patchIdeScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        const scope = this.ensureScope(threadId);
        this.patchIde(scope.ide, patch);
        return cloneReadonlyScope(scope);
    }

    /**
     * 由 tool 显式更新 studio 命名空间。
     */
    patchStudioScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        const scope = this.ensureScope(threadId);
        this.patchStudio(scope.studio, patch);
        return cloneReadonlyScope(scope);
    }

    /**
     * 获取或创建一个线程快照。
     */
    private ensureScope(threadId: ThreadId): MutableAgentVariableScope {
        const existing = this.scopes.get(threadId);
        if (existing) {
            return existing;
        }
        const created = createDefaultScope();
        this.scopes.set(threadId, created);
        return created;
    }

    /**
     * 合并 ide 命名空间。
     */
    private patchIde(target: IdeVariables, patch: JsonObject): void {
        if (hasOwn(patch, "panel")) {
            target.panel = readString(patch.panel);
        }
        if (hasOwn(patch, "activePanel")) {
            target.activePanel = readString(patch.activePanel);
        }
        if (hasOwn(patch, "theme")) {
            target.theme = readString(patch.theme);
        }

        for (const [key, value] of Object.entries(patch)) {
            if (key === "panel" || key === "activePanel" || key === "theme") {
                continue;
            }
            target.extra[key] = value;
        }
    }

    /**
     * 合并 studio 命名空间。
     */
    private patchStudio(target: StudioVariables, patch: JsonObject): void {
        if (hasOwn(patch, "novelId")) {
            target.novelId = readString(patch.novelId);
        }
        if (hasOwn(patch, "selectedChapterId")) {
            target.selectedChapterId = readString(patch.selectedChapterId);
        }
        if (hasOwn(patch, "previousSelectedChapterId")) {
            target.previousSelectedChapterId = readString(patch.previousSelectedChapterId);
        }
        if (hasOwn(patch, "currentChapterTitle")) {
            target.currentChapterTitle = readString(patch.currentChapterTitle);
        }
        if (hasOwn(patch, "previousChapterTitle")) {
            target.previousChapterTitle = readString(patch.previousChapterTitle);
        }
        if (hasOwn(patch, "currentChapterLabel")) {
            target.currentChapterLabel = readString(patch.currentChapterLabel);
        }
        if (hasOwn(patch, "previousChapterLabel")) {
            target.previousChapterLabel = readString(patch.previousChapterLabel);
        }
        if (hasOwn(patch, "workspace")) {
            target.workspace = readString(patch.workspace);
        }
        if (hasOwn(patch, "workspaceKind")) {
            target.workspaceKind = readWorkspaceKind(patch.workspaceKind);
        }
        if (hasOwn(patch, "didSwitchChapter")) {
            target.didSwitchChapter = readBoolean(patch.didSwitchChapter);
        }
        if (hasOwn(patch, "selectionVersion")) {
            target.selectionVersion = readNumber(patch.selectionVersion);
        }

        for (const [key, value] of Object.entries(patch)) {
            if (
                key === "novelId"
                || key === "selectedChapterId"
                || key === "previousSelectedChapterId"
                || key === "currentChapterTitle"
                || key === "previousChapterTitle"
                || key === "currentChapterLabel"
                || key === "previousChapterLabel"
                || key === "workspace"
                || key === "workspaceKind"
                || key === "didSwitchChapter"
                || key === "selectionVersion"
            ) {
                continue;
            }
            target.extra[key] = value;
        }
    }
}
