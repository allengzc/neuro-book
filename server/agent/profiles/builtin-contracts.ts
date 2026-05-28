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
 * session.summarizer 的实例初始化参数。sourceSessionId 由 harness 注入。
 */
export const SessionSummarizerInputSchema = Type.Object({
    sourceSessionId: Type.Number({description: "由 harness 注入的源 leader session id。"}),
    trigger: Type.Optional(Type.Union([
        Type.Literal("after_invocation"),
    ], {description: "首次触发时机。第一版仅支持 after_invocation。"})),
    interval: Type.Optional(Type.Object({
        kind: Type.Union([
            Type.Literal("turn"),
            Type.Literal("loop"),
            Type.Literal("dialogueContentTokens"),
        ]),
        value: Type.Number({description: "触发间隔。turn/loop 表示次数，dialogueContentTokens 表示新增正文 token。"}),
    }, {description: "后台摘要周期触发配置。"})),
    maxDialogueContentTokens: Type.Optional(Type.Number({description: "Agent Dialogue Content 超过该 token 估算值时跳过本次摘要。"})),
});

/**
 * session.summarizer 通过 report_result.data 返回的展示元数据。
 */
export const SessionSummarizerOutputSchema = Type.Object({
    title: Type.String({description: "简短 session 标题，建议不超过 32 字。"}),
    summary: Type.String({description: "当前 session 的可读摘要，建议不超过 240 字。"}),
});

/**
 * writer 子代理输入：由 leader/create_agent 传入，不承载每轮对话文本。
 */
export const WriterInputSchema = Type.Object({
    prompt: Type.String({description: "本次写作任务。写清要写什么、是重写还是局部修改、章节边界和交付要求。"}),
    chapterPaths: Type.Array(Type.String({description: "章节内容节点目录路径，必须相对于 Agent cwd。普通 Project agent 的 cwd 是 workspace 容器根，因此应传 project-slug/manuscript/.../，不要传 manuscript/.../ 或 workspace/project-slug/.../。"}), {
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
    prompt: Type.String({description: "检索请求。写清任务目标、要找什么、给谁用、章节/正文上下文、排除项和数量偏好。"}),
});

/**
 * retrieval 子代理输出：面向 Leader 的内容节点候选判断结果。
 */
export const RetrievalOutputSchema = Type.Object({
    entries: Type.Array(Type.Object({
        path: Type.String({description: "内容节点路径。Leader 调 writer 时只提取这个 path。"}),
        reason: Type.String({description: "为什么这个节点应该传给 writer。按当前写作任务概括，不要完整复述节点 summary。"}),
        use: Type.Optional(Type.String({description: "建议 writer 重点使用这个节点的哪一部分信息；给 Leader 判断用，不直接传给 writer。"})),
        risk: Type.Optional(Type.String({description: "可选风险说明，例如只是弱相关、状态可能过时、需要用户确认、可能与任务冲突。"})),
    }), {description: "按推荐优先级排序的候选内容节点。"}),
    note: Type.Optional(Type.String({description: "整体检索说明，例如没有强相关条目、结果偏少、建议补充搜索条件。"})),
});
