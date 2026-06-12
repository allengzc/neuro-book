import type {TSchema} from "typebox";

/**
 * Profile 级工具绑定。全局工具定义负责执行；绑定只描述当前 profile 暴露给模型的参数 schema 与校验策略。
 */
export type ToolBinding<TKey extends string = string> = {
    key: TKey;
    /** 为空时使用全局工具的默认参数 schema。 */
    parameters?: TSchema;
    /** 为空时使用 parameters 做执行前校验。 */
    validationSchema?: TSchema;
    /** 为空时使用全局工具描述。 */
    description?: string;
    /** 仅 report_result 使用：主路 data 的结构化 schema。 */
    dataSchema?: TSchema;
};

export type ProfileTools = Record<string, ToolBinding>;

/**
 * 保留 profile tools 对象的字面量 key 类型，方便 mainRunToolKeys / sidecar.toolKeys 做子集约束。
 */
export function defineProfileTools<const TTools extends ProfileTools>(tools: TTools): TTools {
    return tools;
}

/**
 * 从 key 数组构造 profile tools 对象。主要用于测试和迁移期的机械声明，运行时仍只消费 tools 对象。
 */
export function profileToolsFromKeys<const TKeys extends readonly string[]>(keys: TKeys): {[K in TKeys[number]]: ToolBinding<K>} {
    const result: Record<string, ToolBinding> = {};
    for (const key of keys) {
        result[key] = bindTool(key);
    }
    return result as {[K in TKeys[number]]: ToolBinding<K>};
}

/**
 * 受控工具绑定工厂。这里不暴露 execute，profile 作者只能声明当前 profile 如何绑定已有工具。
 */
export const tools = {
    read: () => bindTool("read"),
    write: () => bindTool("write"),
    edit: () => bindTool("edit"),
    applyPatch: () => bindTool("apply_patch"),
    bash: () => bindTool("bash"),
    createAgent: () => bindTool("create_agent"),
    invokeAgent: () => bindTool("invoke_agent"),
    getAgent: () => bindTool("get_agent"),
    getAgentProfile: () => bindTool("get_agent_profile"),
    getSession: () => bindTool("get_session"),
    detachAgent: () => bindTool("detach_agent"),
    requestUserInput: () => bindTool("request_user_input"),
    enterPlanMode: () => bindTool("enter_plan_mode"),
    exitPlanMode: () => bindTool("exit_plan_mode"),
    taskCreate: () => bindTool("task_create"),
    taskSetStatus: () => bindTool("task_set_status"),
    getPlotTree: () => bindTool("get_plot_tree"),
    getStoryThread: () => bindTool("get_story_thread"),
    getStorySceneContext: () => bindTool("get_story_scene_context"),
    getChapterPlot: () => bindTool("get_chapter_plot"),
    createStoryThread: () => bindTool("create_story_thread"),
    updateStoryThread: () => bindTool("update_story_thread"),
    createStoryScene: () => bindTool("create_story_scene"),
    updateStoryScene: () => bindTool("update_story_scene"),
    createStoryPlot: () => bindTool("create_story_plot"),
    createStoryPlots: () => bindTool("create_story_plots"),
    updateStoryPlot: () => bindTool("update_story_plot"),
    executeSql: () => bindTool("execute_sql"),
    variableSchema: () => bindTool("variable_schema"),
    variableRead: () => bindTool("variable_read"),
    variablePatch: () => bindTool("variable_patch"),
    subjectRagSearch: () => bindTool("subject_rag_search"),
    subjectEventAppend: () => bindTool("subject_event_append"),
    subjectMemoryUpdate: () => bindTool("subject_memory_update"),
    webSearch: () => bindTool("web_search"),
    webFetch: () => bindTool("web_fetch"),
    reportResult: (options: {dataSchema?: TSchema} = {}) => bindTool("report_result", {
        dataSchema: options.dataSchema,
    }),
    custom: <const TKey extends string>(key: TKey) => bindTool(key),
};

/**
 * 构造单个工具绑定。
 */
function bindTool<const TKey extends string>(key: TKey, options: Omit<ToolBinding<TKey>, "key"> = {}): ToolBinding<TKey> {
    return {
        key,
        ...options,
    };
}
