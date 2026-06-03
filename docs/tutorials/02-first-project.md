# 创建第一本书

这一节结束后，你会拥有一个新的 Project Workspace，并知道如何让 Agent 围绕这个项目工作。

## 创建项目

在应用里创建新项目时，给它一个清晰的标题和一句简介。标题可以先不完美，后面随时能改；简介最好能说明题材、主角和核心吸引力。

一个好用的起点是：

```text
标题：星灯列车
简介：一名失去记忆的列车检票员，在跨越梦境城市的夜行列车上寻找自己的真实身份。
```

创建完成后，NeuroBook 会生成一个 Project Workspace。默认模板会准备基础目录，包括 `lorebook/`、`manuscript/` 和 `simulation/`。

## 操作路径

第一次创建项目时，按这个顺序做：

1. 打开 NeuroBook 并登录。
2. 进入项目入口，选择创建新项目。
3. 填写标题和简介。
4. 创建后进入项目页面。
5. 确认文件树里能看到 `project.yaml`、`lorebook/`、`manuscript/`、`simulation/`。
6. 打开 Agent 抽屉。

如果你找不到创建入口，可以先问 Agent：

```text
我想创建第一本小说项目。请根据当前页面和项目状态，告诉我下一步应该点哪里或检查哪里。
```

## 先理解工作边界

Project Workspace 是这本书的边界。Agent 读取和写入项目文件时，应该优先使用项目内路径，例如：

```text
lorebook/character/主角/index.md
manuscript/001-volume/001-chapter/index.md
simulation/subjects/protagonist/state.md
```

如果你只记住一件事：稳定设定放进 `lorebook/`，正式正文放进 `manuscript/`，会变化的运行态放进 `simulation/`。

## 打开第一个 Agent

默认创作入口通常是普通创作 Leader。它像一个总编 / 制片人，负责判断你现在要做什么，然后决定是否调用 Skill、检索资料、创建写作 Agent，或者先推进世界运行态。

你可以直接对它说：

```text
帮我为这个新项目做一次小说初始化。先问我必要问题，然后建立最小可写的故事概念、世界书骨架和前三章方向。
```

Agent 不会凭空拥有所有项目知识。它会通过工具读取当前 Project Workspace，或者按 Skill 的说明推进任务。

## 成功标志

完成本节后，你应该看到：

```text
project.yaml
lorebook/
manuscript/
simulation/
reference/
.nbook/
```

Agent 应该能回答“当前项目是什么”，并能说明它接下来会如何初始化这本书。

如果 Agent 说找不到当前项目，先让它检查 Current Project Workspace：

```text
请检查当前 Project Workspace 是否已设置。如果没有，请告诉我应该如何切换到刚创建的项目。
```

## Agent、profile、session、Skill 的关系

这一套名字听起来像工程术语，但使用时可以这样理解：

- profile 是 Agent 的角色设定。普通创作 Leader 负责统筹，writer 负责写正文，RP Leader 负责世界模拟。
- session 是工作记录。同一个 profile 可以开很多 session。
- Agent 是正在工作的那位 AI 助手。
- Skill 是流程说明书。比如“小说初始化流程”会告诉 Agent 怎么从模糊灵感落到项目文件。

下一节开始，你会让 leader 调用 Skill，把一个空项目变成能写的小说项目。
