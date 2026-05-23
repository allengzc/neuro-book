import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {AgentProfile} from "nbook/server/agent/profiles/types";

/**
 * 判断 TypeBox object schema 是否没有定义任何输出字段。
 */
export function isEmptyObjectSchema(schema: TSchema | undefined): boolean {
    if (!schema || typeof schema !== "object") {
        return true;
    }
    const properties = "properties" in schema && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
    return Object.keys(properties).length === 0;
}

/**
 * 从目标 profile 的 OutputSchema 派生 report_result 的模型可见参数 schema。
 */
export function reportResultSchemaForProfile(profile: AgentProfile): TSchema {
    if (isEmptyObjectSchema(profile.outputSchema)) {
        return Type.Object({
            walkthrough: Type.String({
                description: "说明你完成任务的过程、关键结论和交付内容。",
            }),
        });
    }
    return Type.Object({
        walkthrough: Type.String({
            description: "说明你完成任务的过程、关键结论和交付内容。",
        }),
        data: profile.outputSchema as TSchema,
    });
}

