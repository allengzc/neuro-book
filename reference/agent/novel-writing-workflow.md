# Novel Writing Workflow

本文定义普通写作模式的 workflow skill 编号体系和主协作链。World Engine 是写作模式下动态世界状态与时间线的唯一真相源；旧 `simulation/` / `emulation` workflow 只作为 legacy RP 或历史维护资料保留。Plot System 在普通写作模式下只作为 Scene / Chapter 结构层，由 `leader.default` 管理，不保存第二份动态世界状态。

完整 World Engine 原理与 leader/writer 协作契约见 [../world-engine/workflow.md](../world-engine/workflow.md)。

## Current Contract

当前普通写作链路由 `leader.default` 直接负责 Plot / Scene、World Engine 推进、writer brief 编译和 writer 调度，正文写作由普通 `writer` profile 执行。

- `leader.default` 负责和用户讨论剧情、确认 canon、推进 World Engine、维护 Thread / Scene / Chapter Plot、选择必要 lorebook、编译 `get_chapter_writer_brief`，并调度 `writer`。
- `director` 只保留为高级或手动剧情导演 profile；不是普通写作主链必经节点。
- `writer` 是章节正文 agent，不是剧情导演、世界模拟 agent 或状态写入 agent。
- `writer` 创建 initial 为空；每轮通过 `invoke_agent.message` 接收写作 brief，通过 `invoke_agent.input` 接收唯一目标 `path` 和建议读取清单。
- `writer` 拥有只读 `execute_world`，只能查询 World Engine；不能写入、删除或编辑 slice。
- `writer` 不直接持有 Plot tools，不读取 `simulation/` 作为普通写作状态源；payload 里遗留的 `threadIds` / `sceneIds` / `plotIds` 兼容字段会被忽略。需要 Scene / World Context 时，由上游把完整 brief 写进 `invoke_agent.message`。
- `writer` 不默认展开全项目 lorebook；只按 brief 判断是否读取 `lorebookEntries` / `readablePaths`。
- 写作前，leader 应先完成“剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> get_chapter_writer_brief”，brief status 为 `ready` 后再调用 writer；写作后若 writer 自由发挥产生新事实，由 leader 回到 `08` 确认并补回 World Engine。

## Standard Flow

1. **Intent routing**：判断用户是在灵感探索、项目初始化、设定补全、剧情推进、章节写作、润色，还是导入素材。
2. **Project check**：确认 Current Project Workspace、目标章节、World Engine 是否已初始化、是否已有本章可写剧情事实。
3. **Canon preparation**：稳定设定进入 `lorebook/`；动态状态和时间线进入 World Engine。
4. **World Engine init**：项目有明确时间线和需追踪对象时，使用 `novel-workflow-world-engine-init` 建立 `calendar.ts`、`schema/index.ts`、纪元锚点和开局状态。
5. **Plot / state planning**：使用 `novel-workflow-08-plot-planning` 讨论剧情。leader 先做剧情初步设计并把确认后的动态事实写入 World Engine，再细化剧情并更新 Thread / Scene / Chapter Plot。
6. **Retrieval handoff**：需要设定上下文时先调用 `retrieval`，leader 选择 `entries[].path` 放入 writer payload 的 `context.lorebookEntries`，不把 retrieval 的 reason / use / risk 直接交给 writer。
7. **Chapter writing**：调用 `get_chapter_writer_brief` 编译 Chapter Writer Brief；若 status 不是 `ready`，先补 Plot、World Anchor 或 World Context，再重新编译。ready 后使用 `novel-workflow-09-chapter-writing` 调用普通 `writer`，传完整 brief、目标 `input.path`、建议读取路径和 World Engine 查询提示。
8. **Post-write check**：leader 检查正文是否产生新事实或状态变化；如需要，回到 `08` 做 World Engine 回补。

## Workflow Skills

| Skill | Status | Purpose |
| --- | --- | --- |
| `novel-workflow-01-idea-exploration` | canonical | 从模糊灵感整理成故事雏形；不急着初始化 World Engine。 |
| `novel-workflow-02-project-bootstrap` | canonical | 建立故事概念、简介和最小 lorebook 骨架。 |
| `novel-workflow-03-lorebook-bootstrap` | canonical | 建立开篇可用的稳定世界说明书，区分 lorebook 与 World Engine。 |
| `novel-workflow-04-character-design` | canonical | 深化主角、配角、反派、势力代表。 |
| `novel-workflow-world-engine-init` | canonical | 初始化 World Engine：calendar、Zod schema、纪元锚点、核心 subject 和开局状态。 |
| `novel-workflow-05-emulation-bootstrap` | legacy | 旧 RP / simulation 初始化；普通写作模式不推荐。 |
| `novel-workflow-06-emulation-tick` | legacy | 旧 RP / simulation tick；普通写作模式用 `08` 推进 World Engine。 |
| `novel-workflow-07-opening-plot-design` | canonical | 开局 / 前三章附近的剧情设计，状态推导走 World Engine。 |
| `novel-workflow-08-plot-planning` | canonical | 剧情讨论、剧情事实确认与 World Engine 状态推进。 |
| `novel-workflow-09-chapter-writing` | canonical | 状态已推进后调用普通 `writer` 写章节正文。 |
| `novel-workflow-10-revision` | canonical | 章节修改、节奏检查、局部重写和润色；新事实回补 World Engine。 |

## Writer Handoff

调用 `writer` 时：

- `invoke_agent.input.path`：唯一写入目标，必须是 `project-slug/.../*.md`。
- `invoke_agent.input.context.lorebookEntries`：建议读取的内容节点路径，writer 按需读取。
- `invoke_agent.input.context.readablePaths`：建议读取的普通 Markdown 文件路径。
- `invoke_agent.message`：本章目标、关键剧情点、Scene / World Context brief、信息控制、写作约束和 World Engine 查询提示。

不要把完整 World Engine 状态、HP / 位置等可查询细节、slice / patch JSON 或旧 Plot id-only handoff 塞进 brief。writer 会用只读 `execute_world` 自查状态。

## Legacy Boundary

`simulation/`、`emulation` 和 RP Tick reference 仍可用于 legacy RP、历史项目维护或迁移分析。普通写作模式下不要把旧 simulation 当作动态状态源，也不要让 Plot System 覆盖 World Engine 的时间线真相源。
