import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import type {TSchema} from "typebox";

describe("reportResultSchemaForProfile", () => {
    it("空 OutputSchema 只要求 result，sidecar_data 保持可选", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.empty", name: "Empty"},
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        });

        const schema = reportResultSchemaForProfile(profile) as TSchema & {properties: Record<string, unknown>};

        expect(schema).toEqual(expect.objectContaining({
            required: ["result"],
            properties: expect.objectContaining({
                sidecar_data: expect.anything(),
            }),
        }));
        expect(schema.properties).not.toEqual(expect.objectContaining({
            data: expect.anything(),
        }));
    });

    it("非空 OutputSchema 只要求 result，data 按 OutputSchema 可选", () => {
        const outputSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.data", name: "Data"},
            inputSchema: Type.Object({}),
            outputSchema,
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        });

        expect(reportResultSchemaForProfile(profile)).toEqual(expect.objectContaining({
            required: ["result"],
            properties: expect.objectContaining({
                data: outputSchema,
                sidecar_data: expect.anything(),
            }),
        }));
    });
});
