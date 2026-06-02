# Plot System

Plot System 是 Project Workspace 内的作者视角剧情结构系统。它保存未来规划、因果线、场景安排、节奏点、伏笔和写作提示，不保存正文，也不替代 lorebook。

## Storage

Plot 数据保存在当前 Project Workspace 的 Project SQLite：

```text
workspace/{project}/.nbook/project.sqlite
```

App SQLite 不保存 Story / Plot 数据；Plot 工具必须以 `projectPath` 定位 Project Workspace。

## Core Objects

| Object | Meaning |
| --- | --- |
| `Story` | 单个 Project Workspace 的剧情根作用域。 |
| `StoryPhase` | 剧情阶段分组，用于整理 Thread。 |
| `StoryThread` | 一条长期剧情线、冲突线、成长线或伏笔线。 |
| `StoryScene` | 基本叙事单位，一场戏或连续叙事单元。 |
| `StoryPlot` | Scene 内部的最小推进点。 |
| `StorySceneRef` | Scene / Thread 到内容节点或剧情对象的结构化关系。 |

Scene 是高频协作单位：它属于一个 Thread，也可以挂到一个 manuscript chapter。

## DTO Fields

当前公开 DTO 的核心字段：

| DTO | Important Fields |
| --- | --- |
| `Story` | `id`、`title`、`summary`、`note`、`createdAt`、`updatedAt` |
| `StoryPhase` | `id`、`storyId`、`sortOrder`、`name`、`title`、`summary`、`note` |
| `StoryThreadSummary` | `id`、`storyId`、`storyPhaseId`、`sortOrder`、`name`、`title`、`isMainThread`、`status`、`summary`、`tags`、`writingTip`、`note` |
| `StorySceneSummary` | `id`、`storyId`、`threadId`、`chapterPath`、`threadSortOrder`、`chapterSortOrder`、`title`、`status`、`summary`、`purpose`、`writingTip`、`note` |
| `StorySceneDetail` | Scene summary fields + `plots`、`refs`、`effectiveRefs` |
| `StoryPlot` | `id`、`sceneId`、`sortOrder`、`kind`、`summary`、`effect`、`writingTip`、`note` |
| `ChapterPlotDetail` | `chapterPath`、`scenes`、`totalScenes`、`totalPlots` |

Status values：

```text
StoryThread.status = active | draft | paused | done | archived
StoryScene.status  = draft | active | written | revised | archived
```

## Thread

Thread 表达一条因果线，不等于章节。

常见字段：

- `title`
- `summary`
- `isMainThread`
- `status`
- `tags`
- `writingTip`
- `refs`
- `sortOrder`
- `phaseId`

Thread refs 表达长期依赖、常驻设定、伏笔源和冲突对象。

## Scene

Scene 是一场戏或一个连续叙事单元。

常见字段：

- `title`
- `summary`
- `purpose`
- `status`
- `threadSortOrder`
- `chapterPath`
- `chapterSortOrder`
- `writingTip`
- `refs`

`chapterPath` 指向 Project Workspace 相对 manuscript content-node 目录，例如：

```text
manuscript/001-volume/001-chapter/
```

工具入口可以接收 Agent 常见的 `project-slug/manuscript/...` 或 `workspace/project-slug/manuscript/...`，但持久化值应归一为 Project Workspace 相对路径。

`chapterPath` 校验规则：

- 必须位于当前 Project Workspace 的 `manuscript/` 下。
- 必须以 `/` 结尾并指向目录。
- 必须指向真实存在、包含 `index.md`、类型为 `chapter` 的 manuscript content-node。
- 传 volume 目录会被拒绝；需要传更深一层 chapter 目录。

Scene 有两套排序：

- `threadSortOrder`：Scene 在线程内的因果顺序。
- `chapterSortOrder`：Scene 在同一章节内的正文呈现顺序；`chapterPath = null` 时为 `null`。

## Plot

Plot 是 Scene 内部的节奏点。

常见字段：

- `kind`
- `summary`
- `effect`
- `writingTip`
- `sortOrder`

常见 kind：

```text
setup | action | conflict | despair | relief | reward | mystery | reveal | twist | payoff | result
```

Plot 用来帮助作者和 Agent 判断一场戏内部是否有推进、铺垫、回收和后果。

## Refs

Plot refs 用结构化关系连接剧情对象和内容节点。

推荐使用：

- `lorebook/.../`：角色、地点、物品、势力、机制等内容节点。
- `manuscript/.../`：章节或正文承载。
- `thread://{id}`、`scene://{id}`、`plot://{id}`：剧情内部对象。

内容节点路径应优先使用 Project Workspace 相对路径，不要恢复旧 `lorebook://` 心智。

`refs` 当前存在于 Scene 层；`effectiveRefs` 表示 Scene 自身有效结构化引用。`visibility` 只表达 author / reader 侧的参考可见性，不是 lorebook information-control 授权系统。

推荐关系标签：

- `defines`
- `constrains`
- `depends_on`
- `part_of`
- `contains`
- `foreshadows`
- `pays_off`
- `conflicts_with`
- `derived_from`

不要把所有出场角色、地点和普通提及都塞进 structured refs；普通自然提及优先使用正文或 summary 中的 Markdown link。

## Agent Tools

读取：

- `get_plot_tree`
- `get_story_thread`
- `get_story_scene_context`
- `get_chapter_plot`

写入：

- `create_story_thread`
- `update_story_thread`
- `create_story_scene`
- `update_story_scene`
- `create_story_plot`
- `update_story_plot`

使用规则：

- 需要 `projectPath` 时传 `workspace/{project}`。
- 章节相关查询使用 manuscript content-node path。
- `get_story_thread` / `get_story_scene_context` 可以在未传 id 时使用 session 的 `plot.selection` 焦点。
- 创建或更新 Thread / Scene 会刷新 `plot.selection`。
- Writer 写章节时，Leader 应优先用 `get_chapter_plot` 获取本章承载的 Scene / Plot。
- Plot refs 帮助检索上下文，但不自动授权 writer 读取隐藏 lorebook 或 subject 私密 knowledge。

## Agent Consumption

Agent 写作或规划时按这个顺序读 Plot：

1. 用 `get_chapter_plot` 获取目标章节承载的 scenes 和 plots。
2. 如果需要更完整的线索，用 `get_story_scene_context` 读取 scene、parent thread 和同章 plot view。
3. 如果要调整长期因果线，用 `get_story_thread` 或 `get_plot_tree`。
4. 修改后用对应 update/create 工具，不要直接用 SQL 绕过业务校验，除非用户明确要求数据库级维护。

`execute_sql` 可查看 Project SQLite，但它是低层工具；普通剧情编辑优先用 Plot tools。

## Boundary

Plot System 适合：

- 未来规划。
- 章节承载关系。
- 多线剧情。
- 伏笔 / 回收。
- scene purpose 和 writing tips。
- 作者视角的信息差。

不适合：

- 正文 prose。
- 稳定世界 canon。
- subject 主观知识。
- entity 当前状态。
- 临时 run scratch。

稳定事实落定后，可以由作者或 Agent 整理同步进 `lorebook/`。当前模拟状态应进入 `simulation/subjects/` 或 `simulation/entities/`。
