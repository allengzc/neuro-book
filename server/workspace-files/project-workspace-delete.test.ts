import {randomUUID} from "node:crypto";
import {mkdir, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {getAgentSqlSchemaSummary, closeAgentSqliteClient} from "nbook/server/agent/tools/sql-tool";
import {plotFacade} from "nbook/server/plot";
import {
    resolveProjectAbsolutePath,
    writeProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {deleteProjectWorkspace} from "nbook/server/workspace-files/project-workspace-delete";
import {
    closeWorkspaceTreeIndex,
    readProjectWorkspaceTreeSnapshot,
} from "nbook/server/workspace-files/project-workspace-index";

describe("deleteProjectWorkspace", () => {
    it("删除前关闭 plot Prisma、execute_sql client 和 workspace watcher", async () => {
        const projectPath = `workspace/delete-project-${randomUUID()}`;
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        try {
            await writeProjectManifest(projectPath, {
                kind: "novel",
                title: "Delete Project",
                summary: "",
            });
            await mkdir(join(projectRoot, "manuscript"), {recursive: true});
            await writeFile(join(projectRoot, "manuscript", "chapter-1.md"), "# Chapter 1\n", "utf8");

            await plotFacade.getStoryDto(projectPath);
            await getAgentSqlSchemaSummary(projectPath);
            await readProjectWorkspaceTreeSnapshot({root: projectRoot});

            await deleteProjectWorkspace(projectPath);

            await expect(pathExists(projectRoot)).resolves.toBe(false);
        } finally {
            await plotFacade.closeProject(projectPath).catch(() => undefined);
            await closeAgentSqliteClient(projectPath).catch(() => undefined);
            await closeWorkspaceTreeIndex(projectRoot).catch(() => undefined);
            await rm(projectRoot, {recursive: true, force: true});
        }
    });
});

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
