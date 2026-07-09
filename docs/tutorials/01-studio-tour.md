# 认识你的小说工作台

这一节结束后，你会知道 NeuroBook 页面上的主要区域分别负责什么，并能判断一个任务应该交给编辑器、文件树、Plot 还是 Agent。

NeuroBook 更像一个小说 IDE，而不是单纯的聊天框。它把正文、设定、剧情结构和 Agent 协作放在同一个本地工作区里。你可以直接编辑文件，也可以让 Agent 按明确边界读取、整理和写入这些文件。

## 首页和项目

打开应用后，你首先要关注的是当前 Project Workspace。每一本书都是一个独立项目，通常位于 `workspace/{project}/`，里面会有 `project.yaml`、`lorebook/`、`manuscript/`、`simulation/` 和 `.nbook/`。

你可以把 Project Workspace 理解成这本书的工作室：

- `project.yaml`：这本书的名字、简介和项目身份。
- `lorebook/`：稳定设定，像角色、地点、物品、势力和世界规则。
- `manuscript/`：正文草稿和章节。
- `simulation/`：会变化的世界运行态，用于世界模拟和 RP。
- `reference/`：外部素材、导入归档和低置信迁移材料。

## Markdown Studio

Markdown Studio 是正文和设定的主要编辑区。NeuroBook 把 Markdown 文件作为长期真相，同时提供更接近写作软件的富文本编辑体验。

你可以在这里写章节正文，也可以修改世界书条目。源码模式适合精确处理 Markdown、frontmatter 和引用；富文本模式适合专心写作。

## 文件树

文件树让你看到 Project Workspace 的真实目录。和许多只把内容藏在数据库里的工具不同，NeuroBook 鼓励你理解文件结构，因为 Agent 也会按这些路径读写内容。

写作时最常看的目录是：

- `lorebook/`：设定说明书。
- `manuscript/`：章节正文。
- `simulation/subjects/`：参与世界模拟的角色或主体。
- `simulation/entities/`：需要独立状态的物品、地点、机关或其他实体。
- `simulation/runs/`：世界模拟 Tick 的过程记录。

## Plot System

Plot System 管理长期剧情结构。它不替代正文，也不替代世界书。它负责把 Story、Thread、Scene 和 Plot 这类剧情骨架保存下来，让 Agent 写章节时有明确的目标和落点。

当你准备写正式章节时，最好先让 Agent 把剧情目标整理进 Plot，再调用 writer 写正文。

## Agent 抽屉

Agent 抽屉是你和 AI 协作的入口。你可以让 leader 理解你的意图、调用 Skill、检索设定、创建 linked agent，或者把章节写作任务交给 writer。

几个常见概念先记住直觉就够了：

- Agent：一次可持续协作的 AI 工作单元。
- session：和某个 Agent 的一条对话 / 工作记录。
- profile：定义 Agent 的角色、工具权限和提示词边界。
- Skill：一张可复用的工作流程卡，教 Agent 怎么完成某类任务。

下一节会用这些概念创建第一本书。
