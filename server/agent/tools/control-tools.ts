import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";

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
    recommended: Type.Optional(Type.Boolean({description: "Whether this option is visually marked as recommended."})),
    defaultSelected: Type.Optional(Type.Boolean({description: "Whether this option should be selected by default when the prompt opens."})),
});

const RequestUserInputQuestionSchema = Type.Object({
    header: Type.Optional(Type.String({description: "Short header shown above this question."})),
    question: Type.String({description: "Prompt shown to the user."}),
    options: Type.Optional(Type.Array(RequestUserInputQuestionOptionSchema, {description: "Options for this question. Omit or pass an empty array for open-ended questions."})),
    multiSelect: Type.Optional(Type.Boolean({description: "Whether the user may select multiple options. Ignored when options is empty."})),
    defaultOptionIndex: Type.Optional(Type.Integer({minimum: -1, description: "Default selected option index for single-select questions. -1 selects the alternative answer option."})),
    defaultOptionIndexes: Type.Optional(Type.Array(Type.Integer({minimum: -1}), {description: "Default selected option indexes for multi-select questions. -1 selects the alternative answer option."})),
});

const RequestUserInputSchema = Type.Object({
    questions: Type.Array(RequestUserInputQuestionSchema, {minItems: 1, description: "Questions to ask in one user-input request."}),
});

const PlanModeSchema = Type.Object({
    reason: Type.Optional(Type.String({description: "Short reason shown to the user for this Plan Mode transition."})),
    planFilePath: Type.Optional(Type.String({description: "For exit_plan_mode only. Optional Project Workspace relative Markdown file under .agent/plan/, for example .agent/plan/profile-migration.md."})),
});

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
        approvalRequired: true,
        description: "Ask the user for input and wait for continue resolution.",
        parameters: RequestUserInputSchema,
        async execute() {
            return {
                content: [{type: "text", text: "等待用户输入。"}],
                details: {pending: true},
                terminate: true,
            };
        },
    }),
    enterPlanMode: defineAgentTool({
        key: "enter_plan_mode",
        name: "enter_plan_mode",
        label: "Enter Plan Mode",
        executionMode: "sequential",
        approvalRequired: true,
        description: "Request entering plan mode.",
        parameters: PlanModeSchema,
        async execute(_toolCallId, params: unknown) {
            const plan = params as Static<typeof PlanModeSchema>;
            return {
                content: [{type: "text", text: plan.reason ? `请求进入计划模式：${plan.reason}` : "请求进入计划模式。"}],
                details: {pending: true},
                terminate: true,
            };
        },
    }),
    exitPlanMode: defineAgentTool({
        key: "exit_plan_mode",
        name: "exit_plan_mode",
        label: "Exit Plan Mode",
        executionMode: "sequential",
        approvalRequired: true,
        description: "Request exiting plan mode. Optionally pass planFilePath for a Project Workspace relative Markdown file under .agent/plan/ so the approval UI can preview it.",
        parameters: PlanModeSchema,
        async execute(_toolCallId, params: unknown) {
            const plan = params as Static<typeof PlanModeSchema>;
            return {
                content: [{type: "text", text: plan.reason ? `请求退出计划模式：${plan.reason}` : "请求退出计划模式。"}],
                details: {pending: true},
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
