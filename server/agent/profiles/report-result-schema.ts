import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import type {ProfileToolBinding, ReportResultToolBinding} from "nbook/server/agent/tools/types";

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
    const dataSchema = isReportResultBinding(reportBinding) ? reportBinding.dataSchema ?? profile.outputSchema : profile.outputSchema;
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...isEmptyObjectSchema(dataSchema)
            ? {}
            : {
                data: Type.Optional(dataSchema as TSchema),
            },
    };
    return Type.Object(properties);
}

/**
 * 从目标 profile 的 sidecarDataSchema 派生 report_sidecar_result 的模型可见参数 schema。
 *
 * 注意：这里生成的是 profile-stable schema，不随当前 active sidecar 变化，避免破坏 provider tool cache。
 * 执行期仍会按当前 active sidecar 的 sidecarDataSchema 做严格校验。
 */
export function reportSidecarResultSchemaForProfile(profile: AgentProfile): TSchema {
    return Type.Object({
        result: Type.String({
            description: "旁路阶段的可读结果；写简短摘要即可。",
        }),
        data: sidecarDataKeyedObjectSchema(profile),
    });
}

/**
 * 生成当前 profile 所有 sidecarDataSchema 的稳定 keyed object。
 *
 * 模型可见结构为 { "<sidecar-name>": <sidecarDataSchema> }，一次只能返回一个
 * sidecar key；这样可以保留每个 sidecar 的精确 schema，同时避开 provider 对
 * anyOf/oneOf 工具参数的不稳定支持。
 */
export function sidecarDataKeyedObjectSchema(profile: AgentProfile): TSchema {
    const properties = Object.fromEntries((profile.sidecars ?? [])
        .flatMap((pass) => pass.sidecarDataSchema
            ? [[pass.name, Type.Optional(pass.sidecarDataSchema)]]
            : []));
    if (Object.keys(properties).length === 0) {
        return Type.Never({
            description: "当前 profile 没有声明 sidecarDataSchema；不应调用 report_sidecar_result。",
        });
    }
    return Type.Object(properties, {
        additionalProperties: false,
        minProperties: 1,
        maxProperties: 1,
        description: "当前 profile 所有 sidecarDataSchema 的稳定 keyed object；当前旁路只填写自己的 sidecar key。",
    });
}

function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && binding.key === "report_result" && "dataSchema" in binding);
}
