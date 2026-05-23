import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {resolvePiApiKey, resolvePiModel} from "nbook/server/agent/harness/model-resolver";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {messageText} from "nbook/server/agent/messages/message-utils";

const PROFILE_KEY = "leader.default";

/**
 * 手动验证 Agent harness 的真实 provider、event、usage 和 JSONL session 链路。
 */
async function main(): Promise<void> {
    const startedAt = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workspaceRoot = path.resolve(".agent", "agent-smoke", stamp);

    try {
        const model = resolvePiModel(PROFILE_KEY);
        const apiKey = resolvePiApiKey(model.provider);
        if (!apiKey) {
            throw new Error(`provider ${model.provider} 未配置 apiKey，请先在 workspace/.nbook/config.json 或设置页中填写真实 Provider 密钥`);
        }

        await fs.mkdir(workspaceRoot, {recursive: true});
        const harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(workspaceRoot),
            modelResolver: () => model,
        });
        const agent = await harness.createAgent({
            profileKey: PROFILE_KEY,
            input: {
                role: "smoke",
            },
            workspaceRoot,
        });

        const result = await harness.invokeAgent({
            sessionId: agent.sessionId,
            mode: "prompt",
            message: {
                text: "用一句中文回复：agent session smoke ok。",
            },
        });
        const snapshot = await harness.repo.readSession(agent.sessionId);
        const context = harness.repo.reduce(snapshot);
        const sessionPath = path.join(
            workspaceRoot,
            ".nbook",
            "agent",
            "sessions",
            snapshot.metadata.workspaceKey,
            `${String(agent.sessionId)}.jsonl`,
        );

        console.log([
            "# Agent Smoke",
            "",
            `Profile: ${PROFILE_KEY}`,
            `Model: ${model.provider}/${model.id}`,
            `Workspace: ${workspaceRoot}`,
            `Session: ${String(agent.sessionId)}`,
            `Session JSONL: ${sessionPath}`,
            `Status: ${result.status}`,
            `Duration: ${String(Date.now() - startedAt)}ms`,
            `Events: ${String(result.events.length)}`,
            result.usage ? `Usage: ${JSON.stringify(result.usage)}` : "Usage: (not reported)",
            "",
            "## Result",
            "",
            result.reportResult ? JSON.stringify(result.reportResult, null, 2) : result.finalMessage ?? "(empty)",
            "",
            "## Last Messages",
            "",
            ...context.messages.slice(-6).map((message, index) => `${String(index + 1)}. ${message.role}: ${messageText(message as never)}`),
            "",
        ].join("\n"));

        if (result.status === "error" || !(result.finalMessage ?? result.reportResult?.result ?? "").includes("smoke")) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    }
}

await main();
