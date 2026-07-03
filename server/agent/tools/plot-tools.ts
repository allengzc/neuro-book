import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});
const NullableString = (description: string) => Type.Union([Type.String({minLength: 1, description}), Type.Null({description: "显式清空。"})]);
const StoryRefSchema = Type.Object({
    relation: Type.String(),
    target: Type.String(),
    visibility: Type.Union([Type.Literal("author"), Type.Literal("reader")]),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ProjectScopedSchema = Type.Object({
    projectPath: NonEmptyString("Required Project Path, e.g. workspace/silver-dragon-hime. The agent must pass it explicitly."),
});

const SceneWorldAnchorSchema = Type.Object({
    startTime: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    endTime: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    startInstant: Type.Union([Type.String(), Type.Null()]),
    endInstant: Type.Union([Type.String(), Type.Null()]),
    subjectIds: Type.Array(Type.String({minLength: 1}), {maxItems: 100}),
    locationSubjectId: Type.Union([Type.String({minLength: 1}), Type.Null()]),
});

const ThreadPatchSchema = {
    storyPhaseId: Type.Optional(NullableString("Phase ID to group this thread under. Null moves to ungrouped.")),
    name: Type.Optional(NonEmptyString("Machine-friendly thread name.")),
    title: Type.Optional(NonEmptyString("Human-readable thread title.")),
    isMainThread: Type.Optional(Type.Boolean()),
    status: Type.Optional(Type.Union([
        Type.Literal("active"),
        Type.Literal("draft"),
        Type.Literal("paused"),
        Type.Literal("done"),
        Type.Literal("archived"),
    ])),
    summary: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    writingTip: Type.Optional(NullableString("Writing tip for the thread. Null clears it.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
};

const ScenePatchSchema = {
    threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread.")),
    chapterId: Type.Optional(NullableString("StoryChapter ID to attach this scene to. Null removes chapter ordering.")),
    title: Type.Optional(NonEmptyString("Human-readable scene title.")),
    status: Type.Optional(Type.Union([
        Type.Literal("draft"),
        Type.Literal("active"),
        Type.Literal("written"),
        Type.Literal("revised"),
        Type.Literal("archived"),
    ])),
    summary: Type.Optional(Type.String()),
    purpose: Type.Optional(NullableString("Scene purpose/function. Null clears it.")),
    writingTip: Type.Optional(NullableString("Writing tip for the scene. Null clears it.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    worldAnchor: Type.Optional(SceneWorldAnchorSchema),
    refs: Type.Optional(Type.Array(StoryRefSchema)),
};

// ChapterBrief:章级写作指令。全部可选自由文本;undefined 不修改,null 显式清空。
const ChapterBriefSchema = Type.Object({
    goal: Type.Optional(NullableString("Chapter goal / landing point. Null clears it.")),
    pov: Type.Optional(NullableString("POV, narrative distance and switching constraints. Null clears it.")),
    tone: Type.Optional(NullableString("Tone / emotional temperature / style constraints. Null clears it.")),
    pacing: Type.Optional(NullableString("Pacing, suspense and next-chapter pull. Null clears it.")),
    readerKnows: Type.Optional(NullableString("Info control: what the reader already knows. Null clears it.")),
    protagonistKnows: Type.Optional(NullableString("Info control: what the protagonist knows. Null clears it.")),
    mustHide: Type.Optional(NullableString("Info control: facts that must stay hidden this chapter. Null clears it.")),
    hintOnly: Type.Optional(NullableString("Info control: may be hinted at but never stated. Null clears it.")),
    opening: Type.Optional(NullableString("Opening hook. Null clears it.")),
    ending: Type.Optional(NullableString("Chapter landing / closing line. Null clears it.")),
    doNotWrite: Type.Optional(NullableString("Do-not-write list (secrets, premature reveals). Null clears it.")),
});

const ActPatchSchema = {
    name: Type.Optional(NonEmptyString("Machine-friendly act name (lowercase, digits, hyphens).")),
    title: Type.Optional(NonEmptyString("Human-readable act (volume) title.")),
    summary: Type.Optional(Type.String()),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    sortOrder: Type.Optional(Type.Integer({minimum: 0, description: "Act order within the story."})),
};

const ChapterPatchSchema = {
    actId: Type.Optional(NullableString("Act ID to group this chapter under. Null moves to ungrouped.")),
    name: Type.Optional(NonEmptyString("Machine-friendly chapter name. Prose files point back via frontmatter `chapter: <name>`; renaming breaks existing pointers.")),
    title: Type.Optional(NonEmptyString("Human-readable chapter title.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    sortOrder: Type.Optional(Type.Integer({minimum: 0, description: "Chapter order within the story."})),
    brief: Type.Optional(ChapterBriefSchema),
};

const GetPlotTreeSchema = ProjectScopedSchema;
const GetStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread."))});
const GetStorySceneContextSchema = Type.Object({...ProjectScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene."))});
const GetChapterPlotSchema = Type.Object({...ProjectScopedSchema.properties, chapterId: NonEmptyString("StoryChapter ID. Use get_plot_tree to list chapters.")});
const GetChapterWriterBriefSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    chapterId: NonEmptyString("StoryChapter ID. Use get_plot_tree to list chapters."),
    mode: Type.Optional(Type.Union([Type.Literal("autonomous"), Type.Literal("curated")], {
        description: "Anti-omniscience mode. autonomous (default): writer self-queries World Engine/lorebook, brief gives only query hints. curated: writer can't read sources, brief expands filtered state summaries for the leader to feed.",
    })),
});
const CreateStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, ...ThreadPatchSchema, name: NonEmptyString("Machine-friendly thread name."), title: NonEmptyString("Human-readable thread title.")});
const UpdateStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread.")), ...ThreadPatchSchema});
const CreateStorySceneSchema = Type.Object({...ProjectScopedSchema.properties, ...ScenePatchSchema, title: NonEmptyString("Human-readable scene title.")});
const UpdateStorySceneSchema = Type.Object({...ProjectScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene.")), ...ScenePatchSchema});
const CreateStoryActSchema = Type.Object({...ProjectScopedSchema.properties, ...ActPatchSchema, name: NonEmptyString("Machine-friendly act name (lowercase, digits, hyphens)."), title: NonEmptyString("Human-readable act (volume) title.")});
const UpdateStoryActSchema = Type.Object({...ProjectScopedSchema.properties, actId: NonEmptyString("Act ID."), ...ActPatchSchema});
const CreateStoryChapterSchema = Type.Object({...ProjectScopedSchema.properties, ...ChapterPatchSchema, name: NonEmptyString("Machine-friendly chapter name. Prose files point back via frontmatter `chapter: <name>`."), title: NonEmptyString("Human-readable chapter title.")});
const UpdateStoryChapterSchema = Type.Object({...ProjectScopedSchema.properties, chapterId: NonEmptyString("StoryChapter ID."), ...ChapterPatchSchema});

type PlotSelection = {
    projectPath?: string;
    threadId?: string;
    sceneId?: string;
};

type SceneRefPayload = {
    relation: string;
    target: string;
    visibility: "author" | "reader";
    note?: string | null;
};

type SceneRefPayloadWithNote = Omit<SceneRefPayload, "note"> & {
    note: string | null;
};

/**
 * 创建 v3 plot 工具。projectPath 必填；Thread/Scene 焦点写入 session custom state。
 */
export function createPlotTools(): NeuroAgentTool[] {
    return [
        tool("get_plot_tree", "Return the plot tree for the given Project Workspace.", GetPlotTreeSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            return plotResult(await facade.getPlotTree(input.projectPath));
        }),
        tool("get_story_thread", "Read the full detail of a story thread. threadId defaults to plot.selection.", GetStoryThreadSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.projectPath, input.threadId);
            const facade = await loadPlotFacade();
            const result = await facade.getStoryThreadDetailDto(input.projectPath, threadId);
            await writeSelection(context, {projectPath: input.projectPath, threadId: String(threadId), sceneId: undefined});
            return plotResult(result);
        }),
        tool("get_story_scene_context", "Read a story scene with its parent thread and chapter plot view. sceneId defaults to plot.selection.", GetStorySceneContextSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectPath, input.sceneId);
            const facade = await loadPlotFacade();
            const scene = await facade.getStorySceneDetailDto(input.projectPath, sceneId);
            const thread = await facade.getStoryThreadDetailDto(input.projectPath, parseEntityId("threadId", scene.threadId));
            const chapterPlot = scene.chapterId ? await facade.getChapterPlotDetailDto(input.projectPath, parseEntityId("chapterId", scene.chapterId)) : null;
            await writeSelection(context, {projectPath: input.projectPath, threadId: scene.threadId, sceneId: String(sceneId)});
            return plotResult({thread, scene, chapterPlot});
        }),
        tool("get_scene_world_context", "Read filtered World Engine slices and subject states for a story scene. sceneId defaults to plot.selection.", GetStorySceneContextSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectPath, input.sceneId);
            const facade = await loadPlotFacade();
            const result = await facade.getSceneWorldContext(input.projectPath, sceneId);
            await writeSelection(context, {projectPath: input.projectPath, sceneId: String(sceneId)});
            return plotResult(result);
        }),
        tool("get_chapter_plot", "Read scenes attached to a StoryChapter.", GetChapterPlotSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            return plotResult(await facade.getChapterPlotDetailDto(input.projectPath, parseEntityId("chapterId", input.chapterId)));
        }),
        tool("get_chapter_writer_brief", "Compile a chapter writer brief from ChapterBrief, Plot Scenes and filtered World Engine context. mode=autonomous (default) gives query hints; mode=curated expands state summaries. Returns markdown text for writer handoff and full DTO in details.", GetChapterWriterBriefSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            const result = await facade.getChapterWriterBrief(input.projectPath, parseEntityId("chapterId", input.chapterId), input.mode ?? "autonomous");
            return {
                content: [{type: "text" as const, text: result.suggestedBriefMarkdown}],
                details: result as JsonValue,
            };
        }),
        tool("create_story_act", "Create a story act (volume) in the carrier tree.", CreateStoryActSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, ...payload} = input;
            return plotResult(await facade.createStoryAct(projectPath, payload));
        }),
        tool("update_story_act", "Update a story act (volume).", UpdateStoryActSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, actId, ...payload} = input;
            return plotResult(await facade.updateStoryAct(projectPath, parseEntityId("actId", actId), payload));
        }),
        tool("create_story_chapter", "Create a StoryChapter (carrier tree). Prose files link back via frontmatter `chapter: <name>`. ChapterBrief fields (goal, POV, info control, opening/ending, do-not-write) can be set via `brief`.", CreateStoryChapterSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, ...payload} = input;
            return plotResult(await facade.createStoryChapter(projectPath, payload));
        }),
        tool("update_story_chapter", "Update a StoryChapter, including its ChapterBrief fields via `brief` (undefined keeps, null clears).", UpdateStoryChapterSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, chapterId, ...payload} = input;
            return plotResult(await facade.updateStoryChapter(projectPath, parseEntityId("chapterId", chapterId), payload));
        }),
        tool("create_story_thread", "Create a new story thread and return its detail.", CreateStoryThreadSchema, async (context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, ...payload} = input;
            const result = await facade.createStoryThread(projectPath, payload);
            await writeSelection(context, {projectPath, threadId: result.id, sceneId: undefined});
            return plotResult(result);
        }),
        tool("update_story_thread", "Update a story thread. threadId defaults to plot.selection.", UpdateStoryThreadSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.projectPath, input.threadId);
            const facade = await loadPlotFacade();
            const {projectPath, threadId: _threadId, ...payload} = input;
            const result = await facade.updateStoryThread(projectPath, threadId, payload);
            await writeSelection(context, {projectPath, threadId: result.id, sceneId: undefined});
            return plotResult(result);
        }),
        tool("create_story_scene", "Create a new story scene. threadId defaults to plot.selection.", CreateStorySceneSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.projectPath, input.threadId);
            const facade = await loadPlotFacade();
            const {projectPath, ...payload} = input;
            const result = await facade.createStoryScene(projectPath, normalizeScenePayload({...payload, threadId: String(threadId)}));
            await writeSelection(context, {projectPath, threadId: result.threadId, sceneId: result.id});
            return plotResult(result);
        }),
        tool("update_story_scene", "Update a story scene. sceneId defaults to plot.selection.", UpdateStorySceneSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectPath, input.sceneId);
            const facade = await loadPlotFacade();
            const {projectPath, sceneId: _sceneId, ...payload} = input;
            const result = await facade.updateStoryScene(projectPath, sceneId, normalizeScenePayload(payload));
            await writeSelection(context, {projectPath, threadId: result.threadId, sceneId: result.id});
            return plotResult(result);
        }),
    ];
}

function tool<TSchemaValue extends TSchema>(
    key: string,
    description: string,
    parameters: TSchemaValue,
    execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<AgentToolResult<unknown>>,
): NeuroAgentTool {
    return {
        key,
        name: key,
        label: key,
        executionMode: "sequential",
        description,
        parameters,
        async execute() {
            throw new Error(`${key} 需要 v3 session context。`);
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            return execute(context, params as Static<TSchemaValue>);
        },
    };
}

async function readSelection(context: ToolExecutionContext): Promise<PlotSelection> {
    const session = await context.harness.readSessionContext(context.sessionId, context.workspaceKey);
    const value = session.customState[PLOT_SELECTION_STATE_KEY];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const record = value as Record<string, JsonValue>;
    return {
        projectPath: typeof record.projectPath === "string" ? record.projectPath : undefined,
        threadId: typeof record.threadId === "string" ? record.threadId : undefined,
        sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
    };
}

async function resolveThreadId(context: ToolExecutionContext, projectPath: string, threadId?: string): Promise<number> {
    const selection = await readSelection(context);
    const value = threadId ?? readSelectedId(selection, projectPath, "threadId");
    if (!value) {
        throw new Error("缺少 threadId；请显式提供 threadId，或先读取/创建一个 Thread 建立 plot.selection。");
    }
    return parseEntityId("threadId", value);
}

async function resolveSceneId(context: ToolExecutionContext, projectPath: string, sceneId?: string): Promise<number> {
    const selection = await readSelection(context);
    const value = sceneId ?? readSelectedId(selection, projectPath, "sceneId");
    if (!value) {
        throw new Error("缺少 sceneId；请显式提供 sceneId，或先读取/创建一个 Scene 建立 plot.selection。");
    }
    return parseEntityId("sceneId", value);
}

function readSelectedId(selection: PlotSelection, projectPath: string, key: "threadId" | "sceneId"): string | undefined {
    if (!selection[key]) {
        return undefined;
    }
    if (selection.projectPath && selection.projectPath !== projectPath) {
        throw new Error(`plot.selection 属于 projectPath=${selection.projectPath}，本次工具调用传入 projectPath=${projectPath}；跨 Project 访问时请显式提供 ${key}。`);
    }
    return selection[key];
}

function normalizeScenePayload<TPayload extends {refs?: SceneRefPayload[]}>(payload: TPayload): Omit<TPayload, "refs"> & {refs?: SceneRefPayloadWithNote[]} {
    if (!payload.refs) {
        return payload as Omit<TPayload, "refs"> & {refs?: SceneRefPayloadWithNote[]};
    }
    return {
        ...payload,
        refs: payload.refs.map((ref) => ({
            ...ref,
            note: ref.note ?? null,
        })),
    };
}

async function writeSelection(context: ToolExecutionContext, patch: PlotSelection): Promise<void> {
    const current = await readSelection(context);
    await context.harness.appendCustomState(context.sessionId, PLOT_SELECTION_STATE_KEY, {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
    } as JsonValue, context.workspaceKey);
}

function plotResult(details: unknown): AgentToolResult<unknown> {
    return {
        content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}],
        details: details as JsonValue,
    };
}

async function loadPlotFacade(): Promise<typeof import("nbook/server/plot").plotFacade> {
    return (await import("nbook/server/plot")).plotFacade;
}
