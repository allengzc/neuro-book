import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {reportResultSchemaForProfile, reportSidecarResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import type {TSchema} from "typebox";

describe("reportResultSchemaForProfile", () => {
    it("空 OutputSchema 且无 sidecar 时只要求 result", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.empty", name: "Empty"},
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            prepare() {
                return {};
            },
        });

        const schema = reportResultSchemaForProfile(profile) as TSchema & {properties: Record<string, unknown>};

        expect(schema).toEqual(expect.objectContaining({
            required: ["result"],
        }));
        expect(schema.properties).not.toHaveProperty("data");
        expect(schema.properties).not.toHaveProperty("sidecar_data");
    });

    it("非空 OutputSchema 只要求 result，data 按 OutputSchema 可选", () => {
        const outputSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.data", name: "Data"},
            initialSchema: Type.Object({}),
            outputSchema,
            tools: profileToolsFromKeys(["report_result"]),
            prepare() {
                return {};
            },
        });

        expect(reportResultSchemaForProfile(profile)).toEqual(expect.objectContaining({
            required: ["result"],
            properties: expect.objectContaining({
                data: outputSchema,
            }),
        }));
    });

    it("有 sidecar 时 report_result 仍只包含主路结果 schema", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.sidecar-main-result", name: "Sidecar Main Result"},
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({summary: Type.String()}),
            tools: profileToolsFromKeys(["report_result", "report_sidecar_result"]),
            sidecars: [{
                name: "load",
                stage: "prepareRun",
                toolKeys: ["report_sidecar_result"],
                sidecarDataSchema: Type.String(),
                enterPrompt: "load",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        });

        const schema = reportResultSchemaForProfile(profile) as TSchema & {properties: Record<string, unknown>};
        expect(schema.properties).toEqual(expect.objectContaining({
            data: profile.outputSchema,
        }));
        expect(schema.properties).not.toHaveProperty("sidecar_data");
    });
});

describe("reportSidecarResultSchemaForProfile", () => {
    it("data 使用所有 sidecarDataSchema 生成 profile-stable keyed object schema", () => {
        const textSchema = Type.String();
        const objectSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.sidecar", name: "Sidecar"},
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result", "report_sidecar_result"]),
            sidecars: [
                {
                    name: "load",
                    stage: "prepareRun",
                    toolKeys: ["report_sidecar_result"],
                    sidecarDataSchema: textSchema,
                    enterPrompt: "load",
                    merge() {
                        return {};
                    },
                },
                {
                    name: "save",
                    stage: "settleRun",
                    toolKeys: ["report_sidecar_result"],
                    sidecarDataSchema: objectSchema,
                    enterPrompt: "save",
                    merge() {
                        return {};
                    },
                },
            ],
            prepare() {
                return {};
            },
        });

        const schema = reportSidecarResultSchemaForProfile(profile) as TSchema & {properties: {data?: TSchema & {anyOf?: TSchema[]; oneOf?: TSchema[]; properties?: Record<string, TSchema>; additionalProperties?: boolean; minProperties?: number; maxProperties?: number}}};
        expect(schema).toEqual(expect.objectContaining({
            required: ["result", "data"],
        }));
        expect(schema.properties.data?.anyOf).toBeUndefined();
        expect(schema.properties.data?.oneOf).toBeUndefined();
        expect(schema.properties.data).toEqual(expect.objectContaining({
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 1,
        }));
        expect(schema.properties.data?.properties).toEqual(expect.objectContaining({
            load: textSchema,
            save: objectSchema,
        }));
        expect(schema.properties.data?.properties).not.toHaveProperty("sidecar");
        expect(schema.properties.data?.properties).not.toHaveProperty("payload");
        expect(schema.properties).not.toHaveProperty("sidecar_data");
    });

    it("忽略 report_sidecar_result binding 上的 dataSchema，避免模型 schema 与执行校验分裂", () => {
        const sidecarSchema = Type.String();
        const profile = defineAgentProfile({
            manifest: {key: "agent.sidecar-schema-source", name: "Sidecar Schema Source"},
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: {
                report_result: {key: "report_result"},
                report_sidecar_result: {
                    key: "report_sidecar_result",
                    dataSchema: Type.Unknown(),
                },
            } as any,
            sidecars: [{
                name: "load",
                stage: "prepareRun",
                toolKeys: ["report_sidecar_result"],
                sidecarDataSchema: sidecarSchema,
                enterPrompt: "load",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        });

        const schema = reportSidecarResultSchemaForProfile(profile) as TSchema & {properties: {data?: TSchema & {properties?: Record<string, TSchema>; additionalProperties?: boolean; minProperties?: number; maxProperties?: number}}};
        expect(schema.properties.data).toEqual(expect.objectContaining({
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 1,
            properties: {
                load: sidecarSchema,
            },
        }));
    });
});
