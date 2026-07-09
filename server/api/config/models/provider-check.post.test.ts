import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/models/provider-check", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("readBody", (event: {body?: unknown}) => event.body);
    });

    it("草稿没有启用模型且禁用保存模型回退时不会使用旧模型", async () => {
        const checkProviderConnection = vi.fn(async (_provider, modelDrafts) => ({
            success: false,
            latencyMs: null,
            message: String(modelDrafts.length),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {
                    providers: {
                        custom: {
                            options: {apiKey: "sk-saved"},
                            models: {
                                "saved-model": {
                                    name: "Saved",
                                    id: "saved-model",
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
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkProviderConnection,
            withSavedProviderApiKey: vi.fn((provider, savedApiKey) => ({
                ...provider,
                options: {
                    ...provider.options,
                    apiKey: provider.options.apiKey || savedApiKey || "",
                },
            })),
        }));

        const handler = (await import("nbook/server/api/config/models/provider-check.post")).default;
        await handler({
            body: {
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
                useSavedApiKey: true,
                useSavedModels: false,
            },
        } as never);

        expect(checkProviderConnection).toHaveBeenCalledWith(expect.anything(), []);
    });
});
