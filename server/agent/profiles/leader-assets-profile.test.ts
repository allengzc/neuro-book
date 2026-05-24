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
            "get_agent_profile",
            "get_session",
            "detach_agent",
            "request_user_input",
            "enter_plan_mode",
            "exit_plan_mode",
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
        expect(prompt).toContain("workspace root");
        expect(prompt).toContain("搜索文本优先用 rg");
        expect(prompt).toContain("create_agent");
        expect(prompt).toContain("invoke_agent");
        expect(prompt).toContain("get_agent");
        expect(prompt).toContain("get_agent_profile");
        expect(prompt).toContain("Task Management");
        expect(prompt).toContain("Task tools are for execution tracking, not for storing novel facts");
        expect(prompt).toContain("task_create");
        expect(prompt).toContain("execute_sql");
        expect(prompt).toContain("get_plot_tree");
        expect(prompt).toContain("writer");
        expect(prompt).toContain("retrieval");
        expect(prompt).toContain("内容节点引用分流");
        expect(prompt).toContain("retrieval.trigger");
        expect(prompt).toContain("workspace node parse --stdin --ndjson");
        expect(prompt).toContain("rg --files | rg '(^|[\\\\/])index\\.md$'");
        expect(prompt).toContain("workspace 相对路径优先使用 / 分隔");
        expect(prompt).toContain("\"novelId\"");
        expect(prompt).toContain("\"createdAt\"");
        expect(prompt).toContain("角色动机是否连续");
        expect(prompt).toContain("Plan Mode 工作目录会在 runtime context");
        expect(prompt).not.toContain("{sessionId}");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(prompt).not.toContain("PowerShell");
        expect(prompt).not.toContain("--path-separator=/");
        expect(prompt).not.toContain("rg --files | rg '(^|/)index");
        const historyText = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
        expect(historyText).toContain("Available Agents");
        expect(historyText).toContain("writer");
        expect(historyText).toContain("get_agent_profile");
        expect(historyText).not.toContain("本次写作任务");
        expect(historyText).not.toContain("allowedTools:");
        expect(historyText).toContain("Available Skills");
        expect(historyText).toContain("Draft Skill");
        expect(historyText).toContain("Skills are reusable work methods");
        expect(historyText).toContain("These agent profiles are currently available");
        const planModePrepared = await profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "leader.default",
                workspaceRoot: resolve("workspace"),
                customState: {
                    "agent.planMode": {
                        active: true,
                        reminderKind: "full",
                        workDirectory: "workspace/.agent/123",
                    },
                },
                linkedAgents: [],
                archived: false,
                planModeActive: true,
            },
            input: {},
            catalog: await catalog.snapshot(),
            skills: [],
        });
        const planModeText = (planModePrepared.appendingMessages ?? []).map(messageText).join("\n");
        expect(planModeText).toContain("## Thread Work Directory");
        expect(planModeText).toContain("## Restrictions");
        expect(planModeText).toContain("## Workflow");
        expect(planModeText).toContain("Do not create or invoke Explore agents");
        expect(planModeText).not.toContain("{sessionId}");
        const exitPrepared = await profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "leader.default",
                workspaceRoot: resolve("workspace"),
                customState: {
                    "agent.planMode": {
                        active: false,
                        reminderKind: "exit",
                        workDirectory: "workspace/.agent/123",
                    },
                },
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {},
            catalog: await catalog.snapshot(),
            skills: [],
        });
        expect((exitPrepared.appendingMessages ?? []).map(messageText).join("\n")).toContain("## Exited Plan Mode");
        const snapshot = await catalog.snapshot();
        expect(snapshot.profiles.map((item) => item.key)).toContain("leader.default");
    });

    it("retrieval profile 使用 Git Bash 安全的路径枚举提示", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const profile = await catalog.get("retrieval");
        const prepared = await profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "retrieval",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {
                prompt: "找主角相关设定",
                maxEntries: 3,
            },
            catalog: await catalog.snapshot(),
            skills: [],
        });
        const prompt = prepared.systemPrompt ?? "";

        expect(prompt).toContain("rg --files | rg '(^|[\\\\/])index\\.md$'");
        expect(prompt).toContain("head -n 30");
        expect(prompt).toContain("workspace 相对路径优先使用 / 分隔");
        expect(prompt).not.toContain("PowerShell");
        expect(prompt).not.toContain("Select-Object");
        expect(prompt).not.toContain("--path-separator=/");
        expect(prompt).not.toContain("rg --files | rg '(^|/)index");
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
            skills: [{
                key: "profile-system-guide",
                name: "profile-system-guide",
                description: "Guide users and agents through Neuro Book harness, TSX profiles, skills, profile checks, templates, and safe profile editing.",
                whenToUse: "用户想创建、修改、诊断或理解 agent/profile/.profile.tsx。",
                source: "system",
                rootPath: resolve("assets", "workspace", ".nbook", "agent", "skills", "profile-system-guide"),
                skillPath: resolve("assets", "workspace", ".nbook", "agent", "skills", "profile-system-guide", "SKILL.md"),
            }],
        });
        const prompt = prepared.systemPrompt ?? "";
        const dynamicText = prepared.modelContextMessages
            ?.filter((message) => message.role === "user")
            .map(messageText)
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
            "get_agent_profile",
            "get_session",
            "detach_agent",
            "request_user_input",
            "enter_plan_mode",
            "exit_plan_mode",
        ]);
        expect(prompt).toContain("workspace/.nbook/agent/profiles");
        expect(prompt).toContain("assets/workspace/.nbook/agent/skills");
        expect(prompt).toContain("defineAgentProfile");
        expect(prompt).toContain("agent 的配方");
        expect(prompt).toContain("harness");
        expect(prompt).toContain("profile-system-guide");
        expect(prompt).toContain("指导");
        expect(prompt).toContain("Workbench 里的“编译”");
        expect(prompt).toContain("profile compile");
        expect(prompt).toContain("profile preview");
        expect(prompt).not.toContain("POST /api/agent/profiles/compile");
        expect(prompt).toContain("Agent runtime 能稳定调用的入口");
        expect(prompt).not.toContain("bun scripts/compile-profile.ts");
        expect(prompt).toContain("read");
        expect(prompt).toContain("bash");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(dynamicText).toContain("agent profiles/skills should use agent/ under current user-assets cwd");
        expect(dynamicText).toContain("Available skills");
        expect(dynamicText).toContain("profile-system-guide");
        expect(dynamicText).toContain(resolve("assets", "workspace", ".nbook", "agent", "skills", "profile-system-guide", "SKILL.md"));
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
