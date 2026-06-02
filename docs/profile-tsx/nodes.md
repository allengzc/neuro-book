# 节点说明

这页介绍 Profile TSX 常见节点的用途。更完整的实现合同见 [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)。

## ProfilePrompt

`ProfilePrompt` 是根节点。

常见顶层子节点：

- `System`
- `HistorySet`
- `ModelContext`
- `AppendingSet`
- `Compaction`
- `If`

不要在 `ProfilePrompt` 顶层放裸文本。文本应放进 `System`、`Message` 等支持 string 的节点。

## System

`System` 定义 profile 的长期身份、职责、工具边界和输出规则。

适合放：

- profile 是谁。
- profile 的任务边界。
- 工具使用原则。
- 和其他 agent 的协作原则。

不适合放：

- 当前 Project Workspace。
- 当前选中文件。
- 本轮临时状态。
- 大段共享协议。

## HistorySet

`HistorySet` 是稳定历史前缀。

适合放：

- `AgentCatalog`
- `SkillCatalog`
- 共享 reference 的 `<Import />`
- 首轮初始化后不需要每轮重复写入的上下文。

`HistorySet` 不是每轮 system prompt patch。它更像“这个 session 第一次启动时写入的稳定背景”。

## ModelContext

`ModelContext` 是本轮只给模型看的上下文，不写入产品历史。

适合放：

- 变量 schema。
- 当前运行期只读摘要。
- 本轮临时工具说明。
- 不应该持久化到历史里的提醒。

`Variable` 和 `VariableSchema` 第一版通常直接放在 `ModelContext` 中。

## AppendingSet

`AppendingSet` 是贴近当前输入的上下文区域。

适合放：

- 当前工作目录提醒。
- 当前 Project Workspace 提醒。
- Plan Mode 提醒。
- linked agent 状态提醒。
- 当前用户提到的 skill 内容。

它产出的非空消息会靠近当前用户输入，并可能写入 session 历史。

## Message

`Message` 表示普通模型可见消息。

`SkillCatalog`、`AgentCatalog`、`Import`、`ActivatedSkills` 这类 string fragment 通常需要放在 `Message` 或 `System` 里。

## Import

`Import` 用于导入共享文本文件。

常见用途：

```tsx
<Message>
    <Import path="reference/agent/neurobook-project-guide.md" />
</Message>
```

V1 允许导入 `AGENTS.md`、`reference/**` 和 `docs/**`。不要用它读取 Project Workspace 文件，例如 `lorebook/...` 或 `manuscript/...`。

## Variable 和 VariableSchema

`VariableSchema` 告诉模型哪些变量可以读写，以及读写时应使用哪些工具。

`Variable` 用于把当前变量值注入模型上下文。

变量路径通常以 `client`、`global`、`project` 或 `session` 开始。

## Reminder

`Reminder` 根据条件、变量变化或轮数间隔决定是否插入提醒。

适合放那些需要靠近当前任务，但不一定每轮都重复出现的上下文。

## Watch

`Watch` 观察变量值变化，并在变化时生成消息。

它不是响应式订阅，而是在 profile prepare 阶段比较当前值和上次 baseline。

适合记录重要状态切换，例如当前章节或当前选中资源变化。

## If

`If` 用于条件渲染。

当条件为 false 时，子树不会渲染，也不会更新子树状态。

## SkillCatalog 和 AgentCatalog

`SkillCatalog` 提供当前可见 skill 的 key、说明和位置。

`AgentCatalog` 提供当前可见 agent profile 的能力信息。

它们是 string fragment，通常应包在 `Message` 中。
