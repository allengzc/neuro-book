import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroAgentTool, UserInputRequestContext, UserInputFormSpec} from "nbook/server/agent/tools/types";
import type {LowCodeFieldDto} from "nbook/shared/dto/low-code-form.dto";
import {buildRequestUserInputResult} from "nbook/server/agent/tools/request-user-input-result";

export const ReportResultSchema = Type.Object({
    result: Type.String(),
    data: Type.Optional(Type.Unknown()),
}, {additionalProperties: false});

const ReportResultValidationSchema = Type.Object({
    result: Type.String(),
    data: Type.Optional(Type.Unknown()),
}, {additionalProperties: false});

export const ReportSidecarResultSchema = Type.Object({
    result: Type.String(),
    data: Type.Record(Type.String(), Type.Unknown()),
}, {additionalProperties: false});

const ReportSidecarResultValidationSchema = Type.Object({
    result: Type.String(),
    data: Type.Optional(Type.Unknown()),
}, {additionalProperties: false});

const RequestUserInputQuestionOptionSchema = Type.Object({
    label: Type.String({description: "User-facing option label, preferably 1-5 words."}),
    description: Type.Optional(Type.String({description: "Optional short sentence explaining the impact or tradeoff of this option."})),
}, {additionalProperties: false});

const RequestUserInputQuestionSchema = Type.Object({
    header: Type.Optional(Type.String({description: "Short header shown above this question."})),
    question: Type.String({description: "Prompt shown to the user."}),
    options: Type.Optional(Type.Array(RequestUserInputQuestionOptionSchema, {description: "Options for this question. Omit or pass an empty array for open-ended questions."})),
}, {additionalProperties: false});

const RequestUserInputSchema = Type.Object({
    questions: Type.Array(RequestUserInputQuestionSchema, {minItems: 1, description: "Questions to ask in one user-input request."}),
}, {additionalProperties: false});

type RequestUserInputParams = Static<typeof RequestUserInputSchema>;

/**
 * switch_mode 工具参数（Task 90）。targetMode 为必填枚举；
 * planFilePath 仅在 plan→normal 切换时有意义，供审批 UI 预览计划文件。
 */
const SwitchModeSchema = Type.Object({
    targetMode: Type.Union([
        Type.Literal("normal"),
        Type.Literal("discuss"),
        Type.Literal("plan"),
    ], {description: "Target mode: \"normal\" (full read-write execution), \"discuss\" (read-only discussion, file writes need approval), \"plan\" (read-only planning, file writes need approval)."}),
    reason: Type.Optional(Type.String({description: "Short reason shown to the user explaining why you want to switch."})),
    planFilePath: Type.Optional(Type.String({description: "Only when leaving plan mode into normal. A Project Workspace relative Markdown file under .agent/plan/ (for example .agent/plan/feature.md) so the approval UI can preview the plan."})),
});

type SwitchModeParams = Static<typeof SwitchModeSchema>;

/** switch_mode 审批表单的模式文案。 */
const SWITCH_MODE_APPROVAL: Record<SwitchModeParams["targetMode"], {prompt: string; label: string; modeLabel: string}> = {
    normal: {prompt: "切换到普通模式并开始执行", label: "是否批准切换到普通模式（开始执行）？", modeLabel: "普通"},
    discuss: {prompt: "进入讨论模式", label: "是否批准进入讨论模式？", modeLabel: "讨论"},
    plan: {prompt: "进入计划模式", label: "是否批准进入计划模式？", modeLabel: "计划"},
};

export const controlTools = {
    reportResult: defineAgentTool({
        key: "report_result",
        name: "report_result",
        label: "Report Result",
        executionMode: "sequential",
        description: "Report final agent result to the caller.",
        parameters: ReportResultSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as Static<typeof ReportResultSchema>;
            return {
                content: [{type: "text", text: report.result}],
                details: report,
                terminate: true,
            };
        },
    }),
    reportSidecarResult: defineAgentTool({
        key: "report_sidecar_result",
        name: "report_sidecar_result",
        label: "Report Sidecar Result",
        executionMode: "sequential",
        description: "Report final sidecar result to the harness.",
        parameters: ReportSidecarResultSchema,
        validationSchema: ReportSidecarResultValidationSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as Static<typeof ReportSidecarResultValidationSchema>;
            return {
                content: [{type: "text", text: report.result}],
                details: report,
                terminate: true,
            };
        },
    }),
    requestUserInput: defineAgentTool({
        key: "request_user_input",
        name: "request_user_input",
        label: "Request User Input",
        executionMode: "sequential",
        description: "Ask the user for input and wait for continue resolution.",
        parameters: RequestUserInputSchema,
        userInputRequest: {
            when(_context: UserInputRequestContext): true {
                return true;
            },
        },
        async executeWithContext(_context, _toolCallId, _params, userInput) {
            if (!userInput) {
                throw new Error("request_user_input 需要用户输入数据");
            }

            const params = _params as Static<typeof RequestUserInputSchema>;
            const result = buildRequestUserInputResult(params, userInput);

            return {
                content: [{type: "text", text: result.text}],
                details: {answers: result.answers},
                terminate: true,
            };
        },
    }),
    switchMode: defineAgentTool({
        key: "switch_mode",
        name: "switch_mode",
        label: "Switch Mode",
        executionMode: "sequential",
        description: "Request approval to switch the agent working mode. The switch only takes effect after the user approves. Use \"plan\" to enter read-only planning before a complex task, \"discuss\" for read-only discussion, and \"normal\" to leave plan/discuss and start executing once the plan or direction is agreed. When leaving plan mode with a prepared plan file, pass planFilePath like .agent/plan/<slug>.md so the approval UI can preview it.",
        parameters: SwitchModeSchema,
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec {
                const params = context.args as SwitchModeParams;
                const copy = SWITCH_MODE_APPROVAL[params.targetMode] ?? SWITCH_MODE_APPROVAL.normal;

                const fields: LowCodeFieldDto[] = [
                    {
                        path: "approved",
                        component: "radio" as const,
                        label: copy.label,
                        description: params.reason,
                        required: true,
                        options: [
                            {value: true, label: "批准"},
                            {value: false, label: "拒绝"},
                        ],
                        defaultValue: true,
                    },
                ];

                // 仅退出到 normal 且带 planFilePath 时，加计划文件预览提示字段
                if (params.targetMode === "normal" && params.planFilePath) {
                    fields.push({
                        path: "planPreviewNote",
                        component: "text" as const,
                        label: "计划文件",
                        description: `请在批准前查看文件：${params.planFilePath}`,
                        required: false,
                        options: [],
                        defaultValue: params.planFilePath,
                    });
                }

                return {
                    form: {
                        defaults: {
                            approved: true,
                        },
                        fields,
                    },
                    prompt: copy.prompt,
                    layout: "dialog",
                };
            },
        },
        async executeWithContext(_context, _toolCallId, params, userInput) {
            const request = params as SwitchModeParams;
            const copy = SWITCH_MODE_APPROVAL[request.targetMode] ?? SWITCH_MODE_APPROVAL.normal;
            const formData = userInput as {approved?: boolean};

            if (!formData?.approved) {
                return {
                    content: [{type: "text", text: `用户拒绝切换到${copy.modeLabel}模式。`}],
                    details: {approved: false, targetMode: request.targetMode},
                    terminate: true,
                };
            }

            return {
                content: [{type: "text", text: request.reason ? `请求切换到${copy.modeLabel}模式：${request.reason}` : `请求切换到${copy.modeLabel}模式。`}],
                details: {approved: true, pending: true, targetMode: request.targetMode},
                terminate: true,
            };
        },
    }),
} as const;

/**
 * 创建带当前 profile OutputSchema 的 report_result 工具。
 */
export function createReportResultTool(parameters: TSchema, options: {
    dataSchema?: TSchema;
    activeSidecar?: {
        name: string;
    };
} = {}): NeuroAgentTool {
    return {
        key: "report_result",
        name: "report_result",
        label: "Report Result",
        executionMode: "sequential",
        description: "Report final agent result to the caller.",
        parameters,
        validationSchema: ReportResultValidationSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as {result: string; data?: unknown};
            if (options.activeSidecar) {
                throw new Error(`当前处于 sidecar ${options.activeSidecar.name} 旁路阶段，不能使用 report_result；请改用 report_sidecar_result，并通过 report_sidecar_result.data 返回旁路结果。`);
            }
            if (options.dataSchema && "data" in report) {
                try {
                    assertStrictSchemaValue(options.dataSchema, report.data);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`report_result.data 校验失败：${message}`);
                }
            }
            return {
                content: [{type: "text", text: report.result}],
                details: report,
                terminate: true,
            };
        },
    };
}

/**
 * 创建带当前 profile keyed sidecarDataSchema 的 report_sidecar_result 工具。
 */
export function createReportSidecarResultTool(parameters: TSchema, options: {
    activeSidecar?: {
        name: string;
        sidecarDataSchema?: TSchema;
    };
} = {}): NeuroAgentTool {
    return {
        key: "report_sidecar_result",
        name: "report_sidecar_result",
        label: "Report Sidecar Result",
        executionMode: "sequential",
        description: "Report final sidecar result to the harness.",
        parameters,
        validationSchema: ReportSidecarResultValidationSchema,
        async execute(_toolCallId, params: unknown) {
            const report = params as {result: string; data?: unknown};
            if (!options.activeSidecar) {
                throw new Error("当前是主 run，不能使用 report_sidecar_result；请改用 report_result 返回主路结果。");
            }
            if (!("data" in report)) {
                throw new Error(`sidecar ${options.activeSidecar.name} 必须通过 report_sidecar_result.data 返回旁路结果。`);
            }
            if (typeof report.data === "string") {
                throw new Error(`sidecar ${options.activeSidecar.name} report_sidecar_result.data 校验失败：收到的是字符串；请直接传对象 data: { "${options.activeSidecar.name}": ... }，不要传 JSON.stringify 后的文本。`);
            }
            if (!isRecord(report.data)) {
                throw new Error(`sidecar ${options.activeSidecar.name} report_sidecar_result.data 校验失败：必须是对象 { "${options.activeSidecar.name}": ... }。`);
            }
            if (!options.activeSidecar.sidecarDataSchema) {
                throw new Error(`sidecar ${options.activeSidecar.name} 未声明 sidecarDataSchema，不能使用 report_sidecar_result。`);
            }
            const dataKeys = Object.keys(report.data);
            if (dataKeys.length !== 1) {
                throw new Error(`sidecar ${options.activeSidecar.name} report_sidecar_result.data 校验失败：只能包含一个 sidecar key，当前应为 "${options.activeSidecar.name}"。`);
            }
            if (!hasOwn(report.data, options.activeSidecar.name)) {
                throw new Error(`sidecar ${options.activeSidecar.name} report_sidecar_result.data 校验失败：只能包含当前 sidecar key "${options.activeSidecar.name}"。`);
            }
            const sidecarData = report.data[options.activeSidecar.name];
            try {
                assertStrictSchemaValue(options.activeSidecar.sidecarDataSchema, sidecarData);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`sidecar ${options.activeSidecar.name} report_sidecar_result.data["${options.activeSidecar.name}"] 校验失败：${message}`);
            }
            return {
                content: [{type: "text", text: report.result}],
                details: {
                    result: report.result,
                    data: report.data,
                },
                terminate: true,
            };
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * 严格校验 schema，不执行 TypeBox Parse/Convert，避免把模型错误参数静默修正。
 */
export function assertStrictSchemaValue(schema: TSchema, value: unknown): void {
    if (Value.Check(schema, value)) {
        return;
    }
    const errors = [...Value.Errors(schema, value)]
        .map((error) => error.message)
        .join("; ");
    throw new Error(errors || "Parse");
}
