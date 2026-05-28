import fs from "node:fs/promises";
import path from "node:path";
import {createClient} from "@libsql/client";
import {createError} from "h3";
import * as yaml from "yaml";

export const PROJECT_MANIFEST_FILE = "project.yaml";
export const PROJECT_DATABASE_RELATIVE_PATH = ".nbook/project.sqlite";
export const PROJECT_CONFIG_RELATIVE_PATH = ".nbook/config.json";

export type ProjectManifest = {
    kind: "novel";
    title: string;
    summary: string;
};

export type ProjectListItem = ProjectManifest & {
    projectPath: string;
    updatedAt: string;
    manifestError?: string;
};

const PROJECT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS "ProjectMetadata" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DatabaseLock" (
    "key" INTEGER NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Story" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "StoryPhase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPhase_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryThread" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "storyPhaseId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isMainThread" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryThread_storyPhaseId_fkey" FOREIGN KEY ("storyPhaseId") REFERENCES "StoryPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryScene" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "chapterPath" TEXT,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryScene_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryPlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "effect" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPlot_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StorySceneRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "targetPlotId" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetPlotId_fkey" FOREIGN KEY ("targetPlotId") REFERENCES "StoryPlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_chapterPath_chapterSortOrder_idx" ON "StoryScene"("chapterPath", "chapterSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPlot_sceneId_sortOrder_key" ON "StoryPlot"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryPlot_sceneId_sortOrder_idx" ON "StoryPlot"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetPlotId_idx" ON "StorySceneRef"("targetPlotId");
INSERT INTO "ProjectMetadata" ("key", "value", "updatedAt")
VALUES ('schemaVersion', '1', CURRENT_TIMESTAMP)
ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
`;

/**
 * 校验并规范化 Project Path。它必须指向 workspace 下的一级目录。
 */
export function normalizeProjectPath(input: string): string {
    const normalized = input.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!normalized || normalized === "workspace" || normalized.includes("..") || path.posix.isAbsolute(normalized)) {
        throw createError({statusCode: 400, message: "projectPath 必须是 workspace 下的项目目录"});
    }
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "workspace") {
        throw createError({statusCode: 400, message: "projectPath 必须形如 workspace/<project>"});
    }
    return normalized;
}

/**
 * 将 Project Path 解析为绝对路径。
 */
export function resolveProjectAbsolutePath(projectPath: string): string {
    return path.resolve(process.cwd(), normalizeProjectPath(projectPath));
}

/**
 * 判断 Project Path 是否指向现有 Project Workspace 目录。不读取 project.yaml，用于文件修复链路。
 */
export async function assertProjectWorkspaceDirectory(projectPath: string): Promise<string> {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const projectRoot = resolveProjectAbsolutePath(normalizedProjectPath);
    const stat = await fs.stat(projectRoot);
    if (!stat.isDirectory()) {
        throw createError({statusCode: 400, message: "projectPath 必须指向 Project Workspace 目录"});
    }
    return normalizedProjectPath;
}

/**
 * 返回 Project SQLite 的绝对路径。
 */
export function resolveProjectDatabasePath(projectPath: string): string {
    return path.join(resolveProjectAbsolutePath(projectPath), PROJECT_DATABASE_RELATIVE_PATH);
}

/**
 * 读取 Project manifest。
 */
export async function readProjectManifest(projectPath: string): Promise<ProjectManifest> {
    const manifestPath = path.join(resolveProjectAbsolutePath(projectPath), PROJECT_MANIFEST_FILE);
    const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
    if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
        throw createError({statusCode: 400, message: `${projectPath}/${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`});
    }
    return {
        kind: "novel",
        title: parsed.title,
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
}

/**
 * 安全读取 Project manifest。解析失败时返回错误文本，避免拖垮文件树和保存链路。
 */
export async function readProjectManifestIssue(projectPath: string): Promise<string | null> {
    return readProjectManifestIssueFromRoot(resolveProjectAbsolutePath(projectPath));
}

/**
 * 从 Project Workspace 根目录安全读取 manifest issue。root 已经由调用方完成定位。
 */
export async function readProjectManifestIssueFromRoot(projectRoot: string): Promise<string | null> {
    try {
        const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
        const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
        if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
            return `${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`;
        }
        return null;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return "Project Workspace 缺少 project.yaml";
        }
        return error instanceof Error ? error.message : "project.yaml 解析失败";
    }
}

/**
 * 写入 Project manifest。
 */
export async function writeProjectManifest(projectPath: string, manifest: ProjectManifest): Promise<void> {
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    await fs.mkdir(projectRoot, {recursive: true});
    await fs.writeFile(path.join(projectRoot, PROJECT_MANIFEST_FILE), yaml.stringify(manifest), "utf-8");
}

/**
 * 扫描 workspace 下一级 Project manifest。
 */
export async function listProjectWorkspaces(): Promise<ProjectListItem[]> {
    const workspaceRoot = path.resolve(process.cwd(), "workspace");
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }

    const projects: ProjectListItem[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".nbook") {
            continue;
        }
        const projectPath = path.posix.join("workspace", entry.name);
        try {
            const manifest = await readProjectManifest(projectPath);
            const stat = await fs.stat(path.join(workspaceRoot, entry.name, PROJECT_MANIFEST_FILE));
            projects.push({...manifest, projectPath, updatedAt: stat.mtime.toISOString()});
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                continue;
            }
            const stat = await fs.stat(path.join(workspaceRoot, entry.name));
            projects.push({
                kind: "novel",
                title: entry.name,
                summary: "",
                projectPath,
                updatedAt: stat.mtime.toISOString(),
                manifestError: error instanceof Error ? error.message : "project.yaml 解析失败",
            });
        }
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * 初始化或迁移 Project SQLite。
 */
export async function initProjectDatabase(projectPath: string): Promise<string> {
    return initProjectDatabaseAtRoot(resolveProjectAbsolutePath(projectPath));
}

/**
 * 按 Project Workspace 绝对根目录初始化或迁移 Project SQLite。
 */
export async function initProjectDatabaseAtRoot(projectRoot: string): Promise<string> {
    const databasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
    await fs.mkdir(path.dirname(databasePath), {recursive: true});
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("PRAGMA foreign_keys = ON");
        for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
            await client.execute(statement);
        }
    } finally {
        await client.close();
    }
    return databasePath;
}

/**
 * SQLite file URL。
 */
export function toSqliteFileUrl(filePath: string): string {
    return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function splitSqlStatements(sql: string): string[] {
    return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}
