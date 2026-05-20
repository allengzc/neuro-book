import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import YAML from "yaml";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createWorkspaceContentFrontmatterDefaults, workspaceContentJsonSchema} from "nbook/server/workspace-files/content-node-schema";
import {renderWorkspaceContentTemplate, renderWorkspaceContentTemplateBundle, renderWorkspaceStateTemplate} from "nbook/server/workspace-files/content-node-templates";
import {copyNovelDirectoryTemplate, syncSystemAssetsToUserAssets, USER_ASSETS_WORKSPACE_ROOT, writeNovelWorkspaceMetadata} from "nbook/server/workspace-files/novel-workspace";
import {createWorkspaceContentState, createWorkspaceDirectory, readWorkspaceTextFile, scanWorkspaceTree, validateWorkspaceContentNodes, validateWorkspaceTree, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";

const WORKSPACE_SCRIPT_PATH = "assets/agent/scripts/workspace.ts";
const execFileAsync = promisify(execFile);

describe("workspace-files", () => {
    let root: string;

    beforeEach(async () => {
        root = path.join(".agent", "workspace-files-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("允许 lorebook 使用目录 index.md 表达嵌套设定节点", async () => {
        await writeMarkdown("lorebook/location/city-a/index.md", {
            type: "location",
            status: "active",
        });
        await writeMarkdown("lorebook/location/city-a/building-a/index.md", {
            type: "item",
            status: "draft",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("允许 lorebook 使用 faction 表达势力内容节点", async () => {
        await writeMarkdown("lorebook/faction/sky-court/index.md", {
            type: "faction",
            status: "draft",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("拒绝非法 lorebook 类型", async () => {
        await writeMarkdown("lorebook/location/foo/index.md", {
            type: "building",
            status: "active",
        });

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P2",
                code: "invalid-type",
            }),
        ]));
    });

    it("推断 manuscript 顶层目录节点为 volume，更深层目录节点为 chapter", async () => {
        await writeMarkdown("manuscript/001-volume/index.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/001-volume/001-chapter/index.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/001-volume/001-chapter/draft.md", {
            type: "research-note",
            status: "draft",
        });

        const nodes = await scanWorkspaceTree({root, targets: ["manuscript"]});
        const issues = await validateWorkspaceTree({root, targets: ["manuscript"]});

        expect(nodes.find((node) => node.path === "manuscript/001-volume/")?.entryType).toBe("volume");
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/")?.entryType).toBe("chapter");
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/draft.md")?.contentNode).toBe(false);
        expect(nodes.find((node) => node.path === "manuscript/001-volume/001-chapter/draft.md")?.entryType).toBeNull();
        expect(issues.filter((issue) => issue.code === "invalid-type")).toEqual([]);
    });

    it("只在内容根内拒绝同级文件 stem 与目录同名", async () => {
        await writeMarkdown("manuscript/foo.md", {
            status: "draft",
        });
        await writeMarkdown("manuscript/foo/index.md", {
            status: "draft",
        });
        await writeMarkdown("docs/foo.md", {
            type: "note",
        });
        await writeMarkdown("docs/foo/index.md", {
            type: "note",
        });

        const issues = await validateWorkspaceTree({root});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P1",
                code: "content-sibling-name-conflict",
                path: "manuscript/foo.md",
            }),
        ]));
        expect(issues.some((issue) => issue.path === "docs/foo.md" && issue.code === "content-sibling-name-conflict")).toBe(false);
    });

    it("解析结构化 refs 和 inline 引用中的相对路径", async () => {
        await writeMarkdown("lorebook/location/city/index.md", {
            type: "location",
            status: "active",
        });
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "draft",
            refs: [
                {
                    relation: "origin",
                    target: "../../location/city/",
                    note: "角色出生地",
                },
            ],
        }, "正文引用 [城市](../../location/city/)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.filter((issue) => issue.code === "missing-ref" || issue.code === "legacy-ref")).toEqual([]);
    });

    it("不会把 Markdown 图片路径当作工作区引用校验", async () => {
        await writeMarkdown("lorebook/location/city/index.md", {
            type: "location",
            status: "active",
        }, "封面图 ![城市](assets/city.png)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues.some((issue) => issue.code === "missing-ref" && issue.message.includes("assets/city.png"))).toBe(false);
    });

    it("把旧引用协议报为解析错误，并报告 deprecated 状态和 ext.character", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "deprecated",
            ext: {
                character: {
                    logline: "旧角色字段",
                },
            },
        }, "旧引用 [城市](lorebook://location/city)。");

        const issues = await validateWorkspaceTree({root, targets: ["lorebook"]});

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({level: "P1", code: "invalid-ref"}),
            expect.objectContaining({level: "P2", code: "legacy-status"}),
            expect.objectContaining({level: "P2", code: "legacy-ext-character"}),
        ]));
    });

    it("非递归校验接受根外内容节点并报告警告", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", {
            type: "character",
            status: "draft",
        });
        await writeMarkdown("docs/foo/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "普通内容节点",
            type: "note",
            status: "draft",
        }));

        const fileTarget = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero/index.md"]});
        const externalNode = await validateWorkspaceContentNodes({root, targets: ["docs/foo"]});
        const recursive = await validateWorkspaceContentNodes({root, targets: ["lorebook"], recursive: true});

        expect(fileTarget.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "invalid-content-node-target"}),
        ]));
        expect(externalNode.issues).toEqual([
            expect.objectContaining({
                level: "WARN",
                code: "external-content-node",
                path: "docs/foo/",
            }),
        ]);
        expect(recursive.issues.some((issue) => issue.code === "invalid-content-node-target")).toBe(false);
    });

    it("fixMissing 会补齐 nullable 字段并保留正文", async () => {
        await writeMarkdown("lorebook/note/question/index.md", {
            title: "主角地球死亡原因",
            type: "note",
            status: "pending",
            refs: [
                {
                    relation: "mentions",
                    target: "../other/",
                },
            ],
        }, "意外？谋杀？还是灵魂牵引的副作用？");

        const before = await validateWorkspaceContentNodes({root, targets: ["lorebook/note/question"]});
        const fixed = await validateWorkspaceContentNodes({
            root,
            targets: ["lorebook/note/question"],
            fixMissing: true,
        });
        const content = await fs.readFile(path.join(root, "lorebook/note/question/index.md"), "utf-8");

        expect(before.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing-frontmatter-field"}),
        ]));
        expect(fixed.fixedPaths).toEqual(["lorebook/note/question/index.md"]);
        expect(fixed.issues.some((issue) => issue.code === "missing-frontmatter-field")).toBe(false);
        expect(content).toContain("subtype: null");
        expect(content).toContain("icon: null");
        expect(content).not.toContain("writingTip:");
        expect(content).toContain("note: null");
        expect(content).toContain("意外？谋杀？还是灵魂牵引的副作用？");
    });

    it("解析并校验内容节点 state.md 当前状态", async () => {
        await writeMarkdown("lorebook/character/A/index.md", {
            type: "character",
            status: "active",
        });
        await writeMarkdown("lorebook/character/B/index.md", {
            type: "character",
            status: "active",
        });
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            statusNote: "已经知道凶手身份，但没有公开证据。",
            updatedAt: "chapter-1",
            knowledge: [
                "所有王国公民都知道的常识。",
                "这是王国禁忌绝学，只有王室成员有资格学，[角色A](lorebook/character/A)什么时候偷学了。",
                "[皇室成员B](lorebook/character/B)在成年的时候选择学习。",
            ],
        }, "当前状态说明");

        const nodes = await scanWorkspaceTree({root, targets: ["lorebook/character/hero"]});
        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});
        const hero = nodes.find((node) => node.path === "lorebook/character/hero/");

        expect(hero?.state?.path).toBe("lorebook/character/hero/state.md");
        expect(hero?.state?.words).toBe("当前状态说明".length);
        expect(result.issues.filter((issue) => issue.path.includes("state.md"))).toEqual([]);
    });

    it("报告 state.md 信息差字符串中的引用断链", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            knowledge: [
                "主角怀疑[失踪线索](lorebook/note/missing/)与皇宫有关。",
            ],
        });

        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P1",
                code: "missing-ref",
                path: "lorebook/character/hero/state.md",
            }),
        ]));
    });

    it("拒绝旧对象式 state.md knowledge", async () => {
        await writeMarkdown("lorebook/character/hero/index.md", createWorkspaceContentFrontmatterDefaults({
            title: "主角",
            type: "character",
            status: "active",
        }));
        await writeMarkdown("lorebook/character/hero/state.md", {
            knowledge: [
                {
                    info: "lorebook/note/secret/",
                    subject: "lorebook/character/hero/",
                    status: "known",
                    note: null,
                },
            ],
        });

        const result = await validateWorkspaceContentNodes({root, targets: ["lorebook/character/hero"]});

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: "P2",
                code: "invalid-state-field",
                path: "lorebook/character/hero/state.md",
            }),
        ]));
    });

    it("内容节点 schema 由 Zod 生成并保留字段描述", () => {
        const factionSchema = workspaceContentJsonSchema("faction");
        const schema = workspaceContentJsonSchema("character");
        const factionProperties = factionSchema.properties as Record<string, Record<string, unknown>>;
        const properties = schema.properties as Record<string, Record<string, unknown>>;

        expect(factionProperties.type.default).toBe("faction");
        expect(properties.title.description).toContain("内容节点显示标题");
        expect(properties.status.default).toBe("draft");
        expect((properties.retrieval.properties as Record<string, Record<string, unknown>>).trigger.description).toContain("自然语言触发条件");
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).profiles.description).toContain("subagent.writer");
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).profiles.description).toContain("leader.default");
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).profiles.description).toContain("任务相关候选召回使用 retrieval");
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).always.description).toContain("长期稳定约束");
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).always.description).toContain("待定问题");
        expect(properties.tags.description).toContain("中文短标签");
        expect(properties.tags.description).toContain("不要为了填字段随意设置标签");
        expect(factionProperties.character).toBeUndefined();
        expect(properties.character).toBeUndefined();
    });

    it("workspace schema markdown 不再输出 Character 专属字段说明", async () => {
        const {stdout, stderr} = await execFileAsync("bun", [WORKSPACE_SCRIPT_PATH, "schema", "character"], {
            encoding: "utf-8",
        });

        expect(stderr).toBe("");
        expect(stdout).toContain("# Workspace Content Schema: character");
        expect(stdout).not.toContain("## Character");
        expect(stdout).not.toContain("character frontmatter");
        expect(stdout).not.toContain("ext.character");
    });

    it("角色内容节点模板包含 frontmatter 注释与正文结构", () => {
        const content = renderWorkspaceContentTemplate({
            title: "苏雪",
            type: "character",
            status: "draft",
        });

        expect(content).toContain("title: 苏雪");
        expect(content).toContain("status: draft # 内容节点状态");
        expect(content).toContain("retrieval:");
        expect(content).toContain("enabled: true");
        expect(content).toContain("inject:");
        expect(content).toContain("profiles: []");
        expect(content).toContain("subagent.writer 写作");
        expect(content).toContain("临时剧情、待定问题、章节状态保持 false");
        expect(content).toContain("## 概要");
        expect(content).toContain("## 角色定义");
        expect(content).toContain("## 角色画像");
        expect(content).toContain("## 动机与矛盾");
        expect(content).toContain("## 关系与角色弧");
        expect(content).not.toContain("character:");
        expect(content).not.toContain("writingTip:");
        expect(content).not.toContain("## 写作注意");
    });

    it("势力内容节点模板包含 frontmatter 注释与当前状态结构", () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "天穹议会",
            type: "faction",
            status: "draft",
        }, true);

        expect(bundle.indexContent).toContain("title: 天穹议会");
        expect(bundle.indexContent).toContain("type: faction");
        expect(bundle.indexContent).toContain("tags: [] # 中文短标签");
        expect(bundle.indexContent).toContain("## 势力设定");
        expect(bundle.indexContent).toContain("## 资源与影响力");
        expect(bundle.indexContent).toContain("## 关系网络");
        expect(bundle.stateContent).toContain("knowledge: []");
        expect(bundle.stateContent).toContain("## 当前目标");
        expect(bundle.stateContent).toContain("## 冲突与压力");
    });

    it("内容节点模板支持目录格式和可选 state.md", () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "苏雪",
            type: "character",
            status: "draft",
        }, true);

        expect(bundle.indexContent).toContain("title: 苏雪");
        expect(bundle.indexContent).toContain("type: character");
        expect(bundle.stateContent).toContain("knowledge: []");
        expect(renderWorkspaceStateTemplate({
            title: "银色短剑",
            type: "item",
            status: "active",
        })).toContain("## 持有者或位置");
        expect(() => renderWorkspaceStateTemplate({
            title: "王国禁令",
            type: "rule",
            status: "draft",
        })).toThrow("暂无 state.md 模板");
    });

    it("用户 assets 可以按文件覆盖内容节点模板", async () => {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "server", "workspace", "content-node-templates", "character", "index.md");
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, [
            "---",
            "title: \"{{title}}\"",
            "type: character",
            "status: \"{{status}}\"",
            "---",
            "",
            "## 用户覆盖模板",
        ].join("\n"), "utf-8");

        try {
            const content = renderWorkspaceContentTemplate({
                title: "苏雪",
                type: "character",
                status: "draft",
            });

            expect(content).toContain("## 用户覆盖模板");
            expect(content).toContain("title: 苏雪");
            expect(content).toContain("status: draft");
            expect(content).not.toContain("## 角色定义");
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    });

    it("同步系统 assets 会补齐默认 leader profile 覆盖文件", async () => {
        const userProfilePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "agent", "profiles", "builtin", "leader-default.profile.tsx");
        const backup = await backupOptionalFile(userProfilePath);
        await fs.rm(userProfilePath, {force: true});

        try {
            const result = await syncSystemAssetsToUserAssets();
            const content = await fs.readFile(userProfilePath, "utf-8");

            expect(result.copied).toBeGreaterThan(0);
            expect(content).toContain("class LeaderDefaultProfile");
            expect(content).toContain("buildLeaderPrompt");
            expect(content).toContain("export default new LeaderDefaultProfile()");
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
        }
    });

    it("小说目录模板会创建最小 lorebook 骨架且通过内容节点校验", async () => {
        await copyNovelDirectoryTemplate(root);

        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.toContain("Novel Workspace");
        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.toContain("PROJECT-STATUS.md");
        await expect(readWorkspaceTextFile(root, "AGENTS.md")).resolves.not.toContain("初始化待办");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("## Current Focus");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("## TODO");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("## Pending Questions");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.not.toContain("## Risks");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.not.toContain("## Recent Updates");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("不维护 `tasks/` walkthrough");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("填写 `lorebook/note/project-positioning/`");
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("填写 `lorebook/note/story-concept/`");
        await expect(readWorkspaceTextFile(root, ".nbook/icons.json")).resolves.toContain("\"lorebook\"");
        await expect(fs.access(path.join(root, ".agent/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(readWorkspaceTextFile(root, "workspace.yaml")).resolves.toContain("slug: novel-template");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-positioning/index.md")).resolves.toContain("## 类型与基调");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-positioning/index.md")).resolves.toContain("- 小说初始化");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("## 故事概述");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("长简介式作品介绍");
        await expect(readWorkspaceTextFile(root, "lorebook/rule/writing-style/index.md")).resolves.toContain("inject:");
        await expect(readWorkspaceTextFile(root, "lorebook/rule/writing-style/index.md")).resolves.toContain("文风约束通常给 subagent.writer");
        await expect(readWorkspaceTextFile(root, "lorebook/note/initial-plot-seed/index.md")).resolves.toContain("剧情种子通常不直接注入");
        await expect(readWorkspaceTextFile(root, "manuscript/001-opening/index.md")).resolves.toContain("## 正文草稿");
        await expect(readWorkspaceTextFile(root, "manuscript/001-opening/index.md")).resolves.toContain("- 开局示例");

        const lorebookResult = await validateWorkspaceContentNodes({
            root,
            targets: ["lorebook"],
            recursive: true,
        });
        const manuscriptResult = await validateWorkspaceContentNodes({
            root,
            targets: ["manuscript"],
            recursive: true,
        });

        expect(lorebookResult.issues.filter((issue) => issue.level === "P1" || issue.level === "P2")).toEqual([]);
        expect(manuscriptResult.issues.filter((issue) => issue.level === "P1" || issue.level === "P2")).toEqual([]);
    });

    it("小说目录模板不会覆盖已有用户文件", async () => {
        const targetPath = path.join(root, "lorebook/rule/writing-style/index.md");
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.writeFile(targetPath, "用户已经写好的文风", "utf-8");

        await copyNovelDirectoryTemplate(root);

        await expect(readWorkspaceTextFile(root, "lorebook/rule/writing-style/index.md")).resolves.toBe("用户已经写好的文风");
        await expect(readWorkspaceTextFile(root, "lorebook/note/synopsis/index.md")).resolves.toContain("## 简介");
    });

    it("用户 assets 可以覆盖小说目录模板但不覆盖目标 workspace 既有文件", async () => {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "server", "workspace", "novel-directory-template", "PROJECT-STATUS.md");
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, "# 用户覆盖状态模板\n", "utf-8");

        try {
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toBe("# 用户覆盖状态模板\n");

            await writeWorkspaceTextFile(root, "PROJECT-STATUS.md", "# 小说自己的状态\n");
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toBe("# 小说自己的状态\n");
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    });

    it("写入小说 workspace 元数据时会加载模板并覆盖占位 workspace.yaml", async () => {
        const now = new Date("2026-05-09T00:00:00.000Z");
        const workspaceSlug = `workspace-files-test-${randomUUID()}`;

        await writeNovelWorkspaceMetadata({
            id: 999,
            workspaceSlug,
            createdAt: now,
            updatedAt: now,
        });

        const createdRoot = path.join("workspace", workspaceSlug);

        try {
            await expect(readWorkspaceTextFile(createdRoot, "workspace.yaml")).resolves.toContain("novelId: \"999\"");
            await expect(readWorkspaceTextFile(createdRoot, "workspace.yaml")).resolves.not.toContain("novel-template");
            await expect(readWorkspaceTextFile(createdRoot, "AGENTS.md")).resolves.toContain("唯一的小说状态");
            await expect(readWorkspaceTextFile(createdRoot, "PROJECT-STATUS.md")).resolves.toContain("## Pending Questions");
            await expect(readWorkspaceTextFile(createdRoot, "PROJECT-STATUS.md")).resolves.not.toContain("## Recent Updates");
            await expect(readWorkspaceTextFile(createdRoot, "manuscript/001-opening/index.md")).resolves.toContain("示范章节");
        } finally {
            await fs.rm(createdRoot, {recursive: true, force: true});
        }
    });

    it("创建内容节点时可以同时写入 state.md", async () => {
        const bundle = renderWorkspaceContentTemplateBundle({
            title: "苏雪",
            type: "character",
            status: "draft",
        }, true);

        const node = await createWorkspaceDirectory({
            root,
            dirPath: "lorebook/character/su-xue",
            indexContent: bundle.indexContent,
            stateContent: bundle.stateContent,
        });

        expect(node.state?.path).toBe("lorebook/character/su-xue/state.md");
        await expect(readWorkspaceTextFile(root, "lorebook/character/su-xue/state.md")).resolves.toContain("## 当前状态");
    });

    it("可以给已有内容节点补充 state.md 且不覆盖已有文件", async () => {
        await createWorkspaceDirectory({
            root,
            dirPath: "lorebook/item/silver-dagger",
            indexContent: renderWorkspaceContentTemplate({
                title: "银色短剑",
                type: "item",
                status: "draft",
            }),
        });

        const node = await createWorkspaceContentState({
            root,
            dirPath: "lorebook/item/silver-dagger",
            stateContent: renderWorkspaceStateTemplate({
                title: "银色短剑",
                type: "item",
                status: "draft",
            }),
        });

        expect(node.state?.path).toBe("lorebook/item/silver-dagger/state.md");
        await expect(createWorkspaceContentState({
            root,
            dirPath: "lorebook/item/silver-dagger",
            stateContent: "重复状态",
        })).rejects.toThrow("state.md 已存在");
    });

    it("允许读写 YAML 这类普通文本文件", async () => {
        await writeWorkspaceTextFile(root, "workspace.yaml", "slug: silver-dragon-hime\n");

        await expect(readWorkspaceTextFile(root, "workspace.yaml")).resolves.toBe("slug: silver-dragon-hime\n");
    });

    it("拒绝把明确二进制扩展按文本读取", async () => {
        await fs.writeFile(path.join(root, "cover.png"), "not really png", "utf-8");

        await expect(readWorkspaceTextFile(root, "cover.png")).rejects.toThrow("This file type cannot be read as text");
    });

    it("拒绝把含 NUL 的文件按文本读取", async () => {
        await fs.writeFile(path.join(root, "bad.txt"), Buffer.from([0x61, 0x00, 0x62]));

        await expect(readWorkspaceTextFile(root, "bad.txt")).rejects.toThrow("The file appears to be binary");
    });

    it("拒绝非法 UTF-8 文件", async () => {
        await fs.writeFile(path.join(root, "bad.log"), Buffer.from([0xff]));

        await expect(readWorkspaceTextFile(root, "bad.log")).rejects.toThrow("The file is not valid UTF-8 text");
    });

    /**
     * 写入一个带最小 frontmatter 的 Markdown 测试文件。
     */
    async function writeMarkdown(filePath: string, frontmatter: Record<string, unknown>, body = "正文"): Promise<void> {
        const absolutePath = path.join(root, filePath);
        const yaml = YAML.stringify(frontmatter).trimEnd();
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, `---\n${yaml}\n---\n\n${body}`, "utf-8");
    }

    /**
     * 备份真实用户 assets 中可能已经存在的同路径测试文件。
     */
    async function backupOptionalFile(filePath: string): Promise<string | null> {
        try {
            return await fs.readFile(filePath, "utf-8");
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    /**
     * 还原被测试临时覆盖的用户 assets 文件。
     */
    async function restoreOptionalFile(filePath: string, content: string | null): Promise<void> {
        if (content === null) {
            await fs.rm(filePath, {force: true});
            return;
        }
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, content, "utf-8");
    }
});
