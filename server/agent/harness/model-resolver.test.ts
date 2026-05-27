import {describe, expect, it} from "vitest";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig, resolvePiModelInputs} from "nbook/server/agent/harness/model-resolver";
import type {EffectiveConfig} from "nbook/server/config/types";

describe("resolvePiModelInputs", () => {
    it("不会把 mimo-v2.5-pro 误判为支持图片", () => {
        expect(resolvePiModelInputs("xiaomi-token-plan-cn", "mimo-v2.5-pro")).toEqual(["text"]);
    });

    it("从 Pi registry 读取 Mimo 图片理解模型能力", () => {
        expect(resolvePiModelInputs("xiaomi-token-plan-cn", "mimo-v2.5")).toEqual(["text", "image"]);
        expect(resolvePiModelInputs("xiaomi-token-plan-cn", "mimo-v2-omni")).toEqual(["text", "image"]);
    });

    it("未知自定义模型默认只声明 text", () => {
        expect(resolvePiModelInputs("custom", "qwen2.5-vl-72b")).toEqual(["text"]);
    });
});

describe("resolvePiModelFromConfig", () => {
    it("允许同一个 Pi provider 使用多个本地 Provider 实例", () => {
        const config: Pick<EffectiveConfig, "agent" | "models"> = {
            agent: {
                defaultProfileKey: {
                    novel: null,
                    userAssets: null,
                },
                profiles: {},
            },
            models: {
                defaultModelKey: "deepseek-2/deepseek-v4-flash",
                providers: {
                    "deepseek-2": {
                        name: "DeepSeek Alt",
                        api: null,
                        options: {
                            apiKey: "sk-alt",
                            baseURL: "",
                            proxy: "",
                            timeoutMs: null,
                            requestOptions: {},
                        },
                        models: {
                            "deepseek-v4-flash": {
                                name: "DeepSeek V4 Flash",
                                id: "deepseek-v4-flash",
                                group: null,
                                enabled: true,
                                provider: "deepseek",
                                api: null,
                                baseUrl: null,
                                reasoning: null,
                                input: null,
                                maxTokens: null,
                                cost: null,
                                compat: null,
                                contextWindowTokens: null,
                            },
                        },
                    },
                },
            },
        };

        const model = resolvePiModelFromConfig(config, "leader.default");

        expect(model.provider).toBe("deepseek");
        expect((model as {providerConfigId?: string}).providerConfigId).toBe("deepseek-2");
        expect(resolvePiApiKeyForModelFromConfig(config, model)).toBe("sk-alt");
    });

    it("会把模型配置中的 Pi Model 字段覆盖到运行时模型", () => {
        const config: Pick<EffectiveConfig, "agent" | "models"> = {
            agent: {
                defaultProfileKey: {
                    novel: null,
                    userAssets: null,
                },
                profiles: {},
            },
            models: {
                defaultModelKey: "custom/mimo-vl",
                providers: {
                    custom: {
                        name: "Custom Mimo",
                        api: null,
                        options: {
                            apiKey: "sk-custom",
                            baseURL: "https://provider-level.example/v1",
                            proxy: "",
                            timeoutMs: null,
                            requestOptions: {},
                        },
                        models: {
                            "mimo-vl": {
                                name: "Mimo Vision",
                                id: "mimo-vl",
                                group: null,
                                enabled: true,
                                provider: "xiaomi-token-plan-cn",
                                api: "openai-completions",
                                baseUrl: "https://model-level.example/v1",
                                reasoning: true,
                                input: ["text", "image"],
                                maxTokens: 1234,
                                cost: {
                                    input: 1,
                                    output: 2,
                                    cacheRead: 3,
                                    cacheWrite: 4,
                                },
                                compat: {
                                    thinkingFormat: "deepseek",
                                    supportsStrictMode: false,
                                },
                                contextWindowTokens: 98765,
                            },
                        },
                    },
                },
            },
        };

        const model = resolvePiModelFromConfig(config, "leader.default");

        expect(model.provider).toBe("xiaomi-token-plan-cn");
        expect((model as {providerConfigId?: string}).providerConfigId).toBe("custom");
        expect(model.api).toBe("openai-completions");
        expect(model.baseUrl).toBe("https://provider-level.example/v1");
        expect(model.reasoning).toBe(true);
        expect(model.input).toEqual(["text", "image"]);
        expect(model.maxTokens).toBe(1234);
        expect(model.contextWindow).toBe(98765);
        expect(model.cost).toEqual({
            input: 1,
            output: 2,
            cacheRead: 3,
            cacheWrite: 4,
        });
        expect(model.compat).toMatchObject({
            thinkingFormat: "deepseek",
            supportsStrictMode: false,
        });
    });

    it("模型未配置 api 时继承本地 Provider 默认 Pi API", () => {
        const config: Pick<EffectiveConfig, "agent" | "models"> = {
            agent: {
                defaultProfileKey: {
                    novel: null,
                    userAssets: null,
                },
                profiles: {},
            },
            models: {
                defaultModelKey: "siliconflow/deepseek-ai/DeepSeek-V4-Flash",
                providers: {
                    siliconflow: {
                        name: "SiliconFlow",
                        api: "openai-completions",
                        options: {
                            apiKey: "sk-sf",
                            baseURL: "https://api.siliconflow.cn/v1",
                            proxy: "",
                            timeoutMs: null,
                            requestOptions: {},
                        },
                        models: {
                            "deepseek-ai/DeepSeek-V4-Flash": {
                                name: "DeepSeek V4 Flash",
                                id: "deepseek-ai/DeepSeek-V4-Flash",
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
                            },
                        },
                    },
                },
            },
        };

        const model = resolvePiModelFromConfig(config, "leader.default");

        expect(model.provider).toBe("siliconflow");
        expect(model.api).toBe("openai-completions");
    });
});
