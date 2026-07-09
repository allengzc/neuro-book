import {
    CreateNovelRequestDtoSchema,
    type CreateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {invalidateNovelListCache, toNovelResponse, validateBody} from "nbook/server/utils/novel-chapter";
import {buildWorkspaceSlugBase, copyNovelDirectoryTemplate} from "nbook/server/workspace-files/novel-workspace";
import {initProjectDatabase, listProjectWorkspaces, projectWorkspaceDirectoryExists, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";

/**
 * 新建 Project Workspace。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CreateNovelRequestDto>(event, CreateNovelRequestDtoSchema);
    const projectPath = await allocateProjectPath(body.title);
    const now = new Date().toISOString();

    await writeProjectManifest(projectPath, {
        kind: "novel",
        title: body.title,
        summary: body.summary ?? "",
    });
    await copyNovelDirectoryTemplate(projectPath);
    await initProjectDatabase(projectPath);
    invalidateNovelListCache();

    return toNovelResponse({
        projectPath,
        title: body.title,
        summary: body.summary ?? "",
        updatedAt: now,
    });
});

async function allocateProjectPath(title: string): Promise<string> {
    const base = buildWorkspaceSlugBase(title);
    const existing = new Set((await listProjectWorkspaces()).map((project) => project.projectPath));
    let suffix = 0;
    while (true) {
        const slug = suffix === 0 ? base : `${base}-${String(suffix + 1)}`;
        const projectPath = `workspace/${slug}`;
        if (!existing.has(projectPath) && !(await projectWorkspaceDirectoryExists(projectPath))) {
            return projectPath;
        }
        suffix += 1;
    }
}
