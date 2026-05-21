import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import type {CallbackManagerForLLMRun} from "@langchain/core/callbacks/manager";
import {ChatGenerationChunk, type ChatResult} from "@langchain/core/outputs";
import type {BaseMessage, BaseMessageChunk, UsageMetadata} from "@langchain/core/messages";
import {AIMessage, AIMessageChunk, HumanMessage} from "@langchain/core/messages";
import {ChatDeepSeek} from "@langchain/deepseek";
import {
    ChatOpenAI,
    ChatOpenAICompletions,
    convertCompletionsDeltaToBaseMessageChunk,
    convertMessagesToCompletionsMessageParams,
} from "@langchain/openai";
import type {OpenAI} from "openai";
import consola from "consola";
import type Dispatcher from "undici/types/dispatcher";
import {ProxyAgent} from "undici";
import type {
    AgentProfileModelConfigDto,
    AgentProfileModelSettingsDto,
    UpdateAgentProfileModelSettingsRequestDto,
    CheckModelResponseDto,
    CheckProviderResponseDto,
    ConfiguredAgentProfileDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    DiscoveredProviderModelDto,
    EnabledModelOptionDto,
    ModelProviderDraftDto,
    ModelSettingsDto,
    UpdateModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderAdapter,
    ModelSettingsConfig,
} from "nbook/server/utils/app-config";
import type {AgentThreadModelOverride} from "nbook/server/agent/types";
import type {JsonValue} from "nbook/server/agent/types";
import {loadAppConfigSync, type AppConfig} from "nbook/server/utils/app-config";

const OPENAI_HTTP_LOG = String(process.env.OPENAI_HTTP_LOG ?? "").toLowerCase();
const enableOpenAiHttpLog = OPENAI_HTTP_LOG === "1" || OPENAI_HTTP_LOG === "true";
const HELLO_PROMPT = "hello";
const OPENAI_COMPATIBLE_MODEL_PROVIDER = "openai-compatible";
const DEFAULT_PROVIDER_TIMEOUT_MS = 180_000;
const DEFAULT_PROVIDER_BASE_URLS: Record<ModelProviderAdapter["type"], string> = {
    "openai-official": "https://api.openai.com/v1",
    "openai-compatible": "https://api.openai.com/v1",
    "gemini-compatible": "https://generativelanguage.googleapis.com/v1beta/openai",
    "deepseek-official": "https://api.deepseek.com/v1",
};

type ProviderRuntimeSource = {
    providerId: string;
    providerName: string;
    adapter: ModelProviderAdapter;
    options: {
        apiKey: string;
        baseURL: string;
        proxy: string;
        timeoutMs: number | null;
        requestOptions: Record<string, JsonValue>;
    };
};

type ModelRuntimeSource = {
    name: string;
    id: string;
    group: string | null;
    enabled?: boolean;
};

type HttpLogContext = {
    providerName: string;
    bodyText: string;
    headerObject: Record<string, string>;
    method: string;
    url: string;
};

type ResolvedDefaultModel = {
    providerId: string;
    provider: ConfiguredProviderConfig;
    model: ConfiguredModelConfig;
};

type ResolvedContextWindow = {
    tokens: number | null;
    source: "manual" | "unknown";
};

type ProviderUsageInputDetails = NonNullable<UsageMetadata["input_token_details"]> & {
    /**
     * DeepSeek KV Cache 未命中 token。LangChain 目前没有标准字段，先挂在 usage_metadata.input_token_details。
     */
    cache_miss?: number;
};

type DeepSeekCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam & {
    /**
     * reasoning provider 工具续跑要求回传的 provider 字段。
     */
    reasoning_content?: string;
};

type OpenAiCompatibleCompletionMessageParam = DeepSeekCompletionMessageParam;

type DeepSeekToolCallParam = {
    id?: unknown;
    function?: {
        name?: unknown;
    };
};

type LangChainReasoningTranslatorMessage = AIMessage | AIMessageChunk;

type LangChainReasoningTranslator = {
    translateContent: (message: LangChainReasoningTranslatorMessage) => Array<Record<string, unknown>>;
    translateContentChunk: (message: LangChainReasoningTranslatorMessage) => Array<Record<string, unknown>>;
};

type LangChainReasoningTranslatorGlobal = typeof globalThis & {
    lc_block_translators_registry?: Map<string, LangChainReasoningTranslator>;
};

export type AgentProfileSettingDefinition = {
    profileKey: string;
    name: string;
    kind: "leader" | "subagent";
};

export type ResolvedAgentModelSelection = {
    modelOverrideKey: string | null;
    modelOverride: {
        modelKey: string;
        modelLabel: string | null;
        temperature: number | null;
        topK: number | null;
        reasoningEffort: "low" | "medium" | "high" | null;
        stream: boolean;
        contextWindowTokens: number | null;
    } | null;
    profileModelKey: string | null;
    effectiveModelKey: string | null;
    effectiveModelLabel: string | null;
    effectiveModel: {
        modelKey: string;
        modelLabel: string | null;
        temperature: number | null;
        topK: number | null;
        reasoningEffort: "low" | "medium" | "high" | null;
        stream: boolean;
        contextWindowTokens: number | null;
    } | null;
    temperature: number | null;
    topK: number | null;
    reasoningEffort: "low" | "medium" | "high" | null;
    stream: boolean;
};

const proxyAgentCache = new Map<string, ProxyAgent>();

/**
 * 读取 AIMessage 中的标准 reasoning block。
 */
function readStandardReasoningContent(message: AIMessage): string {
    for (const block of message.contentBlocks) {
        if (
            block
            && typeof block === "object"
            && "type" in block
            && block.type === "reasoning"
            && "reasoning" in block
            && typeof block.reasoning === "string"
            && block.reasoning.trim()
        ) {
            return block.reasoning;
        }
    }
    return "";
}

/**
 * 将 OpenAI-compatible 的 reasoning_content 暴露为 LangChain 标准 content block。
 */
function translateOpenAiCompatibleReasoningMessage(message: LangChainReasoningTranslatorMessage): Array<Record<string, unknown>> {
    const blocks: Array<Record<string, unknown>> = [];
    const reasoningContent = message.additional_kwargs?.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.trim()) {
        blocks.push({
            type: "reasoning",
            reasoning: reasoningContent,
        });
    }

    if (typeof message.content === "string") {
        if (message.content) {
            blocks.push({
                type: "text",
                text: message.content,
            });
        }
    } else {
        for (const block of message.content) {
            if (
                block
                && typeof block === "object"
                && "type" in block
                && block.type === "text"
                && "text" in block
                && typeof block.text === "string"
            ) {
                blocks.push({
                    type: "text",
                    text: block.text,
                });
            }
        }
    }

    for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
            type: "tool_call",
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.args,
        });
    }
    return blocks;
}

/**
 * 注册项目级 OpenAI-compatible reasoning translator。
 *
 * LangChain 已有 contentBlocks 标准，但默认 OpenAI converter 不会把 provider extension
 * reasoning_content 转成标准 reasoning block，这里在项目 adapter 边界补齐。
 */
function registerOpenAiCompatibleReasoningTranslator(): void {
    const registryGlobal = globalThis as LangChainReasoningTranslatorGlobal;
    registryGlobal.lc_block_translators_registry ??= new Map();
    if (registryGlobal.lc_block_translators_registry.has(OPENAI_COMPATIBLE_MODEL_PROVIDER)) {
        return;
    }
    registryGlobal.lc_block_translators_registry.set(OPENAI_COMPATIBLE_MODEL_PROVIDER, {
        translateContent: translateOpenAiCompatibleReasoningMessage,
        translateContentChunk: translateOpenAiCompatibleReasoningMessage,
    });
}

registerOpenAiCompatibleReasoningTranslator();

/**
 * OpenAI-compatible provider 的流式 delta 可能省略 role。
 * LangChain 原始转换在缺 role 时会退化成 generic ChatMessageChunk，Agent runtime 会跳过 thinking。
 */
function convertOpenAiCompatibleDeltaToBaseMessageChunk(input: {
    delta: Record<string, unknown>;
    rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk;
    includeRawResponse: boolean;
    defaultRole?: OpenAI.Chat.ChatCompletionRole;
}): BaseMessageChunk {
    const normalizedRole: OpenAI.Chat.ChatCompletionRole =
        input.delta.role === "assistant"
            || input.delta.role === "user"
            || input.delta.role === "system"
            || input.delta.role === "tool"
            || input.delta.role === "function"
            || input.delta.role === "developer"
            ? input.delta.role
            : input.defaultRole ?? "assistant";

    return convertCompletionsDeltaToBaseMessageChunk({
        delta: "role" in input.delta ? input.delta : {
            ...input.delta,
            role: normalizedRole,
        },
        rawResponse: input.rawResponse,
        includeRawResponse: input.includeRawResponse,
        defaultRole: normalizedRole,
    });
}

/**
 * Gemini 兼容网关的流式 chunk 经常不带 role。
 * LangChain 在 role 缺失时会退化成 ChatMessageChunk，并直接丢掉 reasoning_content。
 * 这里复用 OpenAI-compatible 的 role 兜底：没有 role 时默认按 assistant 解析。
 */
class GeminiChatOpenAICompletions extends ChatOpenAICompletions {
    /**
     * 兜底修正 Gemini 兼容网关缺失 role 的流式 chunk。
     */
    protected override _convertCompletionsDeltaToBaseMessageChunk(
        delta: Record<string, unknown>,
        rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
        defaultRole?: OpenAI.Chat.ChatCompletionRole,
    ): BaseMessageChunk {
        return convertOpenAiCompatibleDeltaToBaseMessageChunk({
            delta,
            rawResponse,
            includeRawResponse: this.__includeRawResponse ?? false,
            defaultRole,
        });
    }
}

type OpenAiCompatibleChatOpenAICompletionsFields = ConstructorParameters<typeof ChatOpenAICompletions>[0] & {
    reasoningContentReplay?: boolean;
};

/**
 * 归一化 OpenAI-compatible reasoning 输出。
 */
export function normalizeOpenAiCompatibleReasoningMessage<T extends AIMessage | AIMessageChunk>(message: T): T {
    const reasoningContent = message.additional_kwargs.reasoning_content;
    if (typeof reasoningContent !== "string" || !reasoningContent.trim()) {
        return message;
    }

    message.response_metadata = {
        ...message.response_metadata,
        model_provider: OPENAI_COMPATIBLE_MODEL_PROVIDER,
    };
    return message;
}

/**
 * 项目增强版 OpenAI-compatible 模型封装。
 *
 * 负责把 provider extension `reasoning_content` 转成 LangChain 标准 reasoning block，
 * 并在后续请求里回放 assistant tool-call 历史的 reasoning_content。
 */
class NeuroBookChatOpenAICompatible extends ChatOpenAICompletions {
    private readonly reasoningContentReplay: boolean;

    constructor(fields?: OpenAiCompatibleChatOpenAICompletionsFields) {
        super(fields);
        this.reasoningContentReplay = fields?.reasoningContentReplay ?? true;
    }

    /**
     * 兜底修正 OpenAI-compatible provider 缺失 role 的流式 chunk。
     */
    protected override _convertCompletionsDeltaToBaseMessageChunk(
        delta: Record<string, unknown>,
        rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
        defaultRole?: OpenAI.Chat.ChatCompletionRole,
    ): BaseMessageChunk {
        return convertOpenAiCompatibleDeltaToBaseMessageChunk({
            delta,
            rawResponse,
            includeRawResponse: this.__includeRawResponse ?? false,
            defaultRole,
        });
    }

    /**
     * 归一化非流式 OpenAI-compatible 输出。
     */
    override async _generate(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        options.signal?.throwIfAborted();
        const params = this.invocationParams(options);
        if (params.stream) {
            return super._generate(messages, options, runManager);
        }

        const data = await runTimedProviderRequest(this.model, this.timeout, async () => this.completionWithRetry({
            ...params,
            stream: false,
            messages: convertOpenAiCompatibleMessagesToCompletionsParams(messages, this.model, {
                reasoningContentReplay: this.reasoningContentReplay,
            }),
        }, {
            signal: options?.signal,
            ...options?.options,
        }));

        const usageMetadata = buildUsageMetadataFromRawUsage(data?.usage ?? null);
        const generations = data?.choices?.map((part) => {
            const baseMessage = this._convertCompletionsMessageToBaseMessage(part.message ?? {role: "assistant"}, data);
            const message = AIMessage.isInstance(baseMessage)
                ? normalizeOpenAiCompatibleUsageMetadata(normalizeOpenAiCompatibleReasoningMessage(baseMessage))
                : baseMessage;
            if (usageMetadata && AIMessage.isInstance(message)) {
                message.usage_metadata = usageMetadata;
            }

            return {
                text: part.message?.content ?? "",
                message,
                generationInfo: {
                    ...(part.finish_reason ? {finish_reason: part.finish_reason} : {}),
                    ...(part.logprobs ? {logprobs: part.logprobs} : {}),
                },
            };
        }) ?? [];

        return {
            generations,
            llmOutput: {
                tokenUsage: {
                    promptTokens: data?.usage?.prompt_tokens,
                    completionTokens: data?.usage?.completion_tokens,
                    totalTokens: data?.usage?.total_tokens,
                },
            },
        };
    }

    /**
     * 归一化流式 OpenAI-compatible 输出。
     */
    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const params = {
            ...this.invocationParams(options, {streaming: true}),
            messages: convertOpenAiCompatibleMessagesToCompletionsParams(messages, this.model, {
                reasoningContentReplay: this.reasoningContentReplay,
            }),
            stream: true,
        };
        const streamIterable = await runTimedProviderRequest(
            this.model,
            this.timeout,
            async () => this.completionWithRetry(params as never, options as never) as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>,
        );
        let defaultRole: OpenAI.Chat.ChatCompletionRole | undefined;
        let usage: OpenAI.CompletionUsage | undefined;

        for await (const data of streamIterable) {
            if (options.signal?.aborted) {
                return;
            }
            const choice = data?.choices?.[0];
            if (data.usage) {
                usage = data.usage;
            }
            if (!choice?.delta) {
                continue;
            }

            const chunk = this._convertCompletionsDeltaToBaseMessageChunk(choice.delta as Record<string, unknown>, data, defaultRole);
            defaultRole = choice.delta.role ?? defaultRole;
            if (typeof chunk.content !== "string") {
                continue;
            }

            const generationInfo: Record<string, unknown> = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (choice.finish_reason !== null) {
                generationInfo.finish_reason = choice.finish_reason;
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs) {
                generationInfo.logprobs = choice.logprobs;
            }

            const generationChunk = new ChatGenerationChunk({
                message: normalizeOpenAiCompatibleUsageMetadata(normalizeOpenAiCompatibleReasoningMessage(chunk as AIMessageChunk)),
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            await runManager?.handleLLMNewToken(
                generationChunk.text ?? "",
                {
                    prompt: options.promptIndex ?? 0,
                    completion: choice.index ?? 0,
                },
                undefined,
                undefined,
                undefined,
                {chunk: generationChunk},
            );
        }

        if (usage) {
            const generationChunk = new ChatGenerationChunk({
                message: normalizeOpenAiCompatibleUsageMetadata(new AIMessageChunk({
                    content: "",
                    response_metadata: {
                        usage: {...usage},
                    },
                })),
                text: "",
            });
            yield generationChunk;
            await runManager?.handleLLMNewToken(
                generationChunk.text ?? "",
                {
                    prompt: 0,
                    completion: 0,
                },
                undefined,
                undefined,
                undefined,
                {chunk: generationChunk},
            );
        }

        if (options.signal?.aborted) {
            throw new Error("AbortError");
        }
    }
}

/**
 * 从未知对象中安全读取数字字段。
 */
function readNumberField(value: unknown, key: string): number | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    return typeof record[key] === "number" && Number.isFinite(record[key])
        ? record[key]
        : null;
}

/**
 * 从未知对象中安全读取对象字段。
 */
function readRecordField(value: unknown, key: string): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const field = (value as Record<string, unknown>)[key];
    return field && typeof field === "object" && !Array.isArray(field)
        ? field as Record<string, unknown>
        : null;
}

/**
 * 读取 provider 原始 usage。
 */
function readResponseUsage(message: {response_metadata?: Record<string, unknown>}): Record<string, unknown> | null {
    const usage = message.response_metadata?.usage;
    return usage && typeof usage === "object" && !Array.isArray(usage)
        ? usage as Record<string, unknown>
        : null;
}

/**
 * 把 OpenAI Chat Completions usage 归一化到 LangChain usage_metadata。
 */
function buildUsageMetadataFromRawUsage(
    rawUsage: unknown,
    currentUsage?: UsageMetadata,
): UsageMetadata | undefined {
    if (!rawUsage) {
        return undefined;
    }

    const inputTokens = currentUsage?.input_tokens ?? readNumberField(rawUsage, "prompt_tokens");
    const outputTokens = currentUsage?.output_tokens ?? readNumberField(rawUsage, "completion_tokens");
    const totalTokens = currentUsage?.total_tokens ?? readNumberField(rawUsage, "total_tokens");
    if (inputTokens === null && outputTokens === null && totalTokens === null) {
        return undefined;
    }

    const promptTokensDetails = readRecordField(rawUsage, "prompt_tokens_details");
    const completionTokensDetails = readRecordField(rawUsage, "completion_tokens_details");
    const inputDetails: ProviderUsageInputDetails = {
        ...(currentUsage?.input_token_details ?? {}),
    };
    const promptAudioTokens = readNumberField(promptTokensDetails, "audio_tokens");
    const cacheHitTokens = readNumberField(rawUsage, "prompt_cache_hit_tokens")
        ?? readNumberField(promptTokensDetails, "cached_tokens");
    const cacheMissTokens = readNumberField(rawUsage, "prompt_cache_miss_tokens");
    if (typeof inputDetails.audio !== "number" && promptAudioTokens !== null) {
        inputDetails.audio = promptAudioTokens;
    }
    if (typeof inputDetails.cache_read !== "number" && cacheHitTokens !== null) {
        inputDetails.cache_read = cacheHitTokens;
    }
    if (cacheMissTokens !== null) {
        inputDetails.cache_miss = cacheMissTokens;
    }

    const outputDetails: NonNullable<UsageMetadata["output_token_details"]> = {
        ...(currentUsage?.output_token_details ?? {}),
    };
    const completionAudioTokens = readNumberField(completionTokensDetails, "audio_tokens");
    const reasoningTokens = readNumberField(completionTokensDetails, "reasoning_tokens");
    if (typeof outputDetails.audio !== "number" && completionAudioTokens !== null) {
        outputDetails.audio = completionAudioTokens;
    }
    if (typeof outputDetails.reasoning !== "number" && reasoningTokens !== null) {
        outputDetails.reasoning = reasoningTokens;
    }

    return {
        input_tokens: inputTokens ?? 0,
        output_tokens: outputTokens ?? 0,
        total_tokens: totalTokens ?? 0,
        ...(Object.keys(inputDetails).length > 0 ? {input_token_details: inputDetails} : {}),
        ...(Object.keys(outputDetails).length > 0 ? {output_token_details: outputDetails} : {}),
    };
}

/**
 * 把 OpenAI-compatible raw usage 归一化到 LangChain message.usage_metadata。
 */
export function normalizeOpenAiCompatibleUsageMetadata<T extends AIMessage | AIMessageChunk>(message: T): T {
    const usageMetadata = buildUsageMetadataFromRawUsage(readResponseUsage(message), message.usage_metadata);
    if (usageMetadata) {
        message.usage_metadata = usageMetadata;
    }
    return message;
}

/**
 * 把 DeepSeek raw usage 归一化到 LangChain message.usage_metadata。
 */
export function normalizeDeepSeekUsageMetadata<T extends AIMessage | AIMessageChunk>(message: T): T {
    normalizeOpenAiCompatibleUsageMetadata(message);
    return message;
}

/**
 * 将 LangChain 消息转换为 OpenAI-compatible Chat Completions 参数。
 */
export function convertOpenAiCompatibleMessagesToCompletionsParams(
    messages: BaseMessage[],
    model: string,
    options: {
        reasoningContentReplay?: boolean;
        strictToolCallReasoning?: boolean;
    } = {},
): OpenAiCompatibleCompletionMessageParam[] {
    const params = convertMessagesToCompletionsMessageParams({
        messages,
        model,
    }) as OpenAiCompatibleCompletionMessageParam[];
    stripStandardReasoningBlocks(params);
    stripToolCallContentBlocks(params);
    ensureUniqueToolCallIdsInParams(params);
    const normalizedParams = options.reasoningContentReplay ?? true
        ? attachOpenAiCompatibleReasoningContent(messages, params, {
            strictToolCallReasoning: options.strictToolCallReasoning ?? false,
        })
        : params;
    ensureUniqueToolCallIdsInParams(normalizedParams);
    return normalizedParams;
}

/**
 * OpenAI Chat Completions 请求 content 不支持 LangChain 标准 reasoning block。
 */
function stripStandardReasoningBlocks(params: OpenAiCompatibleCompletionMessageParam[]): void {
    for (const param of params) {
        if (!("content" in param) || !Array.isArray(param.content)) {
            continue;
        }
        param.content = param.content.filter((part) => {
            const record = part as {type?: unknown};
            return !(
                part
                && typeof part === "object"
                && "type" in part
                && record.type === "reasoning"
            );
        }) as typeof param.content;
        if (Array.isArray(param.content) && param.content.length === 0) {
            param.content = "";
        }
    }
}

/**
 * OpenAI-compatible 请求里 tool_calls 是 canonical 结构；content 内残留的工具块会让 Bedrock 重放出重复 toolUse id。
 */
function stripToolCallContentBlocks(params: OpenAiCompatibleCompletionMessageParam[]): void {
    for (const param of params) {
        if (!("content" in param) || !Array.isArray(param.content)) {
            continue;
        }
        param.content = param.content.filter((part) => !isToolCallContentPart(part)) as typeof param.content;
        if (Array.isArray(param.content) && param.content.length === 0) {
            param.content = "";
        }
    }
}

/**
 * 判断 Chat Completions content part 是否代表工具调用。
 */
function isToolCallContentPart(part: unknown): boolean {
    if (!part || typeof part !== "object" || Array.isArray(part) || !("type" in part)) {
        return false;
    }
    const type = (part as {type?: unknown}).type;
    return type === "tool_call" || type === "tool_use" || type === "server_tool_use";
}

/**
 * 在最终请求参数层确保 tool id 全局唯一，并同步 tool result 的 tool_call_id。
 * 这是 provider adapter 的最后防线，覆盖绕过历史 codec 的临时消息。
 */
function ensureUniqueToolCallIdsInParams(params: OpenAiCompatibleCompletionMessageParam[]): void {
    const seenToolCallIds = new Set<string>();
    const pendingToolCallIds = new Map<string, string[]>();
    let assistantTurn = 0;

    for (const param of params) {
        if (param.role === "assistant") {
            assistantTurn += 1;
            const toolCalls = "tool_calls" in param && Array.isArray(param.tool_calls)
                ? param.tool_calls
                : [];
            for (let index = 0; index < toolCalls.length; index += 1) {
                const toolCall = toolCalls[index];
                if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
                    continue;
                }
                const originalId = typeof toolCall.id === "string" && toolCall.id.trim()
                    ? toolCall.id
                    : `tool-call-${String(assistantTurn)}-${String(index + 1)}`;
                const nextId = seenToolCallIds.has(originalId)
                    ? createUniqueParamToolCallId(originalId, assistantTurn, index, seenToolCallIds)
                    : originalId;
                seenToolCallIds.add(nextId);
                toolCall.id = nextId;
                appendPendingToolCallId(pendingToolCallIds, originalId, nextId);
            }
            continue;
        }

        if (param.role !== "tool" || typeof param.tool_call_id !== "string") {
            continue;
        }

        const nextIds = pendingToolCallIds.get(param.tool_call_id);
        if (nextIds?.length) {
            param.tool_call_id = nextIds.shift()!;
        }
    }
}

/**
 * 记录原始 tool id 到最终请求 id 的顺序映射。
 */
function appendPendingToolCallId(target: Map<string, string[]>, originalId: string, nextId: string): void {
    const ids = target.get(originalId) ?? [];
    ids.push(nextId);
    target.set(originalId, ids);
}

/**
 * 生成 provider 请求内唯一的 tool id。
 */
function createUniqueParamToolCallId(
    originalId: string,
    assistantTurn: number,
    toolCallIndex: number,
    seenToolCallIds: Set<string>,
): string {
    const baseId = `${originalId}__turn_${String(assistantTurn)}`;
    if (!seenToolCallIds.has(baseId)) {
        return baseId;
    }
    let suffix = toolCallIndex + 1;
    while (seenToolCallIds.has(`${baseId}_${String(suffix)}`)) {
        suffix += 1;
    }
    return `${baseId}_${String(suffix)}`;
}

/**
 * 将 LangChain 消息转换为 DeepSeek Chat Completions 参数。
 * DeepSeek thinking mode 在同一轮工具调用续跑时要求 assistant tool-call 消息携带 reasoning_content。
 */
export function convertDeepSeekMessagesToCompletionsParams(
    messages: BaseMessage[],
    model: string,
): DeepSeekCompletionMessageParam[] {
    const enableThinking = shouldEnableDeepSeekThinking(model);
    return convertOpenAiCompatibleMessagesToCompletionsParams(messages, model, {
        reasoningContentReplay: enableThinking,
        strictToolCallReasoning: enableThinking,
    });
}

/**
 * 给 assistant 消息回填 provider reasoning_content。
 */
function attachOpenAiCompatibleReasoningContent(
    messages: BaseMessage[],
    params: OpenAiCompatibleCompletionMessageParam[],
    options: {
        strictToolCallReasoning: boolean;
    },
): OpenAiCompatibleCompletionMessageParam[] {
    const reasoningBySignature = collectReasoningByToolSignature(messages);
    const orderedAssistantReasoning = collectOrderedAssistantReasoning(messages);
    const orderedReasoning = collectOrderedToolCallReasoning(messages);
    let assistantIndex = 0;
    let orderedIndex = 0;

    // MiMo / DeepSeek 等 reasoning provider 要求：进行了工具调用的轮次，
    // 后续请求必须回传该轮产生的 reasoning_content。
    for (const currentParam of params) {
        if (currentParam.role !== "assistant") {
            continue;
        }

        if (!currentParam.reasoning_content?.trim()) {
            const assistantReasoning = orderedAssistantReasoning[assistantIndex] ?? "";
            if (assistantReasoning) {
                currentParam.reasoning_content = assistantReasoning;
            }
        }
        assistantIndex += 1;

        if (!("tool_calls" in currentParam) || !currentParam.tool_calls?.length) {
            continue;
        }

        if (currentParam.reasoning_content?.trim()) {
            orderedIndex += 1;
            continue;
        }

        const signature = createParamToolCallSignature(currentParam.tool_calls);
        const reasoningContent = (
            signature ? reasoningBySignature.get(signature) : undefined
        ) ?? orderedReasoning[orderedIndex] ?? "";
        orderedIndex += 1;

        if (reasoningContent) {
            currentParam.reasoning_content = reasoningContent;
            continue;
        }

        if (options.strictToolCallReasoning) {
            throw new Error("OpenAI-compatible reasoning 历史缺少 reasoning_content：包含 tool_calls 的 assistant 消息必须完整回传 reasoning_content。请清空、截断或迁移旧线程历史。");
        }
    }

    return params;
}

/**
 * 按 tool_call 签名收集 reasoning_content。
 */
function collectReasoningByToolSignature(messages: BaseMessage[]): Map<string, string> {
    const reasoningBySignature = new Map<string, string>();
    for (const message of messages) {
        if (!AIMessage.isInstance(message)) {
            continue;
        }
        const reasoningContent = readOpenAiCompatibleReasoningContent(message);
        if (!reasoningContent) {
            continue;
        }
        for (const signature of createMessageToolCallSignatures(message)) {
            reasoningBySignature.set(signature, reasoningContent);
        }
    }
    return reasoningBySignature;
}

/**
 * 按 assistant 出现顺序收集 reasoning_content。
 */
function collectOrderedAssistantReasoning(messages: BaseMessage[]): string[] {
    const orderedReasoning: string[] = [];
    let pendingSplitReasoning = "";

    for (const message of messages) {
        if (!AIMessage.isInstance(message)) {
            pendingSplitReasoning = "";
            continue;
        }

        const reasoningContent = readOpenAiCompatibleReasoningContent(message);
        orderedReasoning.push(reasoningContent || (hasMessageToolCalls(message) ? pendingSplitReasoning : ""));
        pendingSplitReasoning = reasoningContent && !message.text.trim()
            ? reasoningContent
            : "";
    }

    return orderedReasoning;
}

/**
 * 按 assistant tool-call 出现顺序收集 reasoning_content。
 *
 * 部分 LangGraph 中间态可能把 thinking chunk 与 tool_call chunk 拆成相邻 AIMessage。
 * 这种情况下，后一个 tool-call message 自身没有 reasoning_content，但前一个空正文 AIMessage
 * 仍然代表同一轮 assistant thinking，可以作为回填来源。
 */
function collectOrderedToolCallReasoning(messages: BaseMessage[]): string[] {
    const orderedReasoning: string[] = [];
    let pendingSplitReasoning = "";

    for (const message of messages) {
        if (!AIMessage.isInstance(message)) {
            pendingSplitReasoning = "";
            continue;
        }

        const reasoningContent = readOpenAiCompatibleReasoningContent(message);
        if (hasMessageToolCalls(message)) {
            orderedReasoning.push(reasoningContent || pendingSplitReasoning);
            pendingSplitReasoning = "";
            continue;
        }

        pendingSplitReasoning = reasoningContent && !message.text.trim()
            ? reasoningContent
            : "";
    }

    return orderedReasoning;
}

/**
 * 判断 LangChain AIMessage 是否携带工具调用。
 */
function hasMessageToolCalls(message: AIMessage): boolean {
    if (message.tool_calls?.length) {
        return true;
    }
    return Array.isArray(message.additional_kwargs.tool_calls) && message.additional_kwargs.tool_calls.length > 0;
}

/**
 * 为 LangChain AIMessage 中的 tool_call 生成签名。
 */
function createMessageToolCallSignatures(message: AIMessage): string[] {
    const signatures: string[] = [];
    if (message.tool_calls?.length) {
        const signature = message.tool_calls
            .map((toolCall) => `${toolCall.id ?? ""}:${toolCall.name}`)
            .join("|");
        if (signature) {
            signatures.push(signature);
        }
    }

    if (Array.isArray(message.additional_kwargs.tool_calls)) {
        const signature = createParamToolCallSignature(message.additional_kwargs.tool_calls);
        if (signature) {
            signatures.push(signature);
        }
    }
    return signatures;
}

/**
 * 为 OpenAI/DeepSeek 请求参数里的 tool_calls 生成签名。
 */
function createParamToolCallSignature(toolCalls: unknown[]): string {
    return toolCalls
        .map((toolCall) => {
            if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
                return "";
            }
            const record = toolCall as DeepSeekToolCallParam;
            const id = typeof record.id === "string" ? record.id : "";
            const name = typeof record.function?.name === "string" ? record.function.name : "";
            return `${id}:${name}`;
        })
        .filter(Boolean)
        .join("|");
}

/**
 * 读取可回传给 OpenAI-compatible provider 的 thinking 内容。
 */
function readOpenAiCompatibleReasoningContent(message: AIMessage): string {
    const reasoningContent = message.additional_kwargs.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.trim()) {
        return reasoningContent;
    }

    const standardReasoningContent = readStandardReasoningContent(message);
    if (standardReasoningContent) {
        return standardReasoningContent;
    }

    const thinking = message.additional_kwargs.thinking;
    return typeof thinking === "string" && thinking.trim() ? thinking : "";
}

/**
 * 给 provider 请求失败补充耗时与配置超时，区分客户端超时和上游快速失败。
 */
async function runTimedProviderRequest<T>(model: string, timeoutMs: number | undefined, task: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
        return await task();
    } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const baseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Provider 请求失败：model=${model}; elapsedMs=${String(elapsedMs)}; timeoutMs=${String(timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS)}; ${baseMessage}`);
    }
}

/**
 * 判断 DeepSeek 模型是否启用 thinking mode。
 */
function shouldEnableDeepSeekThinking(model: string): boolean {
    const normalizedModelId = model.toLowerCase();
    return normalizedModelId.includes("reasoner") || normalizedModelId.includes("deepseek-v4");
}

/**
 * DeepSeek 模型封装层。
 * 负责把 DeepSeek provider 字段折叠进 LangChain Message，避免 agent 业务层理解 provider raw usage。
 */
class NeuroBookChatDeepSeek extends ChatDeepSeek {
    /**
     * 归一化非流式 DeepSeek 输出。
     *
     * ChatDeepSeek 默认非流式路径会直接使用 LangChain 的 OpenAI converter，
     * 这里必须接管 messages 转换，否则 stream=false 时会漏掉 reasoning_content 回传。
     */
    override async _generate(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        const params = this.invocationParams(options);
        if (params.stream) {
            return super._generate(messages, options, runManager);
        }

        const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
            ...params,
            stream: false,
            messages: convertDeepSeekMessagesToCompletionsParams(messages, this.model),
        };
        const data = await runTimedProviderRequest(this.model, this.timeout, async () => super.completionWithRetry(request, {
            signal: options?.signal,
            ...options?.options,
        }));
        const usageMetadata = buildUsageMetadataFromRawUsage(data?.usage ?? null) ?? {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
        };

        const generations = [];
        for (const part of data?.choices ?? []) {
            const message = this._convertCompletionsMessageToBaseMessage(
                part.message ?? {role: "assistant"},
                data,
            );
            if (AIMessage.isInstance(message)) {
                message.usage_metadata = usageMetadata;
            }
            generations.push({
                text: part.message?.content ?? "",
                message,
                generationInfo: {
                    ...(part.finish_reason ? {finish_reason: part.finish_reason} : {}),
                    ...(part.logprobs ? {logprobs: part.logprobs} : {}),
                },
            });
        }

        return {
            generations,
            llmOutput: {
                tokenUsage: {
                    promptTokens: usageMetadata.input_tokens,
                    completionTokens: usageMetadata.output_tokens,
                    totalTokens: usageMetadata.total_tokens,
                },
            },
        };
    }

    /**
     * 归一化流式 DeepSeek 输出。
     */
    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const messagesMapped = convertDeepSeekMessagesToCompletionsParams(messages, this.model);
        const params = {
            ...this.invocationParams(options, {streaming: true}),
            messages: messagesMapped,
            stream: true,
        };
        const streamIterable = await runTimedProviderRequest(
            this.model,
            this.timeout,
            async () => super.completionWithRetry(params as never, options as never) as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>,
        );
        let defaultRole: OpenAI.Chat.ChatCompletionRole | undefined;
        let usage: OpenAI.CompletionUsage | undefined;

        for await (const data of streamIterable) {
            if (options.signal?.aborted) {
                return;
            }
            const choice = data?.choices?.[0];
            if (data.usage) {
                usage = data.usage;
            }
            if (!choice?.delta) {
                continue;
            }

            const chunk = this._convertCompletionsDeltaToBaseMessageChunk(choice.delta, data, defaultRole);
            defaultRole = choice.delta.role ?? defaultRole;
            if (typeof chunk.content !== "string") {
                continue;
            }

            const generationInfo: Record<string, unknown> = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (choice.finish_reason !== null) {
                generationInfo.finish_reason = choice.finish_reason;
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs) {
                generationInfo.logprobs = choice.logprobs;
            }

            normalizeDeepSeekUsageMetadata(chunk as AIMessageChunk);
            const generationChunk = new ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            await runManager?.handleLLMNewToken(
                generationChunk.text ?? "",
                {
                    prompt: options.promptIndex ?? 0,
                    completion: choice.index ?? 0,
                },
                undefined,
                undefined,
                undefined,
                {chunk: generationChunk},
            );
        }

        if (usage) {
            const generationChunk = new ChatGenerationChunk({
                message: normalizeDeepSeekUsageMetadata(new AIMessageChunk({
                    content: "",
                    response_metadata: {
                        usage: {...usage},
                    },
                })),
                text: "",
            });
            yield generationChunk;
            await runManager?.handleLLMNewToken(
                generationChunk.text ?? "",
                {
                    prompt: 0,
                    completion: 0,
                },
                undefined,
                undefined,
                undefined,
                {chunk: generationChunk},
            );
        }

        if (options.signal?.aborted) {
            throw new Error("AbortError");
        }
    }

    /**
     * 归一化非流式 DeepSeek 消息。
     */
    protected override _convertCompletionsMessageToBaseMessage(
        message: OpenAI.ChatCompletionMessage,
        rawResponse: OpenAI.ChatCompletion,
    ): BaseMessage {
        const baseMessage = super._convertCompletionsMessageToBaseMessage(message, rawResponse);
        return AIMessage.isInstance(baseMessage)
            ? normalizeDeepSeekUsageMetadata(baseMessage)
            : baseMessage;
    }
}

/**
 * 生成 `providerId/modelId` 形式的模型 key。
 */
export function buildModelKey(providerId: string, modelId: string): string {
    return `${providerId}/${modelId}`;
}

/**
 * 从模型 ID 推导默认分组。
 */
export function deriveModelGroup(modelId: string): string {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) {
        return "default";
    }

    const separatorIndex = trimmedModelId.indexOf("-");
    if (separatorIndex <= 0) {
        return trimmedModelId;
    }

    return trimmedModelId.slice(0, separatorIndex);
}

/**
 * 规范化 group。空值时回退到从模型 ID 自动推导。
 */
export function resolveModelGroup(group: string | null | undefined, modelId: string): string {
    const normalizedGroup = group?.trim() ?? "";
    return normalizedGroup || deriveModelGroup(modelId);
}

/**
 * 构造模型展示名。
 */
export function buildModelLabel(providerName: string, modelName: string): string {
    return `${providerName} / ${modelName}`;
}

/**
 * 解析模型上下文窗口。
 * 仅从 config.yaml 读取手动配置。
 */
export function resolveModelContextWindow(model: Pick<ConfiguredModelConfig, "id" | "contextWindowTokens">): ResolvedContextWindow {
    if (typeof model.contextWindowTokens === "number" && Number.isFinite(model.contextWindowTokens)) {
        return {
            tokens: Math.trunc(model.contextWindowTokens),
            source: "manual",
        };
    }

    return {
        tokens: null,
        source: "unknown",
    };
}

/**
 * profile 模型配置默认值。
 */
export function createDefaultAgentProfileModelConfig(): AgentProfileModelConfig {
    return {
        modelKey: null,
        temperature: null,
        topK: null,
        reasoningEffort: null,
        stream: true,
    };
}

/**
 * 归一化 profile 模型配置。
 */
function normalizeAgentProfileModelConfig(config: Partial<AgentProfileModelConfigDto> | AgentProfileModelConfig | undefined): AgentProfileModelConfig {
    return {
        modelKey: config?.modelKey?.trim() ? config.modelKey.trim() : null,
        temperature: typeof config?.temperature === "number" && Number.isFinite(config.temperature)
            ? config.temperature
            : null,
        topK: typeof config?.topK === "number" && Number.isFinite(config.topK)
            ? Math.trunc(config.topK)
            : null,
        reasoningEffort: config?.reasoningEffort ?? null,
        stream: config?.stream ?? true,
    };
}

/**
 * 把 DTO 请求体转成运行时配置结构。
 */
export function convertModelSettingsRequestToConfig(request: UpdateModelSettingsRequestDto): ModelSettingsConfig {
    return {
        defaultModelKey: request.defaultModelKey,
        providers: Object.fromEntries(
            request.providers.map((provider) => [provider.id, {
                name: provider.name,
                adapter: provider.adapter,
                options: {
                    apiKey: provider.options.apiKey.trim(),
                    baseURL: provider.options.baseURL.trim(),
                    proxy: provider.options.proxy.trim(),
                    timeoutMs: provider.options.timeoutMs,
                    requestOptions: provider.options.requestOptions,
                },
                models: Object.fromEntries(
                    provider.models.map((model) => [model.id, {
                        name: model.name.trim(),
                        id: model.id.trim(),
                        group: model.group?.trim() ? model.group.trim() : null,
                        enabled: model.enabled,
                        contextWindowTokens: model.contextWindowTokens,
                    }]),
                ),
            }]),
        ),
    };
}

/**
 * 把 Agent Profile DTO 请求体转成运行时配置结构。
 */
export function convertAgentProfileModelSettingsRequestToConfig(
    request: UpdateAgentProfileModelSettingsRequestDto,
): Record<string, AgentProfileConfig> {
    return Object.fromEntries(
        request.agentProfiles.map((profile) => [profile.profileKey, {
            model: normalizeAgentProfileModelConfig(profile.model),
        }]),
    );
}

/**
 * 把运行时配置转成 API DTO。
 */
export function buildModelSettingsDto(
    appConfig: Pick<AppConfig, "models">,
): ModelSettingsDto {
    const config = appConfig.models;
    const providers = Object.entries(config.providers).map(([providerId, provider]) => ({
        id: providerId,
        name: provider.name,
        adapter: provider.adapter,
        options: {
            apiKey: provider.options.apiKey,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
        models: Object.values(provider.models).map((model) => ({
            name: model.name,
            id: model.id,
            group: model.group,
            enabled: model.enabled,
            contextWindowTokens: model.contextWindowTokens,
        })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const defaultModel = resolveDefaultModel(config);

    return {
        defaultModelKey: config.defaultModelKey,
        defaultModelLabel: defaultModel ? buildModelLabel(defaultModel.provider.name, defaultModel.model.name) : null,
        enabledModels: listEnabledModels(config),
        providers,
    };
}

/**
 * 把 Agent Profile 配置转成 API DTO。
 */
export function buildAgentProfileModelSettingsDto(
    appConfig: Pick<AppConfig, "agent" | "models">,
    profileDefinitions: AgentProfileSettingDefinition[],
): AgentProfileModelSettingsDto {
    return {
        enabledModels: listEnabledModels(appConfig.models),
        agentProfiles: buildAgentProfileSettingsDto(appConfig, profileDefinitions),
    };
}

/**
 * 列出所有启用模型，供前端默认模型选择器使用。
 */
export function listEnabledModels(config: ModelSettingsConfig): EnabledModelOptionDto[] {
    const enabledModels: EnabledModelOptionDto[] = [];

    for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of Object.values(provider.models)) {
            if (!model.enabled) {
                continue;
            }

            enabledModels.push({
                key: buildModelKey(providerId, model.id),
                label: buildModelLabel(provider.name, model.name),
                providerId,
                modelId: model.id,
                contextWindowTokens: resolveModelContextWindow(model).tokens,
            });
        }
    }

    return enabledModels.sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * 解析指定模型 key。
 */
export function resolveConfiguredModel(config: ModelSettingsConfig, modelKey: string | null | undefined): ResolvedDefaultModel | null {
    const normalizedModelKey = modelKey?.trim() ?? "";
    if (!normalizedModelKey) {
        return null;
    }

    const separatorIndex = normalizedModelKey.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === normalizedModelKey.length - 1) {
        return null;
    }

    const providerId = normalizedModelKey.slice(0, separatorIndex);
    const modelId = normalizedModelKey.slice(separatorIndex + 1);
    const provider = config.providers[providerId];
    if (!provider) {
        return null;
    }

    const model = provider.models[modelId];
    if (!model || !model.enabled) {
        return null;
    }

    return {
        providerId,
        provider,
        model,
    };
}

/**
 * 解析默认模型指向的 provider / model。
 */
export function resolveDefaultModel(config: ModelSettingsConfig): ResolvedDefaultModel | null {
    return resolveConfiguredModel(config, config.defaultModelKey);
}

/**
 * 解析单个 profile 的模型配置。
 */
export function resolveAgentProfileModelConfig(appConfig: Pick<AppConfig, "agent">, profileKey: string): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig(appConfig.agent.profiles[profileKey]?.model);
}

/**
 * 规范化 thread 模型覆盖配置。
 */
export function normalizeThreadModelOverrideConfig(
    config: Partial<AgentThreadModelOverride> | null | undefined,
): AgentThreadModelOverride | null {
    if (!config?.modelKey?.trim()) {
        return null;
    }

    return {
        modelKey: config.modelKey.trim(),
        temperature: typeof config.temperature === "number" && Number.isFinite(config.temperature)
            ? config.temperature
            : null,
        topK: typeof config.topK === "number" && Number.isFinite(config.topK)
            ? Math.trunc(config.topK)
            : null,
        reasoningEffort: config.reasoningEffort ?? null,
        stream: config.stream ?? true,
    };
}

/**
 * 构造结构化模型配置。
 */
function buildResolvedModelConfig(
    resolvedModel: ResolvedDefaultModel,
    config: {
        temperature: number | null;
        topK: number | null;
        reasoningEffort: "low" | "medium" | "high" | null;
        stream: boolean;
    },
): {
    modelKey: string;
    modelLabel: string | null;
    temperature: number | null;
    topK: number | null;
    reasoningEffort: "low" | "medium" | "high" | null;
    stream: boolean;
    contextWindowTokens: number | null;
} {
    return {
        modelKey: buildModelKey(resolvedModel.providerId, resolvedModel.model.id),
        modelLabel: buildModelLabel(resolvedModel.provider.name, resolvedModel.model.name),
        temperature: config.temperature,
        topK: config.topK,
        reasoningEffort: config.reasoningEffort,
        stream: config.stream,
        contextWindowTokens: resolveModelContextWindow(resolvedModel.model).tokens,
    };
}

/**
 * 解析线程 / profile 最终生效的模型选择。
 */
export function resolveAgentModelSelection(
    appConfig: Pick<AppConfig, "agent" | "models">,
    profileKey: string,
    modelOverride?: AgentThreadModelOverride | null,
    legacyModelOverrideKey?: string | null,
): ResolvedAgentModelSelection {
    const profileModelConfig = resolveAgentProfileModelConfig(appConfig, profileKey);
    const normalizedModelOverride = normalizeThreadModelOverrideConfig(modelOverride);
    const effectiveThreadOverride = normalizedModelOverride ?? (
        legacyModelOverrideKey?.trim()
            ? {
                modelKey: legacyModelOverrideKey.trim(),
                temperature: profileModelConfig.temperature,
                topK: profileModelConfig.topK,
                reasoningEffort: profileModelConfig.reasoningEffort,
                stream: profileModelConfig.stream,
            } satisfies AgentThreadModelOverride
            : null
    );
    const overrideModel = resolveConfiguredModel(appConfig.models, effectiveThreadOverride?.modelKey ?? null);
    const profileModel = resolveConfiguredModel(appConfig.models, profileModelConfig.modelKey);
    const fallbackModel = resolveDefaultModel(appConfig.models);
    const effectiveModel = overrideModel ?? profileModel ?? fallbackModel;
    const effectiveTemperature = effectiveThreadOverride?.temperature ?? profileModelConfig.temperature;
    const effectiveTopK = effectiveThreadOverride?.topK ?? profileModelConfig.topK;
    const effectiveReasoningEffort = effectiveThreadOverride?.reasoningEffort ?? profileModelConfig.reasoningEffort;
    const effectiveStream = effectiveThreadOverride?.stream ?? profileModelConfig.stream;

    return {
        modelOverrideKey: effectiveThreadOverride?.modelKey ?? null,
        modelOverride: overrideModel && effectiveThreadOverride
            ? buildResolvedModelConfig(overrideModel, {
                temperature: effectiveThreadOverride.temperature ?? null,
                topK: effectiveThreadOverride.topK ?? null,
                reasoningEffort: effectiveThreadOverride.reasoningEffort ?? null,
                stream: effectiveThreadOverride.stream ?? true,
            })
            : null,
        profileModelKey: profileModelConfig.modelKey,
        effectiveModelKey: effectiveModel ? buildModelKey(effectiveModel.providerId, effectiveModel.model.id) : null,
        effectiveModelLabel: effectiveModel ? buildModelLabel(effectiveModel.provider.name, effectiveModel.model.name) : null,
        effectiveModel: effectiveModel
            ? buildResolvedModelConfig(effectiveModel, {
                temperature: effectiveTemperature,
                topK: effectiveTopK,
                reasoningEffort: effectiveReasoningEffort,
                stream: effectiveStream,
            })
            : null,
        temperature: effectiveTemperature,
        topK: effectiveTopK,
        reasoningEffort: effectiveReasoningEffort,
        stream: effectiveStream,
    };
}

/**
 * 构造 profile 模型设置 DTO。
 */
function buildAgentProfileSettingsDto(
    appConfig: Pick<AppConfig, "agent">,
    profileDefinitions: AgentProfileSettingDefinition[],
): ConfiguredAgentProfileDto[] {
    return profileDefinitions.map((definition) => ({
        profileKey: definition.profileKey,
        name: definition.name,
        kind: definition.kind,
        model: resolveAgentProfileModelConfig(appConfig, definition.profileKey),
    }));
}

/**
 * 尝试解析 JSON 字符串。
 */
function parseJson(text: string): unknown {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * 将日志对象稳定格式化为可完整输出的字符串。
 */
function formatLogPayload(value: unknown): string {
    try {
        return JSON.stringify(value, null, 4);
    } catch {
        return String(value);
    }
}

/**
 * 生成请求体摘要，重点暴露 messages 的结构，便于定位兼容层报错。
 */
function summarizeRequestBody(bodyText: string): unknown {
    const body = parseJson(bodyText);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }
    const requestBody = body as {
        model?: unknown;
        stream?: unknown;
        tools?: unknown[];
        messages?: unknown[];
    };

    return {
        model: requestBody.model,
        stream: requestBody.stream,
        toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0,
        messageCount: Array.isArray(requestBody.messages) ? requestBody.messages.length : 0,
        messages: Array.isArray(requestBody.messages)
            ? requestBody.messages.map((message, index) => {
                if (!message || typeof message !== "object" || Array.isArray(message)) {
                    return {index, invalidMessage: true};
                }
                const entry = message as {
                    role?: unknown;
                    content?: unknown;
                    tool_calls?: unknown[];
                    tool_call_id?: unknown;
                    name?: unknown;
                    reasoning_content?: unknown;
                };
                const content = entry.content;

                return {
                    index,
                    role: entry.role,
                    name: entry.name,
                    toolCallId: entry.tool_call_id,
                    toolCallCount: Array.isArray(entry.tool_calls) ? entry.tool_calls.length : 0,
                    hasReasoningContent: typeof entry.reasoning_content === "string" && entry.reasoning_content.length > 0,
                    reasoningContentLength: typeof entry.reasoning_content === "string" ? entry.reasoning_content.length : 0,
                    contentKind: typeof content === "string"
                        ? "string"
                        : Array.isArray(content)
                            ? "array"
                            : typeof content,
                    contentPreview: typeof content === "string"
                        ? content.slice(0, 200)
                        : undefined,
                    contentPartTypes: Array.isArray(content)
                        ? content.map((part) => {
                            if (!part || typeof part !== "object" || Array.isArray(part)) {
                                return typeof part;
                            }
                            return "type" in part ? String((part as {type?: unknown}).type) : "unknown";
                        })
                        : undefined,
                };
            })
            : [],
        raw: body,
    };
}

/**
 * 规范化请求头，避免泄露授权信息。
 */
function buildHeaderObject(headers: Headers): Record<string, string> {
    const headerObject: Record<string, string> = {};
    headers.forEach((value, key) => {
        headerObject[key] = key.toLowerCase() === "authorization" ? "[REDACTED]" : value;
    });
    return headerObject;
}

/**
 * 提取请求日志上下文。
 */
function buildHttpLogContext(providerName: string, input: RequestInfo | URL, init?: RequestInit): HttpLogContext {
    const url = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText =
        typeof init?.body === "string"
            ? init.body
            : init?.body
                ? "[non-string body]"
                : "";

    return {
        providerName,
        bodyText,
        headerObject: buildHeaderObject(headers),
        method,
        url,
    };
}

/**
 * 解析代理 dispatcher。
 */
function resolveDispatcher(proxy: string): Dispatcher | undefined {
    const normalizedProxy = proxy.trim();
    if (!normalizedProxy) {
        return undefined;
    }

    let proxyAgent = proxyAgentCache.get(normalizedProxy);
    if (!proxyAgent) {
        proxyAgent = new ProxyAgent(normalizedProxy);
        proxyAgentCache.set(normalizedProxy, proxyAgent);
    }

    return proxyAgent;
}

/**
 * 构造统一的 HTTP fetch 日志包装。
 * 这里抽出来给 OpenAI 兼容 provider 复用，避免每个模型工厂重复实现。
 */
function createLoggedFetch(providerName: string, proxy: string, timeoutMs: number | null) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const context = buildHttpLogContext(providerName, input, init);
        const dispatcher = resolveDispatcher(proxy);
        const requestUrl = typeof input === "string" || input instanceof URL ? input : input.url;
        const controller = new AbortController();
        const timeout = normalizeProviderTimeout(timeoutMs);
        const timeoutHandle = setTimeout(() => controller.abort(), timeout);
        const signal = mergeAbortSignals(init?.signal, controller.signal);

        if (enableOpenAiHttpLog) {
            consola.info(`${providerName}.request\n${formatLogPayload({
                method: context.method,
                url: context.url,
                headers: context.headerObject,
                requestBodySummary: summarizeRequestBody(context.bodyText),
            })}`);
        }

        try {
            const response = dispatcher
                ? await fetch(requestUrl, {
                    ...init,
                    signal,
                    dispatcher,
                } as RequestInit & {dispatcher: Dispatcher})
                : await fetch(requestUrl, {
                    ...init,
                    signal,
                });

            if (!response.ok) {
                const responseText = await response.clone().text();
                consola.error(`${providerName}.request_failed\n${formatLogPayload({
                    method: context.method,
                    url: context.url,
                    status: response.status,
                    statusText: response.statusText,
                    headers: context.headerObject,
                    requestBodySummary: summarizeRequestBody(context.bodyText),
                    responseBody: parseJson(responseText),
                })}`);
            }

            if (enableOpenAiHttpLog) {
                const responseText = await response.clone().text();
                const responseHeaders: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });
                consola.info(`${providerName}.response\n${formatLogPayload({
                    method: context.method,
                    url: context.url,
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body: parseJson(responseText),
                })}`);
            }

            return response;
        } catch (error) {
            if (controller.signal.aborted && !init?.signal?.aborted) {
                throw new Error(`Provider 请求超时：${String(timeout)}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    };
}

/**
 * 解析 provider 请求超时时间。
 */
function normalizeProviderTimeout(timeoutMs: number | null): number {
    return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.trunc(timeoutMs)
        : DEFAULT_PROVIDER_TIMEOUT_MS;
}

/**
 * 读取 provider 级请求体扩展参数。
 */
function normalizeProviderRequestOptions(value: Record<string, JsonValue>): Record<string, unknown> | undefined {
    return value && Object.keys(value).length > 0 ? value : undefined;
}

/**
 * 合并 provider 默认请求扩展与运行时模型参数。
 */
function mergeModelKwargs(
    providerOptions: Record<string, unknown> | undefined,
    runtimeOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    const merged = {
        ...(providerOptions ?? {}),
        ...(runtimeOptions ?? {}),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * 合并调用方取消信号与 provider timeout 信号。
 */
function mergeAbortSignals(left: AbortSignal | null | undefined, right: AbortSignal): AbortSignal {
    if (!left) {
        return right;
    }
    if (left.aborted) {
        return left;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    left.addEventListener("abort", abort, {once: true});
    right.addEventListener("abort", abort, {once: true});
    if (left.aborted || right.aborted) {
        controller.abort();
    }
    return controller.signal;
}

/**
 * 读取 provider 实际生效的 baseURL。
 */
function resolveProviderBaseURL(provider: Pick<ProviderRuntimeSource, "adapter" | "options">): string {
    const baseURL = provider.options.baseURL.trim();
    return baseURL || DEFAULT_PROVIDER_BASE_URLS[provider.adapter.type];
}

/**
 * 归一化 API 路径。
 */
function resolveApiUrl(provider: Pick<ProviderRuntimeSource, "adapter" | "options">, path: string): string {
    const baseURL = resolveProviderBaseURL(provider);
    const normalizedBase = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
    return new URL(path.replace(/^\//, ""), normalizedBase).toString();
}

/**
 * 构造 OpenAI 兼容 provider 的公共配置。
 */
function buildOpenAiCompatibleConfig(provider: ProviderRuntimeSource, model: ModelRuntimeSource) {
    const providerRequestOptions = normalizeProviderRequestOptions(provider.options.requestOptions);
    return {
        model: model.id,
        apiKey: provider.options.apiKey,
        timeout: normalizeProviderTimeout(provider.options.timeoutMs),
        streamUsage: true,
        supportsStrictToolCalling: false,
        configuration: {
            baseURL: resolveProviderBaseURL(provider),
            fetch: createLoggedFetch(provider.providerName, provider.options.proxy, provider.options.timeoutMs),
        },
        ...(providerRequestOptions ? {modelKwargs: providerRequestOptions} : {}),
    };
}

/**
 * 生成可选模型参数。
 */
function buildModelRuntimeOptions(options: {
    temperature?: number | null;
    topK?: number | null;
    reasoningEffort?: "low" | "medium" | "high" | null;
    stream?: boolean;
}): {
    temperature?: number;
    streaming: boolean;
    reasoning?: {
        effort: "low" | "medium" | "high";
    };
    modelKwargs?: Record<string, unknown>;
} {
    const modelKwargs: Record<string, unknown> = {};
    if (typeof options.topK === "number" && Number.isFinite(options.topK)) {
        modelKwargs.top_k = Math.trunc(options.topK);
    }

    return {
        ...(typeof options.temperature === "number" && Number.isFinite(options.temperature)
            ? {temperature: options.temperature}
            : {}),
        streaming: options.stream ?? true,
        reasoning: {
            effort: options.reasoningEffort ?? "high",
        },
        ...(Object.keys(modelKwargs).length > 0 ? {modelKwargs} : {}),
    };
}

/**
 * 通过 adapter 创建聊天模型。
 */
function createChatModelForSource(
    provider: ProviderRuntimeSource,
    model: ModelRuntimeSource,
    options: {
        temperature?: number | null;
        topK?: number | null;
        reasoningEffort?: "low" | "medium" | "high" | null;
        stream?: boolean;
    } = {},
): BaseChatModel {
    if (!provider.options.apiKey.trim()) {
        throw new Error(`Provider ${provider.providerName} 未配置 API Key`);
    }

    const runtimeOptions = buildModelRuntimeOptions(options);

    if (provider.adapter.type === "gemini-compatible") {
        const modelKwargs = mergeModelKwargs(
            normalizeProviderRequestOptions(provider.options.requestOptions),
            runtimeOptions.modelKwargs,
        );
        return new GeminiChatOpenAICompletions({
            ...buildOpenAiCompatibleConfig(provider, model),
            ...runtimeOptions,
            ...(modelKwargs ? {modelKwargs} : {}),
        });
    }

    if (provider.adapter.type === "deepseek-official") {
        const mergedModelKwargs = mergeModelKwargs(
            normalizeProviderRequestOptions(provider.options.requestOptions),
            {
                ...(runtimeOptions.modelKwargs ?? {}),
                ...(shouldEnableDeepSeekThinking(model.id)
                    ? {
                        thinking: {
                            type: "enabled" as const,
                        },
                    }
                    : {}),
            },
        );

        return new NeuroBookChatDeepSeek({
            model: model.id,
            apiKey: provider.options.apiKey,
            timeout: normalizeProviderTimeout(provider.options.timeoutMs),
            streamUsage: true,
            ...(typeof runtimeOptions.temperature === "number" ? {temperature: runtimeOptions.temperature} : {}),
            streaming: runtimeOptions.streaming,
            configuration: {
                baseURL: resolveProviderBaseURL(provider),
                fetch: createLoggedFetch(provider.providerName, provider.options.proxy, provider.options.timeoutMs),
            },
            ...(mergedModelKwargs ? {modelKwargs: mergedModelKwargs} : {}),
        });
    }

    if (provider.adapter.type === "openai-official") {
        const modelKwargs = mergeModelKwargs(
            normalizeProviderRequestOptions(provider.options.requestOptions),
            runtimeOptions.modelKwargs,
        );
        return new ChatOpenAI({
            ...buildOpenAiCompatibleConfig(provider, model),
            ...runtimeOptions,
            ...(modelKwargs ? {modelKwargs} : {}),
        });
    }

    const modelKwargs = mergeModelKwargs(
        normalizeProviderRequestOptions(provider.options.requestOptions),
        runtimeOptions.modelKwargs,
    );
    return new NeuroBookChatOpenAICompatible({
        ...buildOpenAiCompatibleConfig(provider, model),
        ...runtimeOptions,
        ...(modelKwargs ? {modelKwargs} : {}),
        reasoningContentReplay: provider.adapter.reasoningContentReplay,
    });
}

/**
 * 将 DTO draft 转成运行时 source。
 */
function convertDraftProvider(provider: ModelProviderDraftDto): ProviderRuntimeSource {
    return {
        providerId: provider.id,
        providerName: provider.name,
        adapter: provider.adapter,
        options: {
            apiKey: provider.options.apiKey.trim(),
            baseURL: provider.options.baseURL.trim(),
            proxy: provider.options.proxy.trim(),
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
    };
}

/**
 * 将 DTO draft model 转成运行时 source。
 */
function convertDraftModel(model: ConfiguredModelDto | Omit<ConfiguredModelDto, "enabled">): ModelRuntimeSource {
    return {
        name: model.name.trim(),
        id: model.id.trim(),
        group: model.group?.trim() ? model.group.trim() : null,
    };
}

/**
 * 调用 provider 的 `/models` 接口，发现可用模型。
 */
async function fetchDiscoveredModels(provider: ProviderRuntimeSource): Promise<DiscoveredProviderModelDto[]> {
    if (!provider.options.apiKey.trim()) {
        throw new Error("请先填写 API Key");
    }

    const response = await createLoggedFetch(provider.providerName, provider.options.proxy, provider.options.timeoutMs)(
        resolveApiUrl(provider, "models"),
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${provider.options.apiKey}`,
                "Content-Type": "application/json",
            },
        },
    );

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`模型列表请求失败：${response.status} ${response.statusText} ${responseText}`.trim());
    }

    const payload = await response.json() as {
        data?: Array<{
            id?: unknown;
        }>;
    };
    const data = Array.isArray(payload.data) ? payload.data : [];
    const discoveredModels = data.reduce<DiscoveredProviderModelDto[]>((models, item) => {
            const modelId = typeof item?.id === "string" ? item.id.trim() : "";
            if (!modelId) {
                return models;
            }

            models.push({
                id: modelId,
                name: modelId,
                group: deriveModelGroup(modelId),
            });
            return models;
        }, []).sort((left, right) => left.id.localeCompare(right.id));

    if (discoveredModels.length === 0) {
        throw new Error("Provider 未返回可识别的模型列表");
    }

    return discoveredModels;
}

/**
 * 对 Provider 进行连通性测试。
 */
export async function checkProviderConnection(providerDraft: ModelProviderDraftDto): Promise<CheckProviderResponseDto> {
    const startedAt = Date.now();

    try {
        const provider = convertDraftProvider(providerDraft);
        const models = await fetchDiscoveredModels(provider);
        return {
            success: true,
            latencyMs: Date.now() - startedAt,
            message: `连通性正常，发现 ${models.length} 个模型`,
        };
    } catch (error) {
        return {
            success: false,
            latencyMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : "Provider 连通性测试失败",
        };
    }
}

/**
 * 从远端抓取 Provider 模型列表。
 */
export async function discoverProviderModels(providerDraft: ModelProviderDraftDto): Promise<DiscoverProviderModelsResponseDto> {
    const provider = convertDraftProvider(providerDraft);
    const models = await fetchDiscoveredModels(provider);

    return {
        models,
        message: `发现 ${models.length} 个模型，可按需加入白名单`,
    };
}

/**
 * 对单个模型执行健康检查。
 */
export async function checkModelHealth(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
): Promise<CheckModelResponseDto> {
    const startedAt = Date.now();

    try {
        const provider = convertDraftProvider(providerDraft);
        const model = convertDraftModel(modelDraft);
        const chatModel = createChatModelForSource(provider, model);
        await chatModel.invoke([new HumanMessage(HELLO_PROMPT)]);

        return {
            success: true,
            latencyMs: Date.now() - startedAt,
            message: `模型请求成功：${model.id}`,
        };
    } catch (error) {
        return {
            success: false,
            latencyMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : "模型健康检查失败",
        };
    }
}

/**
 * 用指定模型配置创建聊天模型。
 */
export function createConfiguredChatModel(
    appConfig: Pick<AppConfig, "models">,
    input: {
        modelKey?: string | null;
        temperature?: number | null;
        topK?: number | null;
        reasoningEffort?: "low" | "medium" | "high" | null;
        stream?: boolean;
    } = {},
): BaseChatModel {
    const resolvedModel = input.modelKey
        ? resolveConfiguredModel(appConfig.models, input.modelKey)
        : resolveDefaultModel(appConfig.models);

    if (!resolvedModel) {
        throw new Error("config.yaml 未配置有效的默认模型，或指定模型未启用");
    }

    return createChatModelForSource({
        providerId: resolvedModel.providerId,
        providerName: resolvedModel.provider.name,
        adapter: resolvedModel.provider.adapter,
        options: {
            apiKey: resolvedModel.provider.options.apiKey,
            baseURL: resolvedModel.provider.options.baseURL,
            proxy: resolvedModel.provider.options.proxy,
            timeoutMs: resolvedModel.provider.options.timeoutMs,
            requestOptions: resolvedModel.provider.options.requestOptions,
        },
    }, {
        name: resolvedModel.model.name,
        id: resolvedModel.model.id,
        group: resolvedModel.model.group,
        enabled: resolvedModel.model.enabled,
    }, input);
}

/**
 * 按 agent profile / thread 解析聊天模型。
 */
export function useThreadProfileChatModel(
    profileKey: string,
    modelOverride?: AgentThreadModelOverride | null,
    legacyModelOverrideKey?: string | null,
): BaseChatModel {
    const appConfig = loadAppConfigSync();
    const resolvedSelection = resolveAgentModelSelection(appConfig, profileKey, modelOverride, legacyModelOverrideKey);

    if (!resolvedSelection.effectiveModelKey) {
        throw new Error(`profile ${profileKey} 未配置有效模型，且全局默认模型不可用`);
    }

    return createConfiguredChatModel(appConfig, {
        modelKey: resolvedSelection.effectiveModelKey,
        temperature: resolvedSelection.temperature,
        topK: resolvedSelection.topK,
        reasoningEffort: resolvedSelection.reasoningEffort,
        stream: resolvedSelection.stream,
    });
}

/**
 * 用 config.yaml 当前默认模型创建聊天模型。
 */
export const useChatModel = (): BaseChatModel => {
    const appConfig = loadAppConfigSync();
    return createConfiguredChatModel(appConfig);
};

/**
 * 保留旧导出名，便于局部调试时直接使用。
 * 这些函数不再读取 `.env`，而是按当前默认模型所在 adapter 构造实例。
 */
export const useOpenAIModel = (): BaseChatModel => useChatModel();
export const useGeminiModel = (): BaseChatModel => useChatModel();
export const useDeepSeekModel = (): BaseChatModel => useChatModel();
export const useDoubaoModel = (): BaseChatModel => useChatModel();
export const useQwenModel = (): BaseChatModel => useChatModel();
