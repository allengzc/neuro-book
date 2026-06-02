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
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...isEmptyObjectSchema(profile.outputSchema)
            ? {}
            : {
                data: Type.Optional(profile.outputSchema as TSchema),
            },
        sidecar_data: Type.Optional(Type.Unknown({
            description: "旁路 phase 的结构化返回值。普通主路调用不要使用；具体结构由旁路 system reminder 说明，并由 Harness 校验。",
        })),
    };
    return Type.Object(properties);
}
