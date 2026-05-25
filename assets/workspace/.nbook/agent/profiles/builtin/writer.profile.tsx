/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {dirname, isAbsolute, join, posix, relative, resolve} from "node:path";
import type {Static} from "typebox";
import {z} from "zod";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {WriterInputSchema, WriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Message, ModelContext, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildWritingReference} from "nbook/server/agent/profiles/writer-writing-reference";
import {buildWritingStyle} from "nbook/server/agent/profiles/writer-writing-style";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import {parseFrontmatterDocument, renderFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import type {ChapterPlotDetailDto} from "nbook/shared/dto/plot.dto";

export const profileManifest = {
    key: "writer",
    name: "Writer",
    description: "专用正文写作 agent，保留小猫之神 persona、写作风格约束和参考文档流程。",
} as const;

export const InputSchema = WriterInputSchema;
export const OutputSchema = WriterOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["read", "write", "edit", "apply_patch", "report_result"] as const;
const WriterFrontmatterSchema = z.record(z.string(), z.unknown());
const WRITER_INDEX_FRONTMATTER_KEYS = ["title", "type", "status", "summary", "aliases", "tags", "refs"] as const;
const WRITER_STATE_FRONTMATTER_KEYS = ["statusNote", "updatedAt", "knowledge"] as const;

type WriterChapterTarget = {
    novelId: number;
    workspaceSlug: string;
    chapterPath: string;
    workspaceChapterPath: string;
    indexPath: string;
    chapterPlot: ChapterPlotDetailDto;
};

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    async context(ctx) {
        return buildWriterPrompt(ctx);
    },
});

/**
 * 构造 writer prompt。保留 v2 的同名 helper 入口，但返回当前 v3 TSX Profile DSL。
 */
export async function buildWriterPrompt(ctx: ProfilePrepareContext<Input>) {
    const writingStyle = await buildWritingStyle({preset: ctx.input.writingStylePreset});
    const writingReference = await buildWritingReference({preset: ctx.input.writingReferencePreset});
    const chapterTargets = await resolveWriterChapterTargets(ctx);
    const chapterPlotsText = renderChapterPlotsText(chapterTargets);
    const lorebookText = await buildLorebookText(ctx.session.workspaceRoot, ctx.input.lorebookEntries ?? []);
    return (
        <ProfilePrompt>
            <System>{renderSystemPrompt({writingStyle, writingReference})}</System>
            <HistorySet>
                <Message>{renderStableWriterContext()}</Message>
            </HistorySet>
            <ModelContext>
                <Message>{renderInputContext(ctx, {chapterTargets, chapterPlotsText, lorebookText})}</Message>
            </ModelContext>
            <AppendingSet>
                <Message>{`【写作要求】\n${ctx.input.prompt}`}</Message>
            </AppendingSet>
        </ProfilePrompt>
    );
}

function renderSystemPrompt(input: {
    writingStyle: string;
    writingReference: string;
}): string {
    return profileText`
        你是 Neuro Book 的 Writer 子代理，persona 是“小猫之神”。你是一只具有神力的可爱小猫喵，负责把调用方给出的章节剧情、设定节点和写作约束落实成单章正文或单章修改。

        <assistant_definition>
        <role>小猫之神</role>
        <description>你担任 NeuroBook 系统的 Writer 职位，会为信徒创作轻松愉悦、细腻鲜活、符合任务边界的剧情正文。</description>
        <reminder>你是这个故事的创作者，而不是故事里的任何角色。不要把自己代入角色。</reminder>
        </assistant_definition>

        <neurobook_writer_contract>
        - chapterPaths 对应本 writer session 绑定的唯一章节。调用方必须先创建章节内容节点，并在 Plot System 中把 Scene 挂到该章节。
        - chapterPaths 同时是剧情上下文来源和写入目标。系统会在进入模型前读取本章 Scene、Thread、Plots 和 Chapter Plot；你只写显式传入的这一章，不根据自然语言章节名或 UI active scene 猜测其他落点。
        - lorebookEntries 对应内容节点路径，按 Agent cwd 解析。普通小说 agent 的 cwd 是 workspace 容器根，因此通常应是 novel-slug/lorebook/... 或 novel-slug/manuscript/...。writer 会按数组顺序读取每个节点的 index.md 与同级可选 state.md，并把稳定设定、当前状态和信息差作为写作依据。
        - constraints 对应额外写作约束、格式约束、禁忌和用户临时偏好。
        - prompt 对应用户本次要求写什么、改写什么、补全什么。
        </neurobook_writer_contract>

        # 工作边界

        - 你是创作者，不是故事里的角色。不要把自己代入正文人物。
        - 只根据输入里的 prompt、chapterPaths、chapter_plots、lorebookEntries 和 constraints 写作，不擅自新增关键世界观事实。
        - 目标章节 index.md 是唯一文件落点。默认根据 prompt 判断重写或局部修改；需要完整成稿时可以用 write，局部改写或润色优先用 edit / apply_patch。
        - 完成后必须调用 report_result。walkthrough 说明写入路径、润色情况和约 100 字剧情总结；data.summary 给出本次写作摘要，data.outputPath 仅在真实写入文件时提供。

        # 写作流程

        1. 读取必要上下文：先 read 目标章节 index.md；lorebookEntries 已足够时不要额外检索。
        2. 写入或生成正文：正文采用完整自然段，不把分析、工具说明、summary 混入正文。
        3. 润色复查：检查写作风格、视角边界、角色表现、禁用词和剧情点覆盖度。
        4. 修改成稿：局部修改用 edit；成块统一变更才用 apply_patch。
        5. report_result 结束。

        # 小猫之神思考要求

        思考时可以用可爱俏皮的第一人称喵喵叫，但正文和交付内容必须服务作品本身。先确认写作对象、场景目标、必须覆盖的剧情点、设定边界、角色知道/不知道的信息，再动笔。
        思考顺序：确认目标章节和正文边界；回顾 chapter_plots；逐条回顾 lorebookEntries；整理 constraints；辨别视角和信息边界；规划角色动作、互动、台词和环境承载的情绪；检查文风禁用项与段落节奏；确认是重写还是局部修改。

        # 文风与正文约束

        - 默认第三人称。除非输入明确要求第一人称、第二人称、书信体、日志体等。
        - 角色情绪要通过动作、选择、停顿、台词、站位、环境互动表达，少用情绪标签解释。
        - 避免全知视角越界：角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。
        - 正文采用完整长自然段叙述；对话可以独立成段，但不要把每个动作、表情、停顿都拆成单句短段。
        - 禁止词：一丝、不容置疑、不易察觉、几不可察。
        - 禁止句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。

        # 内容节点规则

        内容节点是 NeuroBook 的 workspace 知识单元。lorebook 与 manuscript 都使用“目录 + index.md”的节点结构，同级 state.md 是可选当前状态。
        - index.md 的 frontmatter 是元数据，不是小说正文；不要把字段名、配置项或注释写进故事。
        - index.md 正文是稳定设定、关系、世界规则、角色资料和长期写作约束；state.md 正文与 frontmatter 是当前状态补充。
        - status: active 是已确认事实；draft 使用时要保守；pending 不能当成确定事实；archived 默认不作为当前事实。
        - knowledge[] 只说明谁知道什么、谁误解什么、谁尚不知道什么；它不是全员共享情报。

        # 视角边界与角色表现

        - 角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。不要因为设定写在节点里，就默认场内每个角色都知道。
        - 秘密、伏笔、地点规则或他人动机，可以写成读者可见的客观现象、误解、试探或遮掩，不能写成角色已经理解。
        - 情绪不要直接贴标签。结合角色性格、经历、处境和关系，用具体动作、沉默、回避、靠近、打断、转移话题、整理物件、站位变化和环境互动表达。
        - 台词本身是情绪载体。不要频繁在台词后挂“声音里带着疲惫”“语气满是委屈”这类解释。

        # 段落节奏与 Markdown 方言

        - 正文采用完整长自然段叙述，不要单句成段。对话可以独立成段，但不要把每一个动作、表情、停顿都拆成短段。
        - 工作区引用使用普通 Markdown link；正式小说正文不要主动塞 inline-comment，除非任务要求批注或审稿意见。
        - 支持 <inline-comment>、<mark>、<span style="color: ...">、<sup>、<sub> 和 <align value="center"> 等 NeuroBook Markdown 扩展，但正式正文只在任务需要时使用。

        # 润色工作流与输出协议

        - 文件写作任务：先 read 目标章节 index.md，write 写入正文或用 edit / apply_patch 修改，必要时 edit 逐处润色；只有成块改动才用 apply_patch；最后 report_result。
        - 如果本轮先用 write 写入新正文，随后必须把该文件视为待润色原文，完成一次复查。
        - 不输出 <summary> 标签，不输出“小猫之神的留言”，不把写作分析、自检过程或替换清单混进正文。
        - report_result.walkthrough 包含已写入或修改的文件路径、润色是否完成，以及剧情总结；data.summary 给出摘要，data.outputPath 仅在真实写入文件时提供。

        # 写作风格与参考文档

        下面的 writing style 与 writing reference 来自 writer assets 机制。系统目录 agent/writing-presets 提供默认预设，用户 assets 中的同名 Markdown 文件可以覆盖系统文件。

        ${input.writingStyle}

        ${input.writingReference}
    `;
}

function renderStableWriterContext(): string {
    return profileText`
        <system-reminder>
        Writer 使用 v3 文件工具：read / write / edit / apply_patch。不要使用历史版本的文件工具命名。
        Agent cwd 通常是 workspace 容器根。内容节点路径通常是 novel-slug/lorebook/.../ 或 novel-slug/manuscript/.../；目录节点的正文入口是 index.md，同级 state.md 是当前状态。
        chapterPaths 绑定本 writer session 的唯一章节；写作目标是该章节 index.md，不要写 workspace/novel-slug/...。
        frontmatter 是元数据，不是小说正文；不要把字段名或配置项写进故事。
        </system-reminder>
    `;
}

function renderInputContext(ctx: ProfilePrepareContext<Input>, expanded: {
    chapterTargets: WriterChapterTarget[];
    chapterPlotsText: string;
    lorebookText: string;
}): string {
    const input = ctx.input;
    const target = expanded.chapterTargets[0];
    return [
        "<dynamic-context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        target ? `Target chapter: ${target.workspaceChapterPath}` : "",
        target ? `Writing target index.md: ${target.indexPath}` : "",
        target ? `Novel ID: ${String(target.novelId)}` : "",
        input.writingStylePreset ? `Writing style preset: ${input.writingStylePreset}` : "",
        input.writingReferencePreset ? `Writing reference preset: ${input.writingReferencePreset}` : "",
        expanded.lorebookText ? `<lorebook_entries>\n${expanded.lorebookText}\n</lorebook_entries>` : "",
        expanded.chapterPlotsText ? `<chapter_plots>\n${expanded.chapterPlotsText}\n</chapter_plots>` : "",
        !expanded.lorebookText && input.lorebookEntries?.length ? [
            "Lorebook entries:",
            ...input.lorebookEntries.map((entry) => `- ${entry}`),
        ].join("\n") : "",
        input.constraints?.length ? ["Constraints:", ...input.constraints.map((item) => `- ${item}`)].join("\n") : "",
        "</dynamic-context>",
    ].filter(Boolean).join("\n");
}

/**
 * 读取 writer 输入中的内容节点引用并组装为 prompt 文本。
 */
async function buildLorebookText(workspaceRoot: string, entries: NonNullable<Input["lorebookEntries"]>): Promise<string> {
    const blocks: string[] = [];
    for (const entry of entries) {
        try {
            const nodeFiles = await readContentNodeFiles(workspaceRoot, entry);
            blocks.push([
                `## ${entry}`,
                "",
                "### index.md",
                nodeFiles.indexText,
                nodeFiles.stateText ? "\n### state.md" : "",
                nodeFiles.stateText ?? "",
            ].filter((line) => line !== "").join("\n"));
        } catch (error) {
            throw new Error(`writer 无法解析 lorebookEntries 节点 ${entry}: ${formatPromptError(error)}`);
        }
    }
    return blocks.join("\n\n---\n\n");
}

/**
 * 解析 writer 绑定的唯一章节，并读取章节剧情上下文。
 */
async function resolveWriterChapterTargets(ctx: ProfilePrepareContext<Input>): Promise<WriterChapterTarget[]> {
    if (ctx.input.chapterPaths.length !== 1) {
        throw new Error("writer.chapterPaths 必须且只能包含一个章节路径；多章节写作请创建多个 writer agent。");
    }
    const target = await resolveWriterChapterTarget(ctx.session.novelId ?? null, ctx.input.chapterPaths[0]);
    const facade = await loadPlotFacade();
    try {
        const chapterPlot = await facade.getChapterPlotDetailDto(target.novelId, target.chapterPath);
        return [{...target, chapterPath: chapterPlot.chapterPath, chapterPlot}];
    } catch (error) {
        throw new Error(`writer 无法解析 chapterPaths[0] 章节 ${ctx.input.chapterPaths[0]}: ${formatPromptError(error)}`);
    }
}

/**
 * 将输入路径解析为当前 Project Workspace 或显式 Project Workspace 中的章节。
 */
async function resolveWriterChapterTarget(sessionNovelIdText: string | null, rawChapterPath: string): Promise<Omit<WriterChapterTarget, "chapterPlot">> {
    const normalized = normalizeInputPath(rawChapterPath);
    const currentPrefix = normalizeChapterPath(normalized);
    if (currentPrefix) {
        const novelId = resolveSessionNovelId(sessionNovelIdText);
        const workspaceSlug = await findWorkspaceSlugByNovelId(novelId);
        return buildChapterTarget(novelId, workspaceSlug, currentPrefix);
    }
    const [workspaceSlug, ...rest] = normalized.split("/");
    const chapterPath = normalizeChapterPath(rest.join("/"));
    if (!workspaceSlug || !chapterPath) {
        throw new Error("chapterPaths 必须是 manuscript/.../ 或 novel-slug/manuscript/.../，且必须指向章节目录。");
    }
    const novelId = await findNovelIdByWorkspaceSlug(workspaceSlug);
    return buildChapterTarget(novelId, workspaceSlug, chapterPath);
}

function buildChapterTarget(novelId: number, workspaceSlug: string, chapterPath: string): Omit<WriterChapterTarget, "chapterPlot"> {
    const workspaceChapterPath = posix.join(workspaceSlug, chapterPath);
    return {
        novelId,
        workspaceSlug,
        chapterPath,
        workspaceChapterPath,
        indexPath: posix.join(workspaceChapterPath, "index.md"),
    };
}

function normalizeInputPath(rawPath: string): string {
    return rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^workspace\//, "");
}

function normalizeChapterPath(rawPath: string): string | null {
    const withoutIndex = rawPath.replace(/\/index\.md$/u, "/");
    if (!withoutIndex.startsWith("manuscript/")) {
        return null;
    }
    return withoutIndex.endsWith("/") ? withoutIndex : `${withoutIndex}/`;
}

function renderChapterPlotsText(targets: WriterChapterTarget[]): string {
    return targets.map((target) => renderChapterTargetBlock(target)).join("\n\n---\n\n");
}

/**
 * 读取单个内容节点的 index.md 与可选 state.md。
 */
async function readContentNodeFiles(workspaceRoot: string, entry: NonNullable<Input["lorebookEntries"]>[number]): Promise<{
    indexText: string;
    stateText: string | null;
}> {
    if (!workspaceRoot.trim()) {
        throw new Error(`当前 session 没有 workspaceRoot，无法读取内容节点 ${entry}`);
    }
    const indexPath = resolveContentNodeIndexPath(workspaceRoot, entry);
    const statePath = join(dirname(indexPath), "state.md");
    let indexRaw = "";
    try {
        indexRaw = await readFile(indexPath, "utf-8");
    } catch (error) {
        throw new Error(`无法读取内容节点 index.md: ${formatPromptError(error)}。节点路径：${entry}`);
    }
    const indexText = sanitizeWriterFacingMarkdown(indexRaw, WRITER_INDEX_FRONTMATTER_KEYS);
    const stateText = await readFile(statePath, "utf-8").then((content) => sanitizeWriterFacingMarkdown(
        content,
        WRITER_STATE_FRONTMATTER_KEYS,
    )).catch((error: unknown) => {
        if (isFileMissingError(error)) {
            return null;
        }
        throw new Error(`无法读取内容节点 state.md: ${formatPromptError(error)}。节点路径：${entry}`);
    });
    return {indexText, stateText};
}

/**
 * 将内容节点路径解析为 workspace 内的 index.md 绝对路径。
 */
function resolveContentNodeIndexPath(workspaceRoot: string, nodePath: string): string {
    const root = resolve(workspaceRoot);
    const trimmedPath = nodePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const relativeIndexPath = trimmedPath.endsWith(".md")
        ? trimmedPath
        : posix.join(trimmedPath.replace(/\/+$/, ""), "index.md");
    const absolutePath = resolve(root, relativeIndexPath);
    const relativeToWorkspace = relative(root, absolutePath);
    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
        throw new Error(`内容节点路径越过 workspace: ${nodePath}`);
    }
    return absolutePath;
}

/**
 * 只把写作相关 frontmatter 暴露给 writer，隐藏检索、注入、治理和扩展字段。
 */
function sanitizeWriterFacingMarkdown(content: string, allowedKeys: readonly string[]): string {
    try {
        const parsed = parseFrontmatterDocument(content, WriterFrontmatterSchema);
        const body = parsed.body.trim();
        if (!parsed.hasFrontmatter) {
            return body || "空";
        }
        const frontmatter = pickWriterFacingFrontmatter(parsed.rawFrontmatter, allowedKeys);
        if (Object.keys(frontmatter).length === 0) {
            return body || "空";
        }
        return renderFrontmatterDocument(frontmatter, `${body || "空"}\n`).trim();
    } catch {
        const body = stripFrontmatterBody(content).trim();
        return ["frontmatter 解析失败，已隐藏元数据。", "", body || "空"].join("\n");
    }
}

/**
 * 选出 writer 可见的 frontmatter 字段，并对结构化引用做二次白名单。
 */
function pickWriterFacingFrontmatter(rawFrontmatter: Record<string, unknown>, allowedKeys: readonly string[]): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};
    for (const key of allowedKeys) {
        if (!(key in rawFrontmatter)) {
            continue;
        }
        if (key === "refs") {
            frontmatter.refs = sanitizeRefs(rawFrontmatter.refs);
            continue;
        }
        if (key === "aliases" || key === "tags" || key === "knowledge") {
            frontmatter[key] = sanitizeStringArray(rawFrontmatter[key]);
            continue;
        }
        frontmatter[key] = rawFrontmatter[key];
    }
    return frontmatter;
}

function sanitizeRefs(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!isRecord(item)) {
            return [];
        }
        const ref: Record<string, unknown> = {};
        for (const key of ["relation", "target", "note"] as const) {
            if (key in item) {
                ref[key] = item[key];
            }
        }
        return Object.keys(ref).length > 0 ? [ref] : [];
    });
}

function sanitizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stripFrontmatterBody(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u);
    return match?.[1] ?? content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileMissingError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as {code?: unknown}).code === "ENOENT");
}

function renderChapterTargetBlock(target: WriterChapterTarget): string {
    return [
        `## Chapter: ${target.workspaceChapterPath}`,
        `novelId: ${String(target.novelId)}`,
        `workspaceSlug: ${target.workspaceSlug}`,
        `indexPath: ${target.indexPath}`,
        "",
        "### Chapter Plot",
        renderChapterPlot(target.chapterPlot),
    ].join("\n");
}

function renderChapterPlot(chapterPlot: ChapterPlotDetailDto): string {
    return [
        `chapterPath: ${chapterPlot.chapterPath}`,
        `totalScenes: ${String(chapterPlot.totalScenes)}`,
        `totalPlots: ${String(chapterPlot.totalPlots)}`,
        "",
        chapterPlot.scenes.length > 0 ? chapterPlot.scenes.map((item) => renderChapterScene(item)).join("\n\n") : "空",
    ].join("\n");
}

function renderChapterScene(scene: ChapterPlotDetailDto["scenes"][number]): string {
    return [
        `- sceneId: ${scene.id}`,
        `  title: ${scene.title}`,
        `  threadTitle: ${scene.threadTitle}`,
        `  status: ${scene.status}`,
        `  summary: ${scene.summary}`,
        `  purpose: ${scene.purpose ?? "空"}`,
        `  chapterSortOrder: ${scene.chapterSortOrder ?? "空"}`,
        `  threadSortOrder: ${String(scene.threadSortOrder)}`,
        scene.plots.length > 0 ? `  plots: ${scene.plots.map((plot) => `${plot.kind}:${plot.summary}`).join(" | ")}` : "  plots: 空",
    ].join("\n");
}

function resolveSessionNovelId(novelIdText: string | null): number {
    if (!novelIdText || !novelIdText.trim()) {
        throw new Error("writer 无法解析 chapterPaths：使用 manuscript/.../ 当前 Project Workspace 路径时，session 必须绑定 novelId；跨 Project Workspace 请传 novel-slug/manuscript/.../。");
    }
    return parseEntityId("novelId", novelIdText);
}

async function findWorkspaceSlugByNovelId(novelId: number): Promise<string> {
    const prisma = await loadPrisma();
    const novel = await prisma.novel.findUnique({
        where: {id: novelId},
        select: {workspaceSlug: true},
    });
    if (!novel) {
        throw new Error(`小说不存在：novelId=${String(novelId)}`);
    }
    return novel.workspaceSlug;
}

async function findNovelIdByWorkspaceSlug(workspaceSlug: string): Promise<number> {
    const prisma = await loadPrisma();
    const novel = await prisma.novel.findUnique({
        where: {workspaceSlug},
        select: {id: true},
    });
    if (!novel) {
        throw new Error(`Project Workspace 不存在或未绑定小说：${workspaceSlug}`);
    }
    return novel.id;
}

function formatPromptError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function loadPlotFacade(): Promise<typeof import("nbook/server/plot").plotFacade> {
    return (await import("nbook/server/plot")).plotFacade;
}

async function loadPrisma(): Promise<typeof import("nbook/server/utils/prisma").prisma> {
    return (await import("nbook/server/utils/prisma")).prisma;
}
