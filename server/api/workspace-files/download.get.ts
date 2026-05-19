import {createError, sendStream, setResponseHeader} from "h3";
import {createWorkspaceZipStream} from "nbook/server/workspace-files/workspace-archive";
import {
    USER_ASSETS_WORKSPACE_KIND,
    USER_ASSETS_WORKSPACE_ROOT,
    ensureUserAssetsWorkspaceRoot,
    resolveNovelWorkspaceRoot,
} from "nbook/server/workspace-files/novel-workspace";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 打包下载当前小说 workspace。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const novelId = typeof query.novelId === "string" ? query.novelId : undefined;
    const workspaceKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? query.workspaceKind : undefined;
    if (workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        await ensureUserAssetsWorkspaceRoot();
        const archive = await createWorkspaceZipStream(USER_ASSETS_WORKSPACE_ROOT);
        return sendArchive(event, archive);
    }
    if (!novelId?.trim()) {
        throw createError({statusCode: 400, message: "novelId 不能为空"});
    }

    const workspaceRoot = await resolveNovelWorkspaceRoot(prisma, novelId);
    const archive = await createWorkspaceZipStream(workspaceRoot);
    return sendArchive(event, archive);
});

/**
 * 发送 workspace 压缩包。
 */
function sendArchive(event: Parameters<typeof setResponseHeader>[0], archive: Awaited<ReturnType<typeof createWorkspaceZipStream>>) {
    const filename = encodeURIComponent(archive.filename);

    setResponseHeader(event, "Content-Type", "application/zip");
    setResponseHeader(event, "Content-Disposition", `attachment; filename="${archive.filename}"; filename*=UTF-8''${filename}`);
    return sendStream(event, archive.stream);
}
