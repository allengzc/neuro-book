import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

describe("reportResultSchemaForProfile", () => {
    it("空 OutputSchema 只要求 walkthrough", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.empty", name: "Empty"},
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        });

        expect(reportResultSchemaForProfile(profile)).toEqual(expect.objectContaining({
            required: ["walkthrough"],
            properties: expect.not.objectContaining({
                data: expect.anything(),
            }),
        }));
    });

    it("非空 OutputSchema 要求 walkthrough 和 data", () => {
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
            required: ["walkthrough", "data"],
            properties: expect.objectContaining({
                data: outputSchema,
            }),
        }));
    });
});
