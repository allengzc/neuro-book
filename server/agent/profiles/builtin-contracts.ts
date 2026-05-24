import {Type} from "typebox";

/**
 * leader.default 的实例初始化参数。它只用于 create_agent，不承载每轮 prompt。
 */
export const LeaderDefaultInputSchema = Type.Object({
    role: Type.Optional(Type.String({description: "可选的运行角色提示，用于让 leader 在默认协作模式之外临时偏向某个工作身份。"})),
});

/**
 * leader.default 的结构化输出合同。
 */
export const LeaderDefaultOutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "可选总结文本。leader.default 通常不要求 report_result。"})),
});

/**
 * writer 子代理输入：由 leader/create_agent 传入，不承载每轮对话文本。
 */
export const WriterInputSchema = Type.Object({
    prompt: Type.String({description: "本次写作任务。写清要写什么、目标文件路径或无文件落点、场景边界和交付要求。"}),
    plotPoints: Type.Optional(Type.Array(Type.String({description: "Plot System Scene ID。传入时必须同时提供 novelId，writer 会自动展开 Scene/Thread/Plots/Chapter Plot。"}), {description: "需要落实到正文中的 Scene ID 列表。"})),
    lorebookEntries: Type.Optional(Type.Array(Type.Object({
        path: Type.String({description: "内容节点路径，按 writer agent cwd 解析。普通小说 agent cwd 是 workspace 容器根，因此通常传 novel-slug/lorebook/character/foo/ 或 novel-slug/manuscript/...。目录会读取 index.md，并读取同级可选 state.md。"}),
        reason: Type.Optional(Type.String({description: "为什么这个节点与本次写作相关，帮助 writer 判断使用重点。"})),
        priority: Type.Optional(Type.Number({description: "优先级，数字越小越重要；writer 会按 priority 从小到大读取和渲染。"})),
        writingTip: Type.Optional(Type.String({description: "调用方临时给 writer 的使用提示，不会写回内容节点。"})),
    }), {description: "本次写作需要读取的 Lorebook/Manuscript 内容节点。"})),
    constraints: Type.Optional(Type.Array(Type.String({description: "额外写作约束、格式约束、禁忌、字数或用户临时偏好。"}), {description: "本轮写作约束列表。"})),
    outputPath: Type.Optional(Type.String({description: "可选输出文件路径，按 writer agent cwd 解析。普通小说 agent cwd 是 workspace 容器根，因此通常传 novel-slug/manuscript/.../index.md。给出时 writer 应把正文写入该文件并润色。"})),
    novelId: Type.Optional(Type.String({description: "当前 novel ID。传入 plotPoints 时必填，因为 plot 工具不会从 session 自动推断 novelId。"})),
    writingStylePreset: Type.Optional(Type.String({description: "可选 writing style 预设名；为空使用默认文风。"})),
    writingReferencePreset: Type.Optional(Type.String({description: "可选 writing reference 预设名；为空使用默认参考文档。"})),
});

/**
 * writer 子代理结构化输出。
 */
export const WriterOutputSchema = Type.Object({
    summary: Type.String({description: "约 100 字写作摘要，说明时间、地点、参与角色、关键动作、关系变化和伏笔/状态变化。"}),
    outputPath: Type.Optional(Type.String({description: "实际写入或修改的文件路径。没有文件落点时不要填。"})),
});

/**
 * retrieval 子代理输入。
 */
export const RetrievalInputSchema = Type.Object({
    targetProfile: Type.String({description: "召回结果要服务的目标 profile，例如 writer。"}),
    task: Type.String({description: "调用方的上层任务目标，说明为什么需要检索这些内容节点。"}),
    prompt: Type.String({description: "检索提示词。可以包含人物、地点、冲突、章节目标、关键词和排除项。"}),
    chapterOutline: Type.Optional(Type.String({description: "可选章节大纲，用于帮助 retrieval 判断相关节点。"})),
    recentText: Type.Optional(Type.String({description: "可选最近正文或草稿片段，用于召回与当前段落最相关的节点。"})),
    constraints: Type.Optional(Type.Array(Type.String({description: "检索限制，例如只查 active 节点、排除某类节点、最多某类结果。"}), {description: "检索约束列表。"})),
    maxEntries: Type.Optional(Type.Number({description: "最多返回多少个内容节点路径。"})),
});

/**
 * retrieval 子代理输出：按优先级排序的内容节点路径。
 */
export const RetrievalOutputSchema = Type.Array(Type.String({description: "按优先级排序的内容节点路径。"}), {description: "按优先级排序的内容节点路径数组，只包含路径字符串。"});
