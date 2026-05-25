import {
    CreateStoryPhaseRequestDtoSchema,
    CreateStoryPlotRequestDtoSchema,
    CreateStorySceneRequestDtoSchema,
    CreateStoryThreadRequestDtoSchema,
    ReorderStoryPhasesRequestDtoSchema,
    ReorderStoryPlotsRequestDtoSchema,
    ReorderStoryScenesRequestDtoSchema,
    ReorderStoryThreadsRequestDtoSchema,
    UpdateStoryPhaseRequestDtoSchema,
    UpdateStoryPlotRequestDtoSchema,
    UpdateStoryRequestDtoSchema,
    UpdateStorySceneRequestDtoSchema,
    UpdateStoryThreadRequestDtoSchema,
    type CreateStoryPhaseRequestDto,
    type CreateStoryPlotRequestDto,
    type CreateStorySceneRequestDto,
    type CreateStoryThreadRequestDto,
    type ReorderStoryPhasesRequestDto,
    type ReorderStoryPlotsRequestDto,
    type ReorderStoryScenesRequestDto,
    type ReorderStoryThreadsRequestDto,
    type UpdateStoryPhaseRequestDto,
    type UpdateStoryPlotRequestDto,
    type UpdateStoryRequestDto,
    type UpdateStorySceneRequestDto,
    type UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";
import type {H3Event} from "h3";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId, requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * Project Path query 版本的 Plot API，避免把 workspace/<project> 放进 URL path 段。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPathQuery(event);
    const segments = readSegments(event);
    const method = event.method.toUpperCase();

    if (method === "GET" && matchSegments(segments, ["story"])) {
        return plotFacade.getStoryDto(projectPath);
    }
    if (method === "PATCH" && matchSegments(segments, ["story"])) {
        const body = await validateBody<UpdateStoryRequestDto>(event, UpdateStoryRequestDtoSchema);
        return plotFacade.updateStory(projectPath, body);
    }
    if (method === "GET" && matchSegments(segments, ["tree"])) {
        return plotFacade.getPlotTree(projectPath);
    }
    if (method === "GET" && matchSegments(segments, ["workbench"])) {
        return plotFacade.getPlotWorkbench(projectPath);
    }
    if (method === "GET" && matchSegments(segments, ["chapter"])) {
        return plotFacade.getChapterPlotDetailDto(projectPath, requireChapterPathQuery(event));
    }

    if (segments[0] === "phases") {
        return handlePhases(event, projectPath, method, segments);
    }
    if (segments[0] === "threads") {
        return handleThreads(event, projectPath, method, segments);
    }
    if (segments[0] === "scenes") {
        return handleScenes(event, projectPath, method, segments);
    }
    if (segments[0] === "plots") {
        return handlePlots(event, projectPath, method, segments);
    }

    throw createError({statusCode: 404, message: "未知 Project Plot API"});
});

async function handlePhases(event: H3Event, projectPath: string, method: string, segments: string[]): Promise<unknown> {
    if (method === "POST" && matchSegments(segments, ["phases"])) {
        const body = await validateBody<CreateStoryPhaseRequestDto>(event, CreateStoryPhaseRequestDtoSchema);
        return plotFacade.createStoryPhase(projectPath, body);
    }
    if (method === "POST" && matchSegments(segments, ["phases", "reorder"])) {
        const body = await validateBody<ReorderStoryPhasesRequestDto>(event, ReorderStoryPhasesRequestDtoSchema);
        return plotFacade.reorderStoryPhases(projectPath, body);
    }
    if (segments.length === 2) {
        const phaseId = parseEntityId("phaseId", segments[1] ?? "");
        if (method === "GET") return plotFacade.getStoryPhaseDto(projectPath, phaseId);
        if (method === "PATCH") {
            const body = await validateBody<UpdateStoryPhaseRequestDto>(event, UpdateStoryPhaseRequestDtoSchema);
            return plotFacade.updateStoryPhase(projectPath, phaseId, body);
        }
        if (method === "DELETE") return plotFacade.deleteStoryPhase(projectPath, phaseId);
    }
    throw createError({statusCode: 404, message: "未知 Project Phase API"});
}

async function handleThreads(event: H3Event, projectPath: string, method: string, segments: string[]): Promise<unknown> {
    if (method === "POST" && matchSegments(segments, ["threads"])) {
        const body = await validateBody<CreateStoryThreadRequestDto>(event, CreateStoryThreadRequestDtoSchema);
        return plotFacade.createStoryThread(projectPath, body);
    }
    if (method === "POST" && matchSegments(segments, ["threads", "reorder"])) {
        const body = await validateBody<ReorderStoryThreadsRequestDto>(event, ReorderStoryThreadsRequestDtoSchema);
        return plotFacade.reorderStoryThreads(projectPath, body);
    }
    if (segments.length === 2) {
        const threadId = parseEntityId("threadId", segments[1] ?? "");
        if (method === "GET") return plotFacade.getStoryThreadDetailDto(projectPath, threadId);
        if (method === "PATCH") {
            const body = await validateBody<UpdateStoryThreadRequestDto>(event, UpdateStoryThreadRequestDtoSchema);
            return plotFacade.updateStoryThread(projectPath, threadId, body);
        }
        if (method === "DELETE") return plotFacade.deleteStoryThread(projectPath, threadId);
    }
    throw createError({statusCode: 404, message: "未知 Project Thread API"});
}

async function handleScenes(event: H3Event, projectPath: string, method: string, segments: string[]): Promise<unknown> {
    if (method === "POST" && matchSegments(segments, ["scenes"])) {
        const body = await validateBody<CreateStorySceneRequestDto>(event, CreateStorySceneRequestDtoSchema);
        return plotFacade.createStoryScene(projectPath, body);
    }
    if (method === "POST" && matchSegments(segments, ["scenes", "reorder"])) {
        const body = await validateBody<ReorderStoryScenesRequestDto>(event, ReorderStoryScenesRequestDtoSchema);
        return plotFacade.reorderStoryScenes(projectPath, body);
    }
    if (segments.length === 2) {
        const sceneId = parseEntityId("sceneId", segments[1] ?? "");
        if (method === "GET") return plotFacade.getStorySceneDetailDto(projectPath, sceneId);
        if (method === "PATCH") {
            const body = await validateBody<UpdateStorySceneRequestDto>(event, UpdateStorySceneRequestDtoSchema);
            return plotFacade.updateStoryScene(projectPath, sceneId, body);
        }
        if (method === "DELETE") return plotFacade.deleteStoryScene(projectPath, sceneId);
    }
    throw createError({statusCode: 404, message: "未知 Project Scene API"});
}

async function handlePlots(event: H3Event, projectPath: string, method: string, segments: string[]): Promise<unknown> {
    if (method === "POST" && matchSegments(segments, ["plots"])) {
        const body = await validateBody<CreateStoryPlotRequestDto>(event, CreateStoryPlotRequestDtoSchema);
        return plotFacade.createStoryPlot(projectPath, body);
    }
    if (method === "POST" && matchSegments(segments, ["plots", "reorder"])) {
        const body = await validateBody<ReorderStoryPlotsRequestDto>(event, ReorderStoryPlotsRequestDtoSchema);
        return plotFacade.reorderStoryPlots(projectPath, body);
    }
    if (segments.length === 2) {
        const plotId = parseEntityId("plotId", segments[1] ?? "");
        if (method === "GET") return plotFacade.getStoryPlotDto(projectPath, plotId);
        if (method === "PATCH") {
            const body = await validateBody<UpdateStoryPlotRequestDto>(event, UpdateStoryPlotRequestDtoSchema);
            return plotFacade.updateStoryPlot(projectPath, plotId, body);
        }
        if (method === "DELETE") return plotFacade.deleteStoryPlot(projectPath, plotId);
    }
    throw createError({statusCode: 404, message: "未知 Project Plot API"});
}

function readSegments(event: H3Event): string[] {
    const rawSegments = event.context.params?.segments;
    const segments = Array.isArray(rawSegments) ? rawSegments : typeof rawSegments === "string" ? rawSegments.split("/") : [];
    return segments.map((segment) => decodeURIComponent(segment)).filter(Boolean);
}

function matchSegments(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function requireChapterPathQuery(event: H3Event): string {
    const value = getQuery(event).chapterPath;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        throw createError({statusCode: 400, message: "chapterPath query 不能为空"});
    }
    return text;
}
