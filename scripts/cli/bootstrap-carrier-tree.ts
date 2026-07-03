import fs from "node:fs/promises";
import path from "node:path";
import {plotFacade} from "nbook/server/plot";

/**
 * 承载树 Bootstrap CLI。
 *
 * 把现有 Project Workspace 的 manuscript 目录结构导入 Plot 两棵树的承载侧:
 * 为每个 volume 目录建 StoryAct、每个 chapter 目录建 StoryChapter,并向 Prose 的 index.md
 * frontmatter 写入 `chapter: <name>` 反指。Scene.chapterPath → chapterId 的 DB 迁移由
 * initProjectDatabase 自动完成(facade 调用会先触发),本 CLI 只补承载树实体与文件指针。
 *
 * 幂等:同 name 的 Act/Chapter 不重建,已有 chapter 指针的 Prose 不改写,可反复运行。
 *
 * 用法:
 *   bun scripts/cli/bootstrap-carrier-tree.ts workspace/ming-ding-zhi-shi-2
 *   bun scripts/cli/bootstrap-carrier-tree.ts --all            # 扫描 workspace/ 下全部项目
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const projectPaths = args.includes("--all")
        ? await collectWorkspaceProjects()
        : args.filter((arg) => !arg.startsWith("--"));

    if (projectPaths.length === 0) {
        console.log("用法: bun scripts/cli/bootstrap-carrier-tree.ts <workspace/project-slug ...> | --all");
        process.exit(1);
    }

    for (const projectPath of projectPaths) {
        console.log(`\n▸ ${projectPath}`);
        try {
            const result = await plotFacade.bootstrapCarrierTree(projectPath);
            console.log(`  Act 新建 ${result.actsCreated}、Chapter 新建 ${result.chaptersCreated}、补卷归属 ${result.chaptersLinkedToAct}`);
            console.log(`  Prose frontmatter 写回 ${result.proseFrontmatterWritten.length} 处`);
            for (const written of result.proseFrontmatterWritten) {
                console.log(`    + ${written}`);
            }
            for (const warning of result.warnings) {
                console.warn(`  ! ${warning}`);
            }
        } catch (error) {
            console.error(`  ✗ 失败: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            await plotFacade.closeProject(projectPath);
        }
    }
}

/**
 * 扫描 workspace/ 下的一级项目目录(跳过隐藏目录)。
 */
async function collectWorkspaceProjects(): Promise<string[]> {
    const workspaceRoot = path.resolve(process.cwd(), "workspace");
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true}).catch(() => []);
    return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => `workspace/${entry.name}`)
        .sort();
}

await main();
