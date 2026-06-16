# Leader Default Operational Protocol

本文档写给 `leader.default` profile 和后续需要复用默认协作规则的 Agent。它承接原 `leader.default` prompt 中可共享的操作协议，避免在 profile prompt 中长期复制大段工具、任务、多 Agent 和运行模式说明。

`leader.default` 的身份、创作协作口吻和用户主创边界仍属于 profile 私有 system prompt；本文只保存稳定操作规则。

## Variables

- 需要读写变量时，先用 `variable_schema` 查询局部 schema，再用 `variable_read` 读取当前值，最后用 `variable_patch` 提交 JSON Patch；重要修改后再次读取验证。

## Task Management

Task tools are for execution tracking, not for storing novel facts. Stable world facts belong in Lorebook; plot decisions belong in Plot System.

- Use `task_create` for multi-step work, cross-turn work, work that edits files or plot data, or work with explicit verification criteria. `task_create` replaces the current task list.
- Do not create tasks for simple Q&A, one-shot brainstorming, or a single direct tool call whose state is obvious from the conversation.
- When creating tasks, use stable step ids, clear user-facing text, and explicit status values. Do not rely on the tool to infer pending.
- Before actively working on a step, mark it `in_progress` with `task_set_status`.
- Mark a step `completed` immediately after its acceptance criteria are satisfied; do not batch multiple completions.
- Only one step may be `in_progress`. Setting a step to `completed` does not automatically advance the next step.
- On continue runs, use the current task state from runtime reminders and task reminders. Recreate the list only when the existing state is absent or clearly obsolete.

## Multi-Agent Collaboration

1. 不熟悉 profile 时先调用 `get_agent_profile`。返回里的 `description` 是 profile 的能力 / 适用场景说明；同时检查 `InitialSchema`、`PayloadSchema`、`OutputSchema` 和 `toolKeys`，不要只看参数名猜用途。
2. 创建前先调用 `get_agent` 查看当前 linked agents。优先复用已有同 profile 且同创建 initial 语义的 agent。
3. 如果候选 agent 的创建 initial 不确定，调用 `get_session({ sessionId })` 查看 `metadata.initial`、`title` 和 `summary`，再判断是否复用。
4. 同 profile + 同创建 initial 语义时，后续细微修改、继续处理、补充说明、润色和追加要求都用 `invoke_agent` 调用旧 agent；需要结构化引用时按目标 `PayloadSchema` 传 `invoke_agent.input`。
5. 没有可复用 agent，或目标 profile 的创建 initial 语义变化时，才用 `create_agent` 新建 session。`create_agent` 会自动 link 到当前 session。

工具结果心智：

- `invoke_agent` 调用已有 agent。工具返回统一 `result.message`，有结构化数据时在 `result.data`；不要读取旧 `finalMessage`。
- `get_session` 默认只查询轻量 session 元数据、title、summary、usage 和 linked agents；默认不返回 tree，也不返回历史消息。
- 需要少量历史时显式传 `includeRecentMessages` / `recentMessageLimit` / `tokenBudget`。
- 复杂历史、分支或 tree 查询请到 session 文件目录用 `bash` / `jq` / `rg` 自助查询。

### Writer Collaboration

- `writer` 是正文写作专用 agent，是长期可复用写作工位。创建 writer 时使用 `create_agent({profileKey: "writer", initial: {}, title})`。
- 每轮写作任务都通过 `invoke_agent` 发送：`message` 写自然语言任务，`input` 按 writer `PayloadSchema` 传 `{path, context?}`。
- `invoke_agent.input.path` 是本轮唯一写入或修改目标，必须是 Agent cwd-relative Project Markdown 路径，例如 `silver-dragon-hime/manuscript/001-第一章/index.md`。
- `invoke_agent.message` 必须写清写什么、范围、重点、禁忌、结束条件和交付要求；不要只传 id/path 让 writer 自己规划剧情。
- `invoke_agent.input.context` 只放建议读取清单：`threadIds`、`sceneIds`、`plotIds`、`lorebookEntries`、`readablePaths`。它不是任务正文，也不是必须全部读取的材料。
- 需要设定召回时，先让 retrieval 返回候选判断结果，再由 leader 选择 `entries[].path` 放入 `input.context.lorebookEntries`。不要把 retrieval 的 `reason`、`use`、`risk` 或 `note` 直接传给 writer。
- 普通 `writer` 不维护 `simulation/`，也不自行遍历 `simulation/`。如果写作前需要世界状态推进，由 Leader 调用 `simulator.leader` 或按 workflow skill 做 simulation tick，再把结果整理成 Plot、message 中的 writer-safe 信息或 `input.context`。

### Simulator / Director Collaboration

- `leader.default` 是用户助理、监工和路由器，不应长期包干世界模拟、剧情结构设计和正式正文写作。
- 需要世界因果推演、角色/势力/地点自然反应、状态裁决、信息边界过滤或 post-write state commit 时，优先创建或复用 `simulator.leader`。
- `simulator.leader` 负责读取 simulation state、必要 canon 和 Plot 上下文，调度 subject simulator，并输出 `writer_safe_brief`、`director_handoff`、`plot_handoff` 和 open questions。
- 需要 Thread / Scene / Plot 设计、章节剧情结构、伏笔/回收、Plot 密度补齐或 Plot System 落库时，优先创建或复用 `director`。
- `director` 可以写 Plot System，但不写 simulation state，也默认不直接调用 writer；它产出 `chapter_plan` 和 `writer_handoff` 后，由 `leader.default` 决定是否调用普通 `writer`。
- 如果 `director` 需要未裁决的世界状态，先让 `simulator.leader` 裁决；不要让 director 自己把隐藏状态写成剧情事实。
- 如果 `simulator.leader` 输出了可落 Plot 的剧情机会，由 `director` 负责整理成 Thread / Scene / Plot。

### Writing Emulation

- 写作模式中的 `emulation` 是世界运行态推进概念；当前落地目录仍是 Project Workspace 下的 `simulation/`，不要自行新建 `emulation/` 目录。
- 标准写作流程是推荐路径，不是强制流水线。普通写章、润色、简介、标题和不改变事件结果的局部编辑通常跳过 emulation。
- 当用户要求推进剧情、判断下一段因果、模拟角色/势力/地点自然反应，或正文已经改变伤势、持有物、位置、机关、门锁、倒计时等状态时，Leader 可以启动 simulation tick，优先委托 `simulator.leader`。
- 初始化运行态使用 `novel-workflow-05-emulation-bootstrap`；推进一个 tick 或写后提交使用 `novel-workflow-06-emulation-tick`。
- Leader 可以维护 `simulation/subjects/`、`simulation/entities/` 和 `simulation/runs/`，但应把它视为世界状态 commit，不是随手笔记。
- Project Workspace 内的 `simulation/runs/ticks/{id}-{slug}/report.md` 保存后台推演、裁决、信息边界、状态提交、writer-safe brief、未决问题和下一步钩子；文件工具路径必须写成 `{project-slug}/simulation/runs/ticks/{id}-{slug}/report.md`。
- Project Workspace 内的 `simulation/runs/ticks/{id}-{slug}/prose.md` 保存用户可见正文。RP Tick 保存 `rp.writer` 输出的完整正文，传给 writer 的输出路径必须写成 `{project-slug}/simulation/runs/ticks/{id}-{slug}/prose.md`；`rp.leader` 只组装正文链接和元场景。正式章节正文仍以 `manuscript/.../index.md` 为主。

### Retrieval Collaboration

- `retrieval` 是内容节点召回和候选判断专用 agent。
- 需要为 writer 或当前任务选择 lorebook / manuscript 相关节点时创建或复用它。
- 创建 retrieval 时只传自然语言 `prompt`，把任务目标、要找什么、给谁用、章节 / 正文上下文、排除项和数量偏好写清楚即可。
- retrieval 应先建立内容节点元数据清单，再做必要的精确搜索，并通过 `report_result.data` 返回 `{ entries, note? }`。
- `entries` 按推荐优先级排序；Leader 可以不读正文，直接根据 `path`、`reason`、`use`、`risk` 判断哪些条目传给 writer。
- 需要 writer 参考内容节点时，优先先让 retrieval 召回候选，再把 `entries[].path` 整理为 `invoke_agent.input.context.lorebookEntries`；不要让 writer 自己做大范围检索。

### RP / Simulation Collaboration

- 进入普通 RP 模式时优先创建或切换到 `rp.leader`；只有调试世界模拟或执行明确 simulation 任务时才直接进入 `simulator.leader`。
- `rp.leader` 是用户面对的 RP 引导层，会读取 `manual/` 与 `agent-context/rp.leader/`，负责开局、化身创建、体验边界、陪伴交流和把需要裁决的世界变化交给 `simulator.leader`。
- `simulator.leader` 是世界模拟主管，会读取 `simulation/` 目录、调度 `simulator.actor`，并按需调用 `rp.writer` 生成用户可见正文。
- `leader.default` 和 `rp.leader` 不应直接调用 `simulator.actor`；除非用户明确要求调试 actor，否则通过 `simulator.leader` 统一完成 actor-facing 信息过滤和世界裁决。
- `simulator.actor` 通常只由 `simulator.leader` 调用；`rp.writer` 只消费 simulator brief。
- 不要把 `rp.writer` 当成普通 writer，也不要让普通 writer 承担 RP Tick 渲染。
- `simulation/` 目录随默认 Project 模板创建；不再安装独立 roleplay-directory-templates。

### Researcher Collaboration

- `researcher` 是联网研究专用 agent。
- 需要当前网页资料、新闻 / 版本 / 价格 / 政策等可能变化的信息、外部文档核对、跨来源事实检查或来源引用时，先 `get_agent_profile("researcher")`，再创建或复用 researcher。
- `leader.default` 不直接拥有 `web_search` 或 `web_fetch`；不要假装当前 leader 可以直接联网。联网任务必须通过 `create_agent` / `invoke_agent` 交给 researcher。
- 简单或一次性联网查询，创建 researcher 时优先传空 initial `{}`。不要为了看起来完整而自动填 `topic`、`goal`、`source_policy`、domain filter 或 `output_language`。
- 只有用户明确提出长期研究主题、固定来源范围、默认时间范围、输出语言或 source policy 时，才把这些稳定边界写进 `create_agent.initial`；不要把当前轮问题改写成长期 goal。
- `invoke_agent.message` 保留用户原始问题，最多做一句最小改写；如果需要传 Plot id、文件 id 等结构化引用，使用 `invoke_agent.input` 并先检查 `PayloadSchema`。
- 不要替用户补写可能领域、可能含义、搜索语言、搜索策略或输出框架。
- 如果用户问的是短词、缩写或未知名词，把原始问题交给 researcher；不要在 Leader 层扩展成多个猜测方向。
- 同 profile + 同 `topic` / `goal` / filter / `source_policy` 语义时复用已有 researcher。后续补查、追问、核对同一主题或要求更多来源时继续 `invoke_agent` 旧 researcher。
- 对 initial `{}` 的 researcher，只在同一用户问题链或明显连续追问中复用；不相关主题即使 initial 都是 `{}`，也不是同创建 initial 语义。
- researcher 不允许 `report_result`；读取 `invoke_agent.result.message` 作为研究结果。重要事实应带普通 Markdown link 来源。

## SQL

`execute_sql` 用于结构化数据库查询和小范围元数据写入。

- 只允许单条 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`。
- 禁止 DDL、事务控制、session control、`COPY`、`VACUUM` 和多语句。
- 查询最多返回 200 行，超时 1500ms。
- `execute_sql` 只操作当前 Project Workspace 的 `.nbook/project.sqlite`，不能访问 App SQLite、用户表或其他项目数据库。
- SQLite 业务表名和 camelCase 字段建议使用双引号，例如：

```sql
SELECT id, title
FROM "StoryScene"
WHERE "chapterPath" = 'manuscript/001-opening/'
ORDER BY "threadSortOrder";
```

- 文件正文、manuscript、lorebook 和普通文档必须用 `read` / `write` / `edit` / `apply_patch`，不要用 SQL 读写长正文。

## Plan Mode

- `enter_plan_mode` 用于请求进入计划模式，适合大型、多步、风险高或需求仍需共同确认的改动。
- `exit_plan_mode` 用于请求退出计划模式。
- 计划模式里的计划应足够具体，可直接执行，但不要把当前对话里的临时口癖写进长期提示词。
- Plan Mode 是 soft mode：进入后仍可做只读调查、列计划、阅读源码和运行不会改写仓库状态的验证；不要执行产品代码、配置、数据或工作区内容修改。
- 需要实现时，先准备执行计划，再用 `exit_plan_mode` 请求用户批准。不要用普通文本或 `request_user_input` 代替 `exit_plan_mode`。
- Plan Mode 工作目录会在 system-reminder 中给出，固定为当前 Project Workspace 的 `.agent/plan/`，适合保存计划草案、walkthrough 和调研 notes。
- 普通 Project agent 的文件工具 cwd 是 Workspace Root；写计划文件时使用 system-reminder 给出的文件工具路径，例如 `<project>/.agent/plan/<slug>.md`。调用 `exit_plan_mode` 时，`planFilePath` 必须使用 Project Workspace 相对路径，例如 `.agent/plan/<slug>.md`。
- 进入 Plan Mode 时不会绑定固定文件名；需要持久化计划时自行选择短且可读的 Markdown 文件名。
- Plan Mode 激活时，只能编辑 `.agent/plan/` 内的 Markdown 计划 / 记录文件。
- 不要把 scratch / cache / 命令输出草稿放进 Project Workspace `.agent`，临时文件使用系统 tmp。
- 不要创建或调用 Explore agent。需要探索时使用当前 agent 的只读 `read` / search / `bash` 验证能力。
- 退出 Plan Mode 前，如果写了计划文件，先在聊天中简短报告计划状态并引用 `.agent/plan/` 内的 Markdown 文件路径，再用 `exit_plan_mode` 请求批准；正式计划文件必须传 `planFilePath`，让审批 UI 展示该 Project Workspace 计划文件。

## Skills

`SkillCatalog` 会提供可见 skill 的 key、说明和 `SKILL.md` 路径。只有当前任务明显匹配某个 skill，或用户显式提到 `$skill` 时，才用 `read` 读取目录中对应 location 的 `SKILL.md`。

- 不要猜测不可见 skill。
- 当前没有独立 skill 工具。
- `SKILL.md` 是入口卡片；如果它提到 references、scripts、templates 或 examples，再按需读取同一 skill 目录下的具体相对路径。
- 不要默认全量读取 references 目录。
- skill 只指导本轮怎么做；稳定设定写入 Lorebook，剧情推进写入 Plot System，临时计划留在当前对话。

## Related References

- [Profile guide](profile-guide.md)
- [Profile import](profile-import.md)
- [Profile context](context.md)
- [Project Workspace Guide](project-workspace-guide.md)
- [Markdown dialect](../content/markdown-dialect.md)
