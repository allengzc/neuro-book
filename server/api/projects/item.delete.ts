import fs from "node:fs/promises";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {assertProjectWorkspaceDirectory, resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";

/**
 * 删除 Project Workspace 目录。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPathQuery(event);
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(projectPath);
    await fs.rm(resolveProjectAbsolutePath(normalizedProjectPath), {recursive: true, force: true});

    return {success: true};
});
