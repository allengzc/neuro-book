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
 * leader.rp 的实例初始化参数。每轮用户行动仍通过普通 prompt/invoke message 传入。
 */
export const LeaderRpInputSchema = Type.Object({
    simulationRoot: Type.Optional(Type.String({description: "可选 simulation 目录路径，必须相对于 Agent cwd。默认使用当前 Project Workspace 下的 simulation/。"})),
});

/**
 * leader.rp 的结构化输出合同。
 */
export const LeaderRpOutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "可选总结文本。leader.rp 通常直接面向用户输出 writer prose，不要求 report_result。"})),
});

/**
 * rp.actor 的实例初始化参数。每轮 GM packet 通过 invoke_agent.message 传入。
 */
export const RpActorInputSchema = Type.Object({
    actorId: Type.String({description: "本局 subject simulator id，必须与 simulation/cast.yaml 中的 subject id 对应。"}),
    actorName: Type.Optional(Type.String({description: "角色可读名。为空时使用 actorId。"})),
    kind: Type.Optional(Type.String({description: "actor 类型，例如 player、npc、faction、system。"})),
    instructionPath: Type.String({description: "subject simulator 指令文件路径，必须相对于 Agent cwd，例如 project-slug/simulation/subjects/erina/subject.md。"}),
    knowledgePath: Type.String({description: "角色可知世界书路径，必须相对于 Agent cwd，例如 project-slug/simulation/subjects/erina/knowledge.md。"}),
    mindPath: Type.String({description: "角色当前思维文件路径，必须相对于 Agent cwd，例如 project-slug/simulation/subjects/erina/mind.md。"}),
    statePath: Type.String({description: "角色当前状态文件路径，必须相对于 Agent cwd，例如 project-slug/simulation/subjects/erina/state.md。"}),
});

/**
 * rp.actor 通过 report_result.data 返回的结构化角色反应。
 */
export const RpActorOutputSchema = Type.Object({
    visible_action: Type.String({description: "角色在场景中可被观察到的动作、神态、姿态或沉默；没有则填空字符串。"}),
    spoken_dialogue: Type.String({description: "角色明确说出口的台词；没有则填空字符串。"}),
    private_intent: Type.String({description: "只给 GM 使用的私下意图、判断或短期目标；没有则填空字符串。"}),
    emotional_state: Type.String({description: "只给 GM 使用的情绪状态摘要；没有则填空字符串。"}),
    assumptions: Type.Array(Type.String({description: "角色基于自身知识和本 Tick packet 形成的判断、误解或假设。"}), {description: "没有则返回空数组。"}),
    questions_to_gm: Type.Array(Type.String({description: "需要 GM 裁决、补充或确认的问题。"}), {description: "没有则返回空数组。"}),
    knowledge_update: Type.String({description: "本 Tick 后应写入 knowledge.md 的新增认知摘要；没有则填空字符串。"}),
    mind_update: Type.String({description: "本 Tick 后应写入 mind.md 的当前想法、判断或动机摘要；没有则填空字符串。"}),
    state_update: Type.String({description: "本 Tick 后应写入 state.md 的位置、持有物、伤势、关系压力或短期目标变化；没有则填空字符串。"}),
});

/**
 * rp.writer 的实例初始化参数。每轮 writer brief 通过 invoke_agent.message 传入。
 */
export const RpWriterInputSchema = Type.Object({
    writerInstructionPath: Type.String({description: "RP writer 提示词素材路径，必须相对于 Agent cwd，例如 project-slug/simulation/writer.md。"}),
    style: Type.Optional(Type.String({description: "稳定文风偏好。临时 Tick 文风要求应放在 writer brief 中。"})),
    outputRequirements: Type.Optional(Type.Array(Type.String({description: "稳定输出约束，例如人称、篇幅、Markdown 规则。"}), {description: "可选稳定输出约束。"})),
    language: Type.Optional(Type.String({description: "输出语言，例如 zh-CN。默认跟随 GM writer brief。"})),
});

/**
 * rp.writer 的普通输出合同。rp.writer 默认直接回复正文，只有 GM 明确要求写入文件时才使用文件工具。
 */
export const RpWriterOutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "可选结果说明。rp.writer 通常直接用普通 assistant 回复输出正文，不要求 report_result。"})),
});

/**
 * summarizer 的实例初始化参数。sourceSessionId 由 harness 注入。
 */
export const SessionSummarizerInputSchema = Type.Object({
    sourceSessionId: Type.Number({description: "由 harness 注入的 source session id。"}),
    trigger: Type.Optional(Type.Union([
        Type.Literal("afterInvocation"),
    ], {description: "触发时机。第一版仅支持 afterInvocation。"})),
    interval: Type.Optional(Type.Object({
        kind: Type.Union([
            Type.Literal("sourceInvocation"),
            Type.Literal("dialogueContentTokens"),
        ]),
        value: Type.Number({description: "触发间隔。sourceInvocation 表示 source invocation 次数，dialogueContentTokens 表示新增正文 token。"}),
    }, {description: "后台摘要周期触发配置。"})),
    maxDialogueContentTokens: Type.Optional(Type.Number({description: "Agent Dialogue Content 超过该 token 估算值时跳过本次摘要。"})),
});

/**
 * summarizer 通过 report_result.data 返回的展示元数据。
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

/**
 * researcher 子代理输入：创建 session 时传入长期研究边界；每轮具体问题通过 invoke_agent.message 继续对话。
 */
export const ResearcherInputSchema = Type.Object({
    topic: Type.Optional(Type.String({
        maxLength: 500,
        description: "Long-lived research topic for this researcher session. Omit for a general researcher.",
    })),
    goal: Type.Optional(Type.String({
        maxLength: 1200,
        description: "Stable research goal or operating brief for this researcher session. Per-turn questions should be sent via invoke_agent.message, not stored here.",
    })),
    allowed_domains: Type.Optional(Type.Array(Type.String({
        minLength: 1,
        description: "Default allowed domain filter inherited by web_search unless the turn asks otherwise.",
    }), {maxItems: 20})),
    blocked_domains: Type.Optional(Type.Array(Type.String({
        minLength: 1,
        description: "Default blocked domain filter inherited by web_search unless the turn asks otherwise.",
    }), {maxItems: 50})),
    default_recency_days: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 3650,
        description: "Default freshness preference for web_search. Omit for no default recency filter.",
    })),
    source_policy: Type.Optional(Type.Union([
        Type.Literal("balanced"),
        Type.Literal("primary_sources"),
        Type.Literal("recent_first"),
    ], {
        description: "Default source preference. primary_sources means prefer official docs, papers, laws, specs, or original announcements when available.",
    })),
    output_language: Type.Optional(Type.String({
        description: "Preferred response language, for example zh-CN or en. Default follows the caller/user language.",
    })),
});
