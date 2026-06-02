# Leader Default Operational Protocol

本文档写给 `leader.default` profile 和后续需要复用默认协作规则的 Agent。它承接原 `leader.default` prompt 中可共享的操作协议，避免在 profile prompt 中长期复制大段工具、任务、多 Agent 和运行模式说明。

`leader.default` 的身份、创作协作口吻和用户主创边界仍属于 profile 私有 system prompt；本文只保存稳定操作规则。

## Tool Usage

- 读文件用 `read`，不要用 `bash` 调 `cat` / `head` / `tail` / `sed` 代替。大文件按 `read` 返回的 `offset` / `limit` 提示继续读取，直到拿到需要的内容。
- 新建文件或完整重写文件用 `write`；局部修改现有文件时不要用 `write` 覆盖整文件。
- 精确修改单文件用 `edit`。多个分散位置应放在同一次 `edit.edits[]` 中；每个 `oldText` 都按原始文件匹配，不会按前一个 edit 的结果增量匹配。
- `edit.oldText` 必须唯一、精确、非重叠。相邻或同一块改动合并成一个 edit；不要为了连接远距离改动塞入大段未变化文本。
- `apply_patch` 是 Codex 风格 freeform patch 工具，只用于当前内容已确认、天然适合一个 cohesive patch 的改动。不要传 JSON，不要传 `{ path, patch }`。patch 失败后先重新读取当前文件，再生成新的修改。
- `bash` 只用于真实终端操作：`rg`、`find`、`ls`、`git`、测试、构建、workspace CLI、脚本验证等。搜索文本优先用 `rg`。
- `bash` 命令必须按 bash 语法编写；不要写其他 shell 语法。Agent 文件工具已经绑定 workspace 容器根，不要传 `workdir`。
- 可以并行调用互不依赖的工具。依赖前一个结果时必须顺序调用。
- 常规任务优先以 AppendingSet runtime reminder 的 Current Project Workspace 为边界，但 Agent cwd / Workspace Root 始终是 `workspace/`。访问当前小说时使用 `project-slug/lorebook/...`、`project-slug/manuscript/...` 这类显式路径。
- 允许跨 Project Workspace 写作和检查；跨项目时必须显式写出目标 Project Workspace 路径，避免把内容写到错误小说。
- 需要读写变量时，先用 `variable_schema` 查询局部 schema，再用 `variable_read` 读取当前值，最后用 `variable_patch` 提交 JSON Patch；重要修改后再次读取验证。
- 不要用 `bash` 拼接高风险写入命令替代 `edit`、`apply_patch` 或 `write`。
- 脚本失败时读取错误并说明阻塞原因，不要假装验证成功。

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

v3 中 profile 即 agent，不再区分 leader / subagent 类型层级。

协作决策流程：

1. 判断是否真的需要专用 agent。简单问答、一次性小改、当前 leader 能安全完成的任务，不要为了形式创建 agent。
2. 不熟悉 profile 时先调用 `get_agent_profile`。返回里的 `description` 是 profile 的能力 / 适用场景说明；同时检查 `InputSchema`、`OutputSchema`、`reportResultSchema` 和 `allowedToolKeys`，不要只看参数名猜用途。
3. 创建前先调用 `get_agent` 查看当前 linked agents。优先复用已有同 profile 且同创建 input 语义的 agent。
4. 如果候选 agent 的创建 input 不确定，调用 `get_session({ sessionId })` 查看 `metadata.input`、`title` 和 `summary`，再判断是否复用。
5. 同 profile + 同创建 input 语义时，后续细微修改、继续处理、补充说明、润色和追加要求都用 `invoke_agent` 调用旧 agent。
6. 没有可复用 agent，或目标 profile 的创建 input 语义变化时，才用 `create_agent` 新建 session。`create_agent` 会自动 link 到当前 session。
7. `detach_agent` 只解除 owned link，不删除 session；不要把 detach 当成清理数据或重置 agent。

工具结果心智：

- `invoke_agent` 调用已有 agent。目标 agent 允许 `report_result` 时，调用方可期待结构化 report；否则按普通 `finalMessage` 处理。
- `get_session` 默认只查询轻量 session 元数据、title、summary、usage 和 linked agents；默认不返回 tree，也不返回历史消息。
- 需要少量历史时显式传 `includeRecentMessages` / `recentMessageLimit` / `tokenBudget`。
- 复杂历史、分支或 tree 查询请到 session 文件目录用 `bash` / `jq` / `rg` 自助查询。

### Writer Collaboration

- `writer` 是正文写作专用 agent，采用“一章节一 agent”，不是“一次写作任务一 agent”。
- 调用 writer 前，先确保章节内容节点已经存在，并且 Plot System 中需要写入本章的 Scene 已挂到该 `chapterPath`。
- `writer.input.chapterPaths` 必须且只能包含一个章节目录，并且必须是 Agent cwd-relative Project 路径，例如 `silver-dragon-hime/manuscript/001-第一章/`。
- 不要传 `manuscript/...`，也不要传 `workspace/silver-dragon-hime/...`；writer 会读取该章节的 Chapter Plot，并只写这个章节的 `index.md`。
- 不要再传 `plotPoints`、`novelId` 或 `outputPath`。
- 如果 `chapterPaths`、`lorebookEntries`、`constraints`、`writingStylePreset`、`writingReferencePreset` 等创建 input 语义未变，后续润色、局部修改、继续改同一章都 `invoke_agent` 调用旧 writer。
- 如果切换章节、换一组稳定设定输入、换预设或其他 `WriterInputSchema` 创建值语义变化，则 `create_agent` 新 writer。
- `writer.lorebookEntries` 只接收内容节点 path 字符串数组。需要设定召回时，先让 retrieval 返回候选判断结果，再由 leader 提取 `entries[].path`，按需要传给 `writer.lorebookEntries`。不要把 retrieval 的 `reason`、`use`、`risk` 或 `note` 传给 writer。

### Retrieval Collaboration

- `retrieval` 是内容节点召回和候选判断专用 agent。
- 需要为 writer 或当前任务选择 lorebook / manuscript 相关节点时创建或复用它。
- 创建 retrieval 时只传自然语言 `prompt`，把任务目标、要找什么、给谁用、章节 / 正文上下文、排除项和数量偏好写清楚即可。
- retrieval 应先建立内容节点元数据清单，再做必要的精确搜索，并通过 `report_result.data` 返回 `{ entries, note? }`。
- `entries` 按推荐优先级排序；Leader 可以不读正文，直接根据 `path`、`reason`、`use`、`risk` 判断哪些条目传给 writer。
- 需要 writer 参考内容节点时，优先先让 retrieval 召回候选，再把 `entries[].path` 整理为 `writer.lorebookEntries`；不要让 writer 自己做大范围检索。

### RP / Simulation Collaboration

- 进入 RP / simulation 模式时优先创建或切换到 `leader.rp`。
- `leader.rp` 是用户面对的 simulator leader profile，会读取 `simulation/` 目录、调度 `rp.actor`，并调用 `rp.writer` 生成用户可见正文。
- `rp.actor` 和 `rp.writer` 通常只由 `leader.rp` 调用。
- 不要把 `rp.writer` 当成普通 writer，也不要让普通 writer 承担 RP Tick 渲染。
- `simulation/` 目录随默认 Project 模板创建；不再安装独立 roleplay-directory-templates。

### Researcher Collaboration

- `researcher` 是联网研究专用 agent。
- 需要当前网页资料、新闻 / 版本 / 价格 / 政策等可能变化的信息、外部文档核对、跨来源事实检查或来源引用时，先 `get_agent_profile("researcher")`，再创建或复用 researcher。
- `leader.default` 不直接拥有 `web_search` 或 `web_fetch`；不要假装当前 leader 可以直接联网。联网任务必须通过 `create_agent` / `invoke_agent` 交给 researcher。
- 简单或一次性联网查询，创建 researcher 时优先传空 input `{}`。不要为了看起来完整而自动填 `topic`、`goal`、`source_policy`、domain filter 或 `output_language`。
- 只有用户明确提出长期研究主题、固定来源范围、默认时间范围、输出语言或 source policy 时，才把这些稳定边界写进 `create_agent.input`；不要把当前轮问题改写成长期 goal。
- `invoke_agent.message` 保留用户原始问题，最多做一句最小改写；不要把它写成“请搜索……”这类长委托提示。
- 不要替用户补写可能领域、可能含义、搜索语言、搜索策略或输出框架。
- 如果用户问的是短词、缩写或未知名词，把原始问题交给 researcher；不要在 Leader 层扩展成多个猜测方向。
- 同 profile + 同 `topic` / `goal` / filter / `source_policy` 语义时复用已有 researcher。后续补查、追问、核对同一主题或要求更多来源时继续 `invoke_agent` 旧 researcher。
- 对 input `{}` 的 researcher，只在同一用户问题链或明显连续追问中复用；不相关主题即使 input 都是 `{}`，也不是同创建 input 语义。
- researcher 不允许 `report_result`；读取 `invoke_agent.finalMessage` 作为研究结果。重要事实应带普通 Markdown link 来源。

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
- 进入 Plan Mode 时不会绑定固定文件名；需要持久化计划时自行选择短且可读的 Markdown 文件名。
- Plan Mode 激活时，只能编辑 `.agent/plan/` 内的 Markdown 计划 / 记录文件。
- 不要把 scratch / cache / 命令输出草稿放进 Project Workspace `.agent`，临时文件使用系统 tmp。
- 不要创建或调用 Explore agent。需要探索时使用当前 agent 的只读 `read` / search / `bash` 验证能力。
- 退出 Plan Mode 前，如果写了计划文件，先在聊天中简短报告计划状态并引用 `.agent/plan/` 内的 Markdown 文件路径，再用 `exit_plan_mode` 请求批准；需要审批预览时传 `planFilePath`。

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
- [NeuroBook Project Guide](neurobook-project-guide.md)
- [Markdown dialect](../content/markdown-dialect.md)
