import fs from "node:fs/promises";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import path from "node:path";
import process from "node:process";
import {consola} from "consola";
import {useAgentHarness} from "nbook/server/agent/http";
import {invalidateNovelListCache} from "nbook/server/utils/novel-chapter";
import {closeProjectResources} from "nbook/server/workspace-files/project-resources";
import {
    assertProjectWorkspaceDirectory,
    PROJECT_DELETED_MARKER_RELATIVE_PATH,
    PROJECT_MANIFEST_FILE,
    resolveProjectAbsolutePath,
} from "nbook/server/workspace-files/project-workspace";

type ProjectWorkspaceDeleteOptions = {
    /**
     * 归档与 Project 绑定的 Agent sessions。测试可注入临时 harness，运行时默认使用全局 harness。
     */
    archiveProjectSessions?: (projectPath: string, reason: string) => Promise<unknown>;
};

const projectRootDeleteMaxRetries = 20;
const projectRootDeleteRetryDelayMs = 500;
const projectRootMoveTimeoutMs = 10_000;

/**
 * 删除 Project Workspace。删除前统一释放当前进程里会占用 Project 目录的资源。
 */
export async function deleteProjectWorkspace(projectPath: string, options: ProjectWorkspaceDeleteOptions = {}): Promise<void> {
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(projectPath);
    const projectRoot = resolveProjectAbsolutePath(normalizedProjectPath);
    const archiveProjectSessions = options.archiveProjectSessions
        ?? ((targetProjectPath, reason) => useAgentHarness().archiveSessionsByProjectPath(targetProjectPath, reason));

    // 统一释放本进程内该 Project 的常驻资源（Plot PrismaClient、execute_sql client、tree index watcher 等），
    // 属主清单由 project-resources 注册表维护，新资源种类自注册即可，不再手工逐模块枚举。
    await closeProjectResources(normalizedProjectPath);
    await deleteProjectRoot(projectRoot);
    try {
        await archiveProjectSessions(normalizedProjectPath, "project.deleted");
    } catch (error) {
        consola.warn({projectPath: normalizedProjectPath, error}, "删除 Project Workspace 后归档 Agent sessions 失败");
    } finally {
        invalidateNovelListCache();
    }
}

/**
 * 删除 Project Root。Windows dev server 内部递归删除含 SQLite 的目录时会偶发长时间挂起，
 * 因此 Windows 下先改名到 workspace/.nbook/deleted-projects，让 Project 从用户视角立即消失，
 * 再后台 best-effort 清理墓碑目录。
 */
async function deleteProjectRoot(projectRoot: string): Promise<void> {
    if (process.platform === "win32") {
        try {
            const deletedRoot = await moveProjectRootToDeletedProjects(projectRoot);
            cleanupProjectRootInBackground(deletedRoot);
        } catch (error) {
            consola.warn({projectRoot, error}, "移动 Project Workspace 到墓碑目录失败，已改为标记删除并后台清理");
            await markProjectRootDeleted(projectRoot);
            cleanupProjectRootInBackground(projectRoot);
        }
        return;
    }

    await fs.rm(projectRoot, {
        recursive: true,
        force: true,
        maxRetries: projectRootDeleteMaxRetries,
        retryDelay: projectRootDeleteRetryDelayMs,
    });
}

/**
 * 将无法立即移动的 Project Root 标记为已删除。列表会隐藏它，新建流程也不会复用这个目录。
 */
async function markProjectRootDeleted(projectRoot: string): Promise<void> {
    const markerPath = path.join(projectRoot, PROJECT_DELETED_MARKER_RELATIVE_PATH);
    await fs.mkdir(path.dirname(markerPath), {recursive: true});
    await fs.writeFile(markerPath, JSON.stringify({
        deletedAt: new Date().toISOString(),
    }), "utf8");

    const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
    const deletedManifestPath = path.join(projectRoot, ".nbook", `deleted-${PROJECT_MANIFEST_FILE}`);
    await fs.rename(manifestPath, deletedManifestPath).catch((error) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw error;
    });
}

/**
 * 将 Project Root 移入 workspace 内部墓碑目录。调用完成后原 Project Path 已不可见。
 */
async function moveProjectRootToDeletedProjects(projectRoot: string): Promise<string> {
    const workspaceRoot = path.dirname(projectRoot);
    const deletedProjectsRoot = path.join(workspaceRoot, ".nbook", "deleted-projects");
    const deletedRoot = path.join(
        deletedProjectsRoot,
        `${path.basename(projectRoot)}-${Date.now()}-${randomUUID()}`,
    );
    await fs.mkdir(deletedProjectsRoot, {recursive: true});
    await moveDirectoryWithPowerShell(projectRoot, deletedRoot);
    return deletedRoot;
}

/**
 * 后台清理墓碑目录。这里不阻塞删除 API；失败时留给后续启动或人工清理。
 */
function cleanupProjectRootInBackground(projectRoot: string): void {
    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& { param([string]$ProjectRoot) $ErrorActionPreference = 'SilentlyContinue'; Remove-Item -LiteralPath $ProjectRoot -Recurse -Force }",
        projectRoot,
    ], {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
    });
    child.on("error", (error: Error) => {
        consola.warn({projectRoot, error}, "后台清理已删除 Project Workspace 失败");
    });
    child.unref();
}

/**
 * 使用 PowerShell 原生文件命令移动目录。Node fs.rename/fs.rm 在 Windows + SQLite 场景下会偶发 EBUSY 或长时间挂起。
 */
async function moveDirectoryWithPowerShell(source: string, destination: string): Promise<void> {
    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& { param([string]$Source, [string]$Destination) $ErrorActionPreference = 'Stop'; Move-Item -LiteralPath $Source -Destination $Destination }",
        source,
        destination,
    ], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
    });

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`移动 Project Workspace 到墓碑目录超时：${source}`));
        }, projectRootMoveTimeoutMs);

        child.on("error", (error: Error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`移动 Project Workspace 到墓碑目录失败：code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderr.trim()}`));
        });
    });
}
