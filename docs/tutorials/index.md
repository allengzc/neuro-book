# 从第一本书到第一次 RP

这套教程带你走完 NeuroBook 的第一条完整创作路径：创建项目、初始化设定、调用 Skill、写出前三章、导入 SillyTavern 角色卡，并进入世界模拟 / RP 模式。

它不是开发者手册。你不需要先理解 Agent Harness、profile TSX 或数据库结构。你只要像启动一间小说工作室一样，按顺序把工作台、作品、设定、章节和角色准备起来。

## 你会完成什么

完成这套教程后，你会拥有：

- 一个可继续维护的 Project Workspace。
- 一套最小可用的 `lorebook/` 世界书。
- 前三章正文草稿。
- 一份从 SillyTavern 角色卡导入的素材归档和设定迁移结果。
- 一个可进入第一 Tick 的 `simulation/` 世界模拟目录。

## 推荐路线

1. [开始前检查](./00-before-you-start.md)：确认应用、模型 Provider 和 Agent 能正常工作。
2. [认识你的小说工作台](./01-studio-tour.md)：知道页面上每个区域负责什么。
3. [创建第一本书](./02-first-project.md)：创建 Project Workspace，并理解 Agent、session、profile、Skill 的关系。
4. [用 Skill 点燃故事](./03-skills-bootstrap.md)：从灵感、项目初始化、世界书和角色设计开始。
5. [写出前三章](./04-first-three-chapters.md)：把设定和剧情变成真正的章节正文。
6. [导入一张角色卡](./05-import-character-card.md)：把 SillyTavern 卡片拆包、归档并导入 Project Workspace。
7. [进入世界模拟](./06-enter-world-simulation.md)：让 simulator leader、actor 和 writer 推进一次 RP Tick。

## 什么时候读 Reference

教程只讲“怎么开始”。当你想知道系统为什么这样组织文件，或者要让 Agent 更精确地改项目时，再读 Reference：

- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)：Agent、profile、Skill、Sidecar 和 Harness。
- [Project Workspace Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/neurobook-project-guide.md)：项目文件、内容节点和 Agent 文件语义。
- [Content Reference](https://github.com/notnotype/neuro-book/blob/master/reference/content/README.md)：`lorebook/`、`simulation/`、retrieval 和信息控制。
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/reference/agent/novel-writing-workflow.md)：写作模式、emulation tick、writer handoff 和 workflow skill。
