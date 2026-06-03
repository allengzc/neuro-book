---
layout: home

hero:
  name: "NeuroBook"
  text: "面向长篇小说创作的本地 AI 工作台"
  tagline: 以作者为主导，集成文件化 workspace、Markdown Studio、剧情结构管理和多 Agent 写作流程，并探索 AI RP 与 SillyTavern 角色卡迁移。
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

features:
  - title: 文件化 Project Workspace
    details: 用统一目录组织 lorebook、manuscript、simulation 和 reference；像 VS Code workspace 一样支持本地配置和用户覆盖，便于迁移、协作与分发。
  - title: SillyTavern 角色卡导入
    details: 支持 inspect、unpack、import 三段式导入，保留原始卡片和 worldbook 归档，把稳定设定迁入 lorebook，并为后续 RP / simulation 迁移保留动态机制材料。
  - title: 世界模拟
    details: 用 simulation 目录拆分 GM、subject、entity 和 run 状态，让不同 emulator 只看到被授权的信息，减少角色全知和隐藏设定泄露。
  - title: Agent
    details: 系统深度接入多 Agent 协作，leader 可编排检索、写作、研究与世界推进，writer、retrieval、RP profiles 各司其职，并能真实读写 Project Workspace。
  - title: Profile 系统
    details: 用 TSX Profile 定义 Agent 身份、工具权限、上下文、Sidecar、summarizer 和输出合同；用户可以在系统 profile 之上覆盖和自定义。
  - title: 本地部署与可控数据
    details: 支持 Windows Release Zip、local-git、GHCR 和 source Docker 模式，默认使用 SQLite 与本地 workspace 保存数据，模型 Provider 和项目内容由用户掌控。
---

## 从哪里开始

如果你已经完成部署，直接进入 [从第一本书到第一次 RP](/tutorials/)：它会带你创建项目、调用 Skill、写前三章、导入角色卡，并进入世界模拟。

如果你还没有把应用跑起来，先读 [快速开始](/quick-start)。如果你要部署到自己的机器或服务器，读 [部署方式](/deployment)。

如果你想理解 NeuroBook 的产品心智模型，读 [介绍](/introduction)。如果你要理解 Agent 如何工作，读 [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)。

## 文档分区

- [介绍](/introduction)：NeuroBook 是什么，适合谁，和普通 AI 聊天工具有什么区别。
- [快速开始](/quick-start)：最短路径跑起应用并创建管理员。
- [基础教程](/tutorials/)：从第一个项目到前三章、角色卡导入和世界模拟。
- [部署方式](/deployment)：Windows Release Zip、local-git、ghcr、source 的选择和边界。
- [Agent](/agent/)：Agent、session、profile、Skill 和 linked agent 的产品心智模型。
- [Profile](/profile/)：内置 profile 分工、writer 边界和 RP profiles。
- [Profile TSX](/profile-tsx/)：profile 作者使用的 TSX DSL、节点和示例。
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)：session、linked agent、tool、skill、sidecar、profile 和 TSX DSL 的稳定参考。
- [Leader 协作协议](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)：leader、writer、retrieval、researcher、RP profiles 的职责和调用边界。
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)：用 TSX 表达 prompt、上下文和运行期提醒。
- [Agent Harness](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness.md)：Agent Harness、runtime hooks、SSE 和 session tree 的后续阅读入口。
