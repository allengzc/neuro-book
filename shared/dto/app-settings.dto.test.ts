import {describe, expect, it} from "vitest";
import {CheckModelRequestDtoSchema, CheckProviderRequestDtoSchema, ThinkingLevelSchema, UpdateModelSettingsRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";

describe("Pi settings contracts", () => {
    it("thinking level 接受 max", () => {
        expect(ThinkingLevelSchema.parse("max")).toBe("max");
    });

    it("Provider requestOptions 拒绝 runtime-owned 字段", () => {
        expect(() => UpdateModelSettingsRequestDtoSchema.parse({
            defaultModelKey: "custom/model",
            providers: [{
                id: "custom",
                name: "Custom",
                enabled: true,
                api: "openai-completions",
                options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {apiKey: "hidden"}},
                models: [{
                    name: "Model",
                    id: "model",
                    group: null,
                    enabled: true,
                    provider: null,
                    api: null,
                    baseUrl: null,
                    reasoning: null,
                    input: null,
                    maxTokens: null,
                    cost: null,
                    compat: null,
                    contextWindowTokens: null,
                }],
            }],
        })).toThrow("apiKey");
    });

    it("保存时拒绝未知 Pi API", () => {
        expect(() => UpdateModelSettingsRequestDtoSchema.parse({
            defaultModelKey: "custom/model",
            providers: [{
                id: "custom",
                name: "Custom",
                enabled: true,
                api: "mystery-api",
                options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                models: [{
                    name: "Model",
                    id: "model",
                    group: null,
                    enabled: true,
                    provider: null,
                    api: null,
                    baseUrl: null,
                    reasoning: null,
                    input: null,
                    maxTokens: null,
                    cost: null,
                    compat: null,
                    contextWindowTokens: null,
                }],
            }],
        })).toThrow("不支持的 Pi API");
    });

    it("cost tiers 拒绝重复 threshold", () => {
        const cost = {input: 1, output: 2, cacheRead: 0, cacheWrite: 0};
        expect(() => UpdateModelSettingsRequestDtoSchema.parse({
            defaultModelKey: "custom/model",
            providers: [{
                id: "custom",
                name: "Custom",
                enabled: true,
                api: "openai-completions",
                options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                models: [{
                    name: "Model",
                    id: "model",
                    group: null,
                    enabled: true,
                    provider: null,
                    api: null,
                    baseUrl: null,
                    reasoning: null,
                    input: null,
                    maxTokens: null,
                    cost: {...cost, tiers: [{...cost, inputTokensAbove: 100}, {...cost, inputTokensAbove: 100}]},
                    compat: null,
                    contextWindowTokens: null,
                }],
            }],
        })).toThrow("tier threshold 重复");
    });
});

describe("CheckProviderRequestDtoSchema", () => {
    it("保留当前 Provider 检查携带的模型草稿", () => {
        const parsed = CheckProviderRequestDtoSchema.parse({
            provider: {
                id: "custom",
                name: "Custom",
                api: "openai-completions",
                options: {
                    apiKey: "",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
            },
            models: [{
                name: "Draft Model",
                id: "draft-model",
                group: null,
                provider: "xiaomi-token-plan-cn",
                api: "openai-completions",
                baseUrl: null,
                reasoning: true,
                input: ["text"],
                maxTokens: 4096,
                cost: null,
                compat: {
                    maxTokensField: "max_tokens",
                },
                contextWindowTokens: 128000,
            }],
        });

        expect(parsed.models).toEqual([expect.objectContaining({
            id: "draft-model",
            provider: "xiaomi-token-plan-cn",
            compat: {
                maxTokensField: "max_tokens",
            },
        })]);
    });

    it("兼容旧调用未传模型草稿", () => {
        const parsed = CheckProviderRequestDtoSchema.parse({
            provider: {
                id: "custom",
                name: "Custom",
                api: "openai-completions",
                options: {
                    apiKey: "",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
            },
        });

        expect(parsed.models).toEqual([]);
        expect(parsed.useSavedApiKey).toBe(true);
        expect(parsed.useSavedModels).toBe(true);
    });

    it("保留检查回退开关", () => {
        const parsed = CheckProviderRequestDtoSchema.parse({
            provider: {
                id: "custom",
                name: "Custom",
                api: "openai-completions",
                options: {
                    apiKey: "",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
            },
            models: [],
            useSavedApiKey: false,
            useSavedModels: false,
        });

        expect(parsed.useSavedApiKey).toBe(false);
        expect(parsed.useSavedModels).toBe(false);
    });
});

describe("CheckModelRequestDtoSchema", () => {
    it("保留 API Key 回退开关", () => {
        const parsed = CheckModelRequestDtoSchema.parse({
            provider: {
                id: "custom",
                name: "Custom",
                api: "openai-completions",
                options: {
                    apiKey: "",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
            },
            model: {
                name: "Draft Model",
                id: "draft-model",
                group: null,
                provider: null,
                api: null,
                baseUrl: null,
                reasoning: null,
                input: null,
                maxTokens: null,
                cost: null,
                compat: null,
                contextWindowTokens: null,
            },
            useSavedApiKey: false,
        });

        expect(parsed.useSavedApiKey).toBe(false);
    });
});
