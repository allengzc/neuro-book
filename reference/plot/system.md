# Plot System

Plot System 是 Project Workspace 内的作者视角剧情结构系统。它保存未来规划、因果线、场景安排、章级写作指令、伏笔和写作提示；不保存正文，也不替代 lorebook 或 World Engine。

Plot 组织为**两棵树**：

- **承载树(结构)**:`Story → StoryAct(卷) → StoryChapter(章) → Prose(正文)`。表达「这本书由哪些卷、哪些章组成,每章怎么写」。
- **因果树(剧情)**:`Story → StoryPhase(阶段) → StoryThread(线) → StoryScene(场)`。表达「有哪些剧情线,每条线由哪些场推进」。

两棵树在 **Scene 挂章**处交汇:每个 `StoryScene` 通过 `chapterId` 外键挂到一个 `StoryChapter`,决定它在正文里的呈现位置。事实推进、状态变化和时间线真相由 World Engine slice / patch 表达,Plot System 只保存作者视角的结构、目的、写作提示、章级指令和与 World Engine 的连接点。

Chapter 与 manuscript 文件**切割**:章是 Plot 实体,正文(Prose)是 manuscript 内容节点,通过 Prose 的 frontmatter `chapter: <StoryChapter.name>` 反指所属章。文件移动/改名不影响章;一个章可关联多份 Prose(通常一份,草稿/重写版可共存)。章节顺序权威在 `StoryAct.sortOrder` / `StoryChapter.sortOrder`,manuscript 目录名前缀退化为装饰。

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
| `StoryAct` | 承载树:卷。对应 manuscript volume 层,但与文件系统切割。 |
| `StoryChapter` | 承载树:章一等实体。带 ChapterBrief 字段组(章级写作指令);Prose 通过 frontmatter 反指。 |
| `StoryPhase` | 因果树:剧情阶段分组，用于整理 Thread。 |
| `StoryThread` | 因果树:一条长期剧情线、冲突线、成长线或伏笔线。 |
| `StoryScene` | 因果树最小单位;一场戏或连续叙事单元。经 `chapterId` 挂章,是两棵树的交汇点,也是 Plot 与 World Engine 的桥梁。 |
| `StorySceneRef` | Scene 到内容节点或剧情对象的结构化关系。 |

**ChapterBrief**(`StoryChapter` 上的 `brief*` 字段组)是章级 writer 指令:章节目标/落点、POV、语气、节奏、信息控制(读者已知/主角已知/必须隐藏/可暗示)、开场钩子、禁写事项。全部可选、自由文本为主(防限死创造力);不保存动态世界状态(那是 World Engine),不替代 Scene 剧情点。它是 writer brief 里「信息控制」等段的来源,详见 [writer-brief.md](writer-brief.md)。

## DTO Fields

当前公开 DTO 的核心字段：

| DTO | Important Fields |
| --- | --- |
| `Story` | `id`、`title`、`summary`、`note`、`createdAt`、`updatedAt` |
| `StoryAct` | `id`、`storyId`、`sortOrder`、`name`、`title`、`summary`、`note` |
| `StoryChapter` | `id`、`storyId`、`actId`、`sortOrder`、`name`、`title`、`note`、`brief`(ChapterBrief 对象) |
| `ChapterBrief` | `goal`、`pov`、`tone`、`pacing`、`readerKnows`、`protagonistKnows`、`mustHide`、`hintOnly`、`opening`、`ending`、`doNotWrite`(全部 nullable) |
| `StoryPhase` | `id`、`storyId`、`sortOrder`、`name`、`title`、`summary`、`note` |
| `StoryThreadSummary` | `id`、`storyId`、`storyPhaseId`、`sortOrder`、`name`、`title`、`isMainThread`、`status`、`summary`、`tags`、`writingTip`、`note` |
| `StorySceneSummary` | `id`、`storyId`、`threadId`、`chapterId`、`chapter`(轻量摘要)、`threadSortOrder`、`chapterSortOrder`、`title`、`status`、`summary`、`purpose`、`writingTip`、`note`、`worldAnchor` |
| `StorySceneDetail` | Scene summary fields + `refs`、`effectiveRefs` |
| `SceneWorldContext` | `slices`、`subjectStates`、`unresolvedSubjectIds` |
| `ChapterPlotDetail` | `chapter`、`scenes`、`totalScenes` |
| `PlotTree` | `story`、`phases`(因果树)、`ungroupedThreads`、`acts`(承载树)、`ungroupedChapters`、各 total 计数 |

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

Scene 是一场戏或一个连续叙事单元，也是 Plot System 与 World Engine 的连接点。

常见字段：

- `title`
- `summary`
- `purpose`
- `status`
- `threadSortOrder`
- `chapterId`
- `chapterSortOrder`
- `writingTip`
- `worldAnchor`
- `refs`

`chapterId` 是 `StoryChapter` 外键(nullable),把 Scene 挂到承载树上的某个章；这是两棵树的交汇点。Scene 不再直接持有 manuscript 路径字符串——正文承载关系由 Chapter 与 Prose 的 frontmatter 反指表达(见下)，Scene 只认章实体。

`chapterId` 校验规则：

- 必须指向当前 Story 下真实存在的 `StoryChapter`。
- 可以为 `null`：Scene 先规划、稍后挂章。
- `onDelete: SetNull`——删除 Chapter 时挂在它上面的 Scene 退回未挂章状态，不级联删 Scene。

**Chapter ↔ Prose(frontmatter 反指)**:章不直接存正文路径；正文(manuscript content-node)在自己的 `index.md` frontmatter 写 `chapter: <StoryChapter.name>` 反指所属章。查询复用 `ProjectWorkspaceIndex`(watcher 重建的内存快照，节点已含解析好的 frontmatter)，`ChapterProseService` 过滤 `frontmatter.chapter === chapter.name` 解析 Chapter→Prose。文件移动/改名不影响章；一个章可关联多份 Prose(通常一份，草稿/重写版可共存)；指向不存在章名的 Prose 记为孤儿。

Scene 有两套排序：

- `threadSortOrder`：Scene 在线程内的因果顺序。
- `chapterSortOrder`：Scene 在同一章节内的正文呈现顺序；`chapterId = null` 时为 `null`。

## Scene World Anchor

`worldAnchor` 让 Scene 连接 World Engine：

| Field | Meaning |
| --- | --- |
| `startTime` / `endTime` | HTTP / 前端使用的项目日历字符串；`null` 表示尚未连接时间线。 |
| `startInstant` / `endInstant` | raw instant 的字符串形式，用于稳定排序、调试和避免 JSON BigInt 问题。 |
| `subjectIds` | 该 Scene 相关的所有 World Engine subjects，不区分 POV / active / mentioned。 |
| `locationSubjectId` | 可选的地点 subject。 |
| `subjects` | 读取 DTO 专用；将 `subjectIds` 解析为 `{id,name,type,resolved}`。 |
| `locationSubject` | 读取 DTO 专用；地点 subject 的解析结果，未设置地点时为 `null`。 |
| `unresolvedSubjectIds` | 读取 DTO 专用；所有尚未接入 World Engine 的占位 subject ID。 |

服务层使用 World Engine 的 `Instant = bigint`，持久化使用 Prisma `BigInt`。HTTP / 前端不直接传 BigInt。

读取解析规则：

- Plot 聚合读取通过 `SceneWorldAnchorResolutionService` 解析 `subjects/locationSubject/unresolvedSubjectIds`，使用 World Engine 的 subject identity 表，不加载 schema/calendar。
- 如果 Project 尚未创建 `world-engine/calendar.ts`，Plot 读取仍应成功：保留 `startInstant/endInstant`，`startTime/endTime` 降级为 `null`，subject 按已登记身份解析，未登记 subject 继续显示 `resolved=false`。
- 如果 `calendar.ts` 存在但加载失败，且读取需要格式化 `startInstant/endInstant`，错误必须继续抛出；不得把损坏配置伪装成未初始化 Project。

校验规则：

- `startInstant` / `endInstant` 可以为 `null`，表示 Scene 先规划、稍后连接 World Engine。
- 当两者都存在时，`startInstant <= endInstant`。
- `subjectIds` 必须去重，不能包含空字符串。
- `locationSubjectId` 可以为空；若填写，允许先作为占位 subject ID 存在，但读取 DTO、UI 和 Agent 工具必须通过 `resolved=false` / `unresolvedSubjectIds` 显式暴露，不得静默写入幽灵锚点。

Scene World Context 通过服务端 API 查询：

```text
GET /api/projects/plot/scenes/:sceneId/world-context
```

查询策略：

- 使用 Scene 的闭区间 `[startInstant, endInstant]` 查询相关 slices。
- 查询前先解析 `subjectIds` 和 `locationSubjectId`；只用已存在的 World Engine subjects 查询 slices 和 subject states。
- subject 身份解析使用 calendar-free 读取，因此占位判断不依赖 `world-engine/calendar.ts`。
- 只返回涉及已解析 subjects 的 patches / slices 摘要。
- 查询已解析 subjects 在 `endInstant` 时刻的状态，用于 Inspector 上下文预览。
- 若部分 subject 尚未接入 World Engine，返回已解析上下文和 `unresolvedSubjectIds`。
- 若全部 subject 都是占位，返回空 `slices` / `subjectStates` 和 `unresolvedSubjectIds`，不报错。
- 未连接时间范围的 Scene 仍可正常编辑，但无法查询 World Engine 上下文。
- `SceneWorldContext` 是实际 World Engine 查询能力；当需要真实 slices、state reduce 或时间格式化而 Project 缺少/损坏 calendar 配置时，可以返回配置错误。

前端打开完整 World Engine Workbench 不通过 `SceneWorldContext` DTO 返回路径字段；Plot Workbench 通过显式 UI 事件关闭当前剧情工作台并打开真实 World Engine Workbench。

## Refs

Plot refs 用结构化关系连接剧情对象和内容节点。

推荐使用：

- `lorebook/.../`：角色、地点、物品、势力、机制等内容节点。
- `manuscript/.../`：章节或正文承载。
- `thread://{id}`、`scene://{id}`：剧情内部对象。

内容节点路径应优先使用 Project Workspace 相对路径，不要恢复旧 `lorebook://` 心智。

`refs` 当前只存在于 Scene 层；`effectiveRefs` 是 Scene 自身有效结构化引用的规整视图(去重、解析 gloss)，**当前实现不合并所属 Thread 的 refs**——Thread 级 refs 泛化是后置项，文档不承诺。`visibility` 只表达 author / reader 侧的参考可见性，不是 lorebook information-control 授权系统。

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

不要把所有出场角色、地点和普通提及都塞进 structured refs；普通自然提及优先使用正文、summary 或 `worldAnchor.subjectIds/locationSubjectId`。

## Agent Tools

读取：

- `get_plot_tree`（输出两棵树：`acts`/`ungroupedChapters` + `phases`/`ungroupedThreads`）
- `get_story_thread`
- `get_story_scene_context`
- `get_chapter_plot`（入参 `chapterId`）
- `get_scene_world_context`
- `get_chapter_writer_brief`（入参 `chapterId` + `mode`，`mode` 默认 `autonomous`）

写入：

- `create_story_act` / `update_story_act`
- `create_story_chapter` / `update_story_chapter`（含 ChapterBrief 字段组）
- `create_story_thread` / `update_story_thread`
- `create_story_scene` / `update_story_scene`（Scene patch 用 `chapterId` 挂章）

使用规则：

- 需要 `projectPath` 时传 `workspace/{project}`。
- 章级查询用 `chapterId`（不再传 manuscript 路径字符串）；正文承载由 Prose frontmatter 反指，不经 Scene。
- `get_story_thread` / `get_story_scene_context` 可以在未传 id 时使用 session 的 `plot.selection` 焦点。
- 创建或更新 Thread / Scene 会刷新 `plot.selection`。
- Writer 写章节前，Leader 应优先用 `get_chapter_writer_brief` 编译 Chapter Writer Brief。若 status 不是 `ready`，再用 `get_chapter_plot` / `get_story_scene_context` / `get_scene_world_context` 和 update/create 工具补 Plot、ChapterBrief、World Anchor 或 World Context 后重新编译。
- Plot refs 帮助检索上下文，但不自动授权 writer 读取隐藏 lorebook 或 subject 私密 knowledge。

Thread / Scene 的 agent-facing 写法、摘要密度和 World Engine 连接规则见 [agent-spec.md](agent-spec.md)。

After plot edits, check continuity: character motivation, causal chain, reader information and protagonist information should not be accidentally mixed.

## Agent Consumption

Agent 写作或规划时按这个顺序读 Plot：

1. 调用 writer 前，用 `get_chapter_writer_brief`(传 `chapterId` + `mode`)编译目标章节的 writer brief。
2. 如果 brief status 不是 `ready`，用 `get_chapter_plot`(传 `chapterId`)获取目标章节承载的 scenes。
3. 如果需要更完整的线索，用 `get_story_scene_context` 读取 scene、parent thread 和同章 scene view。
4. 如果目标 Scene 已连接 World Engine，用 `get_scene_world_context` 读取相关 slices 和 subject states。
5. 如果要调整长期因果线，用 `get_story_thread` 或 `get_plot_tree`。
6. 修改后用对应 update/create 工具，不要直接用 SQL 绕过业务校验，除非用户明确要求数据库级维护。

`execute_sql` 可查看 Project SQLite，但它是低层工具；普通剧情编辑优先用 Plot tools。

## Boundary

Plot System 适合：

- 未来规划。
- 章节承载关系。
- 多线剧情。
- 伏笔 / 回收。
- scene purpose 和 writing tips。
- 作者视角的信息差。
- Scene 到 World Engine 时间、地点和 subjects 的连接。

不适合：

- 正文 prose。
- 稳定世界 canon。
- subject 主观知识。
- entity 当前状态。
- 临时 run scratch。

稳定事实落定后，可以由作者或 Agent 整理同步进 `lorebook/`。当前动态世界状态应进入 World Engine。
