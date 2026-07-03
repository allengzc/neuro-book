import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterBriefDto,
    ChapterWriterBriefDto,
    ChapterWriterBriefMode,
    ChapterWriterBriefReadingDto,
    ChapterWriterBriefSceneDto,
    ChapterWriterBriefStatus,
    SceneWorldContextDto,
    StoryChapterDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Chapter writer brief 只读聚合服务。
 *
 * 聚合 ChapterBrief(章级写作指令)+ Scene 剧情点 + Scene/Thread refs + Scene World Context,
 * 按 writer 防全知模式渲染两种 markdown:
 * - autonomous:writer 自查 World Engine/lorebook,brief 只给「查哪些 subject / 哪个时间窗」的查询提示,不展开状态。
 * - curated:writer 读不到设定源,brief 展开 World Context 状态摘要,由 leader 投喂前按 mustHide 删减。
 *
 * 信息控制是防全知唯一的按章控制面,四项全空时 status 降级为 needs_chapter_brief,阻断 handoff。
 */
export class ChapterWriterBriefService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly sceneWorldContextService: SceneWorldContextService,
        private readonly anchorResolutionService: SceneWorldAnchorResolutionService,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 生成指定章节的 writer brief DTO 与可直接交给 writer 的 markdown 草案。
     * @param mode 防全知模式;默认 autonomous。
     */
    async getChapterWriterBrief(projectPath: string, chapterId: number, mode: ChapterWriterBriefMode = "autonomous"): Promise<ChapterWriterBriefDto> {
        const story = await this.storyService.ensureStory(projectPath);
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);
        const chapterDto = this.assembler.toStoryChapterDto(chapter);
        const records = await this.sceneRepository.findChapterScenesForBrief(chapter.id);
        const scenes = await this.buildBriefScenes(projectPath, records);
        const suggestedReading = this.buildSuggestedReading(records);
        const warnings = uniqueStrings(scenes.flatMap((scene) => scene.warnings));
        const status = chooseStatus(scenes, chapterDto.brief);
        if (records.length === 0) {
            warnings.push("本章节尚未关联 Plot Scene；请先建立章节 Scene 顺序。");
        }
        if (status === "needs_chapter_brief") {
            warnings.push("信息控制未填写：请在 ChapterBrief 补「读者已知 / 主角已知 / 必须隐藏 / 可暗示」中至少一项，这是防全知唯一的按章控制面。");
        }

        const brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown"> = {
            chapter: chapterDto,
            mode,
            status,
            scenes,
            totalScenes: scenes.length,
            suggestedReading,
            warnings,
        };
        return {
            ...brief,
            suggestedBriefMarkdown: renderSuggestedBriefMarkdown(brief),
        };
    }

    /**
     * 为每个 Scene 组装 brief scene item。
     */
    private async buildBriefScenes(
        projectPath: string,
        records: ChapterWriterBriefSceneWithThread[],
    ): Promise<ChapterWriterBriefSceneDto[]> {
        const rawAnchors = records.map((record) => this.assembler.toStorySceneWorldAnchorDto(record));
        const resolvedAnchors = await this.anchorResolutionService.resolveMany(projectPath, rawAnchors);
        const result: ChapterWriterBriefSceneDto[] = [];

        for (const [index, record] of records.entries()) {
            const worldAnchor = resolvedAnchors[index] ?? rawAnchors[index]!;
            const warnings: string[] = [];
            let worldContext: SceneWorldContextDto | null = null;

            if (record.startInstant === null || record.endInstant === null) {
                warnings.push(`Scene「${record.title}」尚未设置完整 World Engine 时间范围。`);
            } else {
                worldContext = await this.readWorldContext(projectPath, record, warnings);
                if (worldContext && worldContext.unresolvedSubjectIds.length > 0) {
                    warnings.push(`Scene「${record.title}」存在未解析 subject：${worldContext.unresolvedSubjectIds.join(", ")}。`);
                }
                if (worldContext && worldContext.slices.length === 0 && worldContext.subjectStates.length === 0 && worldContext.unresolvedSubjectIds.length === 0) {
                    warnings.push(`Scene「${record.title}」没有可展示的 World Engine 上下文；可继续写作，但建议 leader 复核是否需要补状态。`);
                }
            }

            result.push({
                id: stringifyEntityId(record.id),
                threadId: stringifyEntityId(record.thread.id),
                threadTitle: record.thread.title,
                threadIsMain: record.thread.isMainThread,
                threadSummary: record.thread.summary,
                threadWritingTip: record.thread.writingTip,
                chapterId: record.chapterId === null ? null : stringifyEntityId(record.chapterId),
                chapterSortOrder: record.chapterSortOrder,
                threadSortOrder: record.threadSortOrder,
                title: record.title,
                status: record.status,
                summary: record.summary,
                purpose: record.purpose,
                writingTip: record.writingTip,
                worldAnchor,
                worldContext,
                warnings,
            });
        }

        return result;
    }

    /**
     * 从 Scene refs 编译建议读取清单(仅 content 类内容节点),按 path 去重。
     * 替代 leader 手写「设定复述」;Thread 级 refs 目前不存在,全部标 source=scene。
     */
    private buildSuggestedReading(records: ChapterWriterBriefSceneWithThread[]): ChapterWriterBriefReadingDto[] {
        const seen = new Set<string>();
        const reading: ChapterWriterBriefReadingDto[] = [];
        for (const record of records) {
            for (const ref of record.refs) {
                if (ref.targetKind !== "content") {
                    continue;
                }
                const path = this.assembler.normalizeStoryRefTarget(ref);
                if (seen.has(path)) {
                    continue;
                }
                seen.add(path);
                reading.push({path, relation: ref.relation, note: ref.note, source: "scene"});
            }
        }
        return reading;
    }

    /**
     * 读取单个 Scene 的 World Engine 上下文，失败时只记录通用 warning。
     */
    private async readWorldContext(
        projectPath: string,
        record: ChapterWriterBriefSceneWithThread,
        warnings: string[],
    ): Promise<SceneWorldContextDto | null> {
        try {
            return await this.sceneWorldContextService.getSceneWorldContextForScene(projectPath, record);
        } catch {
            warnings.push(`Scene「${record.title}」的 World Engine 上下文查询失败；请先让 leader 或 world.engine 复核世界状态。`);
            return null;
        }
    }
}

/**
 * 判断信息控制四项是否全空。
 */
function isInfoControlEmpty(brief: ChapterBriefDto): boolean {
    return !brief.readerKnows && !brief.protagonistKnows && !brief.mustHide && !brief.hintOnly;
}

/**
 * 按固定优先级聚合 brief 状态。
 * needs_chapter_brief(信息控制缺失)排在世界上下文之后:先保证 Scene/World 数据完整,再要求信息控制。
 */
function chooseStatus(scenes: ChapterWriterBriefSceneDto[], brief: ChapterBriefDto): ChapterWriterBriefStatus {
    if (scenes.length === 0) {
        return "needs_plot";
    }
    if (scenes.some((scene) => scene.worldAnchor.startInstant === null || scene.worldAnchor.endInstant === null)) {
        return "needs_world_anchor";
    }
    if (scenes.some((scene) => scene.worldContext === null || scene.worldContext.unresolvedSubjectIds.length > 0)) {
        return "needs_world_context";
    }
    if (isInfoControlEmpty(brief)) {
        return "needs_chapter_brief";
    }
    return "ready";
}

/**
 * 渲染可直接作为 writer message 草案的 markdown。
 */
function renderSuggestedBriefMarkdown(brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown">): string {
    const modeLabel = brief.mode === "curated" ? "Curated（受控投喂）" : "Autonomous（自主全知）";
    const lines: string[] = [
        `# Chapter Writer Brief — ${modeLabel}`,
        "",
        `Chapter: ${brief.chapter.title}(name: ${brief.chapter.name})`,
        `Status: ${brief.status}`,
        brief.mode === "curated"
            ? "> 受控模式:writer 读不到设定源,以下状态摘要即写作依据;leader 投喂前必须按「必须隐藏」删减。"
            : "> 自主模式:writer 自行用 execute_world 查证状态与读 lorebook;以下只给框架与查询提示,不含可查询状态。",
        "",
    ];

    appendChapterBriefSections(lines, brief.chapter.brief);

    if (brief.warnings.length > 0) {
        lines.push("## Warnings", ...brief.warnings.map((warning) => `- ${warning}`), "");
    }

    if (brief.scenes.length === 0) {
        lines.push("## 关键剧情点", "- 本章节尚未关联 Plot Scene。", "");
    } else {
        lines.push("## 关键剧情点（按 Scene）");
        for (const [index, scene] of brief.scenes.entries()) {
            lines.push(
                "",
                `### ${index + 1}. ${scene.title}`,
                `- Thread: ${scene.threadTitle}${scene.threadIsMain ? "（主线）" : ""}`,
                `- 本场做什么: ${scene.summary || "未填写"}`,
                `- 本场目的: ${scene.purpose ?? "未填写"}`,
            );
            if (scene.writingTip) {
                lines.push(`- 写作提示: ${scene.writingTip}`);
            }
            if (scene.threadSummary) {
                lines.push(`- 线索脉络: ${scene.threadSummary}`);
            }
            appendSceneWorld(lines, scene, brief.mode);
        }
        lines.push("");
    }

    appendSuggestedReading(lines, brief.suggestedReading);
    return lines.join("\n").trimEnd();
}

/**
 * 渲染 ChapterBrief 章级指令段(目标/参数/信息控制/节奏/禁写)。空字段不渲染,信息控制全空时显式标注必填缺口。
 */
function appendChapterBriefSections(lines: string[], brief: ChapterBriefDto): void {
    const goalParts = [brief.goal, brief.ending ? `落点：${brief.ending}` : null].filter(Boolean);
    if (goalParts.length > 0) {
        lines.push("## 本章目标与落点", ...goalParts.map((part) => `- ${part}`), "");
    }

    const params = [
        brief.pov ? `视角：${brief.pov}` : null,
        brief.tone ? `语气：${brief.tone}` : null,
    ].filter(Boolean);
    if (params.length > 0) {
        lines.push("## 本章参数（覆盖 writer 默认）", ...params.map((part) => `- ${part}`), "");
    }

    lines.push("## 信息控制（必填）");
    const infoControl = [
        brief.readerKnows ? `读者已知：${brief.readerKnows}` : null,
        brief.protagonistKnows ? `主角已知：${brief.protagonistKnows}` : null,
        brief.mustHide ? `必须隐藏：${brief.mustHide}` : null,
        brief.hintOnly ? `可暗示但不可明说：${brief.hintOnly}` : null,
    ].filter(Boolean);
    if (infoControl.length > 0) {
        lines.push(...infoControl.map((part) => `- ${part}`));
    } else {
        lines.push("- ⚠ 未设置：writer 拥有上帝视角查询能力,缺信息控制会导致越界泄露。请在 ChapterBrief 补齐后再交接。");
    }
    lines.push("");

    const pacingParts = [
        brief.pacing ? `节奏：${brief.pacing}` : null,
        brief.opening ? `开场钩子：${brief.opening}` : null,
    ].filter(Boolean);
    if (pacingParts.length > 0) {
        lines.push("## 节奏 / 下一章牵引", ...pacingParts.map((part) => `- ${part}`), "");
    }

    if (brief.doNotWrite) {
        lines.push("## 禁写", `- ${brief.doNotWrite}`, "");
    }
}

/**
 * 按模式渲染单个 Scene 的世界连接:autonomous 给查询提示,curated 展开状态摘要。
 */
function appendSceneWorld(lines: string[], scene: ChapterWriterBriefSceneDto, mode: ChapterWriterBriefMode): void {
    const timeRange = formatRange(scene.worldAnchor.startTime ?? scene.worldAnchor.startInstant, scene.worldAnchor.endTime ?? scene.worldAnchor.endInstant);
    const subjectHint = formatSubjects(scene.worldAnchor.subjects);
    const location = scene.worldAnchor.locationSubject?.name ?? "未指定";

    if (mode === "autonomous") {
        lines.push(`- World 查询提示: 用 execute_world 查 subject [${subjectHint}]${location === "未指定" ? "" : `、地点 ${location}`} 在 ${timeRange} 的状态`);
        return;
    }

    // curated:展开状态摘要,writer 直接依赖。
    lines.push(`- 时间: ${timeRange}｜出场: ${subjectHint}｜地点: ${location}`);
    appendWorldContext(lines, scene.worldContext);
}

/**
 * 渲染简短 World Engine 上下文，避免输出 raw attrs 或 patch JSON。仅 curated 模式使用。
 */
function appendWorldContext(lines: string[], context: SceneWorldContextDto | null): void {
    if (!context) {
        lines.push("  - World context: 暂不可用");
        return;
    }

    if (context.slices.length === 0) {
        lines.push("  - World slices: 无匹配切面");
    } else {
        lines.push("  - World slices:");
        for (const slice of context.slices) {
            lines.push(`    - ${slice.time} ${slice.title}: ${slice.summary || "无摘要"}（相关 patches: ${slice.patchCount}）`);
        }
    }

    if (context.subjectStates.length === 0) {
        lines.push("  - Subject states: 无可展示终态");
    } else {
        lines.push(`  - Subject states: ${context.subjectStates.map((subject) => `${subject.name}(${subject.type})`).join(", ")}`);
    }
}

/**
 * 渲染建议读取清单。
 */
function appendSuggestedReading(lines: string[], reading: ChapterWriterBriefReadingDto[]): void {
    if (reading.length === 0) {
        return;
    }
    lines.push("## 建议读取");
    for (const item of reading) {
        const gloss = item.note ? `${item.relation} · ${item.note}` : item.relation;
        lines.push(`- ${item.path}（${gloss}）`);
    }
    lines.push("");
}

/**
 * 格式化时间范围。
 */
function formatRange(start: string | null, end: string | null): string {
    if (!start || !end) {
        return "未连接";
    }
    return `${start} ~ ${end}`;
}

/**
 * 格式化 Scene subjects。
 */
function formatSubjects(subjects: ChapterWriterBriefSceneDto["worldAnchor"]["subjects"]): string {
    if (subjects.length === 0) {
        return "未指定";
    }
    return subjects.map((subject) => subject.resolved ? subject.name : `${subject.id}（未解析）`).join(", ");
}

/**
 * 保留顺序去重字符串。
 */
function uniqueStrings(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
