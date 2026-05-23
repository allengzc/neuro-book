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

const NovelScopedSchema = Type.Object({
    novelId: NonEmptyString("Required novel ID. The agent must pass it explicitly; this tool never infers novelId from session."),
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
    threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread when omitted.")),
    chapterPath: Type.Optional(NullableString("Manuscript chapter content-node path. Null removes manuscript ordering.")),
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
    refs: Type.Optional(Type.Array(StoryRefSchema)),
};

const PlotKindSchema = Type.Union([
    Type.Literal("setup"),
    Type.Literal("action"),
    Type.Literal("conflict"),
    Type.Literal("despair"),
    Type.Literal("relief"),
    Type.Literal("reward"),
    Type.Literal("mystery"),
    Type.Literal("reveal"),
    Type.Literal("twist"),
    Type.Literal("payoff"),
    Type.Literal("result"),
]);

const PlotPatchSchema = {
    sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene when omitted.")),
    kind: Type.Optional(PlotKindSchema),
    summary: Type.Optional(Type.String()),
    effect: Type.Optional(NullableString("Plot effect/outcome. Null clears it.")),
    writingTip: Type.Optional(NullableString("Writing tip for this plot. Null clears it.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
};

const GetPlotTreeSchema = NovelScopedSchema;
const GetStoryThreadSchema = Type.Object({...NovelScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread."))});
const GetStorySceneContextSchema = Type.Object({...NovelScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene."))});
const GetChapterPlotSchema = Type.Object({...NovelScopedSchema.properties, chapterPath: NonEmptyString("Manuscript chapter path, e.g. manuscript/001-opening/.")});
const CreateStoryThreadSchema = Type.Object({...NovelScopedSchema.properties, ...ThreadPatchSchema, name: NonEmptyString("Machine-friendly thread name."), title: NonEmptyString("Human-readable thread title.")});
const UpdateStoryThreadSchema = Type.Object({...NovelScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread.")), ...ThreadPatchSchema});
const CreateStorySceneSchema = Type.Object({...NovelScopedSchema.properties, ...ScenePatchSchema, title: NonEmptyString("Human-readable scene title.")});
const UpdateStorySceneSchema = Type.Object({...NovelScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene.")), ...ScenePatchSchema});
const CreateStoryPlotSchema = Type.Object({...NovelScopedSchema.properties, ...PlotPatchSchema, kind: PlotKindSchema, summary: Type.Optional(Type.String())});
const UpdateStoryPlotSchema = Type.Object({...NovelScopedSchema.properties, plotId: NonEmptyString("Plot ID to update."), ...PlotPatchSchema});

type PlotSelection = {
    novelId?: string;
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
 * 创建 v3 plot 工具。novelId 必填；Thread/Scene 焦点写入 session custom state。
 */
export function createPlotTools(): NeuroAgentTool[] {
    return [
        tool("get_plot_tree", "Return the plot tree for the given novel.", GetPlotTreeSchema, async (context, input) => {
            const facade = await loadPlotFacade();
            return plotResult(await facade.getPlotTree(parseNovelId(input.novelId)));
        }),
        tool("get_story_thread", "Read the full detail of a story thread. threadId defaults to plot.selection.", GetStoryThreadSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.novelId, input.threadId);
            const facade = await loadPlotFacade();
            const result = await facade.getStoryThreadDetailDto(parseNovelId(input.novelId), threadId);
            await writeSelection(context, {novelId: input.novelId, threadId: String(threadId), sceneId: undefined});
            return plotResult(result);
        }),
        tool("get_story_scene_context", "Read a story scene with its parent thread and chapter plot view. sceneId defaults to plot.selection.", GetStorySceneContextSchema, async (context, input) => {
            const novelId = parseNovelId(input.novelId);
            const sceneId = await resolveSceneId(context, input.novelId, input.sceneId);
            const facade = await loadPlotFacade();
            const scene = await facade.getStorySceneDetailDto(novelId, sceneId);
            const thread = await facade.getStoryThreadDetailDto(novelId, parseEntityId("threadId", scene.threadId));
            const chapterPlot = scene.chapterPath ? await facade.getChapterPlotDetailDto(novelId, scene.chapterPath) : null;
            await writeSelection(context, {novelId: input.novelId, threadId: scene.threadId, sceneId: String(sceneId)});
            return plotResult({thread, scene, chapterPlot});
        }),
        tool("get_chapter_plot", "Read scenes and plots attached to a manuscript chapter content-node.", GetChapterPlotSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            return plotResult(await facade.getChapterPlotDetailDto(parseNovelId(input.novelId), input.chapterPath));
        }),
        tool("create_story_thread", "Create a new story thread and return its detail.", CreateStoryThreadSchema, async (context, input) => {
            const facade = await loadPlotFacade();
            const {novelId, ...payload} = input;
            const result = await facade.createStoryThread(parseNovelId(novelId), payload);
            await writeSelection(context, {novelId, threadId: result.id, sceneId: undefined});
            return plotResult(result);
        }),
        tool("update_story_thread", "Update a story thread. threadId defaults to plot.selection.", UpdateStoryThreadSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.novelId, input.threadId);
            const facade = await loadPlotFacade();
            const {novelId, threadId: _threadId, ...payload} = input;
            const result = await facade.updateStoryThread(parseNovelId(novelId), threadId, payload);
            await writeSelection(context, {novelId, threadId: result.id, sceneId: undefined});
            return plotResult(result);
        }),
        tool("create_story_scene", "Create a new story scene. threadId defaults to plot.selection.", CreateStorySceneSchema, async (context, input) => {
            const threadId = await resolveThreadId(context, input.novelId, input.threadId);
            const facade = await loadPlotFacade();
            const {novelId, ...payload} = input;
            const result = await facade.createStoryScene(parseNovelId(novelId), normalizeScenePayload({...payload, threadId: String(threadId)}));
            await writeSelection(context, {novelId, threadId: result.threadId, sceneId: result.id});
            return plotResult(result);
        }),
        tool("update_story_scene", "Update a story scene. sceneId defaults to plot.selection.", UpdateStorySceneSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.novelId, input.sceneId);
            const facade = await loadPlotFacade();
            const {novelId, sceneId: _sceneId, ...payload} = input;
            const result = await facade.updateStoryScene(parseNovelId(novelId), sceneId, normalizeScenePayload(payload));
            await writeSelection(context, {novelId, threadId: result.threadId, sceneId: result.id});
            return plotResult(result);
        }),
        tool("create_story_plot", "Create a plot under a story scene. sceneId defaults to plot.selection.", CreateStoryPlotSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.novelId, input.sceneId);
            const facade = await loadPlotFacade();
            const {novelId, ...payload} = input;
            const result = await facade.createStoryPlot(parseNovelId(novelId), {...payload, sceneId: String(sceneId)} as never);
            await writeSelection(context, {novelId, sceneId: result.sceneId});
            return plotResult(result);
        }),
        tool("update_story_plot", "Update a plot. plotId is required; sceneId can move the plot.", UpdateStoryPlotSchema, async (context, input) => {
            const facade = await loadPlotFacade();
            const {novelId, plotId, ...payload} = input;
            const result = await facade.updateStoryPlot(parseNovelId(novelId), parseEntityId("plotId", plotId), payload);
            await writeSelection(context, {novelId, sceneId: result.sceneId});
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

function parseNovelId(novelId: string): number {
    return parseEntityId("novelId", novelId);
}

async function readSelection(context: ToolExecutionContext): Promise<PlotSelection> {
    const session = await context.harness.readSessionContext(context.sessionId, context.workspaceKey);
    const value = session.customState[PLOT_SELECTION_STATE_KEY];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const record = value as Record<string, JsonValue>;
    return {
        novelId: typeof record.novelId === "string" ? record.novelId : undefined,
        threadId: typeof record.threadId === "string" ? record.threadId : undefined,
        sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
    };
}

async function resolveThreadId(context: ToolExecutionContext, novelId: string, threadId?: string): Promise<number> {
    const selection = await readSelection(context);
    const value = threadId ?? readSelectedId(selection, novelId, "threadId");
    if (!value) {
        throw new Error("缺少 threadId；请显式提供 threadId，或先读取/创建一个 Thread 建立 plot.selection。");
    }
    return parseEntityId("threadId", value);
}

async function resolveSceneId(context: ToolExecutionContext, novelId: string, sceneId?: string): Promise<number> {
    const selection = await readSelection(context);
    const value = sceneId ?? readSelectedId(selection, novelId, "sceneId");
    if (!value) {
        throw new Error("缺少 sceneId；请显式提供 sceneId，或先读取/创建一个 Scene 建立 plot.selection。");
    }
    return parseEntityId("sceneId", value);
}

function readSelectedId(selection: PlotSelection, novelId: string, key: "threadId" | "sceneId"): string | undefined {
    if (!selection[key]) {
        return undefined;
    }
    if (selection.novelId && selection.novelId !== novelId) {
        throw new Error(`plot.selection 属于 novelId=${selection.novelId}，本次工具调用传入 novelId=${novelId}；跨 project/novel 访问时请显式提供 ${key}。`);
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
