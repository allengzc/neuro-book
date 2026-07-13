import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Type} from "typebox";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import memoryCuratorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/memory.curator.profile";
import {
    applySubjectMemoryPatch,
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
} from "nbook/server/agent/tools/subject-memory";

describe("subject memory tools", () => {
    let root: string;
    let workspaceRoot: string;
    let harness: NeuroAgentHarness;
    let context: ToolExecutionContext;
    let faux: FauxModelsFixture;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-subject-memory-tools-test-"));
        workspaceRoot = join(root, "workspace");
        await mkdir(workspaceRoot, {recursive: true});
        faux = createFauxModels({
            models: [{
                id: "subject-memory-faux",
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        const profiles = new AgentProfileCatalog(
            join(root, "missing-system-profiles"),
            join(root, "missing-user-profiles"),
        );
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles,
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness.profiles.register(memoryCuratorProfile, false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.subject-memory-tools",
                name: "Subject Memory Tools Test",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const session = await harness.createAgent({
            profileKey: "test.subject-memory-tools",
            initial: {},
            workspaceRoot,
        });
        context = {
            harness,
            sessionId: session.sessionId,
            profileKey: "test.subject-memory-tools",
            workspaceRoot,
            workspaceKey: "global",
        };
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await rm(root, {recursive: true, force: true});
    });

    it("解析 events.jsonl 并拒绝空 text", () => {
        expect(parseSubjectEventsJsonl([
            "{\"tick\":\"000001\",\"time\":\"早晨\",\"text\":\"我被粉色头发的女孩子帮了一把。\"}",
            "{\"text\":\"我还不知道她叫什么。\"}",
        ].join("\n"))).toEqual([
            {tick: "000001", time: "早晨", text: "我被粉色头发的女孩子帮了一把。"},
            {text: "我还不知道她叫什么。"},
        ]);

        expect(() => parseSubjectEventsJsonl("{\"text\":\"\"}")).toThrow("text 不能为空");
    });

    it("解析 memory.jsonl，支持长 view 并拒绝重复 topic", () => {
        const longView = "艾琳娜是我的同班同学。".repeat(120);

        expect(parseSubjectMemoriesJsonl(JSON.stringify({
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子"],
            view: longView,
        }))).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子"],
            view: longView,
        }]);

        expect(() => parseSubjectMemoriesJsonl([
            "{\"topic\":\"艾琳娜\",\"view\":\"同学。\"}",
            "{\"topic\":\"艾琳娜\",\"view\":\"朋友。\"}",
        ].join("\n"))).toThrow("重复 topic");
    });

    it("应用 JSON Patch 后仍校验 memory 结构", () => {
        const updated = applySubjectMemoryPatch([
            {topic: "粉色头发的女孩子", aliases: ["早上帮过我的女孩"], view: "她早上帮过我。"},
            {topic: "艾琳娜", view: "她是同班同学。"},
        ], [
            {op: "replace", path: "/1", value: {
                topic: "艾琳娜",
                aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
                view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
            }},
            {op: "remove", path: "/0"},
        ]);

        expect(updated).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
            view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
        }]);
    });

    it("subject_event_append 追加 JSONL 并标记 RAG dirty", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"旧事件。\"}\n", "utf-8");
        const tool = mustTool("subject_event_append", harness);

        await tool.executeWithContext?.(context, "append-events", {
            subjectPath: "demo/simulation/subjects/heroine",
            events: [
                {tick: "000002", text: "我确认艾琳娜就是早上帮过我的女孩。"},
            ],
        });

        await expect(readFile(join(subjectRoot, "events.jsonl"), "utf-8")).resolves.toBe([
            "{\"text\":\"旧事件。\"}",
            "{\"text\":\"我确认艾琳娜就是早上帮过我的女孩。\",\"tick\":\"000002\"}",
            "",
        ].join("\n"));
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("subject_event_append 硬切 JSONL，不导入旧 events.md", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.md"), "## 旧经历\n\n她曾经在雨夜帮我带路。", "utf-8");
        const tool = mustTool("subject_event_append", harness);

        await tool.executeWithContext?.(context, "append-events-hard-cut", {
            subjectPath: "demo/simulation/subjects/heroine",
            events: [
                {text: "我今天再次想起那次雨夜带路。"},
            ],
        });

        const events = parseSubjectEventsJsonl(await readFile(join(subjectRoot, "events.jsonl"), "utf-8"));
        expect(events).toEqual([
            {text: "我今天再次想起那次雨夜带路。"},
        ]);
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("subject_rag_search 未配置 embedding 时明确失败且不做关键词 fallback", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search", {
            subjectPath: "demo/simulation/subjects/heroine",
            query: "艾琳娜",
            sources: ["events"],
        })).rejects.toThrow("不会执行关键词 fallback");
    });

    it("subject_rag_search 必须显式指定 sources，不提供时不会默认双搜", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search-missing-sources", {
            subjectPath: "demo/simulation/subjects/heroine",
            query: "艾琳娜",
        })).rejects.toThrow("必须显式指定且只能指定一个 source");
    });

    it("subject_rag_search 不允许一次同时搜索 events 和 memory", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search-two-sources", {
            subjectPath: "demo/simulation/subjects/heroine",
            query: "艾琳娜",
            sources: ["events", "memory"],
        })).rejects.toThrow("必须显式指定且只能指定一个 source");
    });

    it("subject_event_append 后立刻 search 会同步重建 dirty events 索引", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"旧事件只提到了王都学院走廊。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"艾琳娜是我的同班同学。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 3,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "utf-8");
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text.includes("艾琳娜") || text.includes("粉色头发")
                        ? [1, 0, 0]
                        : [0, 1, 0],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;
        try {
            const appendTool = mustTool("subject_event_append", harness);
            const searchTool = mustTool("subject_rag_search", harness);

            await appendTool.executeWithContext?.(context, "append-before-search", {
                subjectPath: "demo/simulation/subjects/heroine",
                events: [
                    {text: "我刚刚确认艾琳娜就是早上帮我的粉色头发女孩。"},
                ],
            });
            const result = await searchTool.executeWithContext?.(context, "search-after-append", {
                subjectPath: "demo/simulation/subjects/heroine",
                query: "艾琳娜 粉色头发",
                sources: ["events"],
                limit: 3,
            });
            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";

            expect(text).toContain("粉色头发女孩");
            expect(text).not.toContain("旧事件只提到了王都学院走廊");
            expect(result?.details).toEqual({
                subjectPath: "demo/simulation/subjects/heroine",
                source: "events",
                count: 1,
            });
            await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.not.toContain("\"events\"");
            await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag.sqlite"))).resolves.toBeInstanceOf(Buffer);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_rag_search 内部过滤不会误杀中等相关候选", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), [
            "{\"text\":\"艾琳娜曾在早晨帮我避开迟到。\"}",
            "{\"text\":\"王都学院走廊今天很安静。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"艾琳娜是我的同班同学。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 2,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "utf-8");
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text === "艾琳娜"
                        ? [1, 0]
                        : text.includes("艾琳娜")
                        ? [0.55, 0.83]
                        : [0, 1],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;
        try {
            const tool = mustTool("subject_rag_search", harness);

            const result = await tool.executeWithContext?.(context, "rag-search-medium-match", {
                subjectPath: "demo/simulation/subjects/heroine",
                query: "艾琳娜",
                sources: ["events"],
                limit: 2,
            });
            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";

            expect(text).toContain("避开迟到");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_rag_search 的 embedding 请求超时会明确失败", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "slow-embed",
                dimensions: 3,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: 1,
                requestOptions: {},
            },
        }), "utf-8");
        const timeoutFetch: typeof fetch = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            await new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("This operation was aborted", "AbortError"));
                });
            });
            throw new Error("unreachable");
        }, {preconnect: originalFetch.preconnect});
        globalThis.fetch = timeoutFetch;
        try {
            const tool = mustTool("subject_rag_search", harness);

            await expect(tool.executeWithContext?.(context, "rag-search-timeout", {
                subjectPath: "demo/simulation/subjects/heroine",
                query: "艾琳娜",
                sources: ["events"],
                limit: 1,
            })).rejects.toThrow("embedding 请求超时");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_memory_update 调用真实 memory.curator profile，应用 JSON Patch 并标记 dirty", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "memory.jsonl"), [
            "{\"topic\":\"粉色头发的女孩子\",\"aliases\":[\"早上帮过我的女孩\"],\"view\":\"她早上帮过我。\"}",
            "{\"topic\":\"艾琳娜\",\"view\":\"她是同班同学。\"}",
            "",
        ].join("\n"), "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "patch ready",
                    data: {
                        patch: [
                            {
                                op: "replace",
                                path: "/1",
                                value: {
                                    topic: "艾琳娜",
                                    aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
                                    view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
                                },
                            },
                            {op: "remove", path: "/0"},
                        ],
                    },
                }, {id: "curator-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update", {
            subjectPath: "demo/simulation/subjects/heroine",
            facts: ["我确认艾琳娜就是早上帮过我的粉色头发女孩。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "updated",
            summary: "patch ready",
            dirty: true,
        }));
        expect(parseSubjectMemoriesJsonl(await readFile(join(subjectRoot, "memory.jsonl"), "utf-8"))).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
            view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
        }]);
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("subject_memory_update 硬切 JSONL，不导入旧 knowledge.md", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "knowledge.md"), "## 艾琳娜\n\n我知道艾琳娜曾经帮过我。", "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "patch ready",
                    data: {
                        patch: [{
                            op: "add",
                            path: "/-",
                            value: {
                                topic: "艾琳娜",
                                view: "我今天确认自己仍然记得艾琳娜帮过我。",
                            },
                        }],
                    },
                }, {id: "curator-hard-cut-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update-hard-cut", {
            subjectPath: "demo/simulation/subjects/heroine",
            facts: ["我今天确认自己仍然记得艾琳娜帮过我。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "updated",
            summary: "patch ready",
        }));
        expect(parseSubjectMemoriesJsonl(await readFile(join(subjectRoot, "memory.jsonl"), "utf-8"))).toEqual([{
            topic: "艾琳娜",
            view: "我今天确认自己仍然记得艾琳娜帮过我。",
        }]);
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("subject_memory_update patch 校验失败会重试一次，仍失败则 needs_review 且不写文件", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        const original = "{\"topic\":\"艾琳娜\",\"view\":\"她是同班同学。\"}\n";
        await writeFile(join(subjectRoot, "memory.jsonl"), original, "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad patch",
                    data: {
                        patch: [{op: "replace", path: "/0/view", value: ""}],
                    },
                }, {id: "curator-bad-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad patch again",
                    data: {
                        patch: [{op: "add", path: "/-", value: {topic: "", view: "x"}}],
                    },
                }, {id: "curator-bad-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update-bad", {
            subjectPath: "demo/simulation/subjects/heroine",
            facts: ["事实需要更新，但 curator patch 不合法。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "needs_review",
            attempts: 2,
        }));
        await expect(readFile(join(subjectRoot, "memory.jsonl"), "utf-8")).resolves.toBe(original);
    });
});

function mustTool(key: string, harness: NeuroAgentHarness) {
    const tool = harness.tools.get(key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing tool ${key}`);
    }
    return tool;
}
