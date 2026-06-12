import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
import type {TSchema} from "typebox";

describe("reportResultSchemaForProfile", () => {
    it("空 OutputSchema 且无 sidecar 时只要求 result", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.empty", name: "Empty"},
            inputSchema: Type.Object({}),
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
        expect(schema.properties).not.toEqual(expect.objectContaining({
            data: expect.anything(),
            sidecar_data: expect.anything(),
        }));
    });

    it("非空 OutputSchema 只要求 result，data 按 OutputSchema 可选", () => {
        const outputSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.data", name: "Data"},
            inputSchema: Type.Object({}),
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

    it("sidecar_data 使用所有 sidecarDataSchema 生成 profile-stable schema", () => {
        const textSchema = Type.String();
        const objectSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.sidecar", name: "Sidecar"},
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            sidecars: [
                {
                    name: "load",
                    stage: "prepareRun",
                    toolKeys: ["report_result"],
                    sidecarDataSchema: textSchema,
                    enterPrompt: "load",
                    merge() {
                        return {};
                    },
                },
                {
                    name: "save",
                    stage: "settleRun",
                    toolKeys: ["report_result"],
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

        const schema = reportResultSchemaForProfile(profile) as TSchema & {properties: Record<string, TSchema>};
        expect(schema.properties.sidecar_data).toEqual(expect.objectContaining({
            anyOf: [textSchema, objectSchema],
        }));
    });
});
