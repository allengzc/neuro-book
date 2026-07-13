---
layout: home

hero:
  name: "NeuroBook"
  text: "长篇小说创作与 AI 角色扮演 IDE"
  tagline: 基于 Nuxt 构建，深度集成领域化 Agent 系统，用 Project Workspace、NeuroAgentHarness、TSX Profile 和 Sidecar Context 支撑长篇写作与 RP。
  actions:
    - theme: brand
      text: 开始第一本书
      link: /tutorials/
    - theme: alt
      text: 快速开始
      link: /quick-start
    - theme: alt
      text: 了解 NeuroBook
      link: /introduction
    - theme: alt
      text: English
      link: https://github.com/notnotype/neuro-book/blob/master/README.en.md

features:
  - title: NeuroAgentHarness
    details: 基于 Pi 风格 multi-provider、tool calling 和 append-only session tree 扩展，支持 Multi-Agent、HITL、运行时 Profile / Tool Catalog、上下文压缩、会话摘要、生命周期与 Runtime Hooks。
  - title: Profile / TSX Profile
    details: Profile 定义 Agent 的工具白名单、输入输出 Schema、系统提示词、动态上下文、压缩和摘要策略；TSX Profile 用类型安全的上下文模板组织 System、History、Dynamic Context、Reminder 和 Import。
  - title: Sidecar Context
    details: 在主 Agent 运行前后 fork runtime-only 分支，用于检索、反思、记忆维护或状态整理；sidecar transcript 不污染主 history，只把整理后的结果合并回主线。
  - title: 文件化 Project Workspace
    details: 用统一目录组织 lorebook、manuscript、simulation 和 reference；像 VS Code workspace 一样支持本地配置和用户覆盖，便于迁移、协作与分发。
  - title: SillyTavern 角色卡导入
    details: 支持 inspect、unpack、import 三段式导入，保留原始卡片和 worldbook 归档，把稳定设定迁入 lorebook，并为后续 RP / simulation 迁移保留动态机制材料。
  - title: 世界模拟
    details: 用 simulation 目录拆分 GM、subject、entity 和 run 状态，让不同 emulator 只看到被授权的信息，减少角色全知和隐藏设定泄露。
  - title: 领域化 Agent 协作
    details: leader 可编排检索、写作、研究与世界推进，writer、retrieval、RP profiles 各司其职，避免把剧情裁决、正文写作和角色记忆维护塞进一次模型调用。
  - title: 本地部署与可控数据
    details: 由 NeuroBook Manager 统一支持 Windows Portable、GHCR、Product Bun 和 Source Profile，默认使用 SQLite 与本地 Workspace Root 保存数据。
---

## 从哪里开始

如果你已经完成部署，直接进入 [从第一本书到第一次 RP](/tutorials/)：它会带你创建项目、调用 Skill、写前三章、导入角色卡，并进入世界模拟。

如果你还没有把应用跑起来，先读 [快速开始](/quick-start)。如果你要部署到自己的机器或服务器，读 [部署方式](/deployment)。

如果你想理解 NeuroBook 的产品心智模型，读 [介绍](/introduction)。如果你要理解 Agent 如何工作，读 [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)。英文入口见 [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md)。

## 文档分区

- [介绍](/introduction)：NeuroBook 是什么，适合谁，和普通 AI 聊天工具有什么区别。
- [快速开始](/quick-start)：最短路径跑起应用并创建管理员。
- [基础教程](/tutorials/)：从第一个项目到前三章、角色卡导入和世界模拟。
- [部署方式](/deployment)：Windows Portable、GHCR、Product Bun 和 Source Profile 的选择与边界。
- [Agent](/agent/)：Agent、session、profile、Skill 和 linked agent 的产品心智模型。
- [Profile](/profile/)：内置 profile 分工、writer 边界和 RP profiles。
- [Profile TSX](/profile-tsx/)：profile 作者使用的 TSX DSL、节点和示例。
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)：session、linked agent、tool、skill、sidecar、profile 和 TSX DSL 的稳定参考。
- [Profile Routing](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-routing.md) / [Leader 协作协议](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)：入口 agent 选择、任务错位切换建议，以及 leader、writer、retrieval、researcher、RP profiles 的协作边界。
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)：用 TSX 表达 prompt、上下文和运行期提醒。
- [Agent Harness](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness.md)：Agent Harness、runtime hooks、SSE 和 session tree 的后续阅读入口。
- [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md)：英文项目入口。
