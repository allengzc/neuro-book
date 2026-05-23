/**
 * Route-to-Schema mapping for runtime OpenAPI spec generation.
 *
 * Maps each non-agent API route to its request/response Zod schemas,
 * tags, summary, and query parameters. Used by `generate-spec.ts`
 * to produce the full OpenAPI 3.0 spec at request time.
 *
 * AUTO-MAINTAINED: When you add/change Zod schemas in shared/dto/,
 * update this file.
 */

import type { z } from "zod";

// ─── Novel DTOs ──────────────────────────────────────────────────
import {
    CreateNovelRequestDtoSchema,
    NovelListItemDtoSchema,
    UpdateNovelRequestDtoSchema,
} from "nbook/shared/dto/novel-chapter.dto";

// ─── Plot DTOs ───────────────────────────────────────────────────
import {
    CreateStoryPhaseRequestDtoSchema,
    CreateStoryPlotRequestDtoSchema,
    CreateStorySceneRequestDtoSchema,
    CreateStoryThreadRequestDtoSchema,
    PlotTreeDtoSchema,
    PlotWorkbenchDtoSchema,
    ReorderStoryPhasesRequestDtoSchema,
    ReorderStoryPlotsRequestDtoSchema,
    ReorderStoryScenesRequestDtoSchema,
    ReorderStoryThreadsRequestDtoSchema,
    StoryDtoSchema,
    StoryPhaseDtoSchema,
    StoryPlotDtoSchema,
    StorySceneDetailDtoSchema,
    StoryThreadDetailDtoSchema,
    UpdateStoryPhaseRequestDtoSchema,
    UpdateStoryPlotRequestDtoSchema,
    UpdateStoryRequestDtoSchema,
    UpdateStorySceneRequestDtoSchema,
    UpdateStoryThreadRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";

// ─── Settings DTOs ───────────────────────────────────────────────
import {
    CheckModelRequestDtoSchema,
    CheckModelResponseDtoSchema,
    CheckProviderRequestDtoSchema,
    CheckProviderResponseDtoSchema,
    DiscoverProviderModelsRequestDtoSchema,
    DiscoverProviderModelsResponseDtoSchema,
} from "nbook/shared/dto/app-settings.dto";
import {
    ConfigEditorSnapshotDtoSchema,
    ConfigSnapshotDtoSchema,
    ConfigWorkspaceQueryDtoSchema,
    GlobalConfigDtoSchema,
    ProjectConfigDtoSchema,
} from "nbook/shared/dto/config.dto";

// ─── AI / Writing DTOs ──────────────────────────────────────────
import {
    FormAnnotationRequestDtoSchema,
    FormAnnotationResponseDtoSchema,
} from "nbook/shared/dto/ai-form-annotation.dto";
import {
    NovelContinueRequestDtoSchema,
} from "nbook/shared/dto/novel.dto";

// ─── Success response (for DELETE and simple operations) ────────
import { z as z_ } from "zod";
const SuccessResponseSchema = z_.object({ success: z_.boolean() });

// ─── Route meta entry type ──────────────────────────────────────

export interface RouteMetaEntry {
    /** Relative path from server/api/, e.g. "novels/index.post.ts" */
    file: string;
    /** HTTP method */
    method: "get" | "post" | "put" | "patch" | "delete";
    /** OpenAPI tags for grouping */
    tags: string[];
    /** Short summary for the operation */
    summary: string;
    /** Zod schema for request body (null for GET/DELETE) */
    requestBody?: z.ZodType | null;
    /** Zod schema for response body (null to omit) */
    responseBody?: z.ZodType | null;
    /** Query parameter definitions (workspace-files GET routes) */
    queryParams?: z.ZodObject<any> | null;
}

// ─── Inline query param schemas for workspace-files routes ──────

const ReadQuerySchema = z_.object({
    path: z_.string().trim().min(1, "path 不能为空").describe("File path to read"),
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
});

const StatQuerySchema = z_.object({
    path: z_.string().trim().min(1, "path 不能为空").describe("Path to stat"),
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
});

const TreeQuerySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    type: z_.string().optional().describe("Filter by content type"),
    depth: z_.string().optional().describe("Maximum tree depth (parsed as integer)"),
    target: z_.union([z_.string(), z_.array(z_.string())]).optional().describe("Target path(s) to scan"),
});

const ValidateQuerySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    target: z_.union([z_.string(), z_.array(z_.string())]).optional().describe("Target path(s) to validate"),
    recursive: z_.union([z_.string(), z_.boolean()]).optional().describe("Recursive validation"),
});

// ─── Inline request schemas for workspace-files routes ──────────

const WriteBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path"),
    content: z_.string().describe("File content"),
});

const CreateFileBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path"),
    content: z_.string().optional().describe("Initial file content"),
});

const CreateDirBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("Directory path"),
    indexContent: z_.string().nullable().optional().describe("Index file content"),
});

const RenameBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    from: z_.string().trim().min(1, "from 不能为空").describe("Source path"),
    to: z_.string().trim().min(1, "to 不能为空").describe("Destination path"),
});

const DeleteBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("Path to delete"),
    recursive: z_.boolean().optional().default(false).describe("Delete recursively"),
});

const ConvertBodySchema = z_.object({
    root: z_.string().optional().describe("Workspace root directory"),
    novelId: z_.string().optional().describe("Novel id used to resolve isolated workspace"),
    workspaceKind: z_.literal("user-assets").optional().describe("Use the global user assets workspace"),
    path: z_.string().trim().min(1, "path 不能为空").describe("File path to convert"),
});

// ─── Route map ──────────────────────────────────────────────────

export const routeMetaMap: RouteMetaEntry[] = [
    // ═══ Hello ═══
    {
        file: "hello.get.ts",
        method: "get",
        tags: ["Hello"],
        summary: "Server health check — returns message and server time",
    },

    // ═══ Novels ═══
    {
        file: "novels/index.get.ts",
        method: "get",
        tags: ["Novels"],
        summary: "List all novels",
        responseBody: z_.array(NovelListItemDtoSchema),
    },
    {
        file: "novels/index.post.ts",
        method: "post",
        tags: ["Novels"],
        summary: "Create a new novel with an auto-created Story",
        requestBody: CreateNovelRequestDtoSchema,
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
        }),
    },
    {
        file: "novels/[novelId].get.ts",
        method: "get",
        tags: ["Novels"],
        summary: "Get a novel",
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
        }),
    },
    {
        file: "novels/[novelId].patch.ts",
        method: "patch",
        tags: ["Novels"],
        summary: "Update novel title and/or summary",
        requestBody: UpdateNovelRequestDtoSchema,
        responseBody: NovelListItemDtoSchema.omit({
            volumeCount: true,
            chapterCount: true,
            totalWords: true,
        }),
    },
    {
        file: "novels/[novelId].delete.ts",
        method: "delete",
        tags: ["Novels"],
        summary: "Delete a novel and its plot data",
        responseBody: SuccessResponseSchema,
    },

    // ═══ Plot: Story ═══
    {
        file: "novels/[novelId]/plot/story.get.ts",
        method: "get",
        tags: ["Plot"],
        summary: "Get the story for a novel",
        responseBody: StoryDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/story.patch.ts",
        method: "patch",
        tags: ["Plot"],
        summary: "Update story title, summary, and/or note",
        requestBody: UpdateStoryRequestDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/tree.get.ts",
        method: "get",
        tags: ["Plot"],
        summary: "Get the full plot tree (story + phases + threads + scenes + plots)",
        responseBody: PlotTreeDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/workbench.get.ts",
        method: "get",
        tags: ["Plot"],
        summary: "Get plot workbench data with threads, scenes, plots, and scene refs",
        responseBody: PlotWorkbenchDtoSchema,
    },

    // ═══ Plot: Phases ═══
    {
        file: "novels/[novelId]/plot/phases/index.post.ts",
        method: "post",
        tags: ["Plot Phases"],
        summary: "Create a new story phase",
        requestBody: CreateStoryPhaseRequestDtoSchema,
        responseBody: StoryPhaseDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/phases/[phaseId].get.ts",
        method: "get",
        tags: ["Plot Phases"],
        summary: "Get a story phase",
        responseBody: StoryPhaseDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/phases/[phaseId].patch.ts",
        method: "patch",
        tags: ["Plot Phases"],
        summary: "Update a story phase",
        requestBody: UpdateStoryPhaseRequestDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/phases/[phaseId].delete.ts",
        method: "delete",
        tags: ["Plot Phases"],
        summary: "Delete a story phase",
        responseBody: SuccessResponseSchema,
    },
    {
        file: "novels/[novelId]/plot/phases/reorder.post.ts",
        method: "post",
        tags: ["Plot Phases"],
        summary: "Reorder all story phases",
        requestBody: ReorderStoryPhasesRequestDtoSchema,
    },

    // ═══ Plot: Threads ═══
    {
        file: "novels/[novelId]/plot/threads/index.post.ts",
        method: "post",
        tags: ["Plot Threads"],
        summary: "Create a new story thread",
        requestBody: CreateStoryThreadRequestDtoSchema,
        responseBody: StoryThreadDetailDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/threads/[threadId].get.ts",
        method: "get",
        tags: ["Plot Threads"],
        summary: "Get a story thread with scenes",
        responseBody: StoryThreadDetailDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/threads/[threadId].patch.ts",
        method: "patch",
        tags: ["Plot Threads"],
        summary: "Update a story thread",
        requestBody: UpdateStoryThreadRequestDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/threads/[threadId].delete.ts",
        method: "delete",
        tags: ["Plot Threads"],
        summary: "Delete a story thread",
        responseBody: SuccessResponseSchema,
    },
    {
        file: "novels/[novelId]/plot/threads/reorder.post.ts",
        method: "post",
        tags: ["Plot Threads"],
        summary: "Reorder story threads across phases",
        requestBody: ReorderStoryThreadsRequestDtoSchema,
    },

    // ═══ Plot: Scenes ═══
    {
        file: "novels/[novelId]/plot/scenes/index.post.ts",
        method: "post",
        tags: ["Plot Scenes"],
        summary: "Create a new story scene",
        requestBody: CreateStorySceneRequestDtoSchema,
        responseBody: StorySceneDetailDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/scenes/[sceneId].get.ts",
        method: "get",
        tags: ["Plot Scenes"],
        summary: "Get a story scene with plots and refs",
        responseBody: StorySceneDetailDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/scenes/[sceneId].patch.ts",
        method: "patch",
        tags: ["Plot Scenes"],
        summary: "Update a story scene",
        requestBody: UpdateStorySceneRequestDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/scenes/[sceneId].delete.ts",
        method: "delete",
        tags: ["Plot Scenes"],
        summary: "Delete a story scene",
        responseBody: SuccessResponseSchema,
    },
    {
        file: "novels/[novelId]/plot/scenes/reorder.post.ts",
        method: "post",
        tags: ["Plot Scenes"],
        summary: "Reorder story scenes across threads and chapters",
        requestBody: ReorderStoryScenesRequestDtoSchema,
    },

    // ═══ Plot: Plots ═══
    {
        file: "novels/[novelId]/plot/plots/index.post.ts",
        method: "post",
        tags: ["Plot Points"],
        summary: "Create a new story plot point",
        requestBody: CreateStoryPlotRequestDtoSchema,
        responseBody: StoryPlotDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/plots/[plotId].get.ts",
        method: "get",
        tags: ["Plot Points"],
        summary: "Get a story plot point",
        responseBody: StoryPlotDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/plots/[plotId].patch.ts",
        method: "patch",
        tags: ["Plot Points"],
        summary: "Update a story plot point",
        requestBody: UpdateStoryPlotRequestDtoSchema,
    },
    {
        file: "novels/[novelId]/plot/plots/[plotId].delete.ts",
        method: "delete",
        tags: ["Plot Points"],
        summary: "Delete a story plot point",
        responseBody: SuccessResponseSchema,
    },
    {
        file: "novels/[novelId]/plot/plots/reorder.post.ts",
        method: "post",
        tags: ["Plot Points"],
        summary: "Reorder story plot points within scenes",
        requestBody: ReorderStoryPlotsRequestDtoSchema,
    },

    // ═══ Config ═══
    {
        file: "config/snapshot.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get effective runtime config snapshot",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        responseBody: ConfigSnapshotDtoSchema,
    },
    {
        file: "config/editor-snapshot.get.ts",
        method: "get",
        tags: ["Config"],
        summary: "Get config editor snapshot",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/global.put.ts",
        method: "put",
        tags: ["Config"],
        summary: "Update Workspace Root Global Config",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        requestBody: GlobalConfigDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/project.put.ts",
        method: "put",
        tags: ["Config"],
        summary: "Update current Project Workspace Config",
        queryParams: ConfigWorkspaceQueryDtoSchema,
        requestBody: ProjectConfigDtoSchema,
        responseBody: ConfigEditorSnapshotDtoSchema,
    },
    {
        file: "config/models/model-check.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Check health of a single model",
        requestBody: CheckModelRequestDtoSchema,
        responseBody: CheckModelResponseDtoSchema,
    },
    {
        file: "config/models/provider-check.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Check connectivity of a model provider",
        requestBody: CheckProviderRequestDtoSchema,
        responseBody: CheckProviderResponseDtoSchema,
    },
    {
        file: "config/models/provider-discover.post.ts",
        method: "post",
        tags: ["Config"],
        summary: "Discover available models from a provider",
        requestBody: DiscoverProviderModelsRequestDtoSchema,
        responseBody: DiscoverProviderModelsResponseDtoSchema,
    },

    // ═══ Workspace Files ═══
    {
        file: "workspace-files/tree.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Scan the workspace directory tree",
        queryParams: TreeQuerySchema,
    },
    {
        file: "workspace-files/read.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Read a workspace text file",
        queryParams: ReadQuerySchema,
    },
    {
        file: "workspace-files/stat.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Get file/directory metadata (stat)",
        queryParams: StatQuerySchema,
    },
    {
        file: "workspace-files/validate.get.ts",
        method: "get",
        tags: ["Workspace Files"],
        summary: "Validate workspace content nodes",
        queryParams: ValidateQuerySchema,
    },
    {
        file: "workspace-files/write.put.ts",
        method: "put",
        tags: ["Workspace Files"],
        summary: "Write content to a workspace file",
        requestBody: WriteBodySchema,
    },
    {
        file: "workspace-files/create-file.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Create a new workspace file",
        requestBody: CreateFileBodySchema,
    },
    {
        file: "workspace-files/create-directory.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Create a new workspace directory",
        requestBody: CreateDirBodySchema,
    },
    {
        file: "workspace-files/rename.patch.ts",
        method: "patch",
        tags: ["Workspace Files"],
        summary: "Rename or move a workspace path",
        requestBody: RenameBodySchema,
    },
    {
        file: "workspace-files/delete.delete.ts",
        method: "delete",
        tags: ["Workspace Files"],
        summary: "Delete a workspace file or directory",
        requestBody: DeleteBodySchema,
        responseBody: SuccessResponseSchema,
    },
    {
        file: "workspace-files/convert-file-to-directory.post.ts",
        method: "post",
        tags: ["Workspace Files"],
        summary: "Convert a workspace markdown file into a directory",
        requestBody: ConvertBodySchema,
    },

    // ═══ Writing (SSE) ═══
    {
        file: "writing/continue.post.ts",
        method: "post",
        tags: ["Writing"],
        summary: "AI novel continuation — returns SSE stream (text/event-stream)",
        requestBody: NovelContinueRequestDtoSchema,
    },

    // ═══ AI ═══
    {
        file: "ai/form-annotation.post.ts",
        method: "post",
        tags: ["AI"],
        summary: "AI-powered form annotation (currently returns stub)",
        requestBody: FormAnnotationRequestDtoSchema,
        responseBody: FormAnnotationResponseDtoSchema,
    },
];
