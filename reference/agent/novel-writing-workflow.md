# Novel Writing Workflow

本文定义 NeuroBook 写作模式的标准协作流程。它是推荐流程，不是强制流水线：`leader.default` 可以根据用户意图、省略不需要的步骤，也可以在用户明确要求时直接进入章节写作或润色。

## Current Contract

当前普通写作链路由 `leader.default` 编排，正文写作由普通 `writer` profile 执行。

- `writer` 是章节正文 agent，不是世界模拟 agent。
- `writer` 只自动读取创建 input 中的唯一 `chapterPaths`、该章节的 Chapter Plot、显式传入的 `lorebookEntries`，以及 lorebook 内容节点的 `index.md` / 可选同级 `state.md`。
- `writer` 不自动读取 `simulation/`，也不维护 `simulation/subjects/`、`simulation/entities/` 或 `simulation/runs/`。
- 需要世界推进、角色反应判断、势力态势或实体状态变化时，由 `leader.default` 决定是否启动 emulation 步骤，再把 writer-safe 的结果整理给 `writer`。

## Standard Flow

1. **Intent routing**：判断用户是在灵感探索、项目初始化、设定补全、剧情推进、章节写作、润色，还是导入素材。
2. **Project check**：确认 Current Project Workspace、目标章节、当前 Plot 焦点和是否已有可用 emulation 当前状态。
3. **Canon preparation**：如果稳定设定不足，补 `lorebook/`、角色节点或相关作品级 `instruction/`。稳定事实进入 `lorebook/`，不要写进临时 run。
4. **Emulation decision**：如果用户要求推进剧情、判断下一段因果、模拟角色/势力/地点自然反应，或者章节会改变状态，进入 emulation；否则跳过。
5. **Emulation tick**：emulator 根据用户指令或 leader 自动决策，读取必要 lorebook、Plot 和当前 state，推演下一个 tick。
6. **State commit**：leader / emulator 把已裁决事实写入 `simulation/subjects/`、`simulation/entities/`，并在 `simulation/runs/` 记录过程。
7. **Plot handoff**：把选中的剧情结果整理进 Plot System，形成或更新 Thread / Scene / Plot。
8. **Retrieval handoff**：需要设定上下文时先调用 `retrieval`，leader 选择 `entries[].path` 传给 writer，不把 retrieval 的 reason / use / risk 直接交给 writer。
9. **Chapter writing**：创建或复用普通 `writer`，传唯一 `chapterPaths`、选中的 `lorebookEntries`、约束和文风预设。
10. **Post-write check**：leader 检查正文是否产生新事实或状态变化；如需要，补一次 emulation commit 或 Plot 更新。

## Emulation Usage

`emulation` 是写作模式里的概念：把静态 canon 和当前状态推进到“下一刻发生了什么”。当前实现目录仍使用 `simulation/`，后续是否重命名为 `emulation/` 需要单独迁移设计。

适合启动 emulation 的场景：

- 用户问“接下来会发生什么”“当前局势怎么演化”“这个行动会导致什么”。
- 需要根据角色、势力、地点、资源、环境或制度惯性推演下一段剧情。
- 需要处理信息差、隐藏状态、物品持有、地点状态、伤势、门锁、机关、倒计时等可变事实。
- 写完章节后，正文已经让状态发生明显变化。
- 开局剧情设计前，需要把 lorebook 转成当前可写状态。

通常不需要 emulation 的场景：

- 写简介、标题、短推荐语。
- 单纯补稳定设定或整理 lorebook。
- 润色已有正文且不改变事件结果。
- 局部改句子、改文风、改排版。

边界：

- `lorebook/` 保存 prototype、canon、规则和作品说明。
- `simulation/subjects/` 保存 subject 当前事件、知识、心理和状态。
- `simulation/entities/` 保存需要状态追踪的实例。
- `simulation/runs/` 保存 tick 过程产物。
- `writer` 不直接维护 emulation；leader 把 emulation 结果过滤成 Plot、constraints、writer-safe brief 或选中的 lorebook state。

## Workflow Skills

小说协作 skill 建议分为三类：流程、技法、导入。后续如果重命名系统 skill，推荐使用可排序英文 key，frontmatter `name` 可继续保留中文。

### Workflow Skills

| Proposed Key | Current Skill | Purpose |
| --- | --- | --- |
| `novel-workflow-01-idea-exploration` | `小说灵感探索流程` | 从模糊灵感整理成故事雏形。 |
| `novel-workflow-02-project-bootstrap` | `小说初始化流程` | 建立故事概念、简介和最小 lorebook 骨架。 |
| `novel-workflow-03-lorebook-bootstrap` | `世界书初始化流程` | 建立开篇可用的稳定世界说明书。 |
| `novel-workflow-04-character-design` | `角色设计流程` | 深化主角、配角、反派、势力代表。 |
| `novel-workflow-05-emulation-bootstrap` | 已新增 | 初始化世界运行态目录、subjects、entities 和当前 tick。 |
| `novel-workflow-06-emulation-tick` | 已新增；旧 `世界模拟` 暂保留 | 根据当前状态推演下一 tick，产出 run report 和状态提交。 |
| `novel-workflow-07-opening-plot-design` | `开局剧情设计` | 把 lorebook + emulation 当前状态转成开篇可执行剧情。 |
| `novel-workflow-08-plot-planning` | `剧情规划流程` | 中长期剧情讨论、结构拆分和 Plot System 落点。 |
| `novel-workflow-09-chapter-writing` | 已新增 | 调用普通 writer 写章节正文。 |
| `novel-workflow-10-revision` | 已新增 | 章节修改、节奏检查、局部重写和润色。 |

### Technique Skills

| Proposed Key | Current Skill | Purpose |
| --- | --- | --- |
| `novel-technique-commercial-rhythm` | 已新增；旧 `爽文` 暂保留 | 商业网文节奏、期待管理、爽点和章末钩子。 |
| `novel-technique-scene-design` | 新增建议 | 场景目标、冲突、转折和落点设计。 |
| `novel-technique-viewpoint-control` | 新增建议 | 视角、信息控制、角色可知边界。 |

### Import Skills

| Proposed Key | Current Skill | Purpose |
| --- | --- | --- |
| `novel-import-silly-tavern-card` | 已新增；旧 `SillyTavern角色卡导入` 暂保留 | 导入 ST 角色卡、worldbook 和动态机制归档；第一遍导入只处理稳定 lorebook，动态机制进入 `reference/silly-tavern/**`。 |
| `novel-import-tomato-reference` | `番茄小说导入` | 导入番茄小说或外部小说参考资料。 |

## Emulation Bootstrap Skill

`novel-workflow-05-emulation-bootstrap` 应只负责初始化运行态，不负责推进剧情。

职责：

- 检查当前 Project Workspace 是否已有 `simulation/`。
- 根据已有 protagonist、重要 NPC、关键势力或用户指定对象创建最小 `subjects/`。
- 按需创建初始 `entities/`，只实例化有独立状态、隐藏真相、唯一性、损坏、进度或剧情重要性的对象。
- 写入 `simulation/current.md` 或 `simulation/runs/current.md` 的当前状态摘要。
- 创建 `simulation/runs/ticks/000000-initial-state/`，记录初始化报告。

不负责：

- 不推演下一段剧情。
- 不写章节正文。
- 不把上帝视角 lorebook 直接复制进 subject knowledge。

## Emulation Tick Skill

`novel-workflow-06-emulation-tick` 负责推进一个世界模拟 tick。

输入来源：

- 用户明确指令，例如“推演主角离开学院后的下一天”。
- leader 自动判断，例如“进入开局剧情设计前需要先确定当前局势”。
- 写后提交，例如“这一章已经发生战斗，需要更新伤势和持有物”。

输出：

- `simulation/runs/ticks/{tick-id}-{slug}/report.md`
- 可选 `simulation/runs/ticks/{tick-id}-{slug}/prose.md`
- 已裁决的 subject / entity state 更新。
- 可转入 Plot System 的剧情机会和后续钩子。

## Writing Mode Boundaries

- `leader.default` 可以更新 `simulation/`，但应把它视为世界运行态 commit，而不是随手笔记。
- 普通 `writer` 不维护 `simulation/`，也不自行遍历 `simulation/`。
- 如果需要正文级试写或 RP 输出，用户可见正文放到 tick `prose.md`；如果是正式章节正文，正文仍写到 `manuscript/.../index.md`，tick `prose.md` 可只放片段、摘要或链接。
- 重大不可逆世界状态变化，应优先让用户确认，或在 report 的 Open Questions 中挂起。
