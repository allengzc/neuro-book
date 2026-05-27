import {afterEach, describe, expect, it, vi} from "vitest";
import {discoverProviderModels} from "nbook/server/utils/model-settings";
import type {ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";

function createProviderDraft(overrides: Partial<ModelProviderDraftDto> = {}): ModelProviderDraftDto {
    return {
        id: "qwen",
        name: "Qwen",
        api: "openai-completions",
        options: {
            apiKey: "sk-test",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            proxy: "",
            timeoutMs: 1000,
            requestOptions: {},
        },
        ...overrides,
    };
}

describe("discoverProviderModels", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("从 OpenAI-compatible /models 响应解析模型列表", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [
                {id: "qwen-plus"},
                {id: "qwen-max"},
                {id: "qwen-plus"},
                {id: ""},
            ],
        })));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await discoverProviderModels(createProviderDraft());

        expect(fetchMock).toHaveBeenCalledWith(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({
                    accept: "application/json",
                    authorization: "Bearer sk-test",
                }),
            }),
        );
        expect(result.models).toEqual([
            {id: "qwen-max", name: "qwen-max", group: "qwen"},
            {id: "qwen-plus", name: "qwen-plus", group: "qwen"},
        ]);
        expect(result.message).toContain("已从 Qwen 远程发现 2 个模型");
    });

    it("缺少 API Base 时直接报错", async () => {
        await expect(discoverProviderModels(createProviderDraft({
            options: {
                apiKey: "",
                baseURL: "",
                proxy: "",
                timeoutMs: null,
                requestOptions: {},
            },
        }))).rejects.toThrow("Qwen 缺少 API Base");
    });

    it("远端返回非 2xx 时给出 HTTP 状态", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {
            status: 401,
            statusText: "Unauthorized",
        })) as unknown as typeof fetch;

        await expect(discoverProviderModels(createProviderDraft())).rejects.toThrow("HTTP 401 Unauthorized");
    });

    it("远端 JSON 缺少 data 数组时给出结构错误", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({object: "list"}))) as unknown as typeof fetch;

        await expect(discoverProviderModels(createProviderDraft())).rejects.toThrow("/models 返回缺少 data 数组");
    });
});
