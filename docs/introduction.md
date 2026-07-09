# 介绍

NeuroBook 是一款基于 Nuxt 构建的长篇小说创作与 AI 角色扮演 IDE。

它解决的不是“生成一段文字”这种短问题，而是长篇创作中的持续管理问题：设定会变，剧情会推进，角色会记住过去，章节会互相影响，草稿会分叉，写作任务会积压。NeuroBook 把这些内容放进同一个可见、可编辑、可协作的 Project Workspace 中，并用领域化 Agent 系统支撑写作、检索、世界模拟和 RP。

## 产品定位

NeuroBook 更像小说作者使用的本地 IDE，而不是普通聊天框。

它同时提供四层能力：

- 内容管理：设定、正文、草稿、章节资料、引用和状态文件。
- 剧情管理：长期剧情线、场景和情节点。
- 世界模拟：用 `simulation/` 管理 subject、entity、run 和 RP Tick。
- AI 协作：基于 NeuroAgentHarness 的检索、写作、规划、审批和多 Agent 任务协作。

这些能力会落到同一个 Project Workspace 中。作者可以直接看到自己的文件，也可以让 Agent 在明确边界内读取、整理和修改这些文件。

底层运行时基于 Pi 框架扩展，复用了 multi-provider、tool calling、append-only session tree 等基础抽象，并进一步引入 Profile、TSX Profile 和 Sidecar Context。Profile 定义 Agent 的行为边界；TSX Profile 用类型安全的上下文模板描述动态上下文；Sidecar Context 在主 run 前后执行 runtime-only 旁路任务，让检索、反思、记忆维护和状态整理不污染主对话。

## 适合谁

NeuroBook 适合这些使用者：

- 需要长期维护世界观、角色表和剧情线的小说作者。
- 需要把设定库、正文和任务记录统一管理的创作团队。
- 想把 AI 用在检索、规划、写作和整理，而不是只拿来聊天的使用者。
- 需要本地部署、可控数据路径和可导出 Markdown 工作流的用户。

如果你只需要一次性生成短文，普通 AI 聊天工具通常更轻。如果你要持续经营一部长篇作品，NeuroBook 的文件、剧情和 Agent 协作结构会更适合。

## 核心工作流

一个典型创作流程是：

1. 创建 Project Workspace。
2. 在 `lorebook/` 中整理角色、地点、组织、规则和笔记。
3. 在 Plot System 中规划 Thread、Scene 和 Plot。
4. 在 `manuscript/` 中编写章节正文。
5. 让 Agent 检索相关设定、规划下一步、调用 writer 写作或整理已有文件。
6. 通过 Markdown 文件和 Project SQLite 长期维护作品状态。

NeuroBook 的目标不是替作者做所有决定，而是让作者把复杂创作过程拆成可见、可回看、可继续的工作单元。

## 和普通工具的区别

普通 AI 聊天工具通常只知道当前对话。NeuroBook 会把作品内容放在 Project Workspace 中，并让 Agent 按工具权限读取和修改真实文件。

普通 Markdown 编辑器只管理文本。NeuroBook 还管理内容节点、引用、剧情结构和 Agent 协作过程。

普通项目管理工具只记录任务。NeuroBook 的任务、设定、正文和剧情结构都围绕小说创作服务。

## 下一步

- 想先跑起来：读 [快速开始](/quick-start)。
- 要选择部署方式：读 [部署方式](/deployment)。
- 想理解 Agent：读 [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)。
- 想理解 Profile：读 [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)。
