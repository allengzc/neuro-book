import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/models/model-check", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", (event: {body?: unknown}) => event.body);
    });

    it("禁用 API Key 回退时不会补齐已保存密钥", async () => {
        const checkModelHealth = vi.fn(async () => ({
            success: false,
            latencyMs: null,
            message: "checked",
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadGlobalEffectiveConfigSync: vi.fn(() => ({
                models: {
                    providers: {
                        custom: {
                            options: {apiKey: "sk-saved"},
                        },
                    },
                },
            })),
        }));
        vi.doMock("nbook/server/utils/model-settings", () => ({
            checkModelHealth,
            withSavedProviderApiKey: vi.fn((provider, savedApiKey) => ({
                ...provider,
                options: {
                    ...provider.options,
                    apiKey: provider.options.apiKey || savedApiKey || "",
                },
            })),
        }));

        const provider = {
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
        };
        const model = {
            name: "Draft",
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
        };

        const handler = (await import("nbook/server/api/config/models/model-check.post")).default;
        await handler({
            body: {
                provider,
                model,
                useSavedApiKey: false,
            },
        } as never);

        expect(checkModelHealth).toHaveBeenCalledWith(provider, model);
    });
});
