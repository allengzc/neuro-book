# Agent 心智模型

NeuroBook 的 Agent 是围绕小说项目工作的 AI 协作者。它不是一个孤立聊天框，而是能读取 Project Workspace、调用工具、使用 Skill、创建 linked agent，并把结果写回 session 或项目文件的工作单元。

底层运行时是 NeuroAgentHarness：它基于 Pi 风格的 multi-provider、tool calling 和 append-only session tree 扩展，支持 Multi-Agent 协作、HITL（Human-in-the-Loop）、运行时 Profile / Tool Catalog、上下文压缩、会话摘要、生命周期管理与 Runtime Hooks。

如果你只想开始创作，先走 [基础教程](/tutorials/)。如果你要理解 Agent 为什么能协作、能调用 writer、能进入 RP 模式，这一组页面是入口。

## 四个核心概念

| 概念 | 直觉解释 |
| --- | --- |
| Agent | 正在执行任务的 AI 协作者。 |
| session | Agent 的一条工作记录，包含历史、分支、工具结果和运行状态。 |
| profile | Agent 的角色、工具权限、输入输出合同和提示词结构。 |
| Skill | 可复用工作流程卡，告诉 Agent 如何完成某类任务。 |
| Sidecar Context | 主 run 前后的 runtime-only 旁路，用于检索、反思、记忆维护或状态整理。 |

v3 中 profile 就是 agent 类型。系统不再维护旧式 leader / subagent 类型层级，而是通过 profile key、session link 和工具调用形成协作网络。

## 默认协作方式

普通小说项目默认从 `leader.default` 开始。它负责理解用户意图，并在需要时调用专用 profile：

- `writer`：写正式章节正文，一章节一 agent。
- `retrieval`：检索和筛选 lorebook / manuscript 内容节点。
- `researcher`：联网研究，处理最新资料或外部来源核验。
- `leader.rp`：进入 `simulation/` 世界模拟 / RP。
- `rp.actor`：扮演单个 subject，只看到角色可知信息。
- `rp.writer`：把 simulator leader brief 渲染成用户可见 RP 文本。

## Agent 会读写什么

Agent 的工具工作目录以 Workspace Root 为边界。处理当前小说时，路径应指向 Project Workspace，例如：

```text
my-novel/lorebook/character/protagonist/index.md
my-novel/manuscript/001-volume/001-chapter/index.md
my-novel/simulation/subjects/protagonist/state.md
```

稳定设定进入 `lorebook/`，正式正文进入 `manuscript/`，当前运行态进入 `simulation/`。这条边界决定了 Agent 如何写作、检索和进入 RP。

## 继续阅读

- [Agent 工具](./tools.md)：Agent 能调用哪些工具，什么时候该用文件工具、SQL、变量或 linked agent。
- [Sidecar](./sidecar.md)：旁路 run，用于 actor 预加载知识、保存记忆或 writer 写前检索。
- [Agent Harness](./advanced.md)：session、runtime hooks、SSE、队列和黑盒行为合同。
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)：稳定实现参考入口。
