import {createError, sendStream, setResponseHeader} from "h3";
import {createWorkspaceZipStream} from "nbook/server/workspace-files/workspace-archive";
import {
    resolveWorkspaceRootInput,
} from "nbook/server/workspace-files/novel-workspace";
import {statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import path from "node:path";

/**
 * 下载单个文件或文件夹。
 * 文件：直接返回文件内容
 * 文件夹：打包为zip返回
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const filePath = readRequiredQueryString(query.path, "path");
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const workspaceRoot = await resolveWorkspaceRootInput({projectPath, workspaceKind});
    
    if (!workspaceRoot) {
        throw createError({statusCode: 400, message: "无法解析工作区根目录"});
    }
    
    // 获取文件/文件夹信息
    const node = await statWorkspacePath(workspaceRoot, filePath);
    
    if (node.isDirectory) {
        // 文件夹：打包为zip
        const absolutePath = path.resolve(workspaceRoot, filePath);
        const rawFilename = `${path.basename(filePath)}.zip`;
        const archive = await createWorkspaceZipStream(absolutePath);
        
        setResponseHeader(event, "Content-Type", "application/zip");
        setContentDispositionHeader(event, rawFilename);
        return sendStream(event, archive.stream);
    } else {
        // 文件：直接返回文件内容
        const absolutePath = path.resolve(workspaceRoot, filePath);
        const rawFilename = path.basename(filePath);
        const stat = await fs.stat(absolutePath);
        
        if (!stat.isFile()) {
            throw createError({statusCode: 400, message: "路径不是文件"});
        }
        
        const stream = createReadStream(absolutePath);
        setResponseHeader(event, "Content-Type", "application/octet-stream");
        setContentDispositionHeader(event, rawFilename);
        setResponseHeader(event, "Content-Length", stat.size);
        return sendStream(event, stream);
    }
});

/**
 * 设置 Content-Disposition header，正确处理中文文件名。
 */
function setContentDispositionHeader(event: Parameters<typeof setResponseHeader>[0], filename: string): void {
    const encodedFilename = encodeURIComponent(filename);
    setResponseHeader(event, "Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodedFilename}`);
}

/**
 * 读取必填查询字符串。
 */
function readRequiredQueryString(value: unknown, key: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw createError({statusCode: 400, message: `${key} 不能为空`});
    }
    return value.trim();
}
