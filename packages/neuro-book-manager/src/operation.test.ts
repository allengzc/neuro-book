import {mkdir, mkdtemp, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {removePath} from "#manager/files";
import {createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {parseOperationJournal} from "#manager/schema";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => removePath(root))));

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
});

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
