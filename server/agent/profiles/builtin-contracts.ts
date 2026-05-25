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
    prompt: Type.String({description: "本次写作任务。写清要写什么、是重写还是局部修改、章节边界和交付要求。"}),
    chapterPaths: Type.Array(Type.String({description: "章节内容节点目录路径。当前 Project Workspace 使用 manuscript/.../；跨 Project Workspace 使用 novel-slug/manuscript/.../。"}), {
        minItems: 1,
        maxItems: 1,
        description: "本 writer session 绑定的唯一章节。调用方必须先创建章节内容节点，并在 Plot System 中把 Scene 挂到该章节。",
    }),
    lorebookEntries: Type.Optional(Type.Array(Type.String({description: "内容节点路径，按 writer agent cwd 解析。writer 会按数组顺序读取 index.md 与同级可选 state.md。"}), {description: "本次写作需要读取的 Lorebook/Manuscript 内容节点路径数组。"})),
    constraints: Type.Optional(Type.Array(Type.String({description: "额外写作约束、格式约束、禁忌、字数或用户临时偏好。"}), {description: "本轮写作约束列表。"})),
    writingStylePreset: Type.Optional(Type.String({description: "可选 writing style 预设 key，不是文件路径。系统预设目录：assets/workspace/.nbook/agent/writing-presets/styles；用户覆盖目录：workspace/.nbook/agent/writing-presets/styles。为空使用默认文风。"})),
    writingReferencePreset: Type.Optional(Type.String({description: "可选 writing reference 预设 key，不是文件路径。系统预设目录：assets/workspace/.nbook/agent/writing-presets/references；用户覆盖目录：workspace/.nbook/agent/writing-presets/references。为空使用默认参考文档。"})),
});

/**
 * writer 子代理结构化输出。
 */
export const WriterOutputSchema = Type.Object({
    summary: Type.String({description: "写作摘要，说明时间、地点、参与角色、关键动作、关系变化和伏笔/状态变化。"}),
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
 * retrieval 子代理输出：面向 Leader 的详细召回结果。
 */
export const RetrievalOutputSchema = Type.Array(Type.Object({
    path: Type.String({description: "内容节点路径。Leader 调 writer 时只把这个 path 提取到 writer.lorebookEntries。"}),
    reason: Type.Optional(Type.String({description: "为什么召回该节点，供 Leader 判断是否传给 writer。"})),
    summary: Type.Optional(Type.String({description: "节点和任务的相关摘要，供 Leader 快速判断。"})),
    priority: Type.Optional(Type.Number({description: "优先级，数字越小越重要。"})),
    writingTip: Type.Optional(Type.String({description: "可选写作使用建议，供 Leader 阅读；不要传给 writer。"})),
}), {description: "按优先级排序的内容节点召回详情数组。"});
