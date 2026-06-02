# Agent 心智模型

NeuroBook 的 Agent 不是单个聊天机器人，而是一套围绕小说项目工作的协作系统。

你可以把它理解成：用户在一个 session 中发起任务，当前 profile 决定 Agent 的身份和工具边界，Agent 可以读取 Project Workspace、调用工具、创建或复用 linked agent，并把重要结果写回文件、剧情系统或 session。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| session | 一段可继续、可分支、可恢复的 Agent 对话和执行历史。 |
| profile | Agent 的角色模板，定义身份、输入、工具权限、上下文和输出。 |
| linked agent | 当前 session 关联出去的其他 agent session，用于长期协作或专门任务。 |
| skill | 可读取的工作流程说明，帮助 Agent 学会某类任务怎么做。 |
| tool | Agent 真正执行动作的接口，例如读写文件、查 Plot、调用 SQL 或创建其他 agent。 |
| Project Workspace | 当前小说项目目录，通常包含 `lorebook/`、`manuscript/`、`simulation/` 等内容。 |

## 一个任务如何发生

典型流程是：

1. 用户在 leader session 中提出目标。
2. `leader.default` 根据当前 Project Workspace、已有历史和工具权限规划下一步。
3. 如果需要读文件，使用文件工具读取内容节点或正文。
4. 如果需要剧情结构，使用 Plot 工具读取 Thread、Scene 和 Plot。
5. 如果需要专门写作，创建或复用 writer linked agent。
6. 如果需要召回设定，创建或复用 retrieval linked agent。
7. Agent 把结果展示给用户，必要时写入文件或结构化数据。

这让 AI 协作变成可观察的工作流，而不是一段不可追踪的聊天文本。

## Leader 和 linked agent

普通用户主要面对 `leader.default`。它负责理解用户目标、选择工具、协调 linked agent，并在任务结束时说明结果。

linked agent 适合长期专业任务。例如 writer 采用“一章节一 agent”：同一章的后续润色、续写和局部修改，应该继续调用同一个 writer session，而不是每次新建。

## Skill 和 tool 的区别

skill 是说明书，tool 是执行接口。

Agent 看到 skill 后，需要读取对应 `SKILL.md`，再按里面的流程做事。skill 本身不会直接执行动作。

tool 会真的读取文件、修改文件、查询数据库、创建 agent 或返回结果。工具权限由 profile 控制。

## 继续阅读

- [工具](/agent/tools)：了解 Agent 能调用哪些工具。
- [Sidecar](/agent/sidecar)：了解主 run 前后的自动旁路机制。
- [Profile 介绍](/profile/)：了解 Agent 角色如何定义。
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)：稳定实现参考入口。
