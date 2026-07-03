import type {
    ChapterRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryAct, StoryChapter} from "nbook/server/generated/project-prisma/client";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {describe, expect, it, vi} from "vitest";

/** 构造只带 chapter 仓储的 guard,其余仓储用空对象占位。 */
function createGuard(chapterRepository: Partial<ChapterRepository>): PlotScopeGuard {
    return new PlotScopeGuard(
        {} as StoryRepository,
        {} as ThreadRepository,
        {} as SceneRepository,
        chapterRepository as ChapterRepository,
    );
}

describe("PlotScopeGuard", () => {
    it("assertChapter 校验章存在且属于当前 Story", async () => {
        const chapter = {id: 7, storyId: 10, actId: null, name: "001-opening", title: "开篇"} as StoryChapter;
        const guard = createGuard({
            findChapterById: vi.fn(async (chapterId: number) => chapterId === 7 ? chapter : null),
        });

        await expect(guard.assertChapter(10, 7)).resolves.toBe(chapter);
        await expect(guard.assertChapter(10, 8)).rejects.toThrow("章节不存在");
        // 属于其他 Story 的章不可见。
        await expect(guard.assertChapter(11, 7)).rejects.toThrow("章节不存在");
    });

    it("assertAct 校验卷存在且属于当前 Story", async () => {
        const act = {id: 3, storyId: 10, name: "002-volume", title: "第二卷"} as StoryAct;
        const guard = createGuard({
            findActById: vi.fn(async (actId: number) => actId === 3 ? act : null),
        });

        await expect(guard.assertAct(10, 3)).resolves.toBe(act);
        await expect(guard.assertAct(10, 4)).rejects.toThrow("剧情卷不存在");
        await expect(guard.assertAct(11, 3)).rejects.toThrow("剧情卷不存在");
    });

    it("assertChapterNameUnique 拒绝重名章;Prose frontmatter 依赖 name 反指", async () => {
        const guard = createGuard({
            findChapterByName: vi.fn(async (_storyId: number, name: string, excludeChapterId?: number) => (
                name === "001-opening" && excludeChapterId !== 7
                    ? {id: 7, storyId: 10, name} as StoryChapter
                    : null
            )),
        });

        await expect(guard.assertChapterNameUnique(10, "001-opening")).rejects.toThrow("章节 name 已存在");
        await expect(guard.assertChapterNameUnique(10, "001-opening", 7)).resolves.toBeUndefined();
        await expect(guard.assertChapterNameUnique(10, "002-chapter")).resolves.toBeUndefined();
    });
});
