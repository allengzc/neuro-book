import {createFileTools} from "nbook/server/agent/tools/file-tools";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import {createSqlTool} from "nbook/server/agent/tools/sql-tool";
import {createSubjectMemoryTools} from "nbook/server/agent/tools/subject-memory-tools";
import {createTaskTools} from "nbook/server/agent/tools/task-tools";
import {createWebTools} from "nbook/server/agent/tools/web-tools";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import {agentCollaborationTools} from "nbook/server/agent/tools/agent-collaboration-tools";
import {controlTools} from "nbook/server/agent/tools/control-tools";
import {createVariableTools} from "nbook/server/agent/variables/tools";
import {defineAgentToolFromRuntime} from "nbook/server/agent/tools/types";
import type {AgentToolDefinition, NeuroAgentTool} from "nbook/server/agent/tools/types";

export {agentCollaborationTools} from "nbook/server/agent/tools/agent-collaboration-tools";
export {controlTools, createReportResultTool, createReportSidecarResultTool, ReportResultSchema, ReportSidecarResultSchema} from "nbook/server/agent/tools/control-tools";

function buildAgentTools() {
    const fileTools = definitionsByKey(createFileTools());
    const taskTools = definitionsByKey(createTaskTools());
    const plotTools = definitionsByKey(createPlotTools());
    const variableTools = definitionsByKey(createVariableTools());
    const webTools = definitionsByKey(createWebTools());
    const worldEngineTools = definitionsByKey(createWorldEngineTools());
    const subjectMemoryTools = definitionsByKey(createSubjectMemoryTools());
    const sqlTool = defineAgentToolFromRuntime(createSqlTool());
    return {
        read: requireDefinition(fileTools, "read"),
        write: requireDefinition(fileTools, "write"),
        edit: requireDefinition(fileTools, "edit"),
        applyPatch: requireDefinition(fileTools, "apply_patch"),
        bash: requireDefinition(fileTools, "bash"),
        taskCreate: requireDefinition(taskTools, "task_create"),
        taskSetStatus: requireDefinition(taskTools, "task_set_status"),
        getPlotTree: requireDefinition(plotTools, "get_plot_tree"),
        getStoryThread: requireDefinition(plotTools, "get_story_thread"),
        getStorySceneContext: requireDefinition(plotTools, "get_story_scene_context"),
        getStoryPlotContext: requireDefinition(plotTools, "get_story_plot_context"),
        getChapterPlot: requireDefinition(plotTools, "get_chapter_plot"),
        createStoryThread: requireDefinition(plotTools, "create_story_thread"),
        updateStoryThread: requireDefinition(plotTools, "update_story_thread"),
        createStoryScene: requireDefinition(plotTools, "create_story_scene"),
        updateStoryScene: requireDefinition(plotTools, "update_story_scene"),
        createStoryPlot: requireDefinition(plotTools, "create_story_plot"),
        createStoryPlots: requireDefinition(plotTools, "create_story_plots"),
        updateStoryPlot: requireDefinition(plotTools, "update_story_plot"),
        executeSql: sqlTool,
        variableSchema: requireDefinition(variableTools, "variable_schema"),
        variableRead: requireDefinition(variableTools, "variable_read"),
        variablePatch: requireDefinition(variableTools, "variable_patch"),
        subjectRagSearch: requireDefinition(subjectMemoryTools, "subject_rag_search"),
        subjectEventAppend: requireDefinition(subjectMemoryTools, "subject_event_append"),
        subjectMemoryUpdate: requireDefinition(subjectMemoryTools, "subject_memory_update"),
        executeWorld: requireDefinition(worldEngineTools, "execute_world"),
        webSearch: requireDefinition(webTools, "web_search"),
        webFetch: requireDefinition(webTools, "web_fetch"),
        ...controlTools,
        ...agentCollaborationTools,
    } as const;
}

export function createAgentToolRuntimes(): NeuroAgentTool[] {
    return Object.values(buildAgentTools()).map((definition) => definition.runtime());
}

/**
 * 构造 v3 内置工具 runtime。profile 自带工具不进入全局 registry。
 */
export function createBuiltinTools(): NeuroAgentTool[] {
    return createAgentToolRuntimes();
}

function definitionsByKey(tools: NeuroAgentTool[]): Record<string, AgentToolDefinition> {
    return Object.fromEntries(tools.map((tool) => [tool.key, defineAgentToolFromRuntime(tool)]));
}

function requireDefinition<const TKey extends string>(definitions: Record<string, AgentToolDefinition>, key: TKey): AgentToolDefinition<TKey> {
    const definition = definitions[key];
    if (!definition) {
        throw new Error(`内置工具定义缺失：${key}`);
    }
    return definition as AgentToolDefinition<TKey>;
}
