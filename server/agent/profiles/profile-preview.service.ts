import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from "@langchain/core/messages";
import {z} from "zod";
import {toModelHistoryMessages} from "nbook/server/agent/messages/codec";
import type {AgentSystem} from "nbook/server/agent/agent-system";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";
import {previewProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";
import type {
    AgentProfilePreparePreviewDto,
    AgentProfilePreparePreviewRequestDto,
    AgentProfileIssueDto,
} from "nbook/shared/dto/agent-profile.dto";
import type {
    AgentThreadKind,
    AgentThreadRecord,
    AgentVariableScope,
    AgentVariables,
    JsonObject,
    JsonValue,
    ProfileKey,
    ClientVariables,
} from "nbook/server/agent/types";

/**
 * 真实调用 profile.prepare，生成 Message[] 预览。
 */
export async function previewAgentProfilePrepare(
    agentSystem: AgentSystem,
    input: AgentProfilePreparePreviewRequestDto,
    clientVariables: ClientVariables | null = null,
): Promise<AgentProfilePreparePreviewDto> {
    await agentSystem.profileRegistry.refreshDynamicProfiles();

    let profile: AgentProfile<ProfileKey, unknown, unknown>;
    try {
        profile = await agentSystem.profileRegistry.get(input.profileKey);
    } catch (error) {
        return {
            profileKey: input.profileKey,
            ok: false,
            issues: [toProfileIssue(error, input.profileKey, "profile_load_failed")],
            messages: [],
            persistedMessageCount: 0,
            variables: [],
        };
    }

    const thread = await loadPreviewThread(agentSystem, input, profile);
    const parsedInput = parsePreviewInput(profile, input);
    if (!parsedInput.ok) {
        return {
            profileKey: input.profileKey,
            ok: false,
            issues: [parsedInput.issue],
            messages: [],
            persistedMessageCount: 0,
            variables: previewProfileTemplate({
                source: "",
                scope: createPreviewScope(thread, profile, inputToJson(parsedInput.fallbackInput)),
                profile: profile as never,
            }).variables,
        };
    }

    const historyMessages = input.historyMessages
        ? input.historyMessages.map(toBaseMessage)
        : input.threadId
            ? await loadThreadHistory(agentSystem, input.threadId)
            : [];
    const variableStore = new AgentVariableStore();
    const runtimeInput = inputToJson(parsedInput.value);
    let scope = createPreviewScope(thread, profile, runtimeInput);
    const threadId = String(thread.id);
    let agentVariables = toMutableAgentVariables(scope.agent);
    if (clientVariables) {
        variableStore.setAgent(threadId, agentVariables);
        variableStore.setInput(threadId, runtimeInput);
        scope = variableStore.syncClientVariables(threadId, clientVariables);
        agentVariables = toMutableAgentVariables(scope.agent);
    }
    variableStore.setAgent(threadId, agentVariables);
    scope = variableStore.setInput(threadId, runtimeInput);

    try {
        const runtime: ProfileContextRuntime<ProfileKey, unknown, unknown, AgentProfile<ProfileKey, unknown, unknown>> = {
            thread,
            profile,
            input: runtimeInput,
            scope,
            skillCatalog: await agentSystem.skillCatalog.list(),
            options: {},
            messageStore: createReadonlyMessageStore(),
            loadHistoryMessages: async () => historyMessages,
            threadRepository: createReadonlyThreadRepository(),
            variableStore,
        };
        const prepared = await profile.prepare(runtime);
        const messages = prepared.modelMessages.map(toPreviewMessage);
        const staticVariables = previewProfileTemplate({
            source: "",
            scope,
            profile: profile as never,
        }).variables;

        return {
            profileKey: input.profileKey,
            ok: true,
            issues: [],
            messages,
            persistedMessageCount: prepared.persistedMessages.prepend.length + prepared.persistedMessages.append.length,
            variables: staticVariables,
        };
    } catch (error) {
        return {
            profileKey: input.profileKey,
            ok: false,
            issues: [toProfileIssue(error, input.profileKey, "profile_prepare_failed")],
            messages: [],
            persistedMessageCount: 0,
            variables: previewProfileTemplate({
                source: "",
                scope,
                profile: profile as never,
            }).variables,
        };
    }
}

/**
 * 只读 scope.agent 转回可写入变量 store 的普通对象。
 */
function toMutableAgentVariables(agent: AgentVariableScope["agent"]): AgentVariables {
    return structuredClone(agent) as AgentVariables;
}

/**
 * 加载或创建预览线程记录。
 */
async function loadPreviewThread(
    agentSystem: AgentSystem,
    input: AgentProfilePreparePreviewRequestDto,
    profile: AgentProfile<ProfileKey, unknown, unknown>,
): Promise<AgentThreadRecord> {
    if (input.threadId) {
        const existing = await agentSystem.threadRepository.findById(input.threadId);
        if (existing) {
            return existing;
        }
    }
    return {
        id: 0,
        kind: profile.kind,
        runStatus: "idle",
        profileKey: profile.key,
        title: "Profile Prepare Preview",
        activeCursorMessageId: null,
        lastMessagePreview: "",
        lastMessageAt: new Date(),
        metadata: {},
    };
}

type ParsedPreviewInput =
    | {ok: true; value: unknown}
    | {ok: false; issue: AgentProfileIssueDto; fallbackInput: unknown};

/**
 * 构造并校验预览 input。
 */
function parsePreviewInput(
    profile: AgentProfile<ProfileKey, unknown, unknown>,
    input: AgentProfilePreparePreviewRequestDto,
): ParsedPreviewInput {
    const rawInput = input.input ?? inputFromOverrides(profile.kind, input.inputOverrides ?? {});
    const parsed = profile.inputSchema.safeParse(rawInput);
    if (parsed.success) {
        return {
            ok: true,
            value: parsed.data,
        };
    }
    return {
        ok: false,
        fallbackInput: rawInput,
        issue: {
            severity: "error",
            code: "profile_input_invalid",
            profileKey: profile.key,
            message: z.prettifyError(parsed.error),
        },
    };
}

/**
 * 第一版仅把 input.* 覆盖组装为浅对象，常见 leader.prompt 可直接工作。
 */
function inputFromOverrides(kind: AgentThreadKind, overrides: Record<string, string>): JsonObject {
    const input: JsonObject = kind === "leader"
        ? {
            mode: "prompt",
            prompt: "",
        }
        : {};
    for (const [path, value] of Object.entries(overrides)) {
        if (!path.startsWith("input.")) {
            continue;
        }
        input[path.slice("input.".length)] = parseJsonDraft(value);
    }
    return input;
}

/**
 * 文本输入优先尝试 JSON，失败时保留字符串。
 */
function parseJsonDraft(value: string): JsonValue {
    try {
        return z.json().parse(JSON.parse(value)) as JsonValue;
    } catch {
        return value;
    }
}

/**
 * 构造预览 scope。
 */
function createPreviewScope(
    thread: AgentThreadRecord,
    profile: AgentProfile<ProfileKey, unknown, unknown>,
    input: JsonValue,
): AgentVariableScope<ProfileKey, JsonValue> {
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
                id: String(thread.id),
                title: thread.title,
                summary: thread.lastMessagePreview,
                status: thread.runStatus,
            },
            profileKey: profile.key,
            kind: profile.kind,
            tools: [...profile.allowedToolKeys],
            subagents: [],
            tasks: thread.metadata.tasks ?? null,
        },
        input,
    };
}

/**
 * 加载真实线程历史。
 */
async function loadThreadHistory(agentSystem: AgentSystem, threadId: string): Promise<BaseMessage[]> {
    const messages = await agentSystem.threadMessages.loadThreadHistory(threadId);
    return toModelHistoryMessages(messages);
}

/**
 * DTO 消息转 LangChain 消息。
 */
function toBaseMessage(message: NonNullable<AgentProfilePreparePreviewRequestDto["historyMessages"]>[number]): BaseMessage {
    if (message.role === "assistant") {
        return new AIMessage(message.text);
    }
    if (message.role === "human") {
        return new HumanMessage(message.text);
    }
    return new SystemMessage(message.text);
}

/**
 * LangChain 消息转预览 DTO。
 */
function toPreviewMessage(message: BaseMessage): AgentProfilePreparePreviewDto["messages"][number] {
    const role = message._getType() === "human"
        ? "human"
        : message._getType() === "ai"
            ? "assistant"
            : message._getType();
    return {
        role,
        text: message.text,
        source: typeof message.additional_kwargs.source === "string" ? message.additional_kwargs.source : null,
        ...("tool_calls" in message && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
            ? {
                toolCalls: message.tool_calls.map((toolCall) => ({
                    id: toolCall.id ?? "tool-call",
                    name: toolCall.name,
                    argsText: JSON.stringify(toolCall.args ?? {}),
                })),
            }
            : {}),
    };
}

/**
 * 将未知值收敛为 JSON 值。
 */
function inputToJson(value: unknown): JsonValue {
    return z.json().catch({}).parse(value) as JsonValue;
}

/**
 * 预览不允许写消息。
 */
function createReadonlyMessageStore(): AgentMessageStore {
    const fail = async () => {
        throw new Error("prepare 预览不允许写入 messageStore");
    };
    return {
        loadSnapshot: fail,
        loadActivePathMessages: async () => [],
        appendMessages: fail,
        insertMessagesBefore: fail,
        prependMessages: fail,
        setActiveCursor: fail,
        updateMessage: fail,
        archiveMessages: fail,
        deleteThread: fail,
    } as AgentMessageStore;
}

/**
 * 预览只提供只读线程仓储占位。
 */
function createReadonlyThreadRepository(): ThreadRepository {
    const fail = async () => {
        throw new Error("prepare 预览不允许写入 threadRepository");
    };
    return {
        createLeader: fail,
        createSubAgent: fail,
        listThreads: async () => [],
        findById: async () => null,
        delete: fail,
        attachSubAgent: fail,
        listSubAgents: async () => [],
        listManagingLeaders: async () => [],
        assertLeaderManagesSubAgent: async () => {},
        updateRunStatus: fail,
        updateMetadata: fail,
        touchAfterRun: fail,
    } as ThreadRepository;
}

/**
 * 统一 profile 预览错误。
 */
function toProfileIssue(error: unknown, profileKey: string, code: string): AgentProfileIssueDto {
    return {
        severity: "error",
        code,
        profileKey,
        message: error instanceof Error ? error.message : String(error ?? "未知错误"),
        ...(process.env.NODE_ENV === "production" || !(error instanceof Error) ? {} : {stack: error.stack}),
    };
}
