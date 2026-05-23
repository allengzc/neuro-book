import {join, resolve} from "node:path";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";

describe("assets builtin v3 profiles", () => {
    it("leader.default 从 assets/workspace/.nbook 加载并使用 v3 工具名", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const prepared = await profile.prepare!({
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
            skills: [{
                key: "draft",
                name: "Draft Skill",
                description: "写作流程 skill",
                source: "system",
                rootPath: resolve("assets", "workspace", ".nbook", "agent", "skills", "draft"),
                skillPath: resolve("assets", "workspace", ".nbook", "agent", "skills", "draft", "SKILL.md"),
            }],
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
            "task_create",
            "task_set_status",
            "get_plot_tree",
            "get_story_thread",
            "get_story_scene_context",
            "get_chapter_plot",
            "create_story_thread",
            "update_story_thread",
            "create_story_scene",
            "update_story_scene",
            "create_story_plot",
            "update_story_plot",
            "execute_sql",
        ]);
        expect(profile.allowedToolKeys).not.toContain("report_result");
        expect(prompt).toContain("read");
        expect(prompt).toContain("bash");
        expect(prompt).toContain("offset/limit");
        expect(prompt).toContain("edits[]");
        expect(prompt).toContain("原始文件");
        expect(prompt).toContain("workspace root");
        expect(prompt).toContain("搜索文本优先用 rg");
        expect(prompt).toContain("create_agent");
        expect(prompt).toContain("invoke_agent");
        expect(prompt).toContain("get_agent");
        expect(prompt).toContain("Task Management");
        expect(prompt).toContain("task_create");
        expect(prompt).toContain("execute_sql");
        expect(prompt).toContain("get_plot_tree");
        expect(prompt).toContain("writer");
        expect(prompt).toContain("retrieval");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(prompt).not.toContain("PowerShell");
        const historyText = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
        expect(historyText).toContain("Available Agents");
        expect(historyText).toContain("writer");
        expect(historyText).toContain("本次写作任务");
        expect(historyText).toContain("Available Skills");
        expect(historyText).toContain("Draft Skill");
        const snapshot = await catalog.snapshot();
        expect(snapshot.profiles.map((item) => item.key)).toContain("leader.default");
    });

    it("leader.assets 从 assets/workspace/.nbook 加载并使用用户资产提示词", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.assets");
        const prepared = await profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "leader.assets",
                workspaceRoot: resolve("workspace", ".nbook"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {},
            catalog: await catalog.snapshot(),
            skills: [],
        });
        const prompt = prepared.systemPrompt ?? "";
        const dynamicText = prepared.modelContextMessages
            ?.filter((message) => message.role === "user")
            .map((message) => JSON.stringify(message.content))
            .join("\n") ?? "";

        expect(profile.manifest.name).toBe("用户资产助手");
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
        expect(prompt).toContain("用户资产助手");
        expect(prompt).toContain("workspace/.nbook/agent/profiles");
        expect(prompt).toContain("assets/workspace/.nbook/agent/skills");
        expect(prompt).toContain("defineAgentProfile");
        expect(prompt).toContain("read");
        expect(prompt).toContain("bash");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(dynamicText).toContain("workspace/.nbook/agent");
        expect(prepared.historyInitMessages ?? []).toEqual([]);
    });

    it("writer 缺少 novelId 时拒绝展开 plotPoints", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const profile = await catalog.get("writer");

        await expect(profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "writer",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {
                prompt: "写一段正文",
                plotPoints: ["1"],
            },
            catalog: await catalog.snapshot(),
            skills: [],
        })).rejects.toThrow("必须同时提供 novelId");
    });

    it("writer 展开 lorebookEntries 的 index/state 并清洗内部 frontmatter", async () => {
        const workspaceRoot = resolve(".agent", "workspace", "writer-lorebook-test", randomUUID());
        const nodeRoot = join(workspaceRoot, "lorebook", "character", "hero");
        await mkdir(nodeRoot, {recursive: true});
        await writeFile(join(nodeRoot, "index.md"), [
            "---",
            "title: Hero",
            "type: character",
            "status: active",
            "summary: 主角。",
            "retrieval:",
            "  enabled: true",
            "refs:",
            "  - relation: ally",
            "    target: lorebook/character/mage/",
            "    visibility: author",
            "    internal: hidden",
            "---",
            "主角正文设定。",
        ].join("\n"), "utf8");
        await writeFile(join(nodeRoot, "state.md"), [
            "---",
            "statusNote: 正在白塔。",
            "updatedAt: 2026-05-23",
            "knowledge:",
            "  - 知道白塔入口。",
            "privateNote: hidden",
            "---",
            "当前状态正文。",
        ].join("\n"), "utf8");
        try {
            const catalog = new AgentProfileCatalog(
                resolve("assets", "workspace", ".nbook", "agent", "profiles"),
                resolve(".agent", "missing-user-profiles"),
            );
            catalog.register(defaultAgentProfile);
            const profile = await catalog.get("writer");
            const prepared = await profile.prepare!({
                session: {
                    systemPrompt: "",
                    messages: [],
                    model: null,
                    thinkingLevel: "off",
                    profileKey: "writer",
                    workspaceRoot,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    planModeActive: false,
                },
                input: {
                    prompt: "写一段正文",
                    lorebookEntries: [{
                        path: "lorebook/character/hero/",
                        priority: 1,
                        reason: "主角出场",
                    }],
                },
                catalog: await catalog.snapshot(),
                skills: [],
            });
            const modelContext = prepared.modelContextMessages
                ?.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult")
                .map(messageText)
                .join("\n") ?? "";

            expect(modelContext).toContain("<lorebook_entries>");
            expect(modelContext).toContain("主角正文设定");
            expect(modelContext).toContain("当前状态正文");
            expect(modelContext).toContain("statusNote");
            expect(modelContext).not.toContain("retrieval");
            expect(modelContext).not.toContain("privateNote");
            expect(modelContext).not.toContain("visibility");
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });
});
