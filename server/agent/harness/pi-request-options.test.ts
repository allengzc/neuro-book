import {describe, expect, it} from "vitest";
import {parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";

describe("Pi simple request options", () => {
    it("保留 Pi 0.80.6 streamSimple 已确认支持的 JSON 参数", () => {
        const options = parsePiSimpleRequestOptions({
            temperature: 0.3,
            headers: {"x-test": "ok", "x-remove": null},
            websocketConnectTimeoutMs: 2_000,
            maxRetries: 1,
            maxRetryDelayMs: 3_000,
            metadata: {tenant: "test"},
            env: {AWS_REGION: "ap-southeast-1"},
            transport: "auto",
            cacheRetention: "long",
            thinkingBudgets: {low: 2_048, high: 16_384},
        });

        expect(options).toMatchObject({
            temperature: 0.3,
            headers: {"x-test": "ok", "x-remove": null},
            env: {AWS_REGION: "ap-southeast-1"},
            thinkingBudgets: {low: 2_048, high: 16_384},
        });
    });

    it.each(["apiKey", "signal", "onPayload", "sessionId", "reasoning", "timeoutMs", "maxTokens", "bearerToken", "serviceTier"])(
        "拒绝 runtime-owned 或 streamSimple 不生效字段 %s",
        (key) => {
            expect(() => parsePiSimpleRequestOptions({[key]: "invalid"})).toThrow("Unrecognized key");
        },
    );

    it("自定义 OpenAI-compatible 空 key 使用内部无认证占位值", () => {
        expect(piRequestAuthOptions({api: "openai-completions", customRuntime: true})).toEqual({apiKey: "neurobook-no-auth"});
        expect(piRequestAuthOptions({api: "openai-responses", customRuntime: true})).toEqual({apiKey: "neurobook-no-auth"});
        expect(piRequestAuthOptions({api: "openai-completions", customRuntime: false})).toEqual({});
        expect(piRequestAuthOptions({api: "anthropic-messages", customRuntime: true})).toEqual({});
        expect(piRequestAuthOptions({api: "google-generative-ai", customRuntime: true})).toEqual({});
    });

    it("Bedrock API key 映射到 bearer token env 并保留其他 provider env", () => {
        expect(piRequestAuthOptions({
            api: "bedrock-converse-stream",
            apiKey: "bedrock-token",
            customRuntime: true,
            env: {AWS_REGION: "us-west-2"},
        })).toEqual({
            env: {
                AWS_REGION: "us-west-2",
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
            },
        });
    });
});
