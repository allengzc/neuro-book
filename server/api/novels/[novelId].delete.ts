import {requireProjectPath} from "nbook/server/utils/novel-chapter";
import {deleteProjectWorkspace} from "nbook/server/workspace-files/project-workspace-delete";

/**
 * 删除 Project Workspace 目录。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPath(event);
    await deleteProjectWorkspace(projectPath);

    return {
        success: true,
    };
});
