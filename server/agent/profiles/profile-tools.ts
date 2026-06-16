import type {TSchema} from "typebox";
import type {ProfileToolBinding, ProfileTools, ReportResultToolBinding, ReportSidecarResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";

export type {ProfileTools, ReportResultToolBinding, ReportSidecarResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";
export {defineAgentTool as defineProfileTool} from "nbook/server/agent/tools/types";
export type {AgentToolDefinition} from "nbook/server/agent/tools/types";

/**
 * 组装 profile root tools，并保留字面量 key 类型，方便 toolKeys / sidecar.toolKeys 做子集约束。
 */
export function toolset<const TItems extends readonly ProfileToolBinding[]>(...items: TItems): {
    [TItem in TItems[number] as TItem["key"]]: TItem;
} {
    const result: ProfileTools = {};
    for (const item of items) {
        if (result[item.key]) {
            throw new Error(`profile tools 重复：${item.key}`);
        }
        result[item.key] = item;
    }
    return result as {
        [TItem in TItems[number] as TItem["key"]]: TItem;
    };
}

/**
 * 受控内置工具引用。这里不暴露 execute，profile 作者只能声明当前 profile 如何绑定已有工具。
 */
export const builtin = {
    file: {
        read: registeredTool("read"),
        write: registeredTool("write"),
        edit: registeredTool("edit"),
        applyPatch: registeredTool("apply_patch"),
        bash: registeredTool("bash"),
    },
    agent: {
        create: registeredTool("create_agent"),
        invoke: registeredTool("invoke_agent"),
        get: registeredTool("get_agent"),
        getProfile: registeredTool("get_agent_profile"),
        getSession: registeredTool("get_session"),
        detach: registeredTool("detach_agent"),
    },
    control: {
        requestUserInput: registeredTool("request_user_input"),
        enterPlanMode: registeredTool("enter_plan_mode"),
        exitPlanMode: registeredTool("exit_plan_mode"),
    },
    task: {
        create: registeredTool("task_create"),
        setStatus: registeredTool("task_set_status"),
    },
    plot: {
        getTree: registeredTool("get_plot_tree"),
        getThread: registeredTool("get_story_thread"),
        getSceneContext: registeredTool("get_story_scene_context"),
        getChapter: registeredTool("get_chapter_plot"),
        createThread: registeredTool("create_story_thread"),
        updateThread: registeredTool("update_story_thread"),
        createScene: registeredTool("create_story_scene"),
        updateScene: registeredTool("update_story_scene"),
        createPlot: registeredTool("create_story_plot"),
        createPlots: registeredTool("create_story_plots"),
        updatePlot: registeredTool("update_story_plot"),
    },
    sql: {
        execute: registeredTool("execute_sql"),
    },
    variable: {
        schema: registeredTool("variable_schema"),
        read: registeredTool("variable_read"),
        patch: registeredTool("variable_patch"),
    },
    subject: {
        ragSearch: registeredTool("subject_rag_search"),
        eventAppend: registeredTool("subject_event_append"),
        memoryUpdate: registeredTool("subject_memory_update"),
    },
    web: {
        search: registeredTool("web_search"),
        fetch: registeredTool("web_fetch"),
    },
    result: {
        main: (options: {dataSchema?: TSchema} = {}): ReportResultToolBinding => ({
            key: "report_result",
            dataSchema: options.dataSchema,
        }),
        sidecar: (): ReportSidecarResultToolBinding => ({
            key: "report_sidecar_result",
        }),
    },
};

/**
 * 引用运行时已注册但 profile API 尚未 typed 化的插件工具。
 */
export function pluginTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return registeredTool(key);
}

/**
 * 构造一个已注册全局工具绑定。它只引用 registry，不携带 execute。
 */
function registeredTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return {
        key,
    };
}
