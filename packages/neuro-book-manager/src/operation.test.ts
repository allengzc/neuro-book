import {mkdir, mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {removePath} from "#manager/files";
import {createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {parseOperationJournal} from "#manager/schema";
import type {InstallationManifest} from "#manager/types";

const docker = vi.hoisted(() => ({
    removeDeployment: vi.fn(),
    removeImage: vi.fn(),
    start: vi.fn(),
}));

vi.mock("#manager/docker", () => ({
    removeDockerDeployment: docker.removeDeployment,
    removeDockerImage: docker.removeImage,
    startDocker: docker.start,
}));

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => removePath(root))));
beforeEach(() => vi.clearAllMocks());

describe("Operation recovery", () => {
    it("拒绝越界受管路径与缺少 nextManifest 的 Git commit point", () => {
        const journal = operationJournal();
        expect(() => parseOperationJournal({...journal, createdPaths: ["../outside"]}, "memory.json")).toThrow("Installation Root");
        expect(() => parseOperationJournal({
            ...journal,
            git: {
                previousRevision: "a".repeat(40),
                targetRevision: "b".repeat(40),
                committed: true,
            },
        }, "memory.json")).toThrow("缺少 nextManifest");
    });

    it("拒绝嵌套 Manifest 损坏的 journal", () => {
        expect(() => parseOperationJournal({...operationJournal(), nextManifest: {}}, "memory.json")).toThrow("Operation journal 不符合 schema");
    });

    it("commit point 前删除本次创建路径并保留 journal", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
        roots.push(root);
        const created = join(root, ".runtime", "temporary");
        await mkdir(created, {recursive: true});
        await writeFile(join(created, "partial.txt"), "partial", "utf8");
        const journal = await createOperation({
            id: "interrupted",
            action: "install",
            root,
            createdPaths: [".runtime/temporary"],
            backupRoot: join(root, ".deploy", "backups", "interrupted"),
            previousManifest: null,
            nextManifest: null,
        });
        await updateOperation(journal, "staged");

        await recoverInterruptedOperations(root);

        await expect(stat(created)).rejects.toMatchObject({code: "ENOENT"});
        expect(await stat(join(root, ".deploy", "operations", "interrupted.json"))).toBeTruthy();
    });

    it("Fresh Docker失败时移除容器、Compose和本地镜像", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        await writeFile(compose, "services: {}", "utf8");
        const journal = await createOperation({
            id: "fresh-docker",
            action: "install",
            root,
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "fresh-docker"),
            previousManifest: null,
            nextManifest: dockerManifest(root),
            composeChanged: true,
            composeCreated: true,
            dockerImageCreated: "neuro-book-source:test",
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(docker.removeImage).toHaveBeenCalledWith(root, "neuro-book-source:test");
        await expect(stat(compose)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Docker更新失败时恢复数据库、Compose并重启旧实例", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "docker-update");
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        const database = join(root, "workspace", ".nbook", "neuro-book.sqlite");
        const databaseBackup = join(backup, "neuro-book.sqlite");
        await mkdir(join(root, "workspace", ".nbook"), {recursive: true});
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        await writeFile(database, "new", "utf8");
        await writeFile(`${database}-wal`, "wal", "utf8");
        await writeFile(databaseBackup, "old", "utf8");
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "docker-update",
            action: "update",
            root,
            createdPaths: [],
            backupRoot: backup,
            previousManifest,
            nextManifest: {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-13T00:00:00.000Z"},
            previousCompose,
            composeChanged: true,
            composeCreated: false,
            databasePath: database,
            databaseBackup,
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(await readFile(database, "utf8")).toBe("old");
        await expect(stat(`${database}-wal`)).rejects.toMatchObject({code: "ENOENT"});
        expect(await readFile(compose, "utf8")).toBe("image: old");
        expect(docker.start).toHaveBeenCalledWith(root, root, "source-docker");
    });

    it("镜像清理失败时仍完成其他回滚并记录人工清理信息", async () => {
        const root = await operationRoot();
        docker.removeImage.mockRejectedValueOnce(new Error("image is in use"));
        const journal = await createOperation({
            id: "image-cleanup",
            action: "install",
            root,
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "image-cleanup"),
            previousManifest: null,
            nextManifest: dockerManifest(root),
            dockerImageCreated: "neuro-book-source:test",
        });

        await recoverInterruptedOperations(root);

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "image-cleanup.json"), "utf8")) as {outcome: string; dockerImageCleanupError: string};
        expect(saved).toMatchObject({outcome: "rolled-back", dockerImageCleanupError: "image is in use"});
    });

    it("旧Docker实例重启失败时保留未完成journal供下次继续恢复", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const backup = join(root, ".deploy", "backups", "restart-failure");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        docker.start.mockRejectedValueOnce(new Error("docker daemon unavailable"));
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "restart-failure",
            action: "update",
            root,
            createdPaths: [],
            backupRoot: backup,
            previousManifest,
            nextManifest: previousManifest,
            previousCompose,
            composeChanged: true,
        });
        await updateOperation(journal, "switched");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("docker daemon unavailable");

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "restart-failure.json"), "utf8")) as {phase: string; outcome?: string};
        expect(saved.phase).toBe("switched");
        expect(saved.outcome).toBeUndefined();
    });
});

async function operationRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
    roots.push(root);
    await mkdir(join(root, ".deploy", "operations"), {recursive: true});
    return root;
}

function dockerManifest(root: string): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 3,
        profile: "source-docker",
        managerVersion: "0.1.0",
        appVersion: "1.0.0",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "git", version: "1.0.0", revision, path: ".", repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {provider: "container", version: "1.0.0", revision, image: "neuro-book-source:test"},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "container", version: "1.0.0"},
            tools: {rg: {provider: "container", version: "source-docker"}, git: {provider: "container", version: "source-docker"}, python: {provider: "container", version: "source-docker"}},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function operationJournal() {
    const now = "2026-07-12T00:00:00.000Z";
    return {
        schemaVersion: 1 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: "C:/neuro-book",
        createdPaths: [],
        backupRoot: "C:/neuro-book/.deploy/backups/operation",
        previousManifest: null,
        nextManifest: null,
        createdAt: now,
        updatedAt: now,
    };
}
