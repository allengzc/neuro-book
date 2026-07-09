import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    PROJECT_RESOURCE_IDLE_TTL_MS,
    closeAllProjectResources,
    closeProjectResources,
    registerProjectResourceOwner,
    resetProjectResourcesForTest,
    sweepIdleProjectResources,
    touchProjectResources,
} from "nbook/server/workspace-files/project-resources";

type OwnerCalls = {
    closed: string[];
    closedAll: number;
};

/** 注册一个记录调用轨迹的假属主，返回其调用记录。 */
function registerRecordingOwner(name: string, options: {
    failClose?: boolean;
    busyProjects?: Set<string>;
    withCloseAll?: boolean;
} = {}): OwnerCalls {
    const calls: OwnerCalls = {closed: [], closedAll: 0};
    const busyProjects = options.busyProjects;
    registerProjectResourceOwner({
        name,
        async close(projectPath) {
            if (options.failClose) {
                throw new Error(`close ${name} failed`);
            }
            calls.closed.push(projectPath);
        },
        ...(options.withCloseAll
            ? {
                closeAll: async () => {
                    calls.closedAll += 1;
                },
            }
            : {}),
        ...(busyProjects
            ? {busy: (projectPath: string) => busyProjects.has(projectPath)}
            : {}),
    });
    return calls;
}

describe("project-resources 注册表", () => {
    beforeEach(() => {
        resetProjectResourcesForTest();
    });

    afterEach(() => {
        resetProjectResourcesForTest();
    });

    it("closeProjectResources 调用全部属主，单个属主失败不阻断其余", async () => {
        registerRecordingOwner("failing-owner", {failClose: true});
        const survivor = registerRecordingOwner("surviving-owner");
        touchProjectResources("workspace/book-a");

        await expect(closeProjectResources("workspace/book-a")).resolves.toBeUndefined();

        expect(survivor.closed).toEqual(["workspace/book-a"]);
    });

    it("空闲清扫只关超时且不忙的 Project；busy 会刷新报活时间", async () => {
        const busyProjects = new Set(["workspace/busy-book"]);
        const owner = registerRecordingOwner("watcher-owner", {busyProjects});
        const base = Date.now();
        touchProjectResources("workspace/idle-book");
        touchProjectResources("workspace/busy-book");

        // 未超时：全部保留。
        await expect(sweepIdleProjectResources(base + PROJECT_RESOURCE_IDLE_TTL_MS - 60_000)).resolves.toEqual([]);
        expect(owner.closed).toEqual([]);

        // 超时：idle 被关闭，busy 被跳过并刷新报活。
        const firstSweepAt = base + PROJECT_RESOURCE_IDLE_TTL_MS + 60_000;
        await expect(sweepIdleProjectResources(firstSweepAt)).resolves.toEqual(["workspace/idle-book"]);
        expect(owner.closed).toEqual(["workspace/idle-book"]);

        // busy 解除后：以刷新后的报活时间起算 TTL。
        busyProjects.clear();
        await expect(sweepIdleProjectResources(firstSweepAt + PROJECT_RESOURCE_IDLE_TTL_MS - 1000)).resolves.toEqual([]);
        await expect(sweepIdleProjectResources(firstSweepAt + PROJECT_RESOURCE_IDLE_TTL_MS + 1000)).resolves.toEqual(["workspace/busy-book"]);
        expect(owner.closed).toEqual(["workspace/idle-book", "workspace/busy-book"]);
    });

    it("closeAllProjectResources 优先走属主 closeAll，缺省属主按报活记录逐项关闭", async () => {
        const bulkOwner = registerRecordingOwner("bulk-owner", {withCloseAll: true});
        const perProjectOwner = registerRecordingOwner("per-project-owner");
        touchProjectResources("workspace/book-a");
        touchProjectResources("workspace/book-b");

        await closeAllProjectResources();

        expect(bulkOwner.closedAll).toBe(1);
        expect(bulkOwner.closed).toEqual([]);
        expect(perProjectOwner.closed.sort()).toEqual(["workspace/book-a", "workspace/book-b"]);

        // 报活记录已清空：再清扫不会重复关闭。
        await expect(sweepIdleProjectResources(Date.now() + PROJECT_RESOURCE_IDLE_TTL_MS * 2)).resolves.toEqual([]);
    });

    it("同名属主重复注册按替换处理", async () => {
        const stale = registerRecordingOwner("same-name");
        const active = registerRecordingOwner("same-name");
        touchProjectResources("workspace/book-a");

        await closeProjectResources("workspace/book-a");

        expect(stale.closed).toEqual([]);
        expect(active.closed).toEqual(["workspace/book-a"]);
    });
});
