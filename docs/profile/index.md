# Profile 介绍

Profile 是 Agent 的角色模板。

它决定一个 Agent 是谁、能做什么、创建时需要什么输入、能使用哪些工具、如何组织上下文，以及是否需要返回结构化结果。

## Profile 包含什么

一个 profile 通常包含：

- manifest：key、name、description 等基础信息。
- input：创建这个 agent/session 时需要的初始化参数。
- tools：当前 profile 允许使用的工具集合。
- context：本轮模型可见的 system、history、runtime context 和提醒。
- output：需要结构化结果时的输出 schema。

普通用户不需要直接修改 profile。只有当你要定制 Agent 行为、添加新角色或调整工具边界时，才需要深入理解它。

## Profile 和 session 的关系

session 是一次可继续的 Agent 协作历史。profile 是这个 session 的角色模板。

同一个 profile 可以创建多个 session。例如 writer 采用“一章节一 agent”，不同章节会创建不同 writer session；同一章节的后续润色则复用原 writer session。

## Profile 和 tool 的关系

工具权限由 profile 控制。

比如 writer 可以拥有读写章节相关文件的工具；retrieval 更偏向读取和召回；researcher 才适合联网研究。这样可以避免所有 Agent 都拥有过大的权限。

## Profile 和 Profile TSX

Profile TSX 是当前推荐的 profile context 写法。

它不是把 prompt 写成一整段字符串，而是用 `System`、`HistorySet`、`ModelContext`、`AppendingSet` 等节点表达不同类型的上下文。

继续阅读 [Profile TSX 介绍](/profile-tsx/)。

## 常见内置 Profile

- [Leader](/profile/leader)：用户主入口，负责任务统筹和 Agent 协作。
- [Writer](/profile/writer)：正文写作专用 profile。
- [其他 Profile](/profile/other-profiles)：retrieval、researcher、RP profiles。

稳定实现参考见 [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)。
