---
layout: home

hero:
  name: "NeuroBook"
  text: "长篇小说创作的本地 AI 工作台"
  tagline: 把设定、正文、剧情结构和 Agent 协作放进同一个可控工作区。
  actions:
    - theme: brand
      text: 快速开始
      link: /quick-start
    - theme: alt
      text: 了解 NeuroBook
      link: /introduction
    - theme: alt
      text: 部署方式
      link: /deployment

features:
  - title: 文件化 Project Workspace
    details: 每部作品都有独立 Project Workspace，lorebook、manuscript、simulation 等目录都能直接查看、编辑和迁移。
  - title: Markdown Studio
    details: 正文和设定以 Markdown 为长期真相，同时提供更接近写作软件的富文本编辑体验。
  - title: Plot System
    details: 用 Thread、Scene、Plot 管理长期剧情线、场景和情节点，让剧情结构不被正文草稿淹没。
  - title: Agent 协作
    details: 通过 session、linked agent、profile、skill 和工具调用，把检索、规划、写作和整理纳入可见流程。
  - title: Profile 与 Skill
    details: 用 profile 定义 Agent 角色和工具边界，用 skill 沉淀可复用工作流程。
  - title: 本地部署与可控数据
    details: 支持 Windows Release Zip、local-git 和 Docker 模式，默认使用 SQLite 与本地 workspace 保存数据。
---

## 从哪里开始

如果你只是想先跑起来，先读 [快速开始](/quick-start)。如果你要部署到自己的机器或服务器，读 [部署方式](/deployment)。

如果你想理解 NeuroBook 的产品心智模型，读 [介绍](/introduction)。如果你要理解 Agent 如何工作，读 [Agent](/agent/) 和 [Profile](/profile/)。

## 文档分区

- [介绍](/introduction)：NeuroBook 是什么，适合谁，和普通 AI 聊天工具有什么区别。
- [快速开始](/quick-start)：最短路径跑起应用并创建管理员。
- [部署方式](/deployment)：Windows Release Zip、local-git、ghcr、source 的选择和边界。
- [Agent](/agent/)：session、linked agent、tool、skill、sidecar 的使用心智。
- [Profile](/profile/)：leader、writer、retrieval、RP 等 profile 的职责。
- [Profile TSX](/profile-tsx/)：用 TSX 表达 prompt、上下文和运行期提醒。
- [高级概念](/agent/advanced)：Agent Harness、runtime hooks、SSE 和 session tree 的后续阅读入口。
