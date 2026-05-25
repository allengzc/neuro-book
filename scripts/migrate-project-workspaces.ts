import fs from "node:fs/promises";
import path from "node:path";
import {createClient, type Client} from "@libsql/client";
import * as yaml from "yaml";

type CliOptions = {
    workspaceRoot: string;
    apply: boolean;
    overwriteManifest: boolean;
};

type LegacyWorkspaceManifest = {
    displayName?: unknown;
    slug?: unknown;
};

type ProjectAction = {
    projectName: string;
    projectRoot: string;
    projectYamlPath: string;
    projectDatabasePath: string;
    title: string;
    summary: string;
    hasProjectYaml: boolean;
    hasProjectDatabase: boolean;
};

const PROJECT_DATABASE_RELATIVE_PATH = ".nbook/project.sqlite";

/**
 * 将现有 Project Workspace 目录规范化为 project.yaml + Project SQLite 结构。
 */
async function main(): Promise<void> {
    const options = parseCliOptions(process.argv.slice(2));
    const workspaceRoot = path.resolve(process.cwd(), options.workspaceRoot);
    await assertDirectory(workspaceRoot, "Workspace Root 不存在");

    const actions = await collectProjectActions(workspaceRoot);
    if (actions.length === 0) {
        console.log(`${displayPath(workspaceRoot)} 下没有可迁移的 Project Workspace。`);
        return;
    }

    console.log(`${options.apply ? "执行" : "预演"} Project Workspace 规范化：${displayPath(workspaceRoot)}`);
    if (!options.apply) {
        console.log("当前是 dry-run，不会写入文件。确认无误后加 --apply 执行。");
    }

    for (const action of actions) {
        await runAction(action, options);
    }
}

async function collectProjectActions(workspaceRoot: string): Promise<ProjectAction[]> {
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    const actions: ProjectAction[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
            continue;
        }

        const projectRoot = path.join(workspaceRoot, entry.name);
        if (!await looksLikeProjectWorkspace(projectRoot)) {
            continue;
        }

        const projectYamlPath = path.join(projectRoot, "project.yaml");
        const legacyManifestPath = path.join(projectRoot, "workspace.yaml");
        const projectDatabasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
        const existingProjectManifest = await readYamlFile<{title?: unknown; summary?: unknown}>(projectYamlPath);
        const legacyManifest = await readYamlFile<LegacyWorkspaceManifest>(legacyManifestPath);
        const title = normalizeTitle(existingProjectManifest?.title, legacyManifest?.displayName, entry.name);
        const summary = typeof existingProjectManifest?.summary === "string" ? existingProjectManifest.summary : "";

        actions.push({
            projectName: entry.name,
            projectRoot,
            projectYamlPath,
            projectDatabasePath,
            title,
            summary,
            hasProjectYaml: await fileExists(projectYamlPath),
            hasProjectDatabase: await fileExists(projectDatabasePath),
        });
    }

    return actions.sort((left, right) => left.projectName.localeCompare(right.projectName));
}

async function looksLikeProjectWorkspace(projectRoot: string): Promise<boolean> {
    const markers = ["project.yaml", "workspace.yaml", "manuscript", "lorebook", "AGENTS.md", "PROJECT-STATUS.md"];
    for (const marker of markers) {
        if (await fileExists(path.join(projectRoot, marker))) {
            return true;
        }
    }
    return false;
}

async function runAction(action: ProjectAction, options: CliOptions): Promise<void> {
    console.log(`\n- workspace/${action.projectName}`);
    console.log(`  title: ${action.title}`);
    console.log(`  project.yaml: ${action.hasProjectYaml ? options.overwriteManifest ? "已存在，将覆盖" : "已存在，保留" : "不存在，将创建"}`);
    console.log(`  project.sqlite: ${action.hasProjectDatabase ? "已存在，校验 schema" : "不存在，将初始化"}`);

    if (!options.apply) {
        return;
    }

    if (!action.hasProjectYaml || options.overwriteManifest) {
        await fs.writeFile(action.projectYamlPath, yaml.stringify({
            kind: "novel",
            title: action.title,
            summary: action.summary,
        }), "utf-8");
    }

    await fs.mkdir(path.dirname(action.projectDatabasePath), {recursive: true});
    const client = createClient({url: toSqliteFileUrl(action.projectDatabasePath)});
    try {
        await client.execute("PRAGMA foreign_keys = ON");
        await initProjectDatabase(client);
    } finally {
        client.close();
    }
}

async function initProjectDatabase(client: Client): Promise<void> {
    for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
        await client.execute(statement);
    }
}

async function readYamlFile<T>(filePath: string): Promise<T | null> {
    try {
        return yaml.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function normalizeTitle(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return String(candidate);
        }
    }
    return "Untitled Project";
}

function parseCliOptions(args: string[]): CliOptions {
    const options: CliOptions = {
        workspaceRoot: "workspace",
        apply: false,
        overwriteManifest: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--workspace-root") {
            options.workspaceRoot = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--apply") {
            options.apply = true;
            continue;
        }
        if (arg === "--overwrite-manifest") {
            options.overwriteManifest = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        throw new Error(`未知参数：${arg}`);
    }

    return options;
}

function requireValue(args: string[], index: number, name: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${name} 需要一个值`);
    }
    return value;
}

function printHelp(): void {
    console.log(`Usage:
  bun scripts/migrate-project-workspaces.ts [--workspace-root <dir>] [--apply] [--overwrite-manifest]

Options:
  --workspace-root <dir>   Workspace Root，默认 workspace
  --apply                  实际写入 project.yaml 并初始化 .nbook/project.sqlite；不传则只预演
  --overwrite-manifest     project.yaml 已存在时也按当前目录 / workspace.yaml 重新生成

说明：
  本脚本只规范化现有 Project Workspace 目录，不迁移旧 Plot 数据。
  旧 workspace.yaml 只用于推导 project.yaml.title，不会被删除。
`);
}

async function assertDirectory(filePath: string, message: string): Promise<void> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isDirectory()) {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
        throw error;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function toSqliteFileUrl(filePath: string): string {
    return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function displayPath(filePath: string): string {
    return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function splitSqlStatements(sql: string): string[] {
    return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

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

await main();
