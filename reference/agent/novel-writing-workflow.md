# Novel Writing Workflow

本文定义 NeuroBook 写作模式的标准协作流程。它是推荐流程，不是强制流水线：`leader.default` 可以根据用户意图、省略不需要的步骤，也可以在用户明确要求时直接进入章节写作或润色。

## Current Contract

当前普通写作链路由 `leader.default` 编排，正文写作由普通 `writer` profile 执行。

- `writer` 是章节正文 agent，不是世界模拟 agent。
- `simulator.leader` 是世界模拟主管，负责状态裁决、subject 反应、simulation/runs 报告、writer-safe brief 和 director handoff。
- `director` 是剧情导演，负责 Thread / Scene / Plot 设计、Plot 密度和 Plot System 落库。
- `writer` 创建 initial 为空；每轮通过 `invoke_agent.message` 接收写作任务，通过 `invoke_agent.input` 接收唯一目标 `path` 和建议读取清单。
- `writer` 不在 prepare 阶段自动读取 Plot、lorebook 或 readablePaths；它根据本轮 message 主动使用 Plot 只读工具和 read 工具读取必要上下文。
- `writer` 不自动读取 `simulation/`，也不维护 `simulation/subjects/`、`simulation/entities/` 或 `simulation/runs/`。
- 需要世界推进、角色反应判断、势力态势或实体状态变化时，由 `leader.default` 调用 `simulator.leader` 或启动 simulation tick，再把 writer-safe 的结果整理给 `writer`。

## Standard Flow

1. **Intent routing**：判断用户是在灵感探索、项目初始化、设定补全、剧情推进、章节写作、润色，还是导入素材。
2. **Project check**：确认 Current Project Workspace、目标章节、当前 Plot 焦点和是否已有可用 emulation 当前状态。
3. **Canon preparation**：如果稳定设定不足，补 `lorebook/`、角色节点或相关作品级 `instruction/`。稳定事实进入 `lorebook/`，不要写进临时 run。
4. **Simulation decision**：如果用户要求推进剧情、判断下一段因果、模拟角色/势力/地点自然反应，或者章节会改变状态，进入 simulation；否则跳过。
5. **Simulation tick**：`simulator.leader` 根据用户指令或 leader/director 任务，读取必要 lorebook、Plot 和当前 state，推演下一个 tick。
6. **State commit**：`simulator.leader` 把已裁决事实写入 `simulation/subjects/`、`simulation/entities/`，并在 `simulation/runs/` 记录过程。
7. **Plot handoff**：`director` 把选中的剧情结果整理进 Plot System，形成或更新 Thread / Scene / Plot。
8. **Retrieval handoff**：需要设定上下文时先调用 `retrieval`，leader 选择 `entries[].path` 放入 writer payload 的 `context.lorebookEntries`，不把 retrieval 的 reason / use / risk 直接交给 writer。
9. **Chapter writing**：创建或复用普通 `writer`，使用 `invoke_agent.message + input.path + input.context` 发送本轮写作任务。
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
- `writer` 不直接维护 simulation；leader 把 simulation 结果过滤成 Plot、message 中的 writer-safe 信息，或选中的 payload context。

## Workflow Skills

小说协作 skill 分为三类：流程、技法、导入。系统 skill 目录和 frontmatter `name` 都使用可排序英文 key；中文标题只保留在正文说明中。

### Workflow Skills

| Skill | Status | Purpose |
| --- | --- | --- |
| `novel-workflow-01-idea-exploration` | canonical | 从模糊灵感整理成故事雏形。 |
| `novel-workflow-02-project-bootstrap` | canonical | 建立故事概念、简介和最小 lorebook 骨架。 |
| `novel-workflow-03-lorebook-bootstrap` | canonical | 建立开篇可用的稳定世界说明书。 |
| `novel-workflow-04-character-design` | canonical | 深化主角、配角、反派、势力代表。 |
| `novel-workflow-05-emulation-bootstrap` | canonical | 初始化世界运行态目录、subjects、entities 和当前 tick。 |
| `novel-workflow-06-emulation-tick` | canonical | 根据当前状态推演下一 tick，产出 run report 和状态提交。 |
| `novel-workflow-07-opening-plot-design` | canonical | 把 lorebook + emulation 当前状态转成开篇可执行剧情。 |
| `novel-workflow-08-plot-planning` | canonical | 中长期剧情讨论、结构拆分和 Plot System 落点。 |
| `novel-workflow-09-chapter-writing` | canonical | 调用普通 writer 写章节正文。 |
| `novel-workflow-10-revision` | canonical | 章节修改、节奏检查、局部重写和润色。 |

### Technique Skills

| Skill | Status | Purpose |
| --- | --- | --- |
| `novel-technique-commercial-rhythm` | canonical | 商业网文节奏、期待管理、爽点和章末钩子。 |
| `novel-technique-scene-design` | 新增建议 | 场景目标、冲突、转折和落点设计。 |
| `novel-technique-viewpoint-control` | 新增建议 | 视角、信息控制、角色可知边界。 |

### Import Skills

| Skill | Status | Purpose |
| --- | --- | --- |
| `novel-import-silly-tavern-card` | canonical | 导入 ST 角色卡、worldbook 和动态机制归档；第一遍导入只处理稳定 lorebook，动态机制进入 `reference/silly-tavern/**`。 |
| `novel-import-tomato-reference` | canonical | 导入番茄小说或外部小说参考资料。 |

## Emulation Bootstrap Skill

`novel-workflow-05-emulation-bootstrap` 应只负责初始化运行态，不负责推进剧情。

职责：

- 检查当前 Project Workspace 是否已有 `simulation/`。
- 根据已有 protagonist、重要 NPC、关键势力或用户指定对象创建最小 `subjects/`。
- 按需创建初始 `entities/`，只实例化有独立状态、隐藏真相、唯一性、损坏、进度或剧情重要性的对象。
- 写入 `simulation/current.md` 或 `simulation/runs/current.md` 的当前状态摘要。
- 在 Project Workspace 内创建 `simulation/runs/ticks/000000-initial-state/`，记录初始化报告；文件工具路径必须带 `{project-slug}/` 前缀。

不负责：

- 不推演下一段剧情。
- 不写章节正文。
- 不把上帝视角 lorebook 直接复制进 subject knowledge。

## Emulation Tick Skill

`novel-workflow-06-emulation-tick` 负责推进一个世界模拟 tick；新 profile 路径下优先委托 `simulator.leader`。

输入来源：

- 用户明确指令，例如“推演主角离开学院后的下一天”。
- leader 自动判断，例如“进入 `novel-workflow-07-opening-plot-design` 前需要先确定当前局势”。
- 写后提交，例如“这一章已经发生战斗，需要更新伤势和持有物”。

输出：

- Project Workspace 内的 `simulation/runs/ticks/{tick-id}-{slug}/report.md`，文件工具路径为 `{project-slug}/simulation/runs/ticks/{tick-id}-{slug}/report.md`
- 可选 Project Workspace 内的 `simulation/runs/ticks/{tick-id}-{slug}/prose.md`，文件工具路径为 `{project-slug}/simulation/runs/ticks/{tick-id}-{slug}/prose.md`
- 已裁决的 subject / entity state 更新。
- 可交给 `director` 转入 Plot System 的剧情机会和后续钩子。

## Writing Mode Boundaries

- `leader.default` 可以更新 `simulation/`，但新写作链路优先让 `simulator.leader` 执行世界运行态 commit。
- 普通 `writer` 不维护 `simulation/`，也不自行遍历 `simulation/`。
- 如果需要正文级试写或 RP 输出，用户可见正文放到 tick `prose.md`；如果是正式章节正文，正文仍写到 `manuscript/.../index.md`，tick `prose.md` 可只放片段、摘要或链接。
- 重大不可逆世界状态变化，应优先让用户确认，或在 report 的 Open Questions 中挂起。

## Flow Review

当前 01 到 10 的流程已经形成可执行闭环，但它仍是推荐路径，不是固定流水线。

- 01 到 04 负责 canon 准备：只沉淀故事概念、lorebook 和角色稳定设定，不直接推进当前世界状态。
- 05 到 06 负责运行态：只有存在角色反应、势力行动、地点变化、物品状态、伤势、倒计时或隐藏状态时才启动。
- 07 到 08 负责剧情设计：07 是开局 / 前三章附近的专门流程，08 是更通用的剧情讨论和 Plot 规划。
- 09 到 10 负责正文产出和修订：普通 `writer` 写章节，修订默认不改事件结果；一旦改了事件事实，再回到 06 做状态提交。
- `novel-technique-commercial-rhythm` 是技法补充，不属于 workflow 编号，不能替代剧情规划、emulation 或 writer。
- import skills 只导入外部素材和参考资料，不自动把外部内容变成 subject-facing knowledge 或 simulation state。
