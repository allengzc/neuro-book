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
    const reportBinding = profile.tools.report_result;
    const dataSchema = reportBinding?.dataSchema ?? profile.outputSchema;
    const sidecarDataSchemas = (profile.sidecars ?? [])
        .map((pass) => pass.sidecarDataSchema)
        .filter((schema): schema is TSchema => Boolean(schema));
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...isEmptyObjectSchema(dataSchema)
            ? {}
            : {
                data: Type.Optional(dataSchema as TSchema),
            },
        ...sidecarDataSchemas.length
            ? {
                sidecar_data: Type.Optional(sidecarDataSchemaUnion(sidecarDataSchemas)),
            }
            : {},
    };
    return Type.Object(properties);
}

/**
 * 合并当前 profile 所有 sidecar 的结果合同。provider-visible schema 对 profile 稳定，不随 phase 动态变化。
 */
function sidecarDataSchemaUnion(schemas: TSchema[]): TSchema {
    if (schemas.length === 1) {
        return schemas[0]!;
    }
    return Type.Union(schemas, {
        description: "旁路 phase 的结构化返回值。普通主路调用不要使用；当前具体结构由 sidecar system reminder 指定。",
    });
}
