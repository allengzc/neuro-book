import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {closeWorkspaceTreeIndex, readProjectWorkspaceTreeSnapshot, subscribeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";

const createdRoots: string[] = [];

/**
 * 等待异步条件满足，避免文件系统 watcher 的平台差异造成测试抖动。
 */
async function waitForCondition(predicate: () => boolean): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 4000) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("等待 workspace 文件事件超时");
}

describe("workspace file events", () => {
    afterEach(async () => {
        await Promise.all(createdRoots.map((root) => closeWorkspaceTreeIndex(root)));
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("tree index 会推送外部文件新增和修改事件", async () => {
        const root = path.join(".agent", "workspace-file-events-test", randomUUID());
        createdRoots.push(root);
        await fs.mkdir(root, {recursive: true});

        const events: WorkspaceFileStreamEventDto[] = [];
        await readProjectWorkspaceTreeSnapshot({root});
        const unsubscribe = await subscribeWorkspaceTreeIndex({root}, (event) => {
            events.push(event);
        });

        await fs.writeFile(path.join(root, "note.md"), "第一版", "utf-8");
        await waitForCondition(() => events.some((event) => event.type === "workspace_files_changed"));

        unsubscribe();
        const changedEvent = events.find((event) => event.type === "workspace_files_changed");
        expect(changedEvent).toBeTruthy();
        expect(changedEvent?.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: "note.md",
            }),
        ]));
    });

    it("tree index 会推送外部目录删除事件并移除缓存中的子树", async () => {
        const root = path.join(".agent", "workspace-file-events-test", randomUUID());
        createdRoots.push(root);
        await fs.mkdir(path.join(root, "reference", "silly-tavern"), {recursive: true});
        await fs.writeFile(path.join(root, "reference", "silly-tavern", "card.md"), "角色卡\n", "utf-8");

        const before = await readProjectWorkspaceTreeSnapshot({root});
        const events: WorkspaceFileStreamEventDto[] = [];
        const unsubscribe = await subscribeWorkspaceTreeIndex({root}, (event) => {
            events.push(event);
        });

        await fs.rm(path.join(root, "reference", "silly-tavern"), {recursive: true, force: true});
        await waitForCondition(() => events.some((event) => event.type === "workspace_files_changed"));

        unsubscribe();
        const after = await readProjectWorkspaceTreeSnapshot({root});
        const changedEvent = events.find((event) => event.type === "workspace_files_changed");
        expect(before.nodes.some((node) => node.path === "reference/silly-tavern/")).toBe(true);
        expect(changedEvent?.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: "unlinkDir",
                path: "reference/silly-tavern",
            }),
        ]));
        expect(after.nodes.some((node) => node.path.startsWith("reference/silly-tavern"))).toBe(false);
        expect(after.revision).toBeGreaterThan(before.revision);
    });
});
