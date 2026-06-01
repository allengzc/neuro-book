import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import type {JsonValue} from "nbook/server/agent/types";

const ReportResultInputSchema = z.object({
    result: z.string()
        .trim()
        .min(1, "result 不能为空")
        .describe("Final human-readable result of the agent execution. Keep it complete but concise."),
    data: z.json()
        .optional()
        .describe("Optional structured result. The expected shape depends on the current profile."),
});

/**
 * agent 提交最终结果的内建工具。
 */
export const reportResultTool: AgentTool<typeof ReportResultInputSchema> = {
    key: "report_result",
    description: "Submit the final result of this agent execution. The structured data shape depends on the current profile. After calling this tool successfully, the agent should terminate immediately.",
    schema: ReportResultInputSchema,
    async execute(input, context) {
        const parsedData = validateProfileOutput(input.data, context.profile);
        const rawResult: {
            result: string;
            data?: JsonValue;
        } = {
            result: input.result,
        };
        if (parsedData !== undefined) {
            rawResult.data = parsedData;
        }
        return {
            content: JSON.stringify({ok: true}),
            toolArgs: JSON.stringify(input),
            status: "success",
            rawResult,
        };
    },
};

/**
 * 根据当前 profile 校验 report_result.data。
 */
function validateProfileOutput(data: unknown, profile: {key: string; outputSchema?: z.ZodType}): JsonValue | undefined {
    if (!profile.outputSchema) {
        return data as JsonValue | undefined;
    }
    if (data === undefined) {
        throw new Error(`${profile.key} 必须通过 report_result.data 提交结构化输出`);
    }
    const parsed = parseProfileOutput(data, profile.outputSchema);
    if (!parsed.success) {
        throw new Error(`${profile.key} 的 report_result.data 不符合 profile 输出结构`);
    }
    return parsed.data as JsonValue;
}

/**
 * 先按原值校验；失败后再兼容 provider 字符串化的 JSON 结构。
 */
function parseProfileOutput(data: unknown, outputSchema: z.ZodType): z.ZodSafeParseResult<unknown> {
    const parsed = outputSchema.safeParse(data);
    if (parsed.success || typeof data !== "string") {
        return parsed;
    }

    const normalizedData = parseStringifiedJson(data);
    return normalizedData.parsed ? outputSchema.safeParse(normalizedData.value) : parsed;
}

/**
 * 尝试解析字符串化 JSON。
 */
function parseStringifiedJson(data: string): {parsed: true; value: unknown} | {parsed: false} {
    try {
        return {
            parsed: true,
            value: JSON.parse(data) as unknown,
        };
    } catch {
        return {parsed: false};
    }
}
