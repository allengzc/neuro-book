import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread, StorySceneRefWithTargets} from "nbook/server/plot/core/types";
import type {StoryChapter} from "nbook/server/generated/project-prisma/client";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {ChapterWriterBriefService} from "nbook/server/plot/services/chapter-writer-brief.service";
import type {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import type {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import type {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {StoryService} from "nbook/server/plot/services/story.service";
import type {SceneWorldContextDto, StorySceneWorldAnchorDto} from "nbook/shared/dto/plot.dto";
import {describe, expect, it, vi} from "vitest";

const chapterId = 7;

/** 章实体 fixture;默认信息控制填了 mustHide(否则会降级 needs_chapter_brief)。 */
function chapterEntity(briefPatch: Partial<StoryChapter> = {}): StoryChapter {
    return {
        id: chapterId,
        storyId: 1,
        actId: null,
        sortOrder: 0,
        name: "001-opening",
        title: "开篇",
        note: null,
        briefGoal: null,
        briefPov: null,
        briefTone: null,
        briefPacing: null,
        briefReaderKnows: null,
        briefProtagonistKnows: null,
        briefMustHide: "薇洛丝不知道项链是前作遗物",
        briefHintOnly: null,
        briefOpening: null,
        briefEnding: null,
        briefDoNotWrite: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...briefPatch,
    } satisfies StoryChapter;
}

describe("ChapterWriterBriefService", () => {
    it("autonomous ready：只给查询提示,不展开状态,含信息控制与建议读取", async () => {
        const {service, sceneWorldContextService} = createService([createRecord()]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "autonomous");

        expect(brief.status).toBe("ready");
        expect(brief.mode).toBe("autonomous");
        expect(brief.totalScenes).toBe(1);
        expect(brief.chapter).toMatchObject({id: "7", name: "001-opening"});
        expect(sceneWorldContextService.getSceneWorldContextForScene).toHaveBeenCalledOnce();

        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("Autonomous");
        expect(md).toContain("神殿相遇");
        expect(md).toContain("信息控制");
        expect(md).toContain("必须隐藏：薇洛丝不知道项链是前作遗物");
        expect(md).toContain("World 查询提示");
        // 建议读取由 Scene refs 编译。
        expect(md).toContain("## 建议读取");
        expect(md).toContain("lorebook/character/weiluosi/");
        // autonomous 不展开可查询状态,也不含 raw attrs/patch。
        expect(md).not.toContain("Subject states");
        expect(md).not.toContain("attrs");
        expect(md).not.toContain("\"hp\"");
        // 不产出「写作约束」段(文风归 writer profile)。
        expect(md).not.toContain("写作约束");
    });

    it("curated ready：展开 World Context 状态摘要供投喂", async () => {
        const {service} = createService([createRecord()]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "curated");

        expect(brief.status).toBe("ready");
        expect(brief.mode).toBe("curated");
        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("Curated");
        expect(md).toContain("World slices");
        expect(md).toContain("Subject states");
        expect(md).toContain("主角(character)");
        // curated 展开状态,但仍不 dump raw attrs JSON。
        expect(md).not.toContain("attrs");
        expect(md).not.toContain("\"hp\"");
    });

    it("needs_chapter_brief：信息控制四项全空时阻断 handoff", async () => {
        const {service} = createService([createRecord()], {}, chapterEntity({
            briefReaderKnows: null,
            briefProtagonistKnows: null,
            briefMustHide: null,
            briefHintOnly: null,
        }));

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "autonomous");

        expect(brief.status).toBe("needs_chapter_brief");
        expect(brief.warnings.some((warning) => warning.includes("信息控制未填写"))).toBe(true);
        expect(brief.suggestedBriefMarkdown).toContain("⚠ 未设置");
    });

    it("needs_plot：章节没有关联 Scene 时要求先补 Plot", async () => {
        const {service, sceneWorldContextService} = createService([]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "autonomous");

        expect(brief.status).toBe("needs_plot");
        expect(brief.scenes).toEqual([]);
        expect(brief.warnings).toContain("本章节尚未关联 Plot Scene；请先建立章节 Scene 顺序。");
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_anchor：Scene 缺少完整时间范围时不查询 World Context", async () => {
        const {service, sceneWorldContextService} = createService([createRecord({startInstant: null})]);

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "autonomous");

        expect(brief.status).toBe("needs_world_anchor");
        expect(brief.scenes[0]?.worldContext).toBeNull();
        expect(brief.warnings).toContain("Scene「神殿相遇」尚未设置完整 World Engine 时间范围。");
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_context：存在 unresolved subject 时阻断 handoff", async () => {
        const {service} = createService([createRecord()], {unresolvedSubjectIds: ["future-ally"]});

        const brief = await service.getChapterWriterBrief("workspace/novel", chapterId, "autonomous");

        expect(brief.status).toBe("needs_world_context");
        expect(brief.warnings).toContain("Scene「神殿相遇」存在未解析 subject：future-ally。");
    });
});

/**
 * 创建 service 与 mock 依赖。
 */
function createService(
    records: ChapterWriterBriefSceneWithThread[],
    contextPatch: Partial<SceneWorldContextDto> = {},
    chapter: StoryChapter = chapterEntity(),
) {
    const sceneRepository = {
        findChapterScenesForBrief: vi.fn(async () => records),
    } as unknown as SceneRepository & {findChapterScenesForBrief: ReturnType<typeof vi.fn>};
    const storyService = {
        ensureStory: vi.fn(async () => ({id: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
    } as unknown as StoryService & {ensureStory: ReturnType<typeof vi.fn>};
    const scopeGuard = {
        assertChapter: vi.fn(async () => chapter),
    } as unknown as PlotScopeGuard & {assertChapter: ReturnType<typeof vi.fn>};
    const sceneWorldContextService = {
        getSceneWorldContextForScene: vi.fn(async () => createWorldContext(contextPatch)),
    } as unknown as SceneWorldContextService & {getSceneWorldContextForScene: ReturnType<typeof vi.fn>};
    const anchorResolutionService = {
        resolveMany: vi.fn(async (_projectPath: string, anchors: StorySceneWorldAnchorDto[]) => anchors.map(resolveAnchor)),
    } as unknown as SceneWorldAnchorResolutionService & {resolveMany: ReturnType<typeof vi.fn>};

    return {
        service: new ChapterWriterBriefService(
            sceneRepository,
            storyService,
            scopeGuard,
            sceneWorldContextService,
            anchorResolutionService,
            new PlotDtoAssembler(),
        ),
        sceneRepository,
        scopeGuard,
        sceneWorldContextService,
        anchorResolutionService,
    };
}

/**
 * 创建带一条 content ref 的 brief read model 记录。
 */
function createRecord(patch: Partial<ChapterWriterBriefSceneWithThread> = {}): ChapterWriterBriefSceneWithThread {
    const ref: StorySceneRefWithTargets = {
        id: 1,
        sceneId: 10,
        sortOrder: 0,
        relation: "depends_on",
        rawTarget: "lorebook/character/weiluosi/",
        targetKind: "content",
        targetThreadId: null,
        targetSceneId: null,
        visibility: "author",
        note: "确认项链设定",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        targetThread: null,
        targetScene: null,
    };
    const base: ChapterWriterBriefSceneWithThread = {
        id: 10,
        storyId: 1,
        threadId: 2,
        chapterId,
        threadSortOrder: 0,
        chapterSortOrder: 0,
        title: "神殿相遇",
        status: "draft",
        summary: "主角在神殿遇到未来盟友。",
        purpose: "建立同盟关系。",
        writingTip: "突出压迫感。",
        note: null,
        startInstant: 100n,
        endInstant: 200n,
        subjectIdsJson: JSON.stringify(["hero"]),
        locationSubjectId: "temple",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        thread: {
            id: 2,
            title: "主线",
            isMainThread: true,
            summary: "主线推进到神殿。",
            writingTip: "保持悬疑。",
        },
        refs: [ref],
    };
    return {
        ...base,
        ...patch,
        thread: {...base.thread, ...(patch.thread ?? {})},
        refs: patch.refs ?? base.refs,
    };
}

/**
 * 创建 World Context fixture。
 */
function createWorldContext(patch: Partial<SceneWorldContextDto> = {}): SceneWorldContextDto {
    return {
        slices: [
            {
                id: "slice-1",
                time: "复兴纪元1日 00:02:00",
                title: "相关切面",
                summary: "神殿灯火变暗。",
                kind: "event",
                patchCount: 2,
            },
        ],
        subjectStates: [
            {
                subjectId: "hero",
                type: "character",
                name: "主角",
                attrs: {hp: 8},
            },
        ],
        unresolvedSubjectIds: [],
        ...patch,
    };
}

/**
 * 把 raw anchor fixture 解析成人类可读显示状态。
 */
function resolveAnchor(anchor: StorySceneWorldAnchorDto): StorySceneWorldAnchorDto {
    return {
        ...anchor,
        startTime: anchor.startInstant === null ? null : "复兴纪元1日 00:01:40",
        endTime: anchor.endInstant === null ? null : "复兴纪元1日 00:03:20",
        subjects: anchor.subjectIds.map((subjectId) => ({
            id: subjectId,
            name: subjectId === "hero" ? "主角" : subjectId,
            type: subjectId === "hero" ? "character" : "unknown",
            resolved: subjectId === "hero",
        })),
        locationSubject: anchor.locationSubjectId === null
            ? null
            : {
                id: anchor.locationSubjectId,
                name: "荒野神殿",
                type: "location",
                resolved: true,
            },
        unresolvedSubjectIds: anchor.subjectIds.filter((subjectId) => subjectId !== "hero"),
    };
}
