import {join, resolve} from "node:path";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import writerProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/writer.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {RetrievalInputSchema, RetrievalOutputSchema, WriterInputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {loadWritingReferencePresets} from "nbook/server/agent/profiles/writer-writing-reference";
import {loadWritingStylePresets} from "nbook/server/agent/profiles/writer-writing-style";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: {
        novel: {
            findUnique: vi.fn(async ({where}: {where: {id?: number; workspaceSlug?: string}}) => {
                if (where.workspaceSlug === "silver-dragon-hime" || where.id === 1) {
                    return {id: 1, workspaceSlug: "silver-dragon-hime"};
                }
                return null;
            }),
        },
    },
}));

vi.mock("nbook/server/plot", () => ({
    plotFacade: {
        getChapterPlotDetailDto: vi.fn(async (_novelId: number, chapterPath: string) => ({
            chapterPath,
            totalScenes: 1,
            totalPlots: 1,
            scenes: [{
                id: "1",
                title: "测试场景",
                threadTitle: "主线",
                status: "active",
                summary: "测试剧情摘要。",
                purpose: "验证 writer 章节剧情注入。",
                chapterSortOrder: 0,
                threadSortOrder: 0,
                plots: [{kind: "setup", summary: "测试情节点。"}],
            }],
        })),
    },
}));

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
            vars: createTestVariableAccessor(),
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
            "variable_schema",
            "variable_read",
            "variable_patch",
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
        expect(prompt).toContain("variable_schema");
        expect(prompt).toContain("variable_read");
        expect(prompt).toContain("variable_patch");
        expect(prompt).toContain("get_plot_tree");
        expect(prompt).toContain("writer");
        expect(prompt).toContain("retrieval");
        expect(prompt).toContain("一章节一 agent");
        expect(prompt).toContain("chapterPaths");
        expect(prompt).toContain("writer.lorebookEntries 只接收内容节点 path 字符串数组");
        expect(prompt).toContain("创建 retrieval 时只传自然语言 prompt");
        expect(prompt).toContain("{ entries, note? }");
        expect(prompt).toContain("内容节点引用分流");
        expect(prompt).toContain("retrieval.trigger");
        expect(prompt).toContain("workspace node parse --stdin --ndjson");
        expect(prompt).toContain("rg --files | rg '(^|/)index\\.md$'");
        expect(prompt).toContain("Agent runtime 已配置 rg 输出 / 路径");
        expect(prompt).toContain("workspace 相对路径优先使用 / 分隔");
        expect(prompt).toContain("projectPath");
        expect(prompt).not.toContain("\"novelId\"");
        expect(prompt).toContain("\"StoryScene\"");
        expect(prompt).toContain("\"chapterPath\"");
        expect(prompt).toContain("\"threadSortOrder\"");
        expect(prompt).toContain("角色动机是否连续");
        expect(prompt).toContain("Plan Mode 工作目录会在 runtime context");
        expect(prompt).not.toContain("{sessionId}");
        expect(prompt).not.toContain("read_file");
        expect(prompt).not.toContain("write_file");
        expect(prompt).not.toContain("edit_file");
        expect(prompt).not.toContain("execute_shell");
        expect(prompt).not.toContain("plotPoints 传 Scene ID");
        expect(prompt).not.toContain("PowerShell");
        expect(prompt).not.toContain("--path-separator=/");
        expect(prompt).not.toContain("MSYS_NO_PATHCONV=1");
        expect(prompt).not.toContain("tr '\\\\' '/'");
        expect(prompt).not.toContain("(^|[\\\\/])index");
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
        const runtimePrepared = await profile.prepare!({
            session: {
                systemPrompt: "",
                messages: [],
                model: null,
                thinkingLevel: "off",
                profileKey: "leader.default",
                workspaceRoot: resolve("workspace"),
                customState: {
                    "plot.selection": {
                        projectPath: "workspace/novel-7",
                        threadId: "2",
                        sceneId: "3",
                    },
                },
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            },
            input: {},
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/novel-7",
                "client.studio.selectedFilePath": "manuscript/001-opening/index.md",
            }),
            catalog: await catalog.snapshot(),
            skills: [],
        });
        const runtimeModelContextText = (runtimePrepared.modelContextMessages ?? []).flatMap((message) => {
            const content = "content" in message ? message.content : "";
            if (typeof content === "string") {
                return [content];
            }
            return Array.isArray(content) ? content.flatMap((block) => block.type === "text" ? [block.text] : []) : [];
        }).join("\n");
        const runtimeAppendingText = (runtimePrepared.appendingMessages ?? []).map(messageText).join("\n");
        expect(runtimeModelContextText).toContain("\"path\": \"client.currentProjectWorkspace\"");
        expect(runtimeModelContextText).toContain("\"path\": \"client.studio.selectedFilePath\"");
        expect(runtimeModelContextText).not.toContain("\"ide\"");
        expect(runtimeAppendingText).toContain("Current Project Workspace: workspace/novel-7");
        expect(runtimeAppendingText).toContain("current file: manuscript/001-opening/index.md");
        expect(runtimeAppendingText).toContain("spell cross-project paths explicitly");
        expect(runtimeAppendingText).not.toContain("Current plot focus:");
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
            vars: createTestVariableAccessor(),
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
            vars: createTestVariableAccessor(),
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
            },
            vars: createTestVariableAccessor(),
            catalog: await catalog.snapshot(),
            skills: [],
        });
        const prompt = prepared.systemPrompt ?? "";

        expect(prompt).toContain("rg --files | rg '(^|/)index\\.md$'");
        expect(prompt).toContain("head -n 30");
        expect(prompt).toContain("workspace 相对路径优先使用 / 分隔");
        expect(prompt).toContain("entries[].path");
        expect(prompt).toContain("Leader 会阅读 reason/use/risk/note");
        expect(prompt).toContain("report_result.data 必须是 { entries, note? }");
        expect(prompt).not.toContain("maxEntries");
        expect(prompt).not.toContain("priority 越高越靠前");
        expect(prompt).not.toContain("writingTip");
        expect(prompt).not.toContain("Target profile:");
        expect(prompt).not.toContain("Chapter outline:");
        expect(prompt).not.toContain("PowerShell");
        expect(prompt).not.toContain("Select-Object");
        expect(prompt).not.toContain("--path-separator=/");
        expect(prompt).not.toContain("MSYS_NO_PATHCONV=1");
        expect(prompt).not.toContain("tr '\\\\' '/'");
        expect(prompt).not.toContain("(^|[\\\\/])index");
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
            vars: createTestVariableAccessor(),
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
        const modelContextText = prepared.modelContextMessages
            ?.filter((message) => message.role === "user")
            .map(messageText)
            .join("\n") ?? "";
        const historyText = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
        const appendingText = (prepared.appendingMessages ?? []).map(messageText).join("\n");

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
        expect(prompt).toContain("workspace/.nbook/agent/writing-presets/{styles,references}");
        expect(prompt).toContain("assets/workspace/.nbook/agent/skills");
        expect(prompt).toContain("defineAgentProfile");
        expect(prompt).toContain("ProfilePrompt");
        expect(prompt).toContain("ProfileTurnPlan");
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
        expect(historyText).toContain("Available Agents");
        expect(historyText).toContain("leader.assets");
        expect(historyText).toContain("Available Skills");
        expect(historyText).toContain("profile-system-guide");
        expect(historyText).toContain(resolve("assets", "workspace", ".nbook", "agent", "skills", "profile-system-guide", "SKILL.md"));
        expect(modelContextText).toContain("Agent cwd:");
        expect(modelContextText).toContain("Profile key: leader.assets");
        expect(modelContextText).toContain("agent profiles/skills should use agent/ under current user-assets cwd");
        expect(appendingText).toContain("User assets workspace");
        expect(appendingText).toContain("Do not write novel lorebook");
    });

    it("writer 输入合同硬切为单章节 chapterPaths", () => {
        const properties = WriterInputSchema.properties;

        expect(properties).toHaveProperty("prompt");
        expect(properties).toHaveProperty("chapterPaths");
        expect(properties).toHaveProperty("lorebookEntries");
        expect(properties).toHaveProperty("constraints");
        expect(properties).toHaveProperty("writingStylePreset");
        expect(properties).toHaveProperty("writingReferencePreset");
        expect(properties).not.toHaveProperty("plotPoints");
        expect(properties).not.toHaveProperty("novelId");
        expect(properties).not.toHaveProperty("outputPath");
        const chapterPathsSchema = properties.chapterPaths as typeof properties.chapterPaths & {minItems?: number; maxItems?: number};
        expect(chapterPathsSchema.minItems).toBe(1);
        expect(chapterPathsSchema.maxItems).toBe(1);
    });

    it("retrieval 输入输出合同保持 prompt-only 和 Leader-facing entries", () => {
        const inputProperties = RetrievalInputSchema.properties;
        const outputProperties = RetrievalOutputSchema.properties;
        const entriesSchema = outputProperties.entries as typeof outputProperties.entries & {items: {properties: Record<string, unknown>; required?: string[]}};
        const entryProperties = entriesSchema.items.properties;

        expect(inputProperties).toHaveProperty("prompt");
        expect(inputProperties).not.toHaveProperty("targetProfile");
        expect(inputProperties).not.toHaveProperty("task");
        expect(inputProperties).not.toHaveProperty("chapterOutline");
        expect(inputProperties).not.toHaveProperty("recentText");
        expect(inputProperties).not.toHaveProperty("constraints");
        expect(inputProperties).not.toHaveProperty("maxEntries");
        expect(outputProperties).toHaveProperty("entries");
        expect(outputProperties).toHaveProperty("note");
        expect(entryProperties).toHaveProperty("path");
        expect(entryProperties).toHaveProperty("reason");
        expect(entryProperties).toHaveProperty("use");
        expect(entryProperties).toHaveProperty("risk");
        expect(entryProperties).not.toHaveProperty("priority");
        expect(entryProperties).not.toHaveProperty("writingTip");
        expect(entryProperties).not.toHaveProperty("summary");
    });

    it("writer writing presets 使用用户目录覆盖系统同名文件", async () => {
        const root = resolve(".agent", "workspace", "writer-preset-test", randomUUID());
        const systemStyleRoot = join(root, "system", "styles");
        const userStyleRoot = join(root, "user", "styles");
        const systemReferenceRoot = join(root, "system", "references");
        const userReferenceRoot = join(root, "user", "references");
        await mkdir(systemStyleRoot, {recursive: true});
        await mkdir(userStyleRoot, {recursive: true});
        await mkdir(systemReferenceRoot, {recursive: true});
        await mkdir(userReferenceRoot, {recursive: true});
        await writeFile(join(systemStyleRoot, "same.md"), [
            "---",
            "key: same",
            "label: 系统文风",
            "sourcePreset: source",
            "identifier: system",
            "name: system",
            "enabled: true",
            "role: null",
            "---",
            "系统文风正文",
        ].join("\n"), "utf-8");
        await writeFile(join(userStyleRoot, "same.md"), [
            "---",
            "key: same",
            "label: 用户文风",
            "sourcePreset: source",
            "identifier: user",
            "name: user",
            "enabled: true",
            "role: null",
            "---",
            "用户文风正文",
        ].join("\n"), "utf-8");
        await writeFile(join(systemReferenceRoot, "same.md"), [
            "---",
            "key: same",
            "label: 系统参考",
            "sourceTitle: title",
            "sourceChapters: \"1\"",
            "generatedFrom: test",
            "---",
            "系统参考正文",
        ].join("\n"), "utf-8");
        await writeFile(join(userReferenceRoot, "same.md"), [
            "---",
            "key: same",
            "label: 用户参考",
            "sourceTitle: title",
            "sourceChapters: \"1\"",
            "generatedFrom: test",
            "---",
            "用户参考正文",
        ].join("\n"), "utf-8");

        try {
            const styles = await loadWritingStylePresets([systemStyleRoot, userStyleRoot]);
            const references = await loadWritingReferencePresets([systemReferenceRoot, userReferenceRoot]);

            expect(styles.find((item) => item.key === "same")?.label).toBe("用户文风");
            expect(styles.find((item) => item.key === "same")?.content).toContain("用户文风正文");
            expect(references.find((item) => item.key === "same")?.label).toBe("用户参考");
            expect(references.find((item) => item.key === "same")?.content).toContain("用户参考正文");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
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
            const prepared = await writerProfile.prepare!({
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
                    chapterPaths: ["silver-dragon-hime/manuscript/001-chapter/"],
                    lorebookEntries: ["lorebook/character/hero/"],
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const historyContext = prepared.historyInitMessages
                ?.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult")
                .map(messageText)
                .join("\n") ?? "";

            expect(historyContext).toContain("<writer_input_context>");
            expect(historyContext).toContain("<chapter_target>");
            expect(historyContext).toContain("<chapter_plots>");
            expect(historyContext).toContain("<lorebook_entries>");
            expect(historyContext).toContain("主角正文设定");
            expect(historyContext).toContain("当前状态正文");
            expect(historyContext).toContain("statusNote");
            expect(historyContext).not.toContain("retrieval");
            expect(historyContext).not.toContain("privateNote");
            expect(historyContext).not.toContain("visibility");
            expect(prepared.modelContextMessages ?? []).toHaveLength(0);
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });
});
