import fs from "node:fs/promises";
import {assertNovel, requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";

/**
 * 删除 Project Workspace 目录。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPathQuery(event);
    await assertNovel(projectPath);
    await fs.rm(resolveProjectAbsolutePath(projectPath), {recursive: true, force: true});

    return {success: true};
});
