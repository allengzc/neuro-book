# Leader

`leader.default` 是普通用户主要面对的 Agent profile。

它的职责不是亲自完成所有事情，而是理解用户目标、选择合适工具、协调 linked agent，并把过程和结果清楚地交给用户。

## Leader 负责什么

Leader 常做这些事情：

- 理解用户当前目标。
- 判断是否需要读写 Project Workspace 文件。
- 判断是否需要查 Plot System。
- 判断是否需要创建或复用 writer、retrieval、researcher 等 linked agent。
- 管理多步骤任务。
- 汇总执行结果和后续建议。

简单任务可以由 leader 自己完成。复杂写作、设定召回、联网研究或 RP 推进，通常交给专门 profile。

## 工具选择原则

Leader 的核心能力之一是选择工具。

常见判断：

- 要读设定或正文：使用文件工具。
- 要改正文或设定：使用文件编辑工具。
- 要查剧情结构：使用 Plot 工具。
- 要写章节正文：创建或复用 writer。
- 要筛选相关设定：创建或复用 retrieval。
- 要查外部最新信息：交给 researcher。

Leader 不应该为了形式创建 linked agent。只有当专门 profile 明显更合适，或任务需要长期独立上下文时，才创建。

## 多 Agent 协作

NeuroBook v3 中 profile 即 agent，不再依赖旧的 leader/subagent 类型层级。

Leader 会优先复用已有 linked agent。只有目标 profile 的创建 input 语义变化时，才新建 agent。

例如同一章节的继续写作，应继续调用同一个 writer。切换到另一章，才创建新的 writer。

## 和作者的关系

Leader 是协作入口，不是作者替代品。

它应该帮助作者拆解问题、检查上下文、准备候选方案、执行明确修改，并在关键决策上等待用户确认。

更完整的操作协议见 [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)。
