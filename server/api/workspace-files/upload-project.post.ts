import {createError, getRequestHeader, readMultipartFormData, type MultiPartData} from "h3";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {
    uploadWorkspaceProjectFiles,
    uploadWorkspaceProjectZip,
    WorkspaceUploadError,
    type WorkspaceUploadFile,
} from "nbook/server/workspace-files/workspace-upload";
import {recordUploadedFiles, USER_LOCAL_ACTOR} from "nbook/server/workspace-history/tracked-workspace-files";

/**
 * 上传 Project 文件夹或 zip 到当前挂载根。已有文件跳过。
 */
export default defineEventHandler(async (event) => {
    assertContentLengthLimit(event, 500 * 1024 * 1024, 8 * 1024 * 1024);
    const parts = await readRequiredMultipart(event);
    const workspaceKind = readTextPart(parts, "workspaceKind") === "user-assets" ? "user-assets" : undefined;
    const root = await resolveWorkspaceRootInput({
        projectPath: readTextPart(parts, "projectPath"),
        workspaceKind,
    });
    const mode = readTextPart(parts, "mode");

    if (mode === "zip") {
        const zipFile = firstFilePart(parts, "zip");
        assertZipFile(zipFile.filename ?? "");
        try {
            const result = await uploadWorkspaceProjectZip(root, {
                fileName: zipFile.filename ?? "project.zip",
                data: zipFile.data,
            });
            await recordUploadedFiles({root, files: result.files, actor: USER_LOCAL_ACTOR});
            invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind});
            return result;
        } catch (error) {
            throw toUploadError(error);
        }
    }

    const relativePaths = parts
        .filter((part) => part.name === "relativePath" && !part.filename)
        .map((part) => part.data.toString("utf-8").trim());
    let relativePathIndex = 0;
    const files = parts
        .filter((part) => part.name === "files" && part.filename)
        .map<WorkspaceUploadFile>((part) => ({
            fileName: part.filename ?? "upload.bin",
            relativePath: relativePaths[relativePathIndex++] || part.filename,
            data: part.data,
        }));
    if (!files.length) {
        throw createError({statusCode: 400, message: "缺少 Project 上传文件"});
    }
    try {
        const result = await uploadWorkspaceProjectFiles(root, files);
        await recordUploadedFiles({root, files: result.files, actor: USER_LOCAL_ACTOR});
        invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind});
        return result;
    } catch (error) {
        throw toUploadError(error);
    }
});

async function readRequiredMultipart(event: Parameters<typeof readMultipartFormData>[0]): Promise<MultiPartData[]> {
    const parts = await readMultipartFormData(event);
    if (!parts?.length) {
        throw createError({statusCode: 400, message: "multipart 表单不能为空"});
    }
    return parts;
}

function firstFilePart(parts: MultiPartData[], name: string): MultiPartData {
    const file = parts.find((part) => part.name === name && part.filename);
    if (!file) {
        throw createError({statusCode: 400, message: "缺少上传文件"});
    }
    return file;
}

function readTextPart(parts: MultiPartData[], name: string): string | undefined {
    const part = parts.find((item) => item.name === name && !item.filename);
    const value = part?.data.toString("utf-8").trim();
    return value || undefined;
}

function assertZipFile(fileName: string): void {
    if (!fileName.toLowerCase().endsWith(".zip")) {
        throw createError({statusCode: 400, message: "Project 压缩包只支持 .zip 文件"});
    }
}

function toUploadError(error: unknown): Error {
    if (error instanceof WorkspaceUploadError) {
        return createError({statusCode: error.statusCode, message: error.message});
    }
    return error instanceof Error ? error : new Error(String(error));
}

function assertContentLengthLimit(event: Parameters<typeof getRequestHeader>[0], limitBytes: number, multipartOverheadBytes: number): void {
    const rawContentLength = getRequestHeader(event, "content-length");
    const contentLength = rawContentLength ? Number.parseInt(rawContentLength, 10) : null;
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > limitBytes + multipartOverheadBytes) {
        throw createError({statusCode: 413, message: "Project 上传超过大小限制: 500MB"});
    }
}
