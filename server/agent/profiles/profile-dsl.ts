import {join} from "node:path";
import {readFile} from "node:fs/promises";
import type {AgentToolCall} from "@earendil-works/pi-agent-core";
import type {AgentMessage, AssistantMessage, JsonValue, Message, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText, now} from "nbook/server/agent/messages/message-utils";
import type {AgentCatalogItem, AgentProfile, ProfilePrepareContext, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";

export type ProfileDslChild = ProfileDslNode | string | number | boolean | null | undefined | ProfileDslChild[];

export type ProfileDslNode =
    | ProfilePromptNode
    | ProfileSetNode
    | ProfileMessageNode
    | ProfileToolCallNode
    | ProfileReminderNode
    | ProfileWatchNode
    | ProfileIfNode
    | ProfileStringFragmentNode
    | ProfileFragmentNode;

export type ProfilePromptNode = {
    kind: "ProfilePrompt";
    children: ProfileDslChild[];
};

export type ProfileSetNode = {
    kind: "System" | "HistorySet" | "ModelContext" | "AppendingSet";
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
    watchPath?: string;
    watchValue?: JsonValue;
    repeatEveryTurns?: number;
    children: ProfileDslChild[];
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

export type ProfileFragmentNode = {
    kind: "Fragment";
    children: ProfileDslChild[];
};

type RenderZone = "root" | "system" | "history" | "model" | "appending" | "message" | "assistant" | "reminder" | "watch";

export type ReminderState = {
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
    const allowedKeys = new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "stateWrites"]);
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
    repeatEveryTurns?: number;
    children?: ProfileDslChild | ProfileDslChild[];
}): ProfileReminderNode {
    return {
        kind: "Reminder",
        id: props.id,
        when: props.when ?? true,
        watchPath: props.watchPath,
        watchValue: props.watchValue,
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

export function Fragment(props: {children?: ProfileDslChild | ProfileDslChild[]}): ProfileFragmentNode {
    return {
        kind: "Fragment",
        children: normalizeChildren(props.children),
    };
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
        if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch") {
            throw new Error("string fragment 只能放在支持 string 的节点内部。");
        }
        return [];
    }
    throw new Error(`未知 Profile DSL 节点：${JSON.stringify(child)}`);
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
    if (node.watchPath !== undefined && node.watchValue !== undefined) {
        throw new Error("Reminder.watchPath 与 Reminder.watchValue 不能同时提供。");
    }
    if (node.repeatEveryTurns !== undefined && (!Number.isInteger(node.repeatEveryTurns) || node.repeatEveryTurns <= 0)) {
        throw new Error("Reminder.repeatEveryTurns 必须是正整数。");
    }
    assertAllowedWatchPath(node.watchPath, "Reminder.watchPath");
    const currentValue = node.watchPath ? readPath(state.context, node.watchPath) : node.watchValue;
    const hasWatchValue = node.watchPath !== undefined || node.watchValue !== undefined;
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
    if (hasWatchValue || node.repeatEveryTurns) {
        state.nextRuntimeState.reminders = {
            ...state.nextRuntimeState.reminders,
            [node.id]: {
                ...(fingerprint !== undefined ? {fingerprint} : {}),
                injectedAtTurn: state.currentTurn,
            },
        };
        state.stateTouched = true;
    }
    return renderChildren(state, "reminder", node.children);
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
    const currentValue = node.path ? readPath(state.context, node.path) : node.value;
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
    if (!["ctx.session", "ctx.input", "ctx.runtime", "ctx.workspace"].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) {
        throw new Error(`${label} 只能从 ctx.session、ctx.input、ctx.runtime、ctx.workspace 开始：${path}`);
    }
}

function readPath(context: ProfilePrepareContext<any>, path: string): JsonValue | undefined {
    const roots: Record<string, unknown> = {
        "ctx.session": context.session,
        "ctx.input": context.input,
        "ctx.runtime": {
            now: context.runtime?.now ?? new Date(now()).toISOString(),
            promptUserTurnCount: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
            pendingUserMessage: context.runtime?.pendingUserMessage,
        },
        "ctx.workspace": {
            root: context.session.workspaceRoot,
        },
    };
    const rootKey = Object.keys(roots).find((key) => path === key || path.startsWith(`${key}.`));
    if (!rootKey) {
        return undefined;
    }
    const rest = path === rootKey ? [] : path.slice(rootKey.length + 1).split(".");
    let current = roots[rootKey];
    for (const segment of rest) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return toJsonValue(current);
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

function renderAgentCatalogItem(profile: AgentCatalogItem): string {
    const lines = [
        `- key: ${profile.key}`,
        `  name: ${profile.name}`,
        profile.description ? `  description: ${profile.description}` : "",
        profile.source ? `  source: ${profile.source}` : "",
        profile.allowedToolKeys?.length ? `  allowedTools: ${profile.allowedToolKeys.join(", ")}` : "",
        profile.inputSchema ? `  inputSchema:\n${indentLines(renderSchemaSummary(profile.inputSchema), 4)}` : "  inputSchema: none",
        profile.outputSchema ? `  outputSchema:\n${indentLines(renderSchemaSummary(profile.outputSchema), 4)}` : "  outputSchema: none",
    ].filter(Boolean);
    return lines.join("\n");
}

function renderSchemaSummary(schema: unknown): string {
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

function indentLines(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function displaySkillLocation(skillPath: string, source: string): string {
    const normalized = skillPath.split(/[\\/]+/).join("/");
    const marker = source === "user"
        ? "/workspace/.nbook/agent/skills/"
        : "/assets/workspace/.nbook/agent/skills/";
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) {
        return normalized.slice(index + 1);
    }
    return normalized;
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
            `  location: ${displaySkillLocation(skillItem.skillPath, skillItem.source)}`,
        ].filter(Boolean).join("\n"))
        .join("\n\n");
    return [
        "<system-reminder>",
        "## Skill",
        "",
        "Skills 是可复用工作法，不是长期记忆，也不是每轮都必须执行的流程。",
        "",
        "- skills 根目录：workspace/.nbook/agent/skills/ > assets/workspace/.nbook/agent/skills/",
        "- 用户 assets 优先于系统 assets；同名 skill 目录按整个目录覆盖，不按单个文件混合。",
        "- 当前只存在一个 skill 相关工具：skill。",
        "- 需要启用 skill 时，调用 skill({ skillKey: \"catalog 中的 key\" }) 读取完整 SKILL.md，不要用文件工具直接读取 SKILL.md。",
        "- skill key 允许中文。必须使用下方 catalog 中的原始 key，不要翻译成英文、拼音或另造 slug。",
        "- 用户显式输入 $skill-key，或任务明显匹配 catalog 描述时，先启用对应 skill，再继续执行。",
        "- 用户没有显式提到 skill 且任务不明显匹配 catalog 时，不要为了形式调用 skill。",
        "- skill 只指导本轮怎么做；稳定设定写入 Lorebook，剧情推进写入 Plot System，临时计划留在当前对话。",
        "- skill 与用户目标冲突时，优先保证用户目标；如果冲突会实质改变结果，提出一个最小澄清问题。",
        "- 使用 skill 后，最终回复只说明关键产出和必要验证，不复述完整 skill 内容。",
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
        .map(renderAgentCatalogItem);
    if (profiles.length === 0) {
        return "";
    }
    return [
        "<system-reminder>",
        "## Available Agents",
        "",
        "这些是当前可通过 create_agent / invoke_agent 使用的 agent profiles。调用 create_agent 时，input 必须符合对应 InputSchema 摘要。",
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
    const blocks: string[] = [];
    for (const skillName of skillNames) {
        if (!skillName) {
            continue;
        }
        const skillPath = join(ctx.session.workspaceRoot, ".nbook", "agent", "skills", skillName, "SKILL.md");
        try {
            blocks.push(`【显式激活 Skill】\n${skillName}\n\n${await readFile(skillPath, "utf8")}`);
        } catch {
            blocks.push(`用户显式提到了技能 $${skillName}，但当前 workspace 未找到同名 skill。`);
        }
    }
    return blocks.join("\n\n---\n\n");
}

async function defaultSqlSchemaSummaryText(): Promise<string> {
    try {
        const {getAgentSqlSchemaSummary} = await import("nbook/server/agent/tools/sql-tool");
        return ["<sql-schema-summary>", await getAgentSqlSchemaSummary(), "</sql-schema-summary>"].join("\n");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ["<sql-schema-summary>", `SQL schema summary 暂不可用：${message}`, "</sql-schema-summary>"].join("\n");
    }
}
