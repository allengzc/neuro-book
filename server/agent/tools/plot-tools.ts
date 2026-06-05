import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";
import {MAX_STORY_SUMMARY_LENGTH} from "nbook/shared/dto/plot.dto";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});
const NullableString = (description: string) => Type.Union([Type.String({minLength: 1, description}), Type.Null({description: "显式清空。"})]);
const NonBlankPlotSummaryString = (description: string) => Type.String({
    minLength: 1,
    maxLength: MAX_STORY_SUMMARY_LENGTH,
    pattern: "\\S",
    description,
});
const StoryRefSchema = Type.Object({
    relation: Type.String(),
    target: Type.String(),
    visibility: Type.Union([Type.Literal("author"), Type.Literal("reader")]),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ProjectScopedSchema = Type.Object({
    projectPath: NonEmptyString("Required Project Path, e.g. workspace/silver-dragon-hime. The agent must pass it explicitly."),
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

const CreateStoryPlotItemSchema = Type.Object({
    kind: PlotKindSchema,
    summary: NonBlankPlotSummaryString("Action-level plot summary. Required for batch creation."),
    effect: Type.Optional(NullableString("Plot effect/outcome. Null leaves it empty.")),
    writingTip: Type.Optional(NullableString("Writing tip for this plot. Null leaves it empty.")),
    note: Type.Optional(NullableString("Optional note. Null leaves it empty.")),
});

const GetPlotTreeSchema = ProjectScopedSchema;
const GetStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread."))});
const GetStorySceneContextSchema = Type.Object({...ProjectScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene."))});
const GetChapterPlotSchema = Type.Object({...ProjectScopedSchema.properties, chapterPath: NonEmptyString("Manuscript chapter path, e.g. manuscript/001-opening/.")});
const CreateStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, ...ThreadPatchSchema, name: NonEmptyString("Machine-friendly thread name."), title: NonEmptyString("Human-readable thread title.")});
const UpdateStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread.")), ...ThreadPatchSchema});
const CreateStorySceneSchema = Type.Object({...ProjectScopedSchema.properties, ...ScenePatchSchema, title: NonEmptyString("Human-readable scene title.")});
const UpdateStorySceneSchema = Type.Object({...ProjectScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene.")), ...ScenePatchSchema});
const CreateStoryPlotSchema = Type.Object({...ProjectScopedSchema.properties, ...PlotPatchSchema, kind: PlotKindSchema, summary: Type.Optional(Type.String())});
const CreateStoryPlotsSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene.")),
    plots: Type.Array(CreateStoryPlotItemSchema, {minItems: 1, maxItems: 50, description: "Plots to append to the same scene, in array order."}),
});
const UpdateStoryPlotSchema = Type.Object({...ProjectScopedSchema.properties, plotId: NonEmptyString("Plot ID to update."), ...PlotPatchSchema});

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
            const chapterPlot = scene.chapterPath ? await facade.getChapterPlotDetailDto(input.projectPath, scene.chapterPath) : null;
            await writeSelection(context, {projectPath: input.projectPath, threadId: scene.threadId, sceneId: String(sceneId)});
            return plotResult({thread, scene, chapterPlot});
        }),
        tool("get_chapter_plot", "Read scenes and plots attached to a manuscript chapter content-node.", GetChapterPlotSchema, async (_context, input) => {
            const facade = await loadPlotFacade();
            return plotResult(await facade.getChapterPlotDetailDto(input.projectPath, input.chapterPath));
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
        tool("create_story_plot", "Create a plot under a story scene. sceneId defaults to plot.selection.", CreateStoryPlotSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectPath, input.sceneId);
            const facade = await loadPlotFacade();
            const {projectPath, ...payload} = input;
            const result = await facade.createStoryPlot(projectPath, {...payload, sceneId: String(sceneId)} as never);
            await writeSelection(context, {projectPath, sceneId: result.sceneId});
            return plotResult(result);
        }),
        tool("create_story_plots", "Create multiple plots under the same story scene. sceneId defaults to plot.selection; plots are appended in array order.", CreateStoryPlotsSchema, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectPath, input.sceneId);
            const facade = await loadPlotFacade();
            const {projectPath, plots} = input;
            const result = await facade.createStoryPlots(projectPath, {sceneId: String(sceneId), plots});
            await writeSelection(context, {projectPath, threadId: result.scene.threadId, sceneId: result.scene.id});
            return plotResult(result);
        }),
        tool("update_story_plot", "Update a plot. plotId is required; sceneId can move the plot.", UpdateStoryPlotSchema, async (context, input) => {
            const facade = await loadPlotFacade();
            const {projectPath, plotId, ...payload} = input;
            const result = await facade.updateStoryPlot(projectPath, parseEntityId("plotId", plotId), payload);
            await writeSelection(context, {projectPath, sceneId: result.sceneId});
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
