import {randomUUID} from "node:crypto";
import {readFile, readdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import type {PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";

/** 轮询等待某 session 目录至少出现 minCount 条 trace 文件（record 是 fire-and-forget）。 */
async function waitForTrace(root: string, sessionId: number, minCount = 1): Promise<PiTraceRecord[]> {
    const dir = join(root, ".nbook", "agent", "traces", String(sessionId));
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const files = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
        if (files.length >= minCount) {
            return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as PiTraceRecord));
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return [];
}

describe("harness → pi trace 集成", () => {
    let root: string;
    let faux: FauxProviderRegistration;
    let harness: NeuroAgentHarness;

    beforeEach(() => {
        root = join(".agent", "harness-trace-test", randomUUID());
        faux = registerFauxProvider({models: [{id: `faux-${randomUUID()}`, contextWindow: 128_000, maxTokens: 8_000}]});
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        faux.unregister();
        await rm(root, {recursive: true, force: true});
    });

    it("一次 prompt turn 经默认开启的 trace 落一条 kind=turn 记录", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "trace.plain", name: "Trace Plain"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {systemPrompt: "you are a test assistant"};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "trace.plain", initial: {}, workspaceRoot: root});

        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        expect(result.status).toBe("completed");

        const records = await waitForTrace(root, created.sessionId);
        expect(records.length).toBeGreaterThanOrEqual(1);
        const record = records[0]!;
        expect(record.correlation.kind).toBe("turn");
        expect(record.correlation.sessionId).toBe(created.sessionId);
        expect(record.correlation.invocationId).toBe(result.invocationId);
        expect(record.request.model).toBe(faux.getModel().id);
        expect(record.request.context).toBeDefined();
        expect(record.response.usage).toBeDefined();
        expect(record.status).toBe("ok");
        // 白名单：记录里绝不含密钥字段。
        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain("apiKey");
    }, 40_000);

    it("sidecar pass 的 provider 请求同样落 trace，mode 区分 sidecar 与主 turn", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "trace.sidecar", name: "Trace Sidecar"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            sidecars: [{
                name: "ctx-load",
                stage: "prepareRun",
                enterPrompt: "load context",
                outputFallback: "final_message_as_result",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {systemPrompt: "you are a test assistant"};
            },
        }), false);
        // 第一条响应给 sidecar 内层 runLoop，第二条给主 turn。
        faux.setResponses([fauxAssistantMessage("ctx ok"), fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "trace.sidecar", initial: {}, workspaceRoot: root});

        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        expect(result.status).toBe("completed");

        const records = await waitForTrace(root, created.sessionId, 2);
        const sidecarRecord = records.find((record) => record.correlation.mode === "sidecar:ctx-load");
        const mainRecord = records.find((record) => record.correlation.mode === "user");
        expect(sidecarRecord).toBeDefined();
        expect(mainRecord).toBeDefined();
        expect(sidecarRecord!.correlation.kind).toBe("turn");
        expect(sidecarRecord!.correlation.sessionId).toBe(created.sessionId);
        expect(sidecarRecord!.correlation.invocationId).toBe(result.invocationId);
        expect(sidecarRecord!.status).toBe("ok");
        expect(JSON.stringify(records)).not.toContain("apiKey");
    }, 40_000);
});
