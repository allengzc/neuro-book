import path from "node:path";
import fs from "node:fs/promises";
import {consola} from "consola";
import type {OperationActor} from "nbook/server/vendor/nb-history/index";
import {
    convertWorkspaceFileToDirectory,
    createWorkspaceDirectory,
    createWorkspaceFile,
    deleteWorkspacePath,
    renameWorkspacePath,
    resolveWorkspacePath,
    writeWorkspaceTextFile,
    type WorkspaceFileNode,
    type WorkspaceFileToDirectoryInput,
    type WorkspaceNewDirectoryInput,
    type WorkspaceNewFileInput,
} from "nbook/server/workspace-files/workspace-files";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import type {WorkspaceUploadedFileResult} from "nbook/server/workspace-files/workspace-upload";
import {historyProjectPathFromRoot} from "nbook/server/workspace-history/history-paths";
import {
    LOCAL_USER_ID,
    collectTrackedDiskFiles,
    recordProjectDelete,
    recordProjectRename,
    recordProjectWrite,
} from "nbook/server/workspace-history/project-history";

/**
 * 带记账的 workspace 写入包装层（Task 95 N2）。
 *
 * 每个包装函数 = 原核心函数 + 文件历史记账：非项目 root（user-assets / 容器根）零成本透传；
 * 项目 root 下补齐 before 读取并按操作语义 register 到 history。记账一律 fail-open——
 * 任何记账环节失败都不影响写盘结果（漏账由 watcher / 写入口内建对账收敛为 external）。
 * 不动 workspace-files.ts 的核心函数签名：它还服务 user-assets，且底层纯 fs 模块不应反向依赖 history。
 */

/** 编辑器 / 前端路由写入的固定归因（D10：单机产品本地用户）。 */
export const USER_LOCAL_ACTOR: OperationActor = {kind: "user", userId: LOCAL_USER_ID};

/** 记账读盘上限：删除/上传记账单文件读取的最大字节，超限跳过记账（对账自愈补 external）。 */
const RECORD_READ_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 覆盖写文本文件 + 记账。
 * knownBefore：调用方已读到的写前内容（如 write 路由冲突检测已读），省一次读盘；
 * undefined = 由本函数读盘补 before，null = 明确此前文件不存在。
 */
export async function writeWorkspaceTextFileTracked(input: {
    root: string | undefined;
    filePath: string;
    content: string;
    actor: OperationActor;
    knownBefore?: string | null;
}): Promise<void> {
    const projectPath = historyProjectPathFromRoot(input.root);
    const before = projectPath === null
        ? null
        : input.knownBefore !== undefined
            ? (input.knownBefore === null ? null : new TextEncoder().encode(input.knownBefore))
            : await readBytesForRecord(projectPath, input.filePath);
    await writeWorkspaceTextFile(input.root, input.filePath, input.content);
    if (projectPath !== null) {
        await recordProjectWrite({
            projectPath,
            relativePath: input.filePath,
            actor: input.actor,
            before,
            after: new TextEncoder().encode(input.content),
        });
    }
}

/** 创建新文本文件 + 记账（已存在时核心函数拒绝，不会产生覆盖语义）。 */
export async function createWorkspaceFileTracked(input: WorkspaceNewFileInput & {actor: OperationActor}): Promise<WorkspaceFileNode> {
    const node = await createWorkspaceFile(input);
    const projectPath = historyProjectPathFromRoot(input.root);
    if (projectPath !== null) {
        await recordProjectWrite({
            projectPath,
            relativePath: input.filePath,
            actor: input.actor,
            before: null,
            after: new TextEncoder().encode(input.content ?? ""),
        });
    }
    return node;
}

/** 创建目录 + 对附带的 index.md / state.md 逐个记账（目录本身不是账面对象）。 */
export async function createWorkspaceDirectoryTracked(input: WorkspaceNewDirectoryInput & {actor: OperationActor}): Promise<WorkspaceFileNode> {
    const node = await createWorkspaceDirectory(input);
    const projectPath = historyProjectPathFromRoot(input.root);
    if (projectPath !== null) {
        const dirPath = normalizeSlashes(input.dirPath);
        if (input.indexContent !== undefined && input.indexContent !== null) {
            await recordProjectWrite({
                projectPath,
                relativePath: `${dirPath}/index.md`,
                actor: input.actor,
                before: null,
                after: new TextEncoder().encode(input.indexContent),
            });
        }
        if (input.stateContent !== undefined && input.stateContent !== null) {
            await recordProjectWrite({
                projectPath,
                relativePath: `${dirPath}/state.md`,
                actor: input.actor,
                before: null,
                after: new TextEncoder().encode(input.stateContent),
            });
        }
    }
    return node;
}

/**
 * 文件转目录节点 + 记账。语义 = 一条 rename（`foo.md` → `foo/index.md`，内容不变）：
 * 时间线跨转换连续，优于 delete + create 的断链表达。
 */
export async function convertWorkspaceFileToDirectoryTracked(input: WorkspaceFileToDirectoryInput & {actor: OperationActor}): Promise<WorkspaceFileNode> {
    const node = await convertWorkspaceFileToDirectory(input);
    const projectPath = historyProjectPathFromRoot(input.root);
    if (projectPath !== null) {
        const fromPath = normalizeSlashes(input.filePath);
        const parsed = path.posix.parse(fromPath);
        await recordProjectRename({
            projectPath,
            fromPath,
            toPath: path.posix.join(parsed.dir, parsed.name, "index.md"),
            actor: input.actor,
        });
    }
    return node;
}

/** 移动 / 改名 + 记账。目录改名展开为「目录内每个受管文件一条 rename」（账面对象是文件）。 */
export async function renameWorkspacePathTracked(input: {
    root: string | undefined;
    fromPath: string;
    toPath: string;
    actor: OperationActor;
}): Promise<WorkspaceFileNode> {
    const projectPath = historyProjectPathFromRoot(input.root);
    const fromPath = normalizeSlashes(input.fromPath);
    const toPath = normalizeSlashes(input.toPath);
    // rename 前判定形态并枚举目录内容（rename 后源路径已不存在）。
    const childFiles = projectPath === null ? [] : await listDirectoryFilesForRecord(projectPath, fromPath);
    const node = await renameWorkspacePath(input.root, input.fromPath, input.toPath);
    if (projectPath !== null) {
        if (childFiles === null) {
            await recordProjectRename({projectPath, fromPath, toPath, actor: input.actor});
        } else {
            for (const child of childFiles) {
                await recordProjectRename({
                    projectPath,
                    fromPath: `${fromPath}/${child}`,
                    toPath: `${toPath}/${child}`,
                    actor: input.actor,
                });
            }
        }
    }
    return node;
}

/** 删除 + 记账。目录删除展开为「每个受管文件一条 delete」，删除前逐个读 before 保住找回快照。 */
export async function deleteWorkspacePathTracked(input: {
    root: string | undefined;
    filePath: string;
    recursive: boolean;
    actor: OperationActor;
}): Promise<void> {
    const projectPath = historyProjectPathFromRoot(input.root);
    const filePath = normalizeSlashes(input.filePath);
    // 删除前收集 before：文件 = 单条；目录 = 目录内全部受管文件。
    const pendingDeletes: Array<{relativePath: string; before: Uint8Array}> = [];
    if (projectPath !== null) {
        const childFiles = await listDirectoryFilesForRecord(projectPath, filePath);
        const targets = childFiles === null ? [filePath] : childFiles.map((child) => `${filePath}/${child}`);
        for (const relativePath of targets) {
            const before = await readBytesForRecord(projectPath, relativePath);
            if (before !== null) {
                pendingDeletes.push({relativePath, before});
            }
        }
    }
    await deleteWorkspacePath(input.root, input.filePath, input.recursive);
    for (const pending of pendingDeletes) {
        await recordProjectDelete({
            projectPath: projectPath!,
            relativePath: pending.relativePath,
            actor: input.actor,
            before: pending.before,
        });
    }
}

/** 上传结果记账：对 action === "written" 的文件补 create 账（upload 对已存在文件恒 skip，before 必为 null）。 */
export async function recordUploadedFiles(input: {
    root: string | undefined;
    files: WorkspaceUploadedFileResult[];
    actor: OperationActor;
}): Promise<void> {
    const projectPath = historyProjectPathFromRoot(input.root);
    if (projectPath === null) {
        return;
    }
    for (const file of input.files) {
        if (file.action !== "written") {
            continue;
        }
        const bytes = await readBytesForRecord(projectPath, file.path);
        if (bytes === null) {
            continue;
        }
        await recordProjectWrite({
            projectPath,
            relativePath: file.path,
            actor: input.actor,
            before: null,
            after: bytes,
        });
    }
}

/** 记账用读盘：不存在 / 非文件 / 超限 / 读失败一律返回 null（fail-open，误差由对账自愈）。 */
async function readBytesForRecord(projectPath: string, relativePath: string): Promise<Uint8Array | null> {
    try {
        // 与 history 库同一解析权威（resolveProjectAbsolutePath），避免与核心写函数的 cwd 解析出现分歧。
        const root = resolveProjectAbsolutePath(projectPath);
        const absolutePath = resolveWorkspacePath(root, relativePath);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile() || stat.size > RECORD_READ_MAX_BYTES) {
            return null;
        }
        return await fs.readFile(absolutePath);
    } catch (error) {
        consola.warn({relativePath, error}, "workspace-history 记账读盘失败（跳过 before）");
        return null;
    }
}

/** 目录记账枚举：目标是目录时返回其中受管文件的相对子路径清单；是文件时返回 null。失败按空目录处理。 */
async function listDirectoryFilesForRecord(projectPath: string, relativePath: string): Promise<string[] | null> {
    try {
        const root = resolveProjectAbsolutePath(projectPath);
        const absolutePath = resolveWorkspacePath(root, relativePath);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat) {
            return null;
        }
        if (!stat.isDirectory()) {
            return null;
        }
        const files = await collectTrackedDiskFiles(root, normalizeSlashes(relativePath));
        const prefix = `${normalizeSlashes(relativePath)}/`;
        return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
    } catch (error) {
        consola.warn({relativePath, error}, "workspace-history 目录记账枚举失败（跳过该目录记账）");
        return [];
    }
}

function normalizeSlashes(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}
