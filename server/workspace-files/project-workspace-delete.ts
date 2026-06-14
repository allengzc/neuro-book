import fs from "node:fs/promises";
import {closeAgentSqliteClient} from "nbook/server/agent/tools/sql-tool";
import {plotFacade} from "nbook/server/plot";
import {invalidateNovelListCache} from "nbook/server/utils/novel-chapter";
import {closeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import {
    assertProjectWorkspaceDirectory,
    resolveProjectAbsolutePath,
} from "nbook/server/workspace-files/project-workspace";

/**
 * 删除 Project Workspace。删除前统一释放当前进程里会占用 Project 目录的资源。
 */
export async function deleteProjectWorkspace(projectPath: string): Promise<void> {
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(projectPath);
    const projectRoot = resolveProjectAbsolutePath(normalizedProjectPath);

    await plotFacade.closeProject(normalizedProjectPath);
    await closeAgentSqliteClient(normalizedProjectPath);
    await closeWorkspaceTreeIndex(projectRoot);
    await fs.rm(projectRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    });
    invalidateNovelListCache();
}
