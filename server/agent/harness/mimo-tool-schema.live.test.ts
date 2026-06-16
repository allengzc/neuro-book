import {describe, expect, it} from "vitest";
import {getModel, streamSimple, Type, validateToolArguments} from "@earendil-works/pi-ai";
import type {AssistantMessage, Message, Model, Tool, ToolCall, ToolResultMessage} from "@earendil-works/pi-ai";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {reportSidecarResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import simulatorActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";

const LIVE_ENABLED = process.env.MIMO_TOOL_SCHEMA_LIVE === "1";
const DEFAULT_MODEL_KEY = "xiaomi-token-plan-cn/mimo-v2.5-pro";
const RUNS = Math.max(1, Number.parseInt(process.env.MIMO_TOOL_SCHEMA_RUNS ?? "3", 10) || 3);
const MAX_ACTOR_TURNS = Math.max(2, Number.parseInt(process.env.MIMO_TOOL_SCHEMA_MAX_TURNS ?? "6", 10) || 6);
const LIVE_TEST_TIMEOUT_MS = Math.max(60_000, Number.parseInt(process.env.MIMO_TOOL_SCHEMA_TIMEOUT_MS ?? "420000", 10) || 420_000);

type ProbeResult = {
    caseName: string;
    runIndex: number;
    toolName: string | null;
    arguments: unknown;
    validation: {
        ok: boolean;
        value?: unknown;
        error?: string;
    };
    inspectedField: string;
    dataType: string;
    payloadType: string;
    dataLooksJsonString: boolean;
};

type ResolvedLiveModel = {
    model: Model<any>;
    apiKey: string;
    modelKey: string;
};

type MatrixCase = {
    name: string;
    tool: Tool;
    expectedInstruction: string;
    assertCurrentProtocol?: boolean;
    assertNativeObject?: boolean;
    inspectField?: string;
};

type ActorScenario = {
    name: string;
    subjectPath: string;
    userPacket: string;
    ragEvents: string;
    ragMemory: string;
};

const EmptyPayloadSchema = Type.Object({}, {
    additionalProperties: false,
});

const ContextPayloadSchema = Type.Object({
    context: Type.String(),
}, {
    additionalProperties: false,
});

const CurrentProtocolSchema = reportSidecarResultSchemaForProfile(simulatorActorProfile);

const RenamedAnyOfEnvelopeSchema = Type.Object({
    result: Type.String({
        description: "旁路阶段的可读结果；写简短摘要即可。",
    }),
    sidecarResult: Type.Union([
        Type.Object({
            sidecar: Type.Literal("actor.context-load"),
            payload: EmptyPayloadSchema,
        }, {
            additionalProperties: false,
        }),
        Type.Object({
            sidecar: Type.Literal("actor.memory-save"),
            payload: EmptyPayloadSchema,
        }, {
            additionalProperties: false,
        }),
    ], {
        description: "当前 profile 所有 sidecarDataSchema 的稳定 envelope union；当前旁路的精确 sidecar id 以 sidecar reminder 为准。",
    }),
}, {
    additionalProperties: false,
});

const SubjectRagSearchTool: Tool = {
    name: "subject_rag_search",
    description: "Search the current actor's own subject memory. Use it before report_sidecar_result.",
    parameters: Type.Object({
        subjectPath: Type.String(),
        query: Type.String(),
        sources: Type.Array(Type.Union([
            Type.Literal("events"),
            Type.Literal("memory"),
        ]), {
            minItems: 1,
            maxItems: 1,
        }),
        limit: Type.Optional(Type.Integer({minimum: 1, maximum: 8})),
    }, {
        additionalProperties: false,
    }),
};

const ReportSidecarTool: Tool = {
    name: "report_sidecar_result",
    description: "Report final sidecar result. Put the memory text in result and pass data as an object, never as a JSON string.",
    parameters: CurrentProtocolSchema,
};

const KeyedStableReportSidecarTool: Tool = {
    name: "report_sidecar_result",
    description: "Report final sidecar result. Put the memory text in result and pass data as an object keyed by the active sidecar name.",
    parameters: Type.Object({
        result: Type.String(),
        data: Type.Object({
            "actor.context-load": Type.Optional(EmptyPayloadSchema),
            "actor.memory-save": Type.Optional(EmptyPayloadSchema),
        }, {
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 1,
        }),
    }, {
        additionalProperties: false,
    }),
};

const MatrixCases: MatrixCase[] = [
    {
        name: "current-keyed-stable-empty-payload",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result using the current protocol. data must be an object, not a JSON string.",
            parameters: CurrentProtocolSchema,
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { \"actor.context-load\": {} }.",
        assertCurrentProtocol: true,
    },
    {
        name: "renamed-sidecarResult-anyof-envelope-empty-payload",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result using the current protocol shape, but the envelope field is named sidecarResult. sidecarResult must be an object, not a JSON string.",
            parameters: RenamedAnyOfEnvelopeSchema,
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and sidecarResult set to the object { sidecar: \"actor.context-load\", payload: {} }.",
        inspectField: "sidecarResult",
    },
    {
        name: "single-envelope-empty-payload",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result using a single envelope object.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Object({
                    sidecar: Type.Literal("actor.context-load"),
                    payload: EmptyPayloadSchema,
                }, {
                    additionalProperties: false,
                }),
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { sidecar: \"actor.context-load\", payload: {} }.",
    },
    {
        name: "non-empty-object-payload",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with a non-empty object payload.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Object({
                    sidecar: Type.Literal("actor.context-load"),
                    payload: ContextPayloadSchema,
                }, {
                    additionalProperties: false,
                }),
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { sidecar: \"actor.context-load\", payload: { context: \"loaded\" } }.",
    },
    {
        name: "string-payload",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with a string payload.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Object({
                    sidecar: Type.Literal("actor.context-load"),
                    payload: Type.String(),
                }, {
                    additionalProperties: false,
                }),
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { sidecar: \"actor.context-load\", payload: \"loaded\" }.",
    },
    {
        name: "top-level-envelope",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with sidecar and payload as top-level arguments.",
            parameters: Type.Object({
                result: Type.String(),
                sidecar: Type.Literal("actor.context-load"),
                payload: EmptyPayloadSchema,
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok, sidecar set to actor.context-load, and payload set to the empty object {}.",
    },
    {
        name: "keyed-object",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with data keyed by sidecar name.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Object({
                    "actor.context-load": EmptyPayloadSchema,
                }, {
                    additionalProperties: false,
                }),
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { \"actor.context-load\": {} }.",
    },
    {
        name: "keyed-stable-multi-sidecar-object",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with data as one object keyed by the active sidecar name. Use exactly one sidecar key.",
            parameters: Type.Object({
                result: Type.String(),
                data: Type.Object({
                    "actor.context-load": Type.Optional(EmptyPayloadSchema),
                    "actor.memory-save": Type.Optional(EmptyPayloadSchema),
                }, {
                    additionalProperties: false,
                    minProperties: 1,
                    maxProperties: 1,
                }),
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the object { \"actor.context-load\": {} }. Do not include actor.memory-save.",
        assertNativeObject: true,
    },
    {
        name: "direct-empty-object-data",
        tool: {
            name: "report_sidecar_result",
            description: "Report final sidecar result with data as an empty object.",
            parameters: Type.Object({
                result: Type.String(),
                data: EmptyPayloadSchema,
            }, {
                additionalProperties: false,
            }),
        },
        expectedInstruction: "Call report_sidecar_result with result set to ok and data set to the empty object {}.",
    },
];

const ActorScenarios: ActorScenario[] = [
    {
        name: "mage-context-load",
        subjectPath: "ming-ding-zhi-shi-2/simulation/subjects/mage",
        userPacket: [
            "<gm>运动男生继续追问子爵如何回去，子爵向法师投来求助眼神。白发女孩仍然安静观察大厅。</gm>",
            "<character name=\"运动男生\">你们到底有没有办法把我们送回去？需要多久？谁保证？</character>",
        ].join("\n"),
        ragEvents: [
            "events: 召唤仪式魔力回路闭合成功，但第四名白发女孩没有能力外放。",
            "events: 水晶长杖在朝向白发女孩时多次微温脉冲。",
        ].join("\n"),
        ragMemory: [
            "memory: 白发女孩的红宝石项链呈呼吸节律主动吸收和释放微光。",
            "memory: 运动男生追问条理清晰，不易被政治话术安抚。",
        ].join("\n"),
    },
    {
        name: "player-context-load",
        subjectPath: "ming-ding-zhi-shi-2/simulation/subjects/player",
        userPacket: [
            "<gm>眼镜女生向我靠近，问我被叫作哑火以后为什么还能这么冷静。</gm>",
            "<character name=\"眼镜女生\">你不害怕吗？我是说，刚才子爵那样说你。</character>",
        ].join("\n"),
        ragEvents: [
            "events: 我被召唤后发现身体变小，子爵称我为哑火。",
            "events: 我曾在看向洛丽塔女孩和女仆时短暂看见不可见的因果线。",
        ].join("\n"),
        ragMemory: [
            "memory: 眼镜女生一直观察我，不是敌意，而是解不开谜题的执拗。",
            "memory: 子爵称我为哑火时移开视线，可能隐瞒什么。",
        ].join("\n"),
    },
];

describe.skipIf(!LIVE_ENABLED)("mimo tool schema live probes", () => {
    it("schema matrix 探测 mimo 对不同工具 schema 的参数生成", async () => {
        const live = resolveLiveModel();
        const matrixCases = filteredMatrixCases();
        const failures: string[] = [];
        console.info(`[mimo-tool-schema] model=${live.modelKey} runs=${RUNS} cases=${matrixCases.map((item) => item.name).join(",")}`);

        for (const item of matrixCases) {
            for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
                const result = await runSingleToolProbe(live, item, runIndex);
                logProbeResult(result);
                if (item.assertCurrentProtocol) {
                    if (result.toolName !== "report_sidecar_result") {
                        failures.push(`${item.name}#${runIndex}: 模型没有调用 report_sidecar_result`);
                    }
                    if (!result.validation.ok) {
                        failures.push(`${item.name}#${runIndex}: 参数未通过当前 schema 校验：${result.validation.error ?? "unknown"}`);
                    }
                    if (result.dataLooksJsonString) {
                        failures.push(`${item.name}#${runIndex}: report_sidecar_result.data 是 JSON 字符串`);
                    }
                }
                if (item.assertNativeObject) {
                    if (result.toolName !== "report_sidecar_result") {
                        failures.push(`${item.name}#${runIndex}: 模型没有调用 report_sidecar_result`);
                    }
                    if (!result.validation.ok) {
                        failures.push(`${item.name}#${runIndex}: 参数未通过 schema 校验：${result.validation.error ?? "unknown"}`);
                    }
                    if (result.dataType !== "object") {
                        failures.push(`${item.name}#${runIndex}: report_sidecar_result.data 不是原生 object，而是 ${result.dataType}`);
                    }
                    if (result.dataLooksJsonString) {
                        failures.push(`${item.name}#${runIndex}: report_sidecar_result.data 是 JSON 字符串`);
                    }
                }
            }
        }

        expect(failures).toEqual([]);
    }, LIVE_TEST_TIMEOUT_MS);

    it.each(ActorScenarios)("actor-like $name 一次性产出原生对象 data", async (scenario) => {
        const live = resolveLiveModel();
        const result = await runActorLikeScenario(live, scenario);
        logProbeResult(result);

        expect(result.toolName).toBe("report_sidecar_result");
        expect(result.dataType).toBe("object");
        expect(result.dataLooksJsonString).toBe(false);

        const args = result.arguments as {data?: unknown};
        expect(isRecord(args.data)).toBe(true);
        expect(args.data).toEqual({"actor.context-load": {}});
    }, LIVE_TEST_TIMEOUT_MS);
});

function resolveLiveModel(): ResolvedLiveModel {
    const requestedModelKey = process.env.MIMO_TOOL_SCHEMA_MODEL_KEY?.trim() || DEFAULT_MODEL_KEY;
    const apiKeyFromEnv = process.env.MIMO_TOOL_SCHEMA_API_KEY?.trim();
    const config = loadGlobalEffectiveConfigSync();

    try {
        const model = resolvePiModelFromConfig(config, "simulator.actor", {
            modelKey: requestedModelKey,
        });
        const apiKey = apiKeyFromEnv || resolvePiApiKeyForModelFromConfig(config, model);
        if (!apiKey) {
            throw new Error(`缺少 ${requestedModelKey} 的 API key；请设置 MIMO_TOOL_SCHEMA_API_KEY，或在 Global Config 中配置该 provider。`);
        }
        return {model, apiKey, modelKey: requestedModelKey};
    } catch (error) {
        if (!apiKeyFromEnv) {
            throw error;
        }
        const model = resolveKnownPiModel(requestedModelKey);
        return {model, apiKey: apiKeyFromEnv, modelKey: requestedModelKey};
    }
}

function resolveKnownPiModel(modelKey: string): Model<any> {
    const [providerId, ...modelIdParts] = modelKey.split("/");
    const modelId = modelIdParts.join("/");
    if (!providerId || !modelId) {
        throw new Error(`模型 key 格式错误：${modelKey}`);
    }
    try {
        return getModel(providerId as never, modelId as never) as Model<any>;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法从 Pi registry 解析 ${modelKey}；请把模型配置进 Global Config，或使用已知 Pi provider/model。原始错误：${message}`);
    }
}

async function runSingleToolProbe(live: ResolvedLiveModel, item: MatrixCase, runIndex: number): Promise<ProbeResult> {
    const message = await callModel(live, [{
        role: "user",
        content: [{
            type: "text",
            text: [
                "You are testing tool-call argument schema compliance.",
                "Use exactly one tool call and do not answer in plain text.",
                item.expectedInstruction,
                "Important: pass objects as tool argument objects, not as JSON-encoded strings.",
            ].join("\n"),
        }],
        timestamp: Date.now(),
    }], [item.tool], `matrix-${item.name}-${runIndex}`);
    const toolCall = firstToolCall(message);
    return summarizeToolCall(item.name, runIndex, item.tool, toolCall);
}

async function runActorLikeScenario(live: ResolvedLiveModel, scenario: ActorScenario): Promise<ProbeResult> {
    const messages: Message[] = [{
        role: "user",
        content: [{
            type: "text",
            text: actorSidecarPrompt(scenario),
        }],
        timestamp: Date.now(),
    }];
    const reportTool = KeyedStableReportSidecarTool;
    const tools = [SubjectRagSearchTool, reportTool];
    let sawRagSearch = false;

    for (let turn = 0; turn < MAX_ACTOR_TURNS; turn += 1) {
        const message = await callModel(live, messages, tools, `actor-${scenario.name}-${turn}`);
        messages.push(message);
        const toolCalls = toolCallsFromMessage(message);
        const reportCall = toolCalls.find((toolCall) => toolCall.name === "report_sidecar_result");
        if (reportCall) {
            if (!sawRagSearch) {
                throw new Error(`actor-like ${scenario.name} 在调用 subject_rag_search 前直接调用了 report_sidecar_result。`);
            }
            return summarizeToolCall(scenario.name, turn, reportTool, reportCall);
        }
        const ragCalls = toolCalls.filter((toolCall) => toolCall.name === "subject_rag_search");
        if (!ragCalls.length) {
            throw new Error(`actor-like ${scenario.name} 第 ${turn} 轮没有调用 subject_rag_search 或 report_sidecar_result。`);
        }
        sawRagSearch = true;
        for (const toolCall of ragCalls) {
            messages.push(createRagToolResult(toolCall, scenario));
        }
    }

    throw new Error(`actor-like ${scenario.name} 在 ${MAX_ACTOR_TURNS} 轮内没有调用 report_sidecar_result。`);
}

async function callModel(live: ResolvedLiveModel, messages: Message[], tools: Tool[], sessionId: string): Promise<AssistantMessage> {
    const stream = streamSimple(live.model, {
        systemPrompt: "You are a strict tool-calling assistant. When a tool is available, satisfy the task by calling the tool.",
        messages,
        tools,
    }, {
        apiKey: live.apiKey,
        timeoutMs: 120_000,
        maxTokens: 1600,
        reasoning: undefined,
        cacheRetention: "none",
        sessionId: `mimo-tool-schema-${sessionId}-${Date.now()}`,
    });
    const message = await stream.result();
    if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw new Error(`provider 返回 ${message.stopReason}：${message.errorMessage ?? "无错误详情"}`);
    }
    return message;
}

function actorSidecarPrompt(scenario: ActorScenario): string {
    const dataShape = [
        "{",
        "  \"actor.context-load\": {}",
        "}",
    ];
    return [
        "当前处于 Sidecar Profile Pass 旁路阶段，不是主扮演阶段。",
        "sidecar: actor.context-load",
        "allowed tools: subject_rag_search, report_sidecar_result",
        "任务：先用 subject_rag_search 检索 events 和 memory，再调用 report_sidecar_result。",
        "report_sidecar_result.result 写第一人称记忆片段。",
        "report_sidecar_result.data 必须直接传对象，不要传 JSON 字符串。期望结构：",
        ...dataShape,
        `subjectPath: ${scenario.subjectPath}`,
        "",
        "<actor-facing-message>",
        scenario.userPacket,
        "</actor-facing-message>",
    ].join("\n");
}

function createRagToolResult(toolCall: ToolCall, scenario: ActorScenario): ToolResultMessage {
    const args = toolCall.arguments as {sources?: unknown};
    const sources = Array.isArray(args.sources) ? args.sources : [];
    const source = sources.includes("events") ? "events" : sources.includes("memory") ? "memory" : "unknown";
    const text = source === "events" ? scenario.ragEvents : source === "memory" ? scenario.ragMemory : `${scenario.ragEvents}\n${scenario.ragMemory}`;
    return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{
            type: "text",
            text,
        }],
        details: {
            source,
            canned: true,
        },
        isError: false,
        timestamp: Date.now(),
    };
}

function summarizeToolCall(caseName: string, runIndex: number, tool: Tool, toolCall: ToolCall | undefined): ProbeResult {
    const inspectedField = inspectFieldForCase(caseName);
    if (!toolCall) {
        return {
            caseName,
            runIndex,
            toolName: null,
            arguments: null,
            validation: {
                ok: false,
                error: "模型没有调用工具。",
            },
            inspectedField,
            dataType: "missing",
            payloadType: "missing",
            dataLooksJsonString: false,
        };
    }
    const inspectedValue = isRecord(toolCall.arguments) ? toolCall.arguments[inspectedField] : undefined;
    return {
        caseName,
        runIndex,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        validation: validateArguments(tool, toolCall),
        inspectedField,
        dataType: valueType(inspectedValue),
        payloadType: payloadType(toolCall.arguments, inspectedField),
        dataLooksJsonString: looksJsonString(inspectedValue),
    };
}

function validateArguments(tool: Tool, toolCall: ToolCall): ProbeResult["validation"] {
    try {
        return {
            ok: true,
            value: validateToolArguments(tool, toolCall) as unknown,
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function firstToolCall(message: AssistantMessage): ToolCall | undefined {
    return toolCallsFromMessage(message)[0];
}

function toolCallsFromMessage(message: AssistantMessage): ToolCall[] {
    return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

function valueType(value: unknown): string {
    if (Array.isArray(value)) {
        return "array";
    }
    if (value === null) {
        return "null";
    }
    return typeof value;
}

function payloadType(args: unknown, inspectedField = "data"): string {
    if (!isRecord(args)) {
        return "missing";
    }
    if ("payload" in args) {
        return valueType(args.payload);
    }
    const data = args[inspectedField];
    if (isRecord(data) && "payload" in data) {
        return valueType(data.payload);
    }
    if (isRecord(data)) {
        const firstValue = Object.values(data)[0];
        return firstValue === undefined ? "missing" : valueType(firstValue);
    }
    return "missing";
}

function looksJsonString(value: unknown): boolean {
    if (typeof value !== "string") {
        return false;
    }
    const trimmed = value.trim();
    return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function logProbeResult(result: ProbeResult): void {
    const summary = {
        caseName: result.caseName,
        runIndex: result.runIndex,
        toolName: result.toolName,
        inspectedField: result.inspectedField,
        dataType: result.dataType,
        payloadType: result.payloadType,
        dataLooksJsonString: result.dataLooksJsonString,
        validationOk: result.validation.ok,
        arguments: compactJson(result.arguments),
        validationError: result.validation.error,
    };
    console.info(`[mimo-tool-schema] ${JSON.stringify(summary)}`);
}

function filteredMatrixCases(): MatrixCase[] {
    const filter = process.env.MIMO_TOOL_SCHEMA_CASE?.trim();
    if (!filter) {
        return MatrixCases;
    }
    const parts = filter.split(",").map((part) => part.trim()).filter(Boolean);
    return MatrixCases.filter((item) => parts.some((part) => item.name.includes(part)));
}

function inspectFieldForCase(caseName: string): string {
    return MatrixCases.find((item) => item.name === caseName)?.inspectField ?? "data";
}

function compactJson(value: unknown): string {
    const text = JSON.stringify(value);
    if (!text) {
        return "";
    }
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}
