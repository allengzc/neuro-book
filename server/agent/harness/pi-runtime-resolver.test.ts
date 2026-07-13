import {describe, expect, it} from "vitest";
import {createServer} from "node:http";
import {once} from "node:events";
import type {Api, Model} from "@earendil-works/pi-ai";
import {builtinProviders, getBuiltinModels} from "@earendil-works/pi-ai/providers/all";
import {resolvePiModelsFromConfig, SUPPORTED_CUSTOM_PI_APIS} from "nbook/server/agent/harness/pi-runtime-resolver";
import {piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import type {EffectiveConfig} from "nbook/server/config/types";

describe("Pi runtime resolver", () => {
    it("内置 Provider 使用进程级 Models，且 catalog 暴露新增 Provider 正式名称", () => {
        const model = getBuiltinModels("ant-ling")[0]!;
        const config = createConfig("ant-ling", model);
        expect(resolvePiModelsFromConfig(config, model)).toBe(resolvePiModelsFromConfig(config, model));

        const names = Object.fromEntries(builtinProviders().map((provider) => [provider.id, provider.name]));
        expect(names["ant-ling"]).toBe("Ant Ling");
        expect(names.nvidia).toBe("NVIDIA");
        expect(names["zai-coding-cn"]).toBe("Z.AI Coding CN");
    });

    it.each(SUPPORTED_CUSTOM_PI_APIS)("自定义 Provider 映射 %s adapter", (api) => {
        const model = createModel("custom", api, "http://127.0.0.1:11434/v1");
        const runtime = resolvePiModelsFromConfig(createConfig("local", model, api), model);
        expect(runtime.getProvider("custom")).toBeDefined();
        expect(runtime.getModel("custom", model.id)?.api).toBe(api);
    });

    it("未知 API 明确失败，不猜测或回退", () => {
        const model = createModel("custom", "unknown-api", "http://127.0.0.1:11434/v1");
        expect(() => resolvePiModelsFromConfig(createConfig("local", model, "unknown-api"), model))
            .toThrow("不支持的 Pi API：unknown-api");
    });

    it("同类 Provider 的两份本地连接创建独立 runtime", () => {
        const left = createModel("openai", "openai-completions", "http://127.0.0.1:8001/v1");
        const right = {...left, baseUrl: "http://127.0.0.1:8002/v1", providerConfigId: "right"};
        const leftRuntime = resolvePiModelsFromConfig(createConfig("left", left, "openai-completions"), left);
        const rightRuntime = resolvePiModelsFromConfig(createConfig("right", right, "openai-completions"), right);

        expect(leftRuntime).not.toBe(rightRuntime);
        expect(leftRuntime.getModel("openai", left.id)?.baseUrl).toBe("http://127.0.0.1:8001/v1");
        expect(rightRuntime.getModel("openai", right.id)?.baseUrl).toBe("http://127.0.0.1:8002/v1");
    });

    it("本地 Provider ID 与 Pi Provider 不同时，即使 API 继承 registry 也使用独立 runtime", () => {
        const registryModel = getBuiltinModels("openai")[0]!;
        const model = {...registryModel, providerConfigId: "local-openai"};
        const config = createConfig("local-openai", model);

        expect(resolvePiModelsFromConfig(config, model)).not.toBe(resolvePiModelsFromConfig(config, model));
    });

    it("同类 Provider 两份本地连接不会串 API key 或 base URL", async () => {
        const leftServer = await startOpenAIServer("left");
        const rightServer = await startOpenAIServer("right");
        try {
            const left = createModel("openai", "openai-completions", leftServer.baseUrl);
            const right = {...left, baseUrl: rightServer.baseUrl, providerConfigId: "right"};
            const [leftMessage, rightMessage] = await Promise.all([
                resolvePiModelsFromConfig(createConfig("left", left, "openai-completions"), left)
                    .completeSimple(left, {messages: []}, {apiKey: "left-key"}),
                resolvePiModelsFromConfig(createConfig("right", right, "openai-completions"), right)
                    .completeSimple(right, {messages: []}, {apiKey: "right-key"}),
            ]);

            expect(leftMessage.content).toEqual([{type: "text", text: "left"}]);
            expect(rightMessage.content).toEqual([{type: "text", text: "right"}]);
            expect(leftServer.authorization).toEqual(["Bearer left-key"]);
            expect(rightServer.authorization).toEqual(["Bearer right-key"]);
        } finally {
            await Promise.all([leftServer.close(), rightServer.close()]);
        }
    });

    it("自定义 OpenAI-compatible 无 API key 时可连接无认证端点", async () => {
        const server = await startOpenAIServer("no-auth");
        try {
            const model = createModel("openai", "openai-completions", server.baseUrl);
            const runtime = resolvePiModelsFromConfig(createConfig("local-openai", model), model);
            const message = await runtime.completeSimple(model, {messages: []}, piRequestAuthOptions({
                api: model.api,
                customRuntime: true,
            }));

            expect(message.content).toEqual([{type: "text", text: "no-auth"}]);
            expect(server.authorization).toEqual(["Bearer neurobook-no-auth"]);
        } finally {
            await server.close();
        }
    });

    it("自定义 OpenAI Responses 无 API key 时可连接无认证端点", async () => {
        const server = await startOpenAIResponsesServer("responses-no-auth");
        try {
            const model = createModel("openai", "openai-responses", server.baseUrl);
            const runtime = resolvePiModelsFromConfig(createConfig("local-openai", model), model);
            const message = await runtime.completeSimple(model, {messages: []}, piRequestAuthOptions({
                api: model.api,
                customRuntime: true,
            }));

            expect(message.content).toEqual([expect.objectContaining({type: "text", text: "responses-no-auth"})]);
            expect(server.authorization).toEqual(["Bearer neurobook-no-auth"]);
        } finally {
            await server.close();
        }
    });
});

function createConfig(providerConfigId: string, model: Model<Api>, api: string | null = null): Pick<EffectiveConfig, "models"> {
    return {
        models: {
            defaultModelKey: `${providerConfigId}/${model.id}`,
            providers: {
                [providerConfigId]: {
                    name: providerConfigId,
                    enabled: true,
                    api,
                    options: {apiKey: "", baseURL: model.baseUrl, proxy: "", timeoutMs: null, requestOptions: {}},
                    models: {
                        [model.id]: {
                            name: model.name,
                            id: model.id,
                            group: null,
                            enabled: true,
                            provider: model.provider,
                            api,
                            baseUrl: model.baseUrl,
                            reasoning: model.reasoning,
                            input: [...model.input],
                            maxTokens: model.maxTokens,
                            cost: {...model.cost, tiers: model.cost.tiers ?? []},
                            compat: null,
                            contextWindowTokens: model.contextWindow,
                        },
                    },
                },
            },
        },
    };
}

function createModel(provider: string, api: string, baseUrl: string): Model<Api> & {providerConfigId: string} {
    return {
        id: "test-model",
        name: "Test Model",
        provider,
        providerConfigId: provider,
        api,
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 128_000,
        maxTokens: 8_000,
    };
}

async function startOpenAIServer(text: string): Promise<{baseUrl: string; authorization: string[]; close: () => Promise<void>}> {
    const authorization: string[] = [];
    const server = createServer((request, response) => {
        authorization.push(request.headers.authorization ?? "");
        response.writeHead(200, {"content-type": "text/event-stream"});
        response.write(`data: ${JSON.stringify({id: text, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{index: 0, delta: {role: "assistant", content: text}, finish_reason: null}]})}\n\n`);
        response.write(`data: ${JSON.stringify({id: text, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{index: 0, delta: {}, finish_reason: "stop"}]})}\n\n`);
        response.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("测试 HTTP server 未取得端口");
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        authorization,
        close: async () => {
            server.close();
            await once(server, "close");
        },
    };
}

async function startOpenAIResponsesServer(text: string): Promise<{baseUrl: string; authorization: string[]; close: () => Promise<void>}> {
    const authorization: string[] = [];
    const server = createServer((request, response) => {
        authorization.push(request.headers.authorization ?? "");
        response.writeHead(200, {"content-type": "text/event-stream"});
        const item = {type: "message", role: "assistant", status: "completed", id: "msg-test", content: [{type: "output_text", text, annotations: []}]};
        const events = [
            {type: "response.created", response: {id: "resp-test"}},
            {type: "response.output_item.added", output_index: 0, item: {...item, status: "in_progress", content: []}},
            {type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text},
            {type: "response.output_item.done", output_index: 0, item},
            {type: "response.completed", response: {id: "resp-test", usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
        ];
        for (const event of events) {
            response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("测试 HTTP server 未取得端口");
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        authorization,
        close: async () => {
            server.close();
            await once(server, "close");
        },
    };
}
