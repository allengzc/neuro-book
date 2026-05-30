import {createHash, randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import YAML from "yaml";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createWorkspaceContentFrontmatterDefaults, workspaceContentJsonSchema} from "nbook/server/workspace-files/content-node-schema";
import {renderWorkspaceContentTemplate, renderWorkspaceContentTemplateBundle, renderWorkspaceStateTemplate} from "nbook/server/workspace-files/content-node-templates";
import {copyNovelDirectoryTemplate, readUserAssetsSyncConflictDetail, resolveWorkspaceRootInput, syncSystemAssetsToUserAssets, USER_ASSETS_WORKSPACE_ROOT} from "nbook/server/workspace-files/novel-workspace";
import {initProjectDatabase, listProjectWorkspaces, readProjectManifest, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {closeWorkspaceTreeIndex, invalidateProjectWorkspaceIndexAfterMutation, readPlainWorkspaceTreeSnapshot, readProjectWorkspaceTreeSnapshot, setProjectWorkspaceIndexCommitHookForTest} from "nbook/server/workspace-files/project-workspace-index";
import {createWorkspaceContentState, createWorkspaceDirectory, readWorkspaceTextFile, scanWorkspaceTree, validateWorkspaceContentNodes, validateWorkspaceTree, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {updateNovelByTool} from "nbook/server/utils/novel-chapter";

const WORKSPACE_SCRIPT_PATH = "scripts/cli/workspace.ts";
const AGENT_WORKSPACE_SCRIPT_PATH = "../assets/workspace/.nbook/agent/scripts/workspace.ts";
const execFileAsync = promisify(execFile);

describe("workspace-files", () => {
    let root: string;

    beforeEach(async () => {
        root = path.join(".agent", "workspace-files-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
    });

    afterEach(async () => {
        setProjectWorkspaceIndexCommitHookForTest(null);
        await closeWorkspaceTreeIndex(root);
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

    it("Project Workspace tree snapshot 会返回 issues 和节点问题摘要", async () => {
        await writeMarkdown("lorebook/note/project-positioning/index.md", {
            type: "note",
            status: "draft",
        });

        const snapshot = await readProjectWorkspaceTreeSnapshot({root});
        const node = snapshot.nodes.find((item) => item.path === "lorebook/note/project-positioning/");

        expect(snapshot.revision).toBeGreaterThan(0);
        expect(snapshot.validatedAt).toBeTruthy();
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "missing-frontmatter-field",
                path: "lorebook/note/project-positioning/",
            }),
        ]));
        expect(node?.issueSummary?.selfCount).toBeGreaterThan(0);
    });

    it("plain workspace tree snapshot 不运行 Project Workspace Issue Index", async () => {
        await writeMarkdown("lorebook/note/project-positioning/index.md", {
            type: "note",
            status: "draft",
        });

        const snapshot = await readPlainWorkspaceTreeSnapshot({root});

        expect(snapshot.nodes.length).toBeGreaterThan(0);
        expect(snapshot.issues).toEqual([]);
    });

    it("Project Workspace tree snapshot 失效后会重新读取文件与 issues", async () => {
        const before = await readProjectWorkspaceTreeSnapshot({root});
        await writeMarkdown("lorebook/note/cache-refresh/index.md", {
            type: "note",
            status: "draft",
        });

        invalidateProjectWorkspaceIndexAfterMutation({root});
        const after = await readProjectWorkspaceTreeSnapshot({root});

        expect(before.nodes.some((node) => node.path === "lorebook/note/cache-refresh/")).toBe(false);
        expect(after.nodes.some((node) => node.path === "lorebook/note/cache-refresh/")).toBe(true);
        expect(after.revision).toBeGreaterThan(before.revision);
        expect(after.issues.some((issue) => issue.path === "lorebook/note/cache-refresh/")).toBe(true);
    });

    it("Project Workspace tree index 会 watch 外部新增文件并自动更新缓存", async () => {
        const before = await readProjectWorkspaceTreeSnapshot({root});
        await fs.mkdir(path.join(root, "reference", "silly-tavern"), {recursive: true});
        await fs.writeFile(path.join(root, "reference", "silly-tavern", "cache-refresh.md"), "外部导入素材\n", "utf-8");

        const refreshed = await waitForProjectWorkspaceTreePath("reference/silly-tavern/cache-refresh.md");

        expect(before.nodes.some((node) => node.path === "reference/silly-tavern/cache-refresh.md")).toBe(false);
        expect(refreshed.nodes.some((node) => node.path === "reference/silly-tavern/cache-refresh.md")).toBe(true);
        expect(refreshed.revision).toBeGreaterThan(before.revision);
    });

    it("Project Workspace mutation 失效后会通过同一套 index 重建缓存", async () => {
        const before = await readProjectWorkspaceTreeSnapshot({root});
        await writeMarkdown("lorebook/note/mutation-rebuild/index.md", {
            type: "note",
            status: "draft",
        });

        invalidateProjectWorkspaceIndexAfterMutation({root});
        const refreshed = await waitForProjectWorkspaceTreePath("lorebook/note/mutation-rebuild/");

        expect(before.nodes.some((node) => node.path === "lorebook/note/mutation-rebuild/")).toBe(false);
        expect(refreshed.nodes.some((node) => node.path === "lorebook/note/mutation-rebuild/")).toBe(true);
        expect(refreshed.revision).toBeGreaterThan(before.revision);
    });

    it("Project Workspace rebuild 期间发生 mutation 不会被旧 build 清掉 dirty", async () => {
        await readProjectWorkspaceTreeSnapshot({root});
        await writeMarkdown("lorebook/note/first-mutation/index.md", {
            type: "note",
            status: "draft",
        });

        let hookCalled = false;
        setProjectWorkspaceIndexCommitHookForTest(async () => {
            if (hookCalled) {
                return;
            }
            hookCalled = true;
            await writeMarkdown("lorebook/note/second-mutation/index.md", {
                type: "note",
                status: "draft",
            });
            invalidateProjectWorkspaceIndexAfterMutation({root});
        });

        invalidateProjectWorkspaceIndexAfterMutation({root});
        const first = await readProjectWorkspaceTreeSnapshot({root});
        setProjectWorkspaceIndexCommitHookForTest(null);
        const second = await readProjectWorkspaceTreeSnapshot({root});

        expect(first.nodes.some((node) => node.path === "lorebook/note/first-mutation/")).toBe(true);
        expect(first.nodes.some((node) => node.path === "lorebook/note/second-mutation/")).toBe(false);
        expect(second.nodes.some((node) => node.path === "lorebook/note/second-mutation/")).toBe(true);
        expect(second.revision).toBeGreaterThan(first.revision);
    });

    it("user-assets tree index 会 watch 外部新增文件且保持 issues 为空", async () => {
        const before = await readPlainWorkspaceTreeSnapshot({root});
        await fs.mkdir(path.join(root, "templates"), {recursive: true});
        await fs.writeFile(path.join(root, "templates", "user-template.md"), "# 用户模板\n", "utf-8");

        const refreshed = await waitForPlainWorkspaceTreePath("templates/user-template.md");

        expect(before.nodes.some((node) => node.path === "templates/user-template.md")).toBe(false);
        expect(refreshed.nodes.some((node) => node.path === "templates/user-template.md")).toBe(true);
        expect(refreshed.issues).toEqual([]);
        expect(refreshed.revision).toBeGreaterThan(before.revision);
    });

    it("project.yaml 格式错误时仍允许解析 Project Workspace 根目录", async () => {
        const projectPath = `workspace/workspace-files-test-${randomUUID()}`;
        const projectRoot = path.join("workspace", projectPath.split("/").at(-1) ?? "");

        try {
            await fs.mkdir(projectRoot, {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n", "utf-8");

            await expect(resolveWorkspaceRootInput({projectPath})).resolves.toBe(projectPath);
        } finally {
            await removeDirectoryWithRetry(projectRoot);
        }
    });

    it("Project Workspace tree snapshot 会把 project.yaml 格式错误报告为 issue", async () => {
        await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n", "utf-8");

        const snapshot = await readProjectWorkspaceTreeSnapshot({root});

        expect(snapshot.nodes.some((node) => node.path === "project.yaml")).toBe(true);
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "invalid-project-manifest",
                path: "project.yaml",
            }),
        ]));
    });

    it("Project Workspace 列表遇到坏 project.yaml 时不会整批失败", async () => {
        const projectPath = `workspace/workspace-files-test-${randomUUID()}`;
        const projectRoot = path.join("workspace", projectPath.split("/").at(-1) ?? "");

        try {
            await fs.mkdir(projectRoot, {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n", "utf-8");

            const projects = await listProjectWorkspaces();
            const project = projects.find((item) => item.projectPath === projectPath);

            expect(project?.title).toBe(projectPath.split("/").at(-1));
            expect(project?.manifestError).toContain("Implicit map keys");
        } finally {
            await removeDirectoryWithRetry(projectRoot);
        }
    });

    it("Project manifest 更新在 project.yaml 损坏时可以覆盖写回合法 YAML", async () => {
        const projectPath = `workspace/workspace-files-test-${randomUUID()}`;
        const projectRoot = path.join("workspace", projectPath.split("/").at(-1) ?? "");

        try {
            await fs.mkdir(projectRoot, {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 测试\nsummary: \"\"\na'a\n", "utf-8");

            const result = await updateNovelByTool(projectPath, {
                title: "修复后的标题",
                summary: "修复后的简介",
            });

            await expect(readProjectManifest(projectPath)).resolves.toEqual({
                kind: "novel",
                title: "修复后的标题",
                summary: "修复后的简介",
            });
            expect(result.title).toBe("修复后的标题");
        } finally {
            await removeDirectoryWithRetry(projectRoot);
        }
    });

    it("Project manifest 更新遇到 IO 错误时不会按坏 YAML 兜底覆盖", async () => {
        const projectPath = `workspace/workspace-files-test-${randomUUID()}`;
        const projectRoot = path.join("workspace", projectPath.split("/").at(-1) ?? "");

        try {
            await fs.mkdir(projectRoot, {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 原标题\nsummary: 原简介\n", "utf-8");
            const originalReadFile = fs.readFile;
            const readFile = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
                if (String(filePath).endsWith("project.yaml")) {
                    const error = new Error("permission denied") as NodeJS.ErrnoException;
                    error.code = "EACCES";
                    throw error;
                }
                return originalReadFile(filePath, options);
            });

            try {
                await expect(updateNovelByTool(projectPath, {title: "不应写入"})).rejects.toMatchObject({code: "EACCES"});
            } finally {
                readFile.mockRestore();
            }
            await expect(readProjectManifest(projectPath)).resolves.toEqual({
                kind: "novel",
                title: "原标题",
                summary: "原简介",
            });
        } finally {
            await removeDirectoryWithRetry(projectRoot);
        }
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
        expect((properties.inject.properties as Record<string, Record<string, unknown>>).profiles.description).toContain("用户自定义 profile key");
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

    it("workspace node validate 在 Workspace Root 下接受 workspace/<project>/... 路径", async () => {
        const {stderr} = await execFileAsync("bun", [
            AGENT_WORKSPACE_SCRIPT_PATH,
            "node",
            "validate",
            "workspace/silver-dragon-hime/manuscript/001-荒野觉醒/001-祭坛苏醒/",
        ], {
            cwd: "workspace",
            encoding: "utf-8",
        });

        expect(stderr).toBe("");
    });

    it("workspace project create 能给已有 Project Workspace 补入 roleplay 模板", async () => {
        const workspaceSlug = `roleplay-template-test-${randomUUID()}`;
        const projectRoot = path.join("workspace", workspaceSlug);
        const existingGm = "# 用户自定义 GM\n";

        try {
            await fs.mkdir(path.join(projectRoot, "roleplay"), {recursive: true});
            await fs.writeFile(path.join(projectRoot, "project.yaml"), YAML.stringify({
                kind: "novel",
                title: "RP 模板测试",
                summary: "测试已存在 Project Workspace 安装 roleplay 模板",
            }), "utf-8");
            await fs.writeFile(path.join(projectRoot, "roleplay", "gm.md"), existingGm, "utf-8");

            const {stdout, stderr} = await execFileAsync("bun", [
                AGENT_WORKSPACE_SCRIPT_PATH,
                "project",
                "create",
                workspaceSlug,
                "--template",
                "roleplay-directory-templates",
                "--json",
            ], {
                cwd: "workspace",
                encoding: "utf-8",
            });
            const result = JSON.parse(stdout) as {
                mode: string;
                projectPath: string;
                createdFiles: string[];
                skippedFiles: string[];
            };

            expect(stderr).toBe("");
            expect(result.mode).toBe("updated");
            expect(result.projectPath).toBe(`workspace/${workspaceSlug}`);
            expect(result.createdFiles).toEqual(expect.arrayContaining([
                "roleplay/AGENTS.md",
                "roleplay/cast.yaml",
                "roleplay/actors/player/knowledge.md",
                "roleplay/actors/sample-npc/actor.md",
            ]));
            expect(result.skippedFiles).toContain("roleplay/gm.md");
            await expect(fs.readFile(path.join(projectRoot, "roleplay", "gm.md"), "utf-8")).resolves.toBe(existingGm);
            await expect(fs.readFile(path.join(projectRoot, "roleplay", "AGENTS.md"), "utf-8")).resolves.toContain("leader.rp");
            await expect(fs.readFile(path.join(projectRoot, "roleplay", "cast.yaml"), "utf-8")).resolves.toContain("sample-npc");

            await expect(execFileAsync("bun", [
                AGENT_WORKSPACE_SCRIPT_PATH,
                "project",
                "create",
                workspaceSlug,
                "--json",
            ], {
                cwd: "workspace",
                encoding: "utf-8",
            })).rejects.toMatchObject({
                stderr: expect.stringContaining("显式传入 --template"),
            });
        } finally {
            await removeDirectoryWithRetry(projectRoot);
        }
    }, 30_000);

    it("角色内容节点模板包含 frontmatter 注释与正文结构", async () => {
        await withSystemTemplate("templates/content-node-templates/character/index.md", () => {
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
            expect(content).toContain("leader.default");
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
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "content-node-templates", "character", "index.md");
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
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const staleArtifactPath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "old-hash-artifact.mjs");
        const staleTypePath = path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "old-hash-artifact.types.d.ts");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const staleArtifactBackup = await backupOptionalFile(staleArtifactPath);
        const staleTypeBackup = await backupOptionalFile(staleTypePath);
        await fs.rm(userProfilePath, {force: true});
        await fs.mkdir(path.dirname(staleArtifactPath), {recursive: true});
        await fs.writeFile(staleArtifactPath, "export default {};\n", "utf-8");
        await fs.writeFile(staleTypePath, "export {};\n", "utf-8");

        try {
            const result = await syncSystemAssetsToUserAssets();
            const content = await fs.readFile(userProfilePath, "utf-8");
            const systemContent = await fs.readFile(systemProfilePath, "utf-8");

            expect(result.updatedProfiles).toBeGreaterThan(0);
            expect(content).toBe(systemContent);
            expect(content).toContain("profileManifest");
            expect(content).toContain("export default");
            const manifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {profiles: Array<{fileName: string; sourceSha256: string; artifactFileName: string; artifactSha256: string; typeFileName?: string; dependencies: Array<{path: string; sha256: string}>}>};
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx");
            expect(item?.sourceSha256).toBe(await sha256ForTest(userProfilePath));
            expect(item?.dependencies.find((dependency) => dependency.path === "workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx")?.sha256).toBe(item?.sourceSha256);
            expect(item?.typeFileName).toMatch(/types\.d\.ts$/);
            expect(await sha256ForTest(path.join("workspace", ".nbook", "agent", "profiles", ".compiled", item!.artifactFileName))).toBe(item.artifactSha256);
            await expect(fs.readFile(path.join("workspace", ".nbook", "agent", "profiles", ".compiled", item!.typeFileName!), "utf-8")).resolves.toContain("ProfileVariableValueMap");
            await expect(fs.access(staleArtifactPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(staleTypePath)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
            await restoreOptionalFile(staleArtifactPath, staleArtifactBackup);
            await restoreOptionalFile(staleTypePath, staleTypeBackup);
        }
    });

    it("同步系统 assets 会修复用户 profile manifest 与 artifact 不一致", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.copyFile(systemProfilePath, userProfilePath);
            await syncSystemAssetsToUserAssets();
            const manifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {profiles: Array<{fileName: string; artifactFileName: string; artifactSha256: string}>};
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;
            await fs.writeFile(path.join(userCompiledRoot, item.artifactFileName), "export default {};\n", "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const nextManifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {profiles: Array<{fileName: string; artifactFileName: string; artifactSha256: string}>};
            const nextItem = nextManifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;

            expect(result.profileWarnings ?? []).toEqual([]);
            expect(await sha256ForTest(path.join(userCompiledRoot, nextItem.artifactFileName))).toBe(nextItem.artifactSha256);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 不覆盖已手改用户 profile artifact", async () => {
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", "builtin", "leader.default.profile.tsx");
        const userCompiledRoot = path.join("workspace", ".nbook", "agent", "profiles", ".compiled");
        const userCompiledManifestPath = path.join(userCompiledRoot, "manifest.json");
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await syncSystemAssetsToUserAssets();
            const manifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {profiles: Array<{fileName: string; artifactFileName: string}>};
            const item = manifest.profiles.find((profile) => profile.fileName === "builtin/leader.default.profile.tsx")!;
            const artifactPath = path.join(userCompiledRoot, item.artifactFileName);
            await fs.appendFile(userProfilePath, "\n// user custom change\n", "utf-8");
            await fs.writeFile(artifactPath, "export default { custom: true };\n", "utf-8");
            const beforeArtifact = await fs.readFile(artifactPath, "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.profileWarnings?.some((warning) => warning.fileName === "builtin/leader.default.profile.tsx")).toBe(false);
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toContain("user custom change");
            await expect(fs.readFile(artifactPath, "utf-8")).resolves.toBe(beforeArtifact);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("系统 profile 更新且用户覆盖已手改时会返回可查看 diff 的 warning", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        const syncedContent = await fs.readFile(systemProfilePath, "utf-8");
        const syncedHash = createHash("sha256").update(syncedContent).digest("hex");

        try {
            await fs.mkdir(path.dirname(userProfilePath), {recursive: true});
            await fs.writeFile(userProfilePath, `${syncedContent}\n// user custom change\n`, "utf-8");
            await fs.writeFile(userSyncStatePath, JSON.stringify({
                profiles: [{
                    fileName,
                    profileKey: "leader.default",
                    upstreamHash: "old-upstream-hash",
                    lastSyncedUserHash: syncedHash,
                    syncedAt: new Date(0).toISOString(),
                }],
                assets: [],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.profileWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({fileName, profileKey: "leader.default"}),
            ]));
            await expect(fs.readFile(userProfilePath, "utf-8")).resolves.toContain("user custom change");
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("可以读取用户 profile 覆盖的系统版本 diff 内容", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const userProfilePath = path.join("workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const systemProfilePath = path.join("assets", "workspace", ".nbook", "agent", "profiles", ...fileName.split("/"));
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backup = await backupOptionalFile(userProfilePath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);

        try {
            await syncSystemAssetsToUserAssets();
            await fs.appendFile(userProfilePath, "\n// user diff detail marker\n", "utf-8");

            const detail = await readUserAssetsSyncConflictDetail({kind: "profile", fileName});

            expect(detail.kind).toBe("profile");
            expect(detail.fileName).toBe(fileName);
            expect(detail.userContent).toContain("user diff detail marker");
            expect(detail.systemContent).toBe(await fs.readFile(systemProfilePath, "utf-8"));
            expect(detail.language).toBe("typescript");
            expect(detail.userSha256).toBe(await sha256ForTest(userProfilePath));
            expect(detail.systemSha256).toBe(await sha256ForTest(systemProfilePath));
            expect(detail.userBytes).toBeGreaterThan(0);
            expect(detail.systemBytes).toBeGreaterThan(0);
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userProfilePath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("拒绝读取越界的用户资产同步 diff 路径", async () => {
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "../config.json",
        })).rejects.toThrow("assetPath 不能为空或包含非法片段");
    });

    it("拒绝读取黑名单内的用户资产同步 diff 路径", async () => {
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "config.json",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "agent/sessions/1.jsonl",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
        await expect(readUserAssetsSyncConflictDetail({
            kind: "asset",
            assetPath: "agent/profiles/.compiled/manifest.json",
        })).rejects.toThrow("assetPath 不属于可读取的系统同步资源");
    });

    it("同步系统 assets 会清理用户变量定义旧 compiled artifact", async () => {
        const userVariablePath = path.join("workspace", ".nbook", "agent", "variables", "definitions.ts");
        const userCompiledManifestPath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "manifest.json");
        const staleArtifactPath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "old-hash-definition.mjs");
        const staleTypePath = path.join("workspace", ".nbook", "agent", "variables", ".compiled", "old-hash-definition.types.d.ts");
        const variableBackup = await backupOptionalFile(userVariablePath);
        const manifestBackup = await backupOptionalFile(userCompiledManifestPath);
        const staleArtifactBackup = await backupOptionalFile(staleArtifactPath);
        const staleTypeBackup = await backupOptionalFile(staleTypePath);
        await fs.rm(userVariablePath, {force: true});
        await fs.mkdir(path.dirname(staleArtifactPath), {recursive: true});
        await fs.writeFile(staleArtifactPath, "export default [];\n", "utf-8");
        await fs.writeFile(staleTypePath, "export {};\n", "utf-8");

        try {
            const result = await syncSystemAssetsToUserAssets();
            const manifest = JSON.parse(await fs.readFile(userCompiledManifestPath, "utf-8")) as {definitions: Array<{fileName: string; artifactFileName: string; typeFileName?: string}>};
            const item = manifest.definitions.find((definition) => definition.fileName === "definitions.ts");

            expect(result.updatedAssets).toBeGreaterThan(0);
            expect(item?.artifactFileName).toBe("definitions.mjs");
            expect(item?.typeFileName).toBe("definitions.types.d.ts");
            await expect(fs.readFile(path.join("workspace", ".nbook", "agent", "variables", ".compiled", item!.artifactFileName), "utf-8")).resolves.toContain("definitions_default");
            await expect(fs.readFile(path.join("workspace", ".nbook", "agent", "variables", ".compiled", item.typeFileName!), "utf-8")).resolves.toContain("ProfileVariableValueMap");
            await expect(fs.access(staleArtifactPath)).rejects.toMatchObject({code: "ENOENT"});
            await expect(fs.access(staleTypePath)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await restoreOptionalFile(userVariablePath, variableBackup);
            await restoreOptionalFile(userCompiledManifestPath, manifestBackup);
            await restoreOptionalFile(staleArtifactPath, staleArtifactBackup);
            await restoreOptionalFile(staleTypePath, staleTypeBackup);
        }
    });

    it("可以读取用户变量定义覆盖的系统版本 diff 内容", async () => {
        const assetPath = "agent/variables/definitions.ts";
        const userVariablePath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemVariablePath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const variableBackup = await backupOptionalFile(userVariablePath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);

        try {
            await syncSystemAssetsToUserAssets();
            await fs.appendFile(userVariablePath, "\n// user variable diff marker\n", "utf-8");

            const detail = await readUserAssetsSyncConflictDetail({kind: "asset", assetPath});

            expect(detail.kind).toBe("asset");
            expect(detail.assetPath).toBe(assetPath);
            expect(detail.userContent).toContain("user variable diff marker");
            expect(detail.systemContent).toBe(await fs.readFile(systemVariablePath, "utf-8"));
            expect(detail.language).toBe("typescript");
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userVariablePath, variableBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会补齐 Agent runtime bin、scripts 和 config", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "bin", "workspace"),
            path.join("workspace", ".nbook", "agent", "bin", "workspace.cmd"),
            path.join("workspace", ".nbook", "agent", "scripts", "workspace.ts"),
            path.join("workspace", ".nbook", "agent", "config", "ripgreprc"),
        ];
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            const result = await syncSystemAssetsToUserAssets();

            expect(result.copied).toBeGreaterThanOrEqual(paths.length);
            await expect(fs.readFile(paths[0]!, "utf-8")).resolves.toContain("../scripts/workspace.ts");
            await expect(fs.readFile(paths[1]!, "utf-8")).resolves.toContain("..\\scripts\\workspace.ts");
            const scriptContent = await fs.readFile(paths[2]!, "utf-8");
            expect(scriptContent).toContain(".name(\"workspace\")");
            expect(scriptContent).toContain(".command(\"node\")");
            await expect(fs.readFile(paths[3]!, "utf-8")).resolves.toContain("--path-separator=/");
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
        }
    });

    it("同步系统 assets 会补齐 writing presets 并记录同步状态", async () => {
        const userPresetPath = path.join("workspace", ".nbook", "agent", "writing-presets", "styles", "reborn-villain-loli-magic-girl.first-three-chapters.style.md");
        const userSyncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backup = await backupOptionalFile(userPresetPath);
        const syncStateBackup = await backupOptionalFile(userSyncStatePath);
        await fs.rm(userPresetPath, {force: true});

        try {
            const result = await syncSystemAssetsToUserAssets();
            const content = await fs.readFile(userPresetPath, "utf-8");
            const syncState = JSON.parse(await fs.readFile(userSyncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};

            expect(result.copied + (result.updatedAssets ?? 0)).toBeGreaterThanOrEqual(1);
            expect(content).toContain("key: reborn-villain-loli-magic-girl.first-three-chapters.style");
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/writing-presets/styles/reborn-villain-loli-magic-girl.first-three-chapters.style.md"}),
            ]));
        } finally {
            await restoreOptionalFile(userPresetPath, backup);
            await restoreOptionalFile(userSyncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会保留缺少 sync state 的手改 Agent runtime 文件", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "bin", "workspace"),
            path.join("workspace", ".nbook", "agent", "bin", "workspace.cmd"),
            path.join("workspace", ".nbook", "agent", "scripts", "workspace.ts"),
        ];
        const sentinels = [
            "#!/usr/bin/env sh\necho user-bin-preserved\n",
            "@echo off\necho user-cmd-preserved\n",
            "console.log('user-script-preserved');\n",
        ];
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const syncStateBackup = await backupOptionalFile(syncStatePath);

        try {
            await fs.mkdir(path.dirname(syncStatePath), {recursive: true});
            await fs.writeFile(syncStatePath, JSON.stringify({profiles: [], assets: []}, null, 2), "utf-8");
            for (const [index, filePath] of paths.entries()) {
                await fs.mkdir(path.dirname(filePath), {recursive: true});
                await fs.writeFile(filePath, sentinels[index] ?? "", "utf-8");
            }

            const result = await syncSystemAssetsToUserAssets();

            for (const [index, filePath] of paths.entries()) {
                await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(sentinels[index]);
            }
            expect(result.assetWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/bin/workspace"}),
                expect.objectContaining({assetPath: "agent/bin/workspace.cmd"}),
                expect.objectContaining({assetPath: "agent/scripts/workspace.ts"}),
            ]));
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会更新仍跟随上游的 Agent runtime script", async () => {
        const userScriptPath = path.join("workspace", ".nbook", "agent", "scripts", "workspace.ts");
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const scriptBackup = await backupOptionalFile(userScriptPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const previousScript = "console.log('old runtime script');\n";
        const previousHash = createHash("sha256").update(previousScript).digest("hex");

        try {
            await fs.mkdir(path.dirname(userScriptPath), {recursive: true});
            await fs.writeFile(userScriptPath, previousScript, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath: "agent/scripts/workspace.ts",
                    upstreamHash: previousHash,
                    lastSyncedUserHash: previousHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            const content = await fs.readFile(userScriptPath, "utf-8");
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            expect(result.updatedAssets).toBeGreaterThanOrEqual(1);
            expect(content).toContain(".command(\"project\")");
            expect(content).toContain(".command(\"create\")");
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/scripts/workspace.ts"}),
            ]));
        } finally {
            await restoreOptionalFile(userScriptPath, scriptBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "skills", "profile-system-guide", "SKILL.md"),
            path.join("workspace", ".nbook", "templates", "content-node-templates", "chapter", "index.md"),
            path.join("workspace", ".nbook", "templates", "roleplay-directory-templates", "roleplay", "AGENTS.md"),
            path.join("workspace", ".nbook", "agent", "bin", "profile"),
            path.join("workspace", ".nbook", "agent", "config", "ripgreprc"),
        ];
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            const result = await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};

            expect(result.copied).toBeGreaterThanOrEqual(paths.length);
            await expect(fs.readFile(paths[0]!, "utf-8")).resolves.toContain("profile");
            await expect(fs.readFile(paths[1]!, "utf-8")).resolves.toContain("chapter");
            await expect(fs.readFile(paths[2]!, "utf-8")).resolves.toContain("leader.rp");
            await expect(fs.readFile(paths[3]!, "utf-8")).resolves.toContain("../scripts/profile.ts");
            await expect(fs.readFile(paths[4]!, "utf-8")).resolves.toContain("--path-separator=/");
            expect(syncState.assets).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath: "agent/skills/profile-system-guide/SKILL.md"}),
                expect.objectContaining({assetPath: "templates/content-node-templates/chapter/index.md"}),
                expect.objectContaining({assetPath: "templates/roleplay-directory-templates/roleplay/AGENTS.md"}),
                expect.objectContaining({assetPath: "agent/bin/profile"}),
                expect.objectContaining({assetPath: "agent/config/ripgreprc"}),
            ]));
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 会更新仍跟随上游的 Agent skill", async () => {
        const assetPath = "agent/skills/profile-system-guide/SKILL.md";
        const userSkillPath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemSkillPath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const skillBackup = await backupOptionalFile(userSkillPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const previousSkill = "# Old skill\n";
        const previousHash = createHash("sha256").update(previousSkill).digest("hex");

        try {
            await fs.mkdir(path.dirname(userSkillPath), {recursive: true});
            await fs.writeFile(userSkillPath, previousSkill, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath,
                    upstreamHash: previousHash,
                    lastSyncedUserHash: previousHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();

            expect(result.updatedAssets).toBeGreaterThanOrEqual(1);
            await expect(fs.readFile(userSkillPath, "utf-8")).resolves.toBe(await fs.readFile(systemSkillPath, "utf-8"));
        } finally {
            await restoreOptionalFile(userSkillPath, skillBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("系统 skill 更新且用户覆盖已手改时会返回可查看 diff 的 warning", async () => {
        const assetPath = "agent/skills/profile-system-guide/SKILL.md";
        const userSkillPath = path.join("workspace", ".nbook", ...assetPath.split("/"));
        const systemSkillPath = path.join("assets", "workspace", ".nbook", ...assetPath.split("/"));
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const skillBackup = await backupOptionalFile(userSkillPath);
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        const systemContent = await fs.readFile(systemSkillPath, "utf-8");
        const syncedHash = createHash("sha256").update(systemContent).digest("hex");

        try {
            await fs.mkdir(path.dirname(userSkillPath), {recursive: true});
            await fs.writeFile(userSkillPath, `${systemContent}\n<!-- user skill change -->\n`, "utf-8");
            await fs.writeFile(syncStatePath, JSON.stringify({
                profiles: [],
                assets: [{
                    assetPath,
                    upstreamHash: "old-upstream-hash",
                    lastSyncedUserHash: syncedHash,
                    syncedAt: new Date(0).toISOString(),
                }],
            }, null, 2), "utf-8");

            const result = await syncSystemAssetsToUserAssets();
            const detail = await readUserAssetsSyncConflictDetail({kind: "asset", assetPath});

            expect(result.assetWarnings).toEqual(expect.arrayContaining([
                expect.objectContaining({assetPath}),
            ]));
            expect(detail.kind).toBe("asset");
            expect(detail.assetPath).toBe(assetPath);
            expect(detail.systemContent).toBe(systemContent);
            expect(detail.userContent).toContain("user skill change");
            expect(detail.language).toBe("markdown");
            expect(detail.diffable).toBe(true);
        } finally {
            await restoreOptionalFile(userSkillPath, skillBackup);
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("同步系统 assets 不会把本地状态和 compiled 产物纳入 managed sync", async () => {
        const paths = [
            path.join("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json"),
            path.join("workspace", ".nbook", "agent", "variables", ".compiled", "manifest.json"),
            path.join("workspace", ".nbook", "agent", "profiles", ".system-profile-metadata.json"),
        ];
        const syncStatePath = path.join("workspace", ".nbook", "agent", "profiles", ".profile-sync-state.json");
        const backups = await Promise.all(paths.map((filePath) => backupOptionalFile(filePath)));
        const syncStateBackup = await backupOptionalFile(syncStatePath);
        await Promise.all(paths.map((filePath) => fs.rm(filePath, {force: true})));

        try {
            await syncSystemAssetsToUserAssets();
            const syncState = JSON.parse(await fs.readFile(syncStatePath, "utf-8")) as {assets?: Array<{assetPath: string}>};
            const assetPaths = syncState.assets?.map((asset) => asset.assetPath) ?? [];

            expect(assetPaths.some((assetPath) => assetPath.includes("/.compiled/"))).toBe(false);
            expect(assetPaths).not.toContain("agent/profiles/.system-profile-metadata.json");
            await expect(fs.access(paths[2]!)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            for (const [index, filePath] of paths.entries()) {
                await restoreOptionalFile(filePath, backups[index] ?? null);
            }
            await restoreOptionalFile(syncStatePath, syncStateBackup);
        }
    });

    it("小说目录模板会创建最小 lorebook 骨架且通过内容节点校验", async () => {
        await withSystemTemplate("templates/novel-directory-templates/lorebook/rule/writing-style/index.md", async () => {
            await copyNovelDirectoryTemplate(root);
        });

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
        await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toContain("`.agent/plan/` 保存 Agent 计划");
        await expect(readWorkspaceTextFile(root, ".nbook/icons.json")).resolves.toContain("\"lorebook\"");
        await expect(fs.access(path.join(root, ".agent/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(fs.access(path.join(root, ".agent/plan/.gitkeep")).then(() => true)).resolves.toBe(true);
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-positioning/index.md")).resolves.toContain("## 类型与基调");
        await expect(readWorkspaceTextFile(root, "lorebook/note/project-positioning/index.md")).resolves.toContain("- 小说初始化");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("## 故事概述");
        await expect(readWorkspaceTextFile(root, "lorebook/note/story-concept/index.md")).resolves.toContain("长简介式作品介绍");
        await expect(readWorkspaceTextFile(root, "lorebook/rule/writing-style/index.md")).resolves.toContain("inject:");
        await expect(readWorkspaceTextFile(root, "lorebook/rule/writing-style/index.md")).resolves.toContain("文风约束通常给默认 profile");
        await expect(readWorkspaceTextFile(root, "lorebook/note/initial-plot-seed/index.md")).resolves.toContain("剧情种子通常不直接注入");
        await expect(readWorkspaceTextFile(root, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("## 正文草稿");
        await expect(readWorkspaceTextFile(root, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("- 开局示例");

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
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, "templates", "novel-directory-templates", "PROJECT-STATUS.md");
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.mkdir(path.dirname(userTemplatePath), {recursive: true});
        await fs.writeFile(userTemplatePath, "# 用户覆盖状态模板\n", "utf-8");

        try {
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toBe("# 用户覆盖状态模板\n");
            await expect(fs.access(path.join(root, "workspace.yaml"))).rejects.toMatchObject({code: "ENOENT"});

            await writeWorkspaceTextFile(root, "PROJECT-STATUS.md", "# 小说自己的状态\n");
            await copyNovelDirectoryTemplate(root);
            await expect(readWorkspaceTextFile(root, "PROJECT-STATUS.md")).resolves.toBe("# 小说自己的状态\n");
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    });

    it("创建 Project Workspace 时会写入 manifest、初始化 Project SQLite 并加载模板", async () => {
        const workspaceSlug = `workspace-files-test-${randomUUID()}`;
        const projectPath = `workspace/${workspaceSlug}`;
        const createdRoot = path.join("workspace", workspaceSlug);

        await writeProjectManifest(projectPath, {
            kind: "novel",
            title: "测试小说",
            summary: "测试简介",
        });
        await copyNovelDirectoryTemplate(projectPath);
        await initProjectDatabase(projectPath);

        try {
            await expect(readProjectManifest(projectPath)).resolves.toEqual({
                kind: "novel",
                title: "测试小说",
                summary: "测试简介",
            });
            await expect(fs.access(path.join(createdRoot, "workspace.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(readWorkspaceTextFile(createdRoot, "AGENTS.md")).resolves.toContain("唯一的小说状态");
            await expect(readWorkspaceTextFile(createdRoot, "AGENTS.md")).resolves.toContain(".agent/plan/");
            await expect(readWorkspaceTextFile(createdRoot, "PROJECT-STATUS.md")).resolves.toContain("## Pending Questions");
            await expect(readWorkspaceTextFile(createdRoot, "PROJECT-STATUS.md")).resolves.not.toContain("## Recent Updates");
            await expect(readWorkspaceTextFile(createdRoot, "manuscript/001-volume/001-chapter/index.md")).resolves.toContain("示范章节");
        } finally {
            await removeDirectoryWithRetry(createdRoot);
        }
    }, 20_000);

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
     * 等待 Project Workspace index watcher 完成 debounce 重建。
     */
    async function waitForProjectWorkspaceTreePath(filePath: string): Promise<Awaited<ReturnType<typeof readProjectWorkspaceTreeSnapshot>>> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
            const snapshot = await readProjectWorkspaceTreeSnapshot({root});
            if (snapshot.nodes.some((node) => node.path === filePath)) {
                return snapshot;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`等待 Project Workspace tree index 更新超时: ${filePath}`);
    }

    /**
     * 等待 plain workspace index watcher 完成 debounce 重建。
     */
    async function waitForPlainWorkspaceTreePath(filePath: string): Promise<Awaited<ReturnType<typeof readPlainWorkspaceTreeSnapshot>>> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
            const snapshot = await readPlainWorkspaceTreeSnapshot({root});
            if (snapshot.nodes.some((node) => node.path === filePath)) {
                return snapshot;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`等待 user-assets tree index 更新超时: ${filePath}`);
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

    /**
     * 读取当前 Git HEAD 中的文件内容，用来模拟旧系统同步副本。
     */
    async function readGitHeadFile(filePath: string): Promise<string> {
        const {stdout} = await execFileAsync("git", ["show", `HEAD:${filePath}`], {
            cwd: process.cwd(),
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
        });
        return stdout;
    }

    /**
     * Windows 下 libsql 关闭 SQLite 后文件句柄可能短暂释放延迟，测试清理需要重试。
     */
    async function removeDirectoryWithRetry(dirPath: string): Promise<void> {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                await fs.rm(dirPath, {recursive: true, force: true});
                return;
            } catch (error) {
                if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EBUSY" || attempt === 19) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
            }
        }
    }

    /**
     * 计算文件 sha256，用于验证同步 manifest 是否绑定当前用户侧源码。
     */
    async function sha256ForTest(filePath: string): Promise<string> {
        return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    }

    /**
     * 临时移开用户覆盖模板，让断言只验证 bundled system template。
     */
    async function withSystemTemplate<T>(templateRelativePath: string, callback: () => T | Promise<T>): Promise<T> {
        const userTemplatePath = path.join(USER_ASSETS_WORKSPACE_ROOT, templateRelativePath);
        const backup = await backupOptionalFile(userTemplatePath);
        await fs.rm(userTemplatePath, {force: true});
        try {
            return await callback();
        } finally {
            await restoreOptionalFile(userTemplatePath, backup);
        }
    }
});
