import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Novel, Prisma, PrismaClient} from "nbook/server/generated/prisma/client";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const USER_ASSETS_WORKSPACE_KIND = "user-assets";
export const USER_ASSETS_WORKSPACE_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook", "assets");
export const DEFAULT_NOVEL_WORKSPACE_ID = "1";
export const DEFAULT_NOVEL_WORKSPACE_SLUG = "silver-dragon-hime";

const NOVEL_DIRECTORY_TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/server/workspace/novel-directory-template");
const SYSTEM_ASSETS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");

export type NovelWorkspaceMetadata = {
    schemaVersion: 1;
    slug: string;
    displayName: string;
    novelId: string;
    createdAt: string;
    updatedAt: string;
};

export type WorkspaceRootKind = "novel" | typeof USER_ASSETS_WORKSPACE_KIND;
export type UserAssetsSyncResult = {
    copied: number;
    skipped: number;
};

/**
 * 将小说 workspace slug 归一成安全目录名。
 */
export function normalizeWorkspaceSlug(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "novel";
}

/**
 * 根据标题生成基础 workspace slug。中文标题无法转写时回落到 novel。
 */
export function buildWorkspaceSlugBase(title: string): string {
    return normalizeWorkspaceSlug(title);
}

/**
 * 返回指定 Novel 的 workspace 根目录，格式为 workspace/<workspaceSlug>。
 */
export async function resolveNovelWorkspaceRoot(prismaClient: PrismaExecutor, novelIdInput: string): Promise<string> {
    const novelId = parseEntityId("novelId", novelIdInput);
    const novel = await prismaClient.novel.findUnique({
        where: {id: novelId},
        select: {workspaceSlug: true},
    });

    if (!novel) {
        throw createError({statusCode: 404, message: "小说不存在"});
    }

    return path.posix.join(WORKSPACE_CONTAINER_ROOT, novel.workspaceSlug);
}

/**
 * 优先使用显式 root；未指定 root 时按 novelId 解析小说 workspace。
 */
export async function resolveWorkspaceRootInput(
    prismaClient: PrismaExecutor,
    input: {root?: string; novelId?: string; workspaceKind?: WorkspaceRootKind},
): Promise<string | undefined> {
    if (input.workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        await ensureUserAssetsWorkspaceRoot();
        return USER_ASSETS_WORKSPACE_ROOT;
    }
    if (input.root?.trim()) {
        return input.root.trim();
    }
    if (input.novelId?.trim()) {
        return resolveNovelWorkspaceRoot(prismaClient, input.novelId);
    }
    return undefined;
}

/**
 * 确保全局用户 assets 工作区存在。
 */
export async function ensureUserAssetsWorkspaceRoot(): Promise<string> {
    const workspaceRoot = path.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT);
    await fs.mkdir(workspaceRoot, {recursive: true});
    return USER_ASSETS_WORKSPACE_ROOT;
}

/**
 * 将系统 assets 中缺失的文件补到用户 assets，不覆盖用户已经编辑过的文件。
 */
export async function syncSystemAssetsToUserAssets(): Promise<UserAssetsSyncResult> {
    const targetRoot = path.resolve(process.cwd(), await ensureUserAssetsWorkspaceRoot());
    const result: UserAssetsSyncResult = {copied: 0, skipped: 0};
    await copyMissingAssetEntries(SYSTEM_ASSETS_ROOT, targetRoot, result);
    return result;
}

/**
 * 给新小说分配唯一 workspace slug。当前快速开发阶段优先使用 novel-<id>。
 */
export function buildNovelIdWorkspaceSlug(novelId: number): string {
    if (novelId === 1) {
        return DEFAULT_NOVEL_WORKSPACE_SLUG;
    }
    return `novel-${String(novelId)}`;
}

/**
 * 写入 workspace.yaml 元数据。该文件用于人工识别与后续扩展，运行时绑定仍以数据库为准。
 */
export async function writeNovelWorkspaceMetadata(novel: Pick<Novel, "id" | "workspaceSlug" | "createdAt" | "updatedAt">): Promise<void> {
    const workspaceRoot = path.resolve(process.cwd(), WORKSPACE_CONTAINER_ROOT, novel.workspaceSlug);
    const metadata: NovelWorkspaceMetadata = {
        schemaVersion: 1,
        slug: novel.workspaceSlug,
        displayName: novel.workspaceSlug,
        novelId: String(novel.id),
        createdAt: novel.createdAt.toISOString(),
        updatedAt: novel.updatedAt.toISOString(),
    };

    await fs.mkdir(workspaceRoot, {recursive: true});
    await copyNovelDirectoryTemplate(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "workspace.yaml"), renderWorkspaceMetadata(metadata), "utf-8");
}

/**
 * 把小说目录脚手架复制到 workspace，只补缺失文件，不覆盖用户已编辑内容。
 */
export async function copyNovelDirectoryTemplate(workspaceRoot: string): Promise<void> {
    await fs.cp(NOVEL_DIRECTORY_TEMPLATE_ROOT, workspaceRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
    });
}

/**
 * 递归复制缺失资源；已存在的用户文件只统计为 skipped。
 */
async function copyMissingAssetEntries(sourceRoot: string, targetRoot: string, result: UserAssetsSyncResult): Promise<void> {
    const entries = await fs.readdir(sourceRoot, {withFileTypes: true});
    await fs.mkdir(targetRoot, {recursive: true});

    for (const entry of entries) {
        const sourcePath = path.join(sourceRoot, entry.name);
        const targetPath = path.join(targetRoot, entry.name);
        if (entry.isDirectory()) {
            await copyMissingAssetEntries(sourcePath, targetPath, result);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }

        try {
            await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
            result.copied += 1;
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
                result.skipped += 1;
                continue;
            }
            throw error;
        }
    }
}

/**
 * 渲染最小 workspace 元数据 YAML。
 */
function renderWorkspaceMetadata(metadata: NovelWorkspaceMetadata): string {
    return [
        "schemaVersion: 1",
        `slug: ${metadata.slug}`,
        `displayName: ${metadata.displayName}`,
        `novelId: "${metadata.novelId}"`,
        `createdAt: "${metadata.createdAt}"`,
        `updatedAt: "${metadata.updatedAt}"`,
        "",
    ].join("\n");
}
