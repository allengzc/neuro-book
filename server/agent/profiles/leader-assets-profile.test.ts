import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";

describe("assets leader.default v3 profile", () => {
    it("从 assets/.nbook 加载并使用 v3 工具名", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const prepared = await profile.prepare({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "leader.default",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {},
            catalog: await catalog.snapshot(),
        });
        const prompt = prepared.systemPrompt ?? "";

        expect(profile.manifest.name).toBe("Leader");
        expect(profile.allowedToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "create_agent",
            "invoke_agent",
            "get_agent",
            "get_session",
            "detach_agent",
            "request_user_input",
            "enter_plan_mode",
            "exit_plan_mode",
            "skill",
        ]);
        expect(profile.allowedToolKeys).not.toContain("report_result");
        expect(prompt).toContain("read");
        expect(prompt).toContain("bash");
        expect(prompt).toContain("offset/limit");
        expect(prompt).toContain("edits[]");
        expect(prompt).toContain("原始文件");
        expect(prompt).toContain("workspace root");
        expect(prompt).toContain("搜索文本优先用 rg");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(prompt).not.toContain("create_subagent");
        expect(prompt).not.toContain("invoke_subagent");
        expect(prompt).not.toContain("list_subagents");
        expect(prompt).not.toContain("PowerShell");
        expect(prepared.historyMessages?.some((message) => message.role === "assistant")).toBe(true);
    });
});
