import {resolve, join, relative} from "node:path";
import type {AgentToolCall} from "@earendil-works/pi-agent-core";
import type {AgentMessage, AssistantMessage, JsonValue, Message, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentCatalogItem, AgentProfile, ProfileCompactionPlan, ProfilePrepareContext, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {planModeDirectory} from "nbook/server/agent/plan-mode-path";
import {AGENT_PLAN_MODE_STATE_KEY, AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {ProfileVariablePathInput, VariableNamespace} from "nbook/server/agent/variables/types";

export type ProfileDslChild = ProfileDslNode | string | number | boolean | null | undefined | ProfileDslChild[];

export type ProfileDslNode =
    | ProfilePromptNode
    | ProfileSetNode
    | ProfileCompactionNode
    | ProfileCompactionTextNode
    | ProfileMessageNode
    | ProfileToolCallNode
    | ProfileReminderNode
    | ProfileWatchNode
    | ProfileIfNode
    | ProfileStringFragmentNode
    | ProfileVariableNode
    | ProfileVariableSchemaNode
    | ProfilePlanModeSlotNode
    | ProfileFragmentNode;

export type ProfilePromptNode = {
    kind: "ProfilePrompt";
    children: ProfileDslChild[];
};

export type ProfileSetNode = {
    kind: "System" | "HistorySet" | "ModelContext" | "AppendingSet";
    children: ProfileDslChild[];
};

export type ProfileCompactionNode = {
    kind: "Compaction";
    enabled?: boolean;
    triggerPercent?: number;
    triggerTokens?: number;
    reserveTokens?: number;
    keepRecentTokens?: number;
    keepRecentPercent?: number;
    children: ProfileDslChild[];
};

export type ProfileCompactionTextNode = {
    kind: "CompactionPrompt" | "CompactionSummaryPrefix";
    children: ProfileDslChild[];
};

export type ProfileMessageNode = {
    kind: "Message" | "AIMessage" | "ToolResult";
    role?: "user" | "assistant" | "toolResult" | "system";
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    children: ProfileDslChild[];
};

export type ProfileToolCallNode = {
    kind: "ToolCall";
    id: string;
    name: string;
    args?: Record<string, unknown>;
};

export type ProfileReminderNode = {
    kind: "Reminder";
    id: string;
    when: boolean;
    watchPath?: ProfileVariablePathInput;
    watchValue?: JsonValue;
    watch?: (ctx: ProfilePrepareContext<any>) => JsonValue | undefined | Promise<JsonValue | undefined>;
    render?: (change: ReminderChange) => ProfileDslChild | Promise<ProfileDslChild>;
    repeatEveryTurns?: number;
    children: ProfileDslChild[];
};

export type ReminderChange = {
    previousValue: JsonValue | undefined;
    currentValue: JsonValue | undefined;
    hasPreviousValue: boolean;
    hasCurrentValue: boolean;
    didChange: boolean;
    session: NeuroSessionContext;
};

export type WatchChange = {
    previousValue: JsonValue | undefined;
    currentValue: JsonValue | undefined;
    path: string;
    hasPreviousValue: boolean;
    hasCurrentValue: boolean;
    session: NeuroSessionContext;
};

export type ProfileWatchNode = {
    kind: "Watch";
    id?: string;
    path?: string;
    value?: JsonValue;
    render?: (change: WatchChange) => ProfileDslChild | Promise<ProfileDslChild>;
    children: ProfileDslChild[];
};

export type ProfileIfNode = {
    kind: "If";
    condition: boolean;
    children: ProfileDslChild[];
};

export type ProfileStringFragmentNode = {
    kind: "StringFragment";
    text: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>);
};

export type ProfileVariableNode = {
    kind: "Variable";
    path: ProfileVariablePathInput;
    label?: string;
    maxBytes?: number;
};

export type ProfileVariableSchemaNode = {
    kind: "VariableSchema";
    namespace?: VariableNamespace;
    prefix?: string;
    paths?: ProfileVariablePathInput[];
    writableOnly?: boolean;
    detail?: boolean;
    includeToolGuide?: boolean;
};

export type PlanModeSlotKind = "full" | "sparse" | "exit" | "reentry_full";

export type ProfilePlanModeSlotNode = {
    kind: "PlanModeSlot";
    slot: PlanModeSlotKind;
    children: ProfileDslChild[];
};

export type ProfileFragmentNode = {
    kind: "Fragment";
    children: ProfileDslChild[];
};

type RenderZone = "root" | "system" | "history" | "model" | "appending" | "message" | "assistant" | "reminder" | "watch" | "compaction";

export type ReminderState = {
    hasValue?: boolean;
    value?: JsonValue | null;
    fingerprint?: string;
    injectedAtTurn: number;
};

export type WatchState = {
    hasValue: boolean;
    value: JsonValue | null;
    fingerprint: string;
};

export type ProfileRuntimeState = {
    reminders?: Record<string, ReminderState>;
    watches?: Record<string, WatchState>;
};

type CompileState = {
    context: ProfilePrepareContext<any>;
    profileKey: string;
    currentRuntimeState: ProfileRuntimeState;
    nextRuntimeState: ProfileRuntimeState;
    stateTouched: boolean;
    currentTurn: number;
    pendingToolCallIds: string[];
    plan: ProfileTurnPlan;
};

const PROFILE_STATE_KEY_PREFIX = "profileState.";

/**
 * 编译 profile TSX DSL，产出 harness 可消费的 ProfileTurnPlan。
 */
export async function compileProfileContext(
    profile: Pick<AgentProfile, "manifest">,
    context: ProfilePrepareContext<any>,
    tree: ProfileDslNode,
): Promise<ProfileTurnPlan> {
    const currentRuntimeState = readProfileRuntimeState(context.session.customState[profileStateKey(profile.manifest.key)]);
    const state: CompileState = {
        context,
        profileKey: profile.manifest.key,
        currentRuntimeState,
        nextRuntimeState: cloneProfileRuntimeState(currentRuntimeState),
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
    };
    await renderRoot(state, tree);
    if (state.stateTouched) {
        state.plan.stateWrites = [{
            type: "custom",
            key: profileStateKey(profile.manifest.key),
            value: state.nextRuntimeState as JsonValue,
        }];
    }
    validateProfileTurnPlan(profile.manifest.key, state.plan);
    return state.plan;
}

/**
 * 只编译 ProfilePrompt 里的 System 分区，用于 session snapshot 展示当前 profile system prompt。
 */
export async function compileProfileSystemPrompt(
    profile: Pick<AgentProfile, "manifest">,
    context: ProfilePrepareContext<any>,
    tree: ProfileDslNode,
): Promise<string | undefined> {
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.kind !== "ProfilePrompt") {
        throw new Error("context(ctx) 必须返回 <ProfilePrompt> 根节点。");
    }
    const state: CompileState = {
        context,
        profileKey: profile.manifest.key,
        currentRuntimeState: {},
        nextRuntimeState: {},
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
    };
    const systemPrompt = await renderSystemOnlyChildren(state, tree.children);
    return systemPrompt.trim() ? systemPrompt : undefined;
}

/**
 * 校验底层 prepare 返回的受控状态写入。
 */
export function validateProfileTurnPlan(profileKey: string, plan: ProfileTurnPlan | undefined): asserts plan is ProfileTurnPlan {
    if (!plan || typeof plan !== "object") {
        throw new Error(`profile ${profileKey} prepare/context 必须返回 ProfileTurnPlan。`);
    }
    const allowedKeys = new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "stateWrites", "compaction"]);
    const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
    if (illegalKey) {
        throw new Error(`profile ${profileKey} ProfileTurnPlan 不允许返回 ${illegalKey}。`);
    }
    for (const write of plan.stateWrites ?? []) {
        if (write.type !== "custom") {
            throw new Error(`profile ${profileKey} stateWrites 只允许写 custom entry。`);
        }
        if (write.key !== profileStateKey(profileKey)) {
            throw new Error(`profile ${profileKey} stateWrites 只允许写 ${profileStateKey(profileKey)}。`);
        }
        validateProfileRuntimeStateWrite(profileKey, write.value);
    }
    validateCompactionPlan(profileKey, plan.compaction);
}

/**
 * profile runtime state 在 session custom entry 中的固定 key。
 */
export function profileStateKey(profileKey: string): string {
    return `${PROFILE_STATE_KEY_PREFIX}${profileKey}`;
}

/**
 * ProfilePrompt 根节点。
 */
export function ProfilePrompt(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePromptNode {
    return {
        kind: "ProfilePrompt",
        children: normalizeChildren(props.children),
    };
}

/**
 * Provider 级 system prompt 分区。
 */
export function System(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "System",
        children: normalizeChildren(props.children),
    };
}

/**
 * 空会话首轮初始化历史。
 */
export function HistorySet(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "HistorySet",
        children: normalizeChildren(props.children),
    };
}

/**
 * 本轮模型可见但不落 session 的上下文。
 */
export function ModelContext(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "ModelContext",
        children: normalizeChildren(props.children),
    };
}

/**
 * 本轮 ReAct 前写入 session 的上下文。
 */
export function AppendingSet(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileSetNode {
    return {
        kind: "AppendingSet",
        children: normalizeChildren(props.children),
    };
}

/**
 * 当前 profile 的 compaction 策略。只能放在 ProfilePrompt 顶层。
 */
export function Compaction(props: ProfileCompactionPlan & {children?: ProfileDslChild | ProfileDslChild[]}): ProfileCompactionNode {
    return {
        kind: "Compaction",
        enabled: props.enabled,
        triggerPercent: props.triggerPercent,
        triggerTokens: props.triggerTokens,
        reserveTokens: props.reserveTokens,
        keepRecentTokens: props.keepRecentTokens,
        keepRecentPercent: props.keepRecentPercent,
        children: normalizeChildren(props.children),
    };
}

/**
 * compaction summary 调用使用的 provider system prompt。
 */
export function CompactionPrompt(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileCompactionTextNode {
    return {
        kind: "CompactionPrompt",
        children: normalizeChildren(props.children),
    };
}

/**
 * compaction summary 写入 session 后注入后续上下文的前缀。
 */
export function CompactionSummaryPrefix(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileCompactionTextNode {
    return {
        kind: "CompactionSummaryPrefix",
        children: normalizeChildren(props.children),
    };
}

/**
 * 用户消息节点。system role 明确非法。
 */
export function Message(props: {role?: "user" | "system"; children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    if (props.role === "system") {
        throw new Error("<Message role=\"system\"> 不被支持，请使用 <System> 或 <AppendingSet><Message>。");
    }
    return {
        kind: "Message",
        role: props.role ?? "user",
        children: normalizeChildren(props.children),
    };
}

/**
 * Assistant 示例消息节点。
 */
export function AIMessage(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileMessageNode {
    return {
        kind: "AIMessage",
        role: "assistant",
        children: normalizeChildren(props.children),
    };
}

/**
 * Assistant tool call 子节点。
 */
export function ToolCall(props: {id: string; name: string; args?: Record<string, unknown>}): ProfileToolCallNode {
    return {
        kind: "ToolCall",
        id: props.id,
        name: props.name,
        args: props.args,
    };
}

/**
 * Tool result 示例消息节点。
 */
export function ToolResult(props: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileMessageNode {
    return {
        kind: "ToolResult",
        role: "toolResult",
        toolCallId: props.toolCallId,
        toolName: props.toolName,
        isError: props.isError,
        children: normalizeChildren(props.children),
    };
}

/**
 * 按条件和状态控制 AppendingSet 注入。
 */
export function Reminder(props: {
    id: string;
    when?: boolean;
    watchPath?: string;
    watchValue?: JsonValue;
    watch?: (ctx: ProfilePrepareContext<any>) => JsonValue | undefined | Promise<JsonValue | undefined>;
    render?: (change: ReminderChange) => ProfileDslChild | Promise<ProfileDslChild>;
    repeatEveryTurns?: number;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileReminderNode {
    return {
        kind: "Reminder",
        id: props.id,
        when: props.when ?? true,
        watchPath: props.watchPath,
        watchValue: props.watchValue,
        watch: props.watch,
        render: props.render,
        repeatEveryTurns: props.repeatEveryTurns,
        children: normalizeChildren(props.children),
    };
}

/**
 * 观察上下文值变化，并在变化时渲染子树或 render 结果。
 */
export function Watch(props: {
    id?: string;
    path?: string;
    value?: JsonValue;
    render?: (change: WatchChange) => ProfileDslChild | Promise<ProfileDslChild>;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileWatchNode {
    return {
        kind: "Watch",
        id: props.id,
        path: props.path,
        value: props.value,
        render: props.render,
        children: normalizeChildren(props.children),
    };
}

/**
 * 条件渲染节点。
 */
export function If(props: {condition?: boolean; children?: ProfileDslChild | ProfileDslChild[]}): ProfileIfNode {
    return {
        kind: "If",
        condition: props.condition ?? false,
        children: normalizeChildren(props.children),
    };
}

/**
 * Skill catalog string fragment。
 */
export function SkillCatalog(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultSkillCatalogText,
    };
}

/**
 * Agent catalog string fragment。用于向模型展示可创建/调用的 profile 与 schema 摘要。
 */
export function AgentCatalog(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultAgentCatalogText,
    };
}

/**
 * Activated skills string fragment。
 */
export function ActivatedSkills(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultActivatedSkillsText,
    };
}

/**
 * Agent SQL schema 摘要 string fragment。profile 作者决定注入到 System、ModelContext 或其他 string 节点。
 */
export function SqlSchemaSummary(props: {text?: string | ((ctx: ProfilePrepareContext<any>) => string | Promise<string>)}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: props.text ?? defaultSqlSchemaSummaryText,
    };
}

/**
 * 注入变量当前值。第一版只允许放在 ModelContext 的 Message/SystemReminder 等 string 节点内。
 */
export function Variable(props: {path: ProfileVariablePathInput; label?: string; maxBytes?: number}): ProfileVariableNode {
    return {
        kind: "Variable",
        path: props.path,
        label: props.label,
        maxBytes: props.maxBytes,
    };
}

/**
 * 注入变量 catalog/schema 和工具提示。第一版只允许放在 ModelContext 的 string 节点内。
 */
export function VariableSchema(props: {
    namespace?: VariableNamespace;
    prefix?: string;
    paths?: ProfileVariablePathInput[];
    writableOnly?: boolean;
    detail?: boolean;
    includeToolGuide?: boolean;
}): ProfileVariableSchemaNode {
    return {
        kind: "VariableSchema",
        namespace: props.namespace,
        prefix: props.prefix,
        paths: props.paths,
        writableOnly: props.writableOnly,
        detail: props.detail,
        includeToolGuide: props.includeToolGuide,
    };
}

/**
 * 通用 system-reminder string fragment。推荐用于动态 runtime 提醒。
 */
export function SystemReminder(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: async (ctx) => {
            const body = await renderStandaloneString(ctx, normalizeChildren(props.children));
            return body.trim() ? systemReminder(body) : "";
        },
    };
}

/**
 * 已关联 agent 摘要。可嵌入普通 Message 或 SystemReminder。
 */
export function LinkedAgentsSummary(_props: Record<string, never> = {}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => linkedAgentsSummaryText(ctx.session),
    };
}

/**
 * 已关联 agent 变化提醒。
 */
export function LinkedAgentsReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "linked-agents",
        watch: (ctx) => ctx.session.linkedAgents as JsonValue,
        repeatEveryTurns: props.repeatEveryTurns,
        children: Message({children: LinkedAgentsReminderText()}),
    });
}

/**
 * 首轮注入当前工具 cwd。这里的 cwd 是 agent 文件工具和 bash 的工作目录，不是 Project Workspace。
 */
export function WorkdirReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "workdir",
        watch: (ctx) => normalizeDisplayPath(ctx.session.workspaceRoot),
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => Message({children: systemReminder([
            `Current Workdir: ${ensureTrailingSlash(String(change.currentValue ?? ""))}`,
            "This is the tool cwd itself; use . for the cwd and do not prefix file paths with workspace/.",
        ].join("\n"))}),
    });
}

/**
 * 首轮注入当前 Project Workspace；后续仅在项目切换时注入切换提醒。
 */
export function ProjectWorkspaceReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "project-workspace",
        watch: readCurrentProjectWorkspace,
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => {
            const projectWorkspace = typeof change.currentValue === "string" && change.currentValue ? change.currentValue : "";
            if (!projectWorkspace) {
                return null;
            }
            const projectSlug = projectSlugFromWorkspace(projectWorkspace);
            const body = change.hasPreviousValue && change.didChange
                ? `User switched Current Project Workspace to ${projectWorkspace}. Current Workdir is still workspace/; use ${projectSlug}/... paths, not workspace/${projectSlug}/... unless a tool explicitly asks for projectPath.`
                : [
                    `Current Project Workspace: ${projectWorkspace}`,
                    `Use ${projectSlug}/lorebook/... or ${projectSlug}/manuscript/... for project files.`,
                ].join("\n");
            return Message({children: systemReminder(body)});
        },
    });
}

/**
 * 首轮提示 Plan Mode 可用性。PlanModeReminder 仍负责 active/exit/reentry 生命周期。
 */
export function PlanModeAvailabilityReminder(props: {id?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    return Reminder({
        id: props.id ?? "plan-mode-availability",
        watch: (ctx) => ctx.session.planModeActive ? "active" : "inactive",
        repeatEveryTurns: props.repeatEveryTurns,
        render: (change) => change.currentValue === "inactive"
            ? Message({children: systemReminder("Plan mode is inactive. For large, risky, or multi-step changes, use enter_plan_mode before editing.")})
            : null,
    });
}

/**
 * 当前任务清单提醒。默认读取 agent.tasks custom state。
 */
export function TaskReminder(props: {id?: string; stateKey?: string; repeatEveryTurns?: number} = {}): ProfileReminderNode {
    const stateKey = props.stateKey ?? AGENT_TASKS_STATE_KEY;
    return Reminder({
        id: props.id ?? "tasks",
        watch: (ctx) => ctx.session.customState[stateKey] ?? null,
        repeatEveryTurns: props.repeatEveryTurns ?? 8,
        children: Message({children: TaskReminderText({stateKey})}),
    });
}

/**
 * Plan Mode 生命周期提醒。默认读取 agent.planMode custom state。
 */
export function PlanModeReminder(props: {
    id?: string;
    stateKey?: string;
    repeatEveryTurns?: number;
    children?: ProfileDslChild | ProfileDslChild[];
} = {}): ProfileReminderNode {
    const stateKey = props.stateKey ?? AGENT_PLAN_MODE_STATE_KEY;
    return Reminder({
        id: props.id ?? "plan-mode",
        watch: (ctx) => ({
            active: ctx.session.planModeActive,
            state: ctx.session.customState[stateKey] ?? null,
        }),
        repeatEveryTurns: props.repeatEveryTurns,
        children: Message({children: PlanModeReminderText({stateKey, slots: readPlanModeSlots(normalizeChildren(props.children))})}),
    });
}

/**
 * Plan Mode 活跃期间每轮提醒。适合放在 AppendingSet。
 */
export function ActivePlanModeReminder(props: {id?: string; stateKey?: string} = {}): ProfileReminderNode {
    const stateKey = props.stateKey ?? AGENT_PLAN_MODE_STATE_KEY;
    return Reminder({
        id: props.id ?? "plan-mode-active",
        watch: (ctx) => readRecord(ctx.session.customState[stateKey]).active as JsonValue | undefined,
        children: Message({children: PlanModeReminderText({stateKey})}),
    });
}

/**
 * 用户输入中显式 $skill 时的提醒。
 */
export function MentionedSkillsReminder(_props: Record<string, never> = {}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: mentionedSkillsReminderText,
    };
}

/**
 * Plan Mode full reminder 自定义插槽。只能作为 PlanModeReminder 子节点。
 */
export function PlanModeFull(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePlanModeSlotNode {
    return PlanModeSlot("full", props.children);
}

/**
 * Plan Mode sparse reminder 自定义插槽。只能作为 PlanModeReminder 子节点。
 */
export function PlanModeSparse(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePlanModeSlotNode {
    return PlanModeSlot("sparse", props.children);
}

/**
 * Plan Mode exit reminder 自定义插槽。只能作为 PlanModeReminder 子节点。
 */
export function PlanModeExit(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePlanModeSlotNode {
    return PlanModeSlot("exit", props.children);
}

/**
 * Plan Mode reentry reminder 自定义插槽。只能作为 PlanModeReminder 子节点。
 */
export function PlanModeReentry(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfilePlanModeSlotNode {
    return PlanModeSlot("reentry_full", props.children);
}

export function Fragment(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileFragmentNode {
    return {
        kind: "Fragment",
        children: normalizeChildren(props.children),
    };
}

function PlanModeSlot(slot: PlanModeSlotKind, children: ProfileDslChild | ProfileDslChild[] | undefined): ProfilePlanModeSlotNode {
    return {
        kind: "PlanModeSlot",
        slot,
        children: normalizeChildren(children),
    };
}

function readPlanModeSlots(children: ProfileDslChild[]): Partial<Record<PlanModeSlotKind, ProfileDslChild[]>> {
    const slots: Partial<Record<PlanModeSlotKind, ProfileDslChild[]>> = {};
    const flat = children.flatMap(flattenChildren);
    for (const child of flat) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("PlanModeReminder 只能直接包含 PlanModeFull/PlanModeSparse/PlanModeExit/PlanModeReentry。");
            }
            continue;
        }
        if (Array.isArray(child)) {
            continue;
        }
        if (child.kind !== "PlanModeSlot") {
            throw new Error(`PlanModeReminder 只能直接包含 PlanModeFull/PlanModeSparse/PlanModeExit/PlanModeReentry，不能包含 ${child.kind}。`);
        }
        if (slots[child.slot]) {
            throw new Error(`${slotNodeName(child.slot)} 只能出现一次。`);
        }
        slots[child.slot] = child.children;
    }
    return slots;
}

function slotNodeName(slot: PlanModeSlotKind): string {
    if (slot === "full") {
        return "PlanModeFull";
    }
    if (slot === "sparse") {
        return "PlanModeSparse";
    }
    if (slot === "exit") {
        return "PlanModeExit";
    }
    return "PlanModeReentry";
}

async function renderRoot(state: CompileState, tree: ProfileDslNode): Promise<void> {
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.kind !== "ProfilePrompt") {
        throw new Error("context(ctx) 必须返回 <ProfilePrompt> 根节点。");
    }
    await renderChildren(state, "root", tree.children);
}

async function renderSystemOnlyChildren(state: CompileState, children: ProfileDslChild[]): Promise<string> {
    const prompts: string[] = [];
    for (const child of children) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (Array.isArray(child)) {
            const text = await renderSystemOnlyChildren(state, child);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("root 中的文本必须放在支持 string 的节点内部。");
            }
            continue;
        }
        if (child.kind === "Fragment") {
            const text = await renderSystemOnlyChildren(state, child.children);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (child.kind === "If") {
            if (!child.condition) {
                continue;
            }
            const text = await renderSystemOnlyChildren(state, child.children);
            if (text) {
                prompts.push(text);
            }
            continue;
        }
        if (child.kind !== "System") {
            continue;
        }
        validateSystemChildren(child.children);
        const text = await renderStringChildren(state, "system", child.children);
        if (text) {
            prompts.push(text);
        }
    }
    return prompts.join("\n\n");
}

async function renderChildren(state: CompileState, zone: RenderZone, children: ProfileDslChild[]): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [];
    for (const child of children) {
        messages.push(...await renderChild(state, zone, child));
    }
    return messages;
}

async function renderChild(state: CompileState, zone: RenderZone, child: ProfileDslChild): Promise<AgentMessage[]> {
    if (child === null || child === undefined || child === false || child === true) {
        return [];
    }
    if (Array.isArray(child)) {
        return renderChildren(state, zone, child);
    }
    if (typeof child === "string" || typeof child === "number") {
        if (String(child).trim() !== "") {
            throw new Error(`${zone} 中的文本必须放在支持 string 的节点内部。`);
        }
        return [];
    }
    if (child.kind === "Fragment") {
        return renderChildren(state, zone, child.children);
    }
    if (child.kind === "If") {
        if (!child.condition) {
            return [];
        }
        return renderChildren(state, zone, child.children);
    }
    if (child.kind === "System") {
        assertZone(zone, "root", "System 只能放在 ProfilePrompt 顶层。");
        validateSystemChildren(child.children);
        const text = await renderStringChildren(state, "system", child.children);
        state.plan.systemPrompt = [state.plan.systemPrompt, text].filter(Boolean).join("\n\n");
        return [];
    }
    if (child.kind === "HistorySet") {
        assertZone(zone, "root", "HistorySet 只能放在 ProfilePrompt 顶层。");
        const messages = await renderChildren(state, "history", child.children);
        state.plan.historyInitMessages = [...state.plan.historyInitMessages ?? [], ...onlyMessages(messages, "HistorySet")];
        return [];
    }
    if (child.kind === "ModelContext") {
        assertZone(zone, "root", "ModelContext 只能放在 ProfilePrompt 顶层。");
        const messages = await renderChildren(state, "model", child.children);
        if (messages.length > 0) {
            state.plan.modelContextMessages = [...state.plan.modelContextMessages ?? [], ...messages];
        }
        return [];
    }
    if (child.kind === "AppendingSet") {
        assertZone(zone, "root", "AppendingSet 只能放在 ProfilePrompt 顶层。");
        const messages = await renderChildren(state, "appending", child.children);
        state.plan.appendingMessages = [...state.plan.appendingMessages ?? [], ...onlyMessages(messages, "AppendingSet")];
        return [];
    }
    if (child.kind === "Compaction") {
        assertZone(zone, "root", "Compaction 只能放在 ProfilePrompt 顶层。");
        state.plan.compaction = await renderCompactionNode(state, child);
        return [];
    }
    if (child.kind === "CompactionPrompt" || child.kind === "CompactionSummaryPrefix") {
        assertZone(zone, "compaction", `${child.kind} 只能放在 Compaction 内。`);
        return [];
    }
    if (child.kind === "Reminder") {
        if (zone !== "appending" && zone !== "model") {
            throw new Error("Reminder 只允许放在 AppendingSet 或 ModelContext 内。");
        }
        const messages = await renderReminder(state, child);
        if (zone === "model") {
            state.plan.modelContextAppendingMessages = [
                ...state.plan.modelContextAppendingMessages ?? [],
                ...onlyMessages(messages, "ModelContext Reminder"),
            ];
            return [];
        }
        return messages;
    }
    if (child.kind === "Watch") {
        if (zone !== "appending" && zone !== "model") {
            throw new Error("Watch 只允许放在 AppendingSet 或 ModelContext 内。");
        }
        return renderWatch(state, zone, child);
    }
    if (child.kind === "Variable") {
        assertZone(zone, "model", "Variable 第一版只允许放在 ModelContext 内。");
        const text = await renderVariableNode(state, child);
        return text.trim() ? [createUserMessage({text})] : [];
    }
    if (child.kind === "VariableSchema") {
        assertZone(zone, "model", "VariableSchema 第一版只允许放在 ModelContext 内。");
        const text = renderVariableSchemaNode(state, child);
        return text.trim() ? [createUserMessage({text})] : [];
    }
    if (child.kind === "Message" || child.kind === "AIMessage" || child.kind === "ToolResult") {
        if (!["history", "model", "appending", "reminder", "watch"].includes(zone)) {
            throw new Error(`${child.kind} 不能直接放在 ${zone} 内。`);
        }
        return onlyNonEmptyMessage(await renderMessageNode(state, child));
    }
    if (child.kind === "ToolCall") {
        throw new Error("ToolCall 只能作为 AIMessage 的子节点。");
    }
    if (child.kind === "StringFragment") {
        if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch" && zone !== "compaction") {
            throw new Error("string fragment 只能放在支持 string 的节点内部。");
        }
        return [];
    }
    if (child.kind === "PlanModeSlot") {
        throw new Error(`${slotNodeName(child.slot)} 只能作为 PlanModeReminder 的直接子节点。`);
    }
    throw new Error(`未知 Profile DSL 节点：${JSON.stringify(child)}`);
}

async function renderCompactionNode(state: CompileState, node: ProfileCompactionNode): Promise<ProfileCompactionPlan> {
    const plan: ProfileCompactionPlan = {
        enabled: node.enabled,
        triggerPercent: node.triggerPercent,
        triggerTokens: node.triggerTokens,
        reserveTokens: node.reserveTokens,
        keepRecentTokens: node.keepRecentTokens,
        keepRecentPercent: node.keepRecentPercent,
    };
    for (const child of node.children.flatMap(flattenChildren)) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (Array.isArray(child)) {
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("Compaction 中的文本必须放在 CompactionPrompt 或 CompactionSummaryPrefix 内。");
            }
            continue;
        }
        if (child.kind === "Fragment") {
            const nested = await renderCompactionNode(state, {
                kind: "Compaction",
                children: child.children,
            });
            plan.prompt = nested.prompt ?? plan.prompt;
            plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
            continue;
        }
        if (child.kind === "If") {
            if (!child.condition) {
                continue;
            }
            const nested = await renderCompactionNode(state, {
                kind: "Compaction",
                children: child.children,
            });
            plan.prompt = nested.prompt ?? plan.prompt;
            plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
            continue;
        }
        if (child.kind === "CompactionPrompt") {
            plan.prompt = await renderStringChildren(state, "compaction", child.children);
            continue;
        }
        if (child.kind === "CompactionSummaryPrefix") {
            plan.summaryPrefix = await renderStringChildren(state, "compaction", child.children);
            continue;
        }
        throw new Error(`Compaction 只能包含 CompactionPrompt / CompactionSummaryPrefix，不能包含 ${child.kind}。`);
    }
    validateCompactionPlan(state.profileKey, plan);
    return plan;
}

function validateSystemChildren(children: ProfileDslChild[]): void {
    for (const child of children.flatMap(flattenChildren)) {
        if (Array.isArray(child)) {
            validateSystemChildren(child);
            continue;
        }
        if (!child || typeof child !== "object") {
            continue;
        }
        if (child.kind === "StringFragment" || child.kind === "Fragment" || child.kind === "If") {
            if (child.kind === "Fragment" || child.kind === "If") {
                validateSystemChildren(child.children);
            }
            continue;
        }
        if (child.kind === "Variable" || child.kind === "VariableSchema") {
            throw new Error(`${child.kind} 第一版只允许放在 ModelContext。`);
        }
        throw new Error(`System 只能包含 string-like children，不能包含 ${child.kind}。`);
    }
}

async function renderMessageNode(state: CompileState, node: ProfileMessageNode): Promise<Message> {
    if (node.kind === "Message") {
        if (node.role === "system") {
            throw new Error("<Message role=\"system\"> 不被支持，请使用 <System> 或 <AppendingSet><Message>。");
        }
        return createUserMessage({
            text: await renderStringChildren(state, "message", node.children),
        });
    }
    if (node.kind === "AIMessage") {
        validateAssistantChildren(node.children);
        const contentText = await renderStringChildren(state, "assistant", node.children);
        const toolCalls = collectToolCalls(node.children).map((toolCall): AgentToolCall => ({
            type: "toolCall",
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.args ?? {},
        }));
        const assistant = createAssistantTextMessage({
            text: contentText,
            stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
        });
        state.pendingToolCallIds.push(...toolCalls.map((toolCall) => toolCall.id));
        return {
            ...assistant,
            content: [
                ...contentText ? [{type: "text" as const, text: contentText}] : [],
                ...toolCalls,
            ],
        } satisfies AssistantMessage;
    }
    if (!node.toolCallId || !node.toolName) {
        throw new Error("ToolResult 必须提供 toolCallId 和 toolName。");
    }
    if (!state.pendingToolCallIds.includes(node.toolCallId)) {
        throw new Error(`ToolResult.toolCallId 未匹配前序 ToolCall：${node.toolCallId}`);
    }
    state.pendingToolCallIds = state.pendingToolCallIds.filter((toolCallId) => toolCallId !== node.toolCallId);
    return createTextToolResult({
        toolCallId: node.toolCallId,
        toolName: node.toolName,
        text: await renderStringChildren(state, "message", node.children),
        isError: node.isError,
    }) satisfies ToolResultMessage;
}

function validateAssistantChildren(children: ProfileDslChild[]): void {
    validateAssistantChildSequence(children, false);
}

function collectToolCalls(children: ProfileDslChild[]): ProfileToolCallNode[] {
    const toolCalls: ProfileToolCallNode[] = [];
    const visit = (child: ProfileDslChild): void => {
        if (child === null || child === undefined || child === false || child === true) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                visit(item);
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number" || child.kind === "StringFragment") {
            return;
        }
        if (child.kind === "ToolCall") {
            toolCalls.push(child);
            return;
        }
        if (child.kind === "Fragment") {
            for (const item of child.children) {
                visit(item);
            }
            return;
        }
        if (child.kind === "PlanModeSlot") {
            for (const item of child.children) {
                visit(item);
            }
            return;
        }
        if (child.kind === "If" && child.condition) {
            for (const item of child.children) {
                visit(item);
            }
        }
    };
    for (const child of children) {
        visit(child);
    }
    return toolCalls;
}

function validateAssistantChildSequence(children: ProfileDslChild[], seenToolCall: boolean): boolean {
    let localSeenToolCall = seenToolCall;
    for (const child of children) {
        if (child === null || child === undefined || child === false || child === true) {
            continue;
        }
        if (Array.isArray(child)) {
            localSeenToolCall = validateAssistantChildSequence(child, localSeenToolCall);
            continue;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (localSeenToolCall && String(child).trim() !== "") {
                throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
            }
            continue;
        }
        if (child.kind === "ToolCall") {
            localSeenToolCall = true;
            continue;
        }
        if (child.kind === "StringFragment") {
            if (localSeenToolCall) {
                throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
            }
            continue;
        }
        if (child.kind === "Fragment") {
            localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            continue;
        }
        if (child.kind === "PlanModeSlot") {
            localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            continue;
        }
        if (child.kind === "If") {
            if (child.condition) {
                localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
            }
            continue;
        }
        if (localSeenToolCall) {
            throw new Error("AIMessage 的 ToolCall 后不能再追加非 ToolCall 子节点。");
        }
    }
    return localSeenToolCall;
}

async function renderReminder(state: CompileState, node: ProfileReminderNode): Promise<AgentMessage[]> {
    if (!node.when) {
        return [];
    }
    const watchSourceCount = [node.watchPath, node.watchValue, node.watch].filter((source) => source !== undefined).length;
    if (watchSourceCount > 1) {
        throw new Error("Reminder.watchPath、Reminder.watchValue 与 Reminder.watch 只能提供一个。");
    }
    if (node.repeatEveryTurns !== undefined && (!Number.isInteger(node.repeatEveryTurns) || node.repeatEveryTurns <= 0)) {
        throw new Error("Reminder.repeatEveryTurns 必须是正整数。");
    }
    assertAllowedWatchPath(node.watchPath, "Reminder.watchPath");
    const currentValue = node.watch
        ? await node.watch(state.context)
        : node.watchPath ? await readPath(state.context, node.watchPath) : node.watchValue;
    const hasWatchValue = node.watchPath !== undefined || node.watchValue !== undefined || node.watch !== undefined;
    const fingerprint = hasWatchValue ? stableStringifyJsonValue(currentValue) : undefined;
    const previous = state.currentRuntimeState.reminders?.[node.id];
    const didFingerprintChange = hasWatchValue && previous?.fingerprint !== fingerprint;
    const shouldRepeat = typeof node.repeatEveryTurns === "number"
        && (!previous || state.currentTurn - previous.injectedAtTurn >= node.repeatEveryTurns);
    const shouldInject = hasWatchValue || node.repeatEveryTurns
        ? didFingerprintChange || shouldRepeat
        : true;
    if (!shouldInject) {
        return [];
    }
    const change: ReminderChange = {
        previousValue: previous?.hasValue ? previous.value ?? null : undefined,
        currentValue,
        hasPreviousValue: Boolean(previous?.hasValue),
        hasCurrentValue: currentValue !== undefined,
        didChange: didFingerprintChange,
        session: state.context.session,
    };
    const rendered = node.render ? await node.render(change) : node.children;
    if (!rendered || rendered === true) {
        return [];
    }
    const messages = await renderChildren(state, "reminder", normalizeChildren(rendered));
    if (messages.length === 0) {
        return [];
    }
    if (hasWatchValue || node.repeatEveryTurns) {
        state.nextRuntimeState.reminders = {
            ...state.nextRuntimeState.reminders,
            [node.id]: {
                ...(hasWatchValue ? {
                    hasValue: currentValue !== undefined,
                    value: currentValue === undefined ? null : currentValue,
                } : {}),
                ...(fingerprint !== undefined ? {fingerprint} : {}),
                injectedAtTurn: state.currentTurn,
            },
        };
        state.stateTouched = true;
    }
    return messages;
}

async function renderWatch(state: CompileState, zone: RenderZone, node: ProfileWatchNode): Promise<AgentMessage[]> {
    if (node.path !== undefined && node.value !== undefined) {
        throw new Error("Watch.path 与 Watch.value 不能同时提供。");
    }
    assertAllowedWatchPath(node.path, "Watch.path");
    if (node.value !== undefined && !node.id) {
        throw new Error("Watch.value 模式必须提供 id。");
    }
    const key = node.id ?? node.path;
    if (!key) {
        throw new Error("Watch 必须提供 path 或 id。");
    }
    const currentValue = node.path ? await readPath(state.context, node.path) : node.value;
    const currentBaseline: WatchState = {
        hasValue: currentValue !== undefined,
        value: currentValue === undefined ? null : currentValue,
        fingerprint: stableStringifyJsonValue(currentValue),
    };
    const previous = state.nextRuntimeState.watches?.[key] ?? state.currentRuntimeState.watches?.[key];
    state.nextRuntimeState.watches = {
        ...state.nextRuntimeState.watches,
        [key]: currentBaseline,
    };
    state.stateTouched = true;
    if (!previous && currentValue === undefined) {
        return [];
    }
    if (previous?.fingerprint === currentBaseline.fingerprint) {
        return [];
    }
    const change: WatchChange = {
        previousValue: previous?.hasValue ? previous.value : undefined,
        currentValue,
        path: key,
        hasPreviousValue: Boolean(previous?.hasValue),
        hasCurrentValue: currentValue !== undefined,
        session: state.context.session,
    };
    const rendered = node.render ? await node.render(change) : node.children;
    if (!rendered || rendered === true) {
        return [];
    }
    return renderChildren(state, zone === "model" ? "watch" : "watch", normalizeChildren(rendered));
}

async function renderVariableNode(state: CompileState, node: ProfileVariableNode): Promise<string> {
    const result = await state.context.vars.read(node.path, {
        maxBytes: node.maxBytes,
    });
    if (result.issue) {
        return [
            "<variable>",
            `path: ${node.path}`,
            `issue: ${result.issue.message}`,
            "</variable>",
        ].join("\n");
    }
    return [
        "<variable>",
        `path: ${node.path}`,
        node.label ? `label: ${node.label}` : "",
        result.truncated ? "truncated: true" : "",
        "value:",
        JSON.stringify(result.value ?? null, null, 2),
        "</variable>",
    ].filter(Boolean).join("\n");
}

function renderVariableSchemaNode(state: CompileState, node: ProfileVariableSchemaNode): string {
    const result = state.context.vars.catalog({
        namespace: node.namespace,
        prefix: node.prefix,
        paths: node.paths,
        writableOnly: node.writableOnly,
        detail: node.detail,
    });
    const payload = {catalog: result.catalog, schemas: result.schemas, issues: result.issues};
    return [
        "<variable-schema>",
        JSON.stringify(payload, null, 2),
        node.includeToolGuide === false ? "" : [
            "Tool workflow:",
            "- variable_schema: inspect focused variable schemas. Use namespace/prefix/paths; do not request everything.",
            "- variable_read: read a registered variable value before editing.",
            "- variable_patch: update one writable registered variable path with RFC 6902 JSON Patch, then read again to verify important changes.",
        ].join("\n"),
        "</variable-schema>",
    ].filter(Boolean).join("\n");
}

async function renderStringChildren(state: CompileState, zone: RenderZone, children: ProfileDslChild[]): Promise<string> {
    const parts: string[] = [];
    const visit = async (child: ProfileDslChild): Promise<void> => {
        if (child === null || child === undefined || child === false || child === true) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                await visit(item);
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number") {
            parts.push(String(child));
            return;
        }
        if (child.kind === "Fragment") {
            for (const item of child.children) {
                await visit(item);
            }
            return;
        }
        if (child.kind === "If") {
            if (!child.condition) {
                return;
            }
            for (const item of child.children) {
                await visit(item);
            }
            return;
        }
        if (child.kind === "StringFragment") {
            parts.push(typeof child.text === "function" ? await child.text(state.context) : child.text);
            return;
        }
        if (child.kind === "Variable" || child.kind === "VariableSchema") {
            throw new Error(`${child.kind} 第一版只能作为 ModelContext 的直接子节点。`);
        }
        if (child.kind === "PlanModeSlot") {
            throw new Error(`${slotNodeName(child.slot)} 只能作为 PlanModeReminder 的直接子节点。`);
        }
        if (child.kind === "ToolCall" && zone === "assistant") {
            return;
        }
        throw new Error(`${child.kind} 不能放在 string 内容节点内。`);
    };
    for (const child of children) {
        await visit(child);
    }
    return parts.join("").trim();
}

async function renderStandaloneString(context: ProfilePrepareContext<any>, children: ProfileDslChild[]): Promise<string> {
    const state: CompileState = {
        context,
        profileKey: context.session.profileKey,
        currentRuntimeState: {},
        nextRuntimeState: {},
        stateTouched: false,
        currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
        pendingToolCallIds: [],
        plan: {},
    };
    return renderStringChildren(state, "message", children);
}

function normalizeChildren(children: ProfileDslChild | ProfileDslChild[] | undefined): ProfileDslChild[] {
    if (children === undefined) {
        return [];
    }
    return Array.isArray(children) ? children : [children];
}

function flattenChildren(child: ProfileDslChild): ProfileDslChild[] {
    if (child === null || child === undefined || child === false || child === true) {
        return [];
    }
    if (Array.isArray(child)) {
        return child.flatMap(flattenChildren);
    }
    return [child];
}

function onlyMessages(messages: AgentMessage[], label: string): Message[] {
    return messages.filter((message): message is Message => {
        if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
            return true;
        }
        throw new Error(`${label} 只能产出 user/assistant/toolResult message。`);
    });
}

function onlyNonEmptyMessage(message: Message): Message[] {
    if (message.role === "toolResult") {
        return [message];
    }
    if (message.role === "assistant") {
        const hasContent = message.content.some((block) => {
            return block.type !== "text" || block.text.trim().length > 0;
        });
        return hasContent ? [message] : [];
    }
    return messageText(message).trim() ? [message] : [];
}

function assertZone(current: RenderZone, expected: RenderZone, message: string): void {
    if (current !== expected) {
        throw new Error(message);
    }
}

function countUserTurns(messages: AgentMessage[]): number {
    // runtime.promptUserTurnCount 由 harness 在挂起用户消息前计算；这里保留 session 回退，方便脚本直接调用 profile.prepare。
    return messages.filter((message) => {
        return message.role === "user";
    }).length;
}

function assertAllowedWatchPath(path: string | undefined, label: string): void {
    if (!path) {
        return;
    }
    if (!["client", "global", "project", "session"].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) {
        throw new Error(`${label} 字符串形式只能从 client、global、project、session 变量路径开始；非变量上下文请使用函数 watch：${path}`);
    }
}

async function readPath(context: ProfilePrepareContext<any>, path: string): Promise<JsonValue | undefined> {
    return context.vars.get(path);
}

function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function stableStringifyJsonValue(value: JsonValue | undefined): string {
    if (value === undefined) {
        return "__undefined__";
    }
    return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
    }
    return value;
}

function cloneProfileRuntimeState(state: ProfileRuntimeState): ProfileRuntimeState {
    return {
        reminders: state.reminders ? {...state.reminders} : undefined,
        watches: state.watches ? {...state.watches} : undefined,
    };
}

function readProfileRuntimeState(value: JsonValue | undefined): ProfileRuntimeState {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const state = value as Record<string, JsonValue>;
    return {
        reminders: readReminderStateMap(state.reminders),
        watches: readWatchStateMap(state.watches),
    };
}

function validateProfileRuntimeStateWrite(profileKey: string, value: JsonValue): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`profile ${profileKey} stateWrites 的 profile runtime state 必须是 object。`);
    }
    const state = value as Record<string, JsonValue>;
    const illegalKey = Object.keys(state).find((key) => key !== "reminders" && key !== "watches");
    if (illegalKey) {
        throw new Error(`profile ${profileKey} stateWrites 的 profile runtime state 不允许写 ${illegalKey}。`);
    }
    assertOptionalStateMap(profileKey, state.reminders, "reminders");
    assertOptionalStateMap(profileKey, state.watches, "watches");
    readReminderStateMap(state.reminders);
    readWatchStateMap(state.watches);
}

function validateCompactionPlan(profileKey: string, plan: ProfileCompactionPlan | undefined): void {
    if (!plan) {
        return;
    }
    const allowedKeys = new Set(["enabled", "triggerPercent", "triggerTokens", "reserveTokens", "keepRecentTokens", "keepRecentPercent", "prompt", "summaryPrefix"]);
    const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
    if (illegalKey) {
        throw new Error(`profile ${profileKey} compaction 不允许返回 ${illegalKey}。`);
    }
    if (typeof plan.enabled !== "undefined" && typeof plan.enabled !== "boolean") {
        throw new Error(`profile ${profileKey} compaction.enabled 必须是 boolean。`);
    }
    if (plan.triggerPercent !== undefined && plan.triggerTokens !== undefined) {
        throw new Error(`profile ${profileKey} compaction.triggerPercent 与 triggerTokens 不能同时提供。`);
    }
    if (plan.keepRecentPercent !== undefined && plan.keepRecentTokens !== undefined) {
        throw new Error(`profile ${profileKey} compaction.keepRecentPercent 与 keepRecentTokens 不能同时提供。`);
    }
    assertOptionalPercent(profileKey, plan.triggerPercent, "triggerPercent");
    assertOptionalPercent(profileKey, plan.keepRecentPercent, "keepRecentPercent");
    assertOptionalPositiveInteger(profileKey, plan.triggerTokens, "triggerTokens");
    assertOptionalPositiveInteger(profileKey, plan.reserveTokens, "reserveTokens");
    assertOptionalPositiveInteger(profileKey, plan.keepRecentTokens, "keepRecentTokens");
    assertOptionalString(profileKey, plan.prompt, "prompt");
    assertOptionalString(profileKey, plan.summaryPrefix, "summaryPrefix");
}

function assertOptionalPercent(profileKey: string, value: unknown, name: string): void {
    if (value === undefined) {
        return;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
        throw new Error(`profile ${profileKey} compaction.${name} 必须在 (0, 1] 范围内。`);
    }
}

function assertOptionalPositiveInteger(profileKey: string, value: unknown, name: string): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isInteger(value) || Number(value) <= 0) {
        throw new Error(`profile ${profileKey} compaction.${name} 必须是正整数。`);
    }
}

function assertOptionalString(profileKey: string, value: unknown, name: string): void {
    if (value === undefined) {
        return;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`profile ${profileKey} compaction.${name} 必须是非空字符串。`);
    }
}

function assertOptionalStateMap(profileKey: string, value: JsonValue | undefined, key: "reminders" | "watches"): void {
    if (value === undefined) {
        return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`profile ${profileKey} stateWrites 的 ${key} 必须是 object map。`);
    }
}

function readReminderStateMap(value: JsonValue | undefined): Record<string, ReminderState> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const reminders: Record<string, ReminderState> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.injectedAtTurn !== "number") {
            throw new Error(`profile runtime reminder state 非法：${key}`);
        }
        reminders[key] = {
            hasValue: typeof item.hasValue === "boolean" ? item.hasValue : false,
            value: item.value ?? null,
            fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : undefined,
            injectedAtTurn: item.injectedAtTurn,
        };
    }
    return reminders;
}

function readWatchStateMap(value: JsonValue | undefined): Record<string, WatchState> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const watches: Record<string, WatchState> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.hasValue !== "boolean" || typeof item.fingerprint !== "string") {
            throw new Error(`profile runtime watch state 非法：${key}`);
        }
        watches[key] = {
            hasValue: item.hasValue,
            value: item.value ?? null,
            fingerprint: item.fingerprint,
        };
    }
    return watches;
}

function renderAgentCatalogIndexItem(profile: AgentCatalogItem): string {
    const lines = [
        `- key: ${profile.key}`,
        `  name: ${profile.name}`,
        profile.description ? `  description: ${profile.description}` : "",
        profile.source ? `  source: ${profile.source}` : "",
    ].filter(Boolean);
    return lines.join("\n");
}

export function renderSchemaSummary(schema: unknown): string {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return "- type: unknown";
    }
    const record = schema as Record<string, unknown>;
    if (record.type === "object" && record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)) {
        const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
        const properties = Object.entries(record.properties as Record<string, unknown>);
        if (properties.length === 0) {
            return "- no fields";
        }
        return properties.map(([key, value]) => {
            const field = readSchemaField(value);
            return [
                `- ${key}: ${required.has(key) ? "required" : "optional"} ${field.type}`,
                field.description ? ` - ${field.description}` : "",
            ].join("");
        }).join("\n");
    }
    if (record.type === "array") {
        const item = readSchemaField(record.items);
        const description = typeof record.description === "string" ? ` - ${record.description}` : "";
        return `- array<${item.type}>${description}`;
    }
    const field = readSchemaField(record);
    return `- ${field.type}${field.description ? ` - ${field.description}` : ""}`;
}

function readSchemaField(schema: unknown): {type: string; description?: string} {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return {type: "unknown"};
    }
    const record = schema as Record<string, unknown>;
    const description = typeof record.description === "string" ? record.description : undefined;
    if (typeof record.type === "string") {
        return {
            type: schemaTypeText(record),
            description,
        };
    }
    if (Array.isArray(record.anyOf)) {
        return {
            type: record.anyOf.map((item) => readSchemaField(item).type).join(" | "),
            description,
        };
    }
    if (Array.isArray(record.oneOf)) {
        return {
            type: record.oneOf.map((item) => readSchemaField(item).type).join(" | "),
            description,
        };
    }
    return {
        type: "unknown",
        description,
    };
}

function schemaTypeText(schema: Record<string, unknown>): string {
    if (schema.type === "array") {
        return `array<${readSchemaField(schema.items).type}>`;
    }
    if (schema.type === "object") {
        return "object";
    }
    return String(schema.type);
}

function systemReminder(body: string): string {
    return [
        "<system-reminder>",
        body.trim(),
        "</system-reminder>",
    ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readInputRole(ctx: ProfilePrepareContext<any>): string {
    const input = readRecord(ctx.input);
    return typeof input.role === "string" ? input.role : "";
}

async function readCurrentProjectWorkspace(ctx: ProfilePrepareContext<any>): Promise<string> {
    const value = await ctx.vars.get("client.currentProjectWorkspace");
    const projectWorkspace = typeof value === "string" && value.trim() ? value : ctx.session.projectPath ?? "";
    return projectWorkspace ? normalizeDisplayPath(projectWorkspace) : "";
}

function normalizeDisplayPath(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
    const relativeToRepo = relative(process.cwd(), value).replace(/\\/g, "/");
    if (relativeToRepo && !relativeToRepo.startsWith("..") && !relativeToRepo.startsWith("/")) {
        return relativeToRepo.replace(/\/+$/g, "");
    }
    return normalized;
}

function ensureTrailingSlash(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
    return normalized ? `${normalized}/` : "";
}

function projectSlugFromWorkspace(projectWorkspace: string): string {
    const normalized = projectWorkspace.replace(/\\/g, "/").replace(/\/+$/g, "");
    return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
}

function linkedAgentsSummaryText(session: NeuroSessionContext): string {
    if (session.linkedAgents.length === 0) {
        return "Linked agents: none";
    }
    return [
        "Linked agents:",
        ...session.linkedAgents.map((agent) => `- session ${agent.sessionId}: ${agent.profileKey}${agent.detached ? " (detached)" : ""}`),
    ].join("\n");
}

function readTaskList(ctx: ProfilePrepareContext<any>, stateKey = AGENT_TASKS_STATE_KEY): {
    title?: string;
    steps: Array<{id: string; text: string; status: string; note?: string}>;
} | null {
    const value = ctx.session.customState[stateKey];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.steps)) {
        return null;
    }
    return {
        title: typeof record.title === "string" ? record.title : undefined,
        steps: record.steps.flatMap((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return [];
            }
            const step = item as Record<string, unknown>;
            if (typeof step.id !== "string" || typeof step.text !== "string" || typeof step.status !== "string") {
                return [];
            }
            return [{
                id: step.id,
                text: step.text,
                status: step.status,
                note: typeof step.note === "string" ? step.note : undefined,
            }];
        }),
    };
}

function LinkedAgentsReminderText(): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => systemReminder([
            "Current linked agents:",
            linkedAgentsSummaryText(ctx.session),
        ].join("\n")),
    };
}

function TaskReminderText(props: {stateKey: string}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: (ctx) => {
            const taskList = readTaskList(ctx, props.stateKey);
            if (!taskList) {
                return "";
            }
            const openSteps = taskList.steps.filter((step) => step.status !== "completed");
            if (openSteps.length === 0) {
                return "";
            }
            return systemReminder([
                taskList.title ? `Current task list: ${taskList.title}` : "Current task list:",
                ...openSteps.map((step) => `- [${step.status}] ${step.id}: ${step.text}${step.note ? ` (${step.note})` : ""}`),
                "Use task_set_status when you start or complete a step.",
            ].join("\n"));
        },
    };
}

function PlanModeReminderText(props: {stateKey: string; slots?: Partial<Record<PlanModeSlotKind, ProfileDslChild[]>>}): ProfileStringFragmentNode {
    return {
        kind: "StringFragment",
        text: async (ctx) => {
            const planModeState = readRecord(ctx.session.customState[props.stateKey]);
            const active = typeof planModeState.active === "boolean" ? planModeState.active : ctx.session.planModeActive;
            const kind = typeof planModeState.reminderKind === "string" ? planModeState.reminderKind : active ? "full" : "";
            const workDirectory = typeof planModeState.workDirectory === "string"
                ? planModeState.workDirectory
                : planModeDirectory(ctx.session.workspaceRoot).replace(/\\/g, "/");
            return renderPlanModeReminderText(ctx, kind, workDirectory, props.slots ?? {});
        },
    };
}

async function renderPlanModeReminderText(
    ctx: ProfilePrepareContext<any>,
    kind: string,
    workDirectory: string,
    slots: Partial<Record<PlanModeSlotKind, ProfileDslChild[]>>,
): Promise<string> {
    if (!kind) {
        return "";
    }
    if (kind === "full" || kind === "sparse" || kind === "exit" || kind === "reentry_full") {
        const custom = slots[kind];
        if (custom) {
            return renderPlanModeSlotText(ctx, custom, workDirectory);
        }
    }
    if (kind === "exit") {
        return systemReminder([
            "## Exited Plan Mode",
            "",
            "You have exited plan mode. You can now make edits, run tools, and take actions.",
            `Use the approved plan from the exit approval. If a Markdown file was shown from ${workDirectory}, treat that Project Workspace plan file as the implementation reference and read or cite only that file for details.`,
        ].join("\n"));
    }
    if (kind === "sparse") {
        return systemReminder([
            "Plan mode still active (see full instructions earlier in conversation).",
            "This project uses soft Plan Mode: follow the restriction yourself even though tools are still visible.",
            `Read-only except optional Markdown work files under ${workDirectory}. Do not modify other files, configs, plot data, database data, or commits.`,
            "Do not create or invoke Explore agents.",
            "Keep the user informed in chat: summarize important findings, unresolved decisions, and the current plan.",
            `For implementation planning, keep the plan in chat and, when the work is non-trivial, capture the reviewable plan, walkthrough, or research notes in a Markdown file under ${workDirectory}. It is the Project Workspace shared plan directory, not a session-specific directory.`,
            "Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.",
            "If an unresolved decision materially changes the plan, use request_user_input before exiting.",
            "Before exit_plan_mode, tell the user what was planned and cite the .agent/plan Markdown file path when one exists. Never ask for plan approval via plain text or request_user_input; exit_plan_mode is the approval request.",
        ].join("\n"));
    }
    const reentry = kind === "reentry_full"
        ? [
            "## Re-entering Plan Mode",
            "",
            `You are returning to plan mode after previously exiting it. Only Markdown files under ${workDirectory} are writable while Plan Mode is active.`,
            "Before proceeding, inspect the latest chat context and any relevant Markdown plan file in that directory when available. Revise the visible plan in chat and update the plan file when the task still requires an implementation plan.",
            "",
        ].join("\n")
        : "";
    return systemReminder([
        reentry,
        "Plan mode is active. The user indicated that they do not want you to execute yet.",
        "This project implements soft Plan Mode: tools are still visible, but you MUST treat this run as planning-only.",
        "",
        "## Thread Work Directory",
        "",
        `The Project Workspace Plan Mode directory is ${workDirectory}. It can contain plan files, walkthrough files, or research notes for this project.`,
        "No file is bound when entering Plan Mode. Choose a short readable Markdown file name in this directory when the task needs persisted planning or walkthrough notes.",
        "If a relevant Markdown file already exists in this exact plan directory, you can read it and make incremental edits using read and edit.",
        "This directory is the only place you may create or edit files while Plan Mode is active. Do not create files just for formality for small non-editing tasks.",
        "Do not create scratch/cache/command-output drafts in Project Workspace .agent; use the system temp directory for temporary files.",
        "Build the plan visibly in chat as you learn and keep any Markdown work file aligned when one is used. Do not hide important decisions only in a file.",
        "The final planning response before exit_plan_mode should summarize the implementation plan for the user and cite the .agent/plan Markdown file path when one was prepared.",
        "",
        "## Restrictions",
        "",
        `- Do not edit, create, delete, move, format, migrate, commit, or otherwise mutate files or product data, except Markdown work files under ${workDirectory}.`,
        "- Read-only code and document exploration is allowed.",
        "- Tests or commands are allowed only when they are read-only enough to refine the plan and do not update tracked files.",
        "- Do not create or invoke Explore agents. Work locally with read/search tools.",
        "- Do not write outside the .agent/plan directory while Plan Mode is active. Temporary scratch/cache belongs in the system temp directory.",
        "- If the user asks you to implement while Plan Mode is active, keep planning instead. For anything beyond a small non-editing task, explain that implementation requires leaving Plan Mode through exit_plan_mode after the plan is ready.",
        "- Do not work silently for long stretches. After meaningful exploration, report concise findings and the current direction in chat.",
        "",
        "## Workflow",
        "",
        "1. Ground in the real repository with read-only exploration: inspect relevant files, schemas, tools, tests, and existing patterns.",
        "2. Report what you learned in chat when it changes the plan, including unresolved decisions and the next intended step.",
        "3. Ask the user via request_user_input only when an unresolved decision cannot be discovered from the repo and materially changes the implementation.",
        `4. Present a concise execution-ready plan in chat. For non-trivial implementation work, also write or update a readable Markdown plan, walkthrough, or research note under ${workDirectory}; the file name is your choice and the system will not generate a random slug.`,
        "5. Before exit_plan_mode, briefly report the plan status in chat and cite the Markdown file path when you wrote one. If you skip a file because the task is only a small non-editing task, say that briefly before requesting approval.",
        "6. Call exit_plan_mode when the plan is complete and ready for approval. The tool can request approval from the visible chat plan, and planFilePath should point to a Markdown file under .agent/plan/ when one should be previewed.",
        "7. After approval, implement from the approved chat plan or the approved Markdown file shown during exit approval.",
        "",
        "The user explicitly requested no Explore agent for this project Plan Mode.",
    ].join("\n"));
}

async function renderPlanModeSlotText(ctx: ProfilePrepareContext<any>, children: ProfileDslChild[], workDirectory: string): Promise<string> {
    const body = await renderStandaloneString(ctx, [
        `Thread work directory: ${workDirectory}\n`,
        ...children,
    ]);
    return body.trim() ? systemReminder(body) : "";
}

function mentionedSkillsReminderText(ctx: ProfilePrepareContext<any>): string {
    const latestUser = ctx.runtime?.pendingUserMessage
        ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
    if (!latestUser || latestUser.role !== "user") {
        return "";
    }
    const text = messageText(latestUser);
    const names = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
    if (names.length === 0) {
        return "";
    }
    return systemReminder([
        `The user explicitly mentioned skill(s): ${names.map((name) => `$${name}`).join(", ")}.`,
        "If these skills are visible in the catalog, read the matching SKILL.md location from SkillCatalog before continuing.",
        "Use the original skill key exactly. Do not translate it into English, pinyin, or a new slug.",
    ].join("\n"));
}

function indentLines(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function displaySkillLocation(skillPath: string): string {
    return resolve(skillPath);
}

async function defaultSkillCatalogText(ctx: ProfilePrepareContext<any>): Promise<string> {
    if (ctx.skills.length === 0) {
        return "";
    }
    const skillLines = ctx.skills
        .map((skillItem) => [
            `- key: ${skillItem.key}`,
            `  name: ${skillItem.name}`,
            `  description: ${skillItem.description ?? skillItem.key}`,
            skillItem.whenToUse ? `  when_to_use: ${skillItem.whenToUse}` : "",
            `  location: ${displaySkillLocation(skillItem.skillPath)}`,
        ].filter(Boolean).join("\n"))
        .join("\n\n");
    return [
        "<system-reminder>",
        "## Skill",
        "",
        "Skills are reusable work methods. They are not long-term memory and they are not mandatory for every turn.",
        "",
        "- Skill roots: workspace/.nbook/agent/skills/ overrides assets/workspace/.nbook/agent/skills/.",
        "- User assets override system assets by whole skill directory, not by merging individual files.",
        "- There is no separate skill tool. To use a skill, read the SKILL.md file at the catalog location.",
        "- Read SKILL.md first as the entry card; if it references relative files such as references, scripts, templates, or examples, read only the needed files under the same skill directory.",
        "- Skill keys may be Chinese. Use the original key from the catalog exactly; do not translate, romanize, or invent a slug.",
        "- If the user explicitly types $skill-key, or the task clearly matches a catalog description, read the matching SKILL.md before continuing.",
        "- If the user did not mention a skill and the task does not clearly match one, do not read a skill just for formality.",
        "- A skill guides this turn only. Stable world facts belong in Lorebook, plot progress belongs in Plot System, and temporary plans stay in the conversation.",
        "- If a skill conflicts with the user's goal, prioritize the user's goal; ask one minimal clarification only when the conflict materially changes the result.",
        "- After using a skill, the final response should report key output and necessary verification, not repeat the full skill content.",
        "",
        "## Available Skills",
        "",
        skillLines,
        "</system-reminder>",
    ].join("\n");
}

async function defaultAgentCatalogText(ctx: ProfilePrepareContext<any>): Promise<string> {
    const profiles = ctx.catalog.profiles
        .filter((profile) => profile.loadStatus === "loaded")
        .map(renderAgentCatalogIndexItem);
    if (profiles.length === 0) {
        return "";
    }
    return [
        "<system-reminder>",
        "## Available Agents",
        "",
        "These agent profiles are currently available through create_agent / invoke_agent.",
        "This catalog is only an index. Before calling an unfamiliar profile, call get_agent_profile({ profileKey }) to inspect InputSchema, OutputSchema, report_result schema, and allowed tools.",
        "",
        ...profiles,
        "</system-reminder>",
    ].join("\n");
}

async function defaultActivatedSkillsText(ctx: ProfilePrepareContext<any>): Promise<string> {
    const latestUser = ctx.runtime?.pendingUserMessage
        ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
    const text = latestUser && latestUser.role === "user" ? messageText(latestUser) : "";
    const skillNames = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
    if (skillNames.length === 0) {
        return "";
    }
    return systemReminder([
        `The user explicitly mentioned skill(s): ${skillNames.map((name) => `$${name}`).join(", ")}.`,
        "If each mentioned skill is visible in SkillCatalog, read the matching SKILL.md location before continuing.",
        "If a mentioned skill is not visible in the catalog, say that directly and continue with the best fallback.",
    ].join("\n"));
}

async function defaultSqlSchemaSummaryText(ctx: ProfilePrepareContext<any>): Promise<string> {
    try {
        const {getAgentSqlSchemaSummary} = await import("nbook/server/agent/tools/sql-tool");
        return [
            "<sql-schema-summary>",
            "Target database is current Project Workspace .nbook/project.sqlite. App SQLite is not accessible from execute_sql.",
            "Double-quote business tables with uppercase letters and camelCase columns, e.g. \"createdAt\", \"sortOrder\".",
            await getAgentSqlSchemaSummary(ctx.session.projectPath),
            "</sql-schema-summary>",
        ].join("\n");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ["<sql-schema-summary>", `SQL schema summary 暂不可用：${message}`, "</sql-schema-summary>"].join("\n");
    }
}
