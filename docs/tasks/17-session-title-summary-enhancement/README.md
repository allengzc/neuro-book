# Session Title/Summary Enhancement

## User Request

- 检查当前 Agent session 是否已有 `title` / `summary` 字段，或相关替代字段。
- 设计一个用独立摘要 profile 生成 session `title` / `summary` 的机制。
- 原始设想第一阶段只对 leader session 应用；后续已修订为所有启用 `summarizer` 的 profile 都可使用。
- 新建 task walkthrough 记录计划，后续实现继续更新本文件。

## Goal

- 让任意启用 `summarizer` 的 source session 的 `title` / `summary` 从程序默认值升级为由独立 Agent Summarizer Profile 生成的 active-path-specific 元数据。
- 摘要 profile 作为后台 summarizer session 实例化，使用 `InputSchema` 固定初始化参数，并通过 `report_result` 返回最终 `title` / `summary`。
- 摘要运行的源内容每次都从 source session 当前 active path 重建 Agent Dialogue Content，不依赖 summarizer 自身历史做增量摘要。
- source session 对摘要系统透明、无感；摘要失败不影响 source invocation 的正常完成。
- summarizer 有 session 身份，也可以有 HistorySet 初始化历史；运行中的 assistant/toolResult 不 append 到 summarizer session，模型上下文由自身 system prompt 加 source session 提取出的 Agent Dialogue Content 组成。
- summarizer session 的 leaf 只会因 HistorySet 初始化等少数初始化写入移动；后续摘要运行不通过 transcript append 推进 leaf。

## Target Outcome

17 在 18 完整重构后重新落地。完成后，项目应该得到这些行为：

- 任意 profile 都可以通过 `summarizer` 声明启用 session title/summary 维护，不限定 leader。
- summarizer 是普通 profile：用户可以写自己的 `profile.tsx` 实现 summarizer，只要使用规定的 runtime hooks 和 `report_result` 输出合同。
- summarizer session 默认 hidden，不进入 linked agent；它有 session 身份和 HistorySet 初始化历史，但运行中的 assistant/toolResult 不落盘。
- 每次 summarizer 运行都从 source session 当前 active path 重建 Agent Dialogue Content；不维护 summarizer cursor，不做 summarizer 自身 compact。
- source title/summary 是 active-path-specific projection，绑定 source active leaf；session rollback/tree 切换后展示元数据跟着 active path 变化。
- summarizer 输出写回 source session 前重新校验 source active leaf；旧 leaf 的结果不能覆盖新 active path。
- summarizer 状态对前端可见，但不影响 source invocation 的 completed/error/waiting 结果。

非目标：

- 第一版不支持 Turn Transaction 中途触发摘要。
- 第一版不把 tool call、tool result、thinking、harness reminder 纳入 Agent Dialogue Content。
- 第一版不把 summarizer 做成无 session 的执行体。

## Scheduling Decision

- 本任务等待 [18-agent-runtime-pipeline-hooks](../18-agent-runtime-pipeline-hooks/README.md) 完整重构完成后再重新计划和实现。
- 本文只保留目标语义和后续验收点，不再作为当前 harness 的直接实现计划。
- 术语以 18 的 Run Kernel / Turn Transaction / SessionWritePlan / TurnSnapshot 定义为准。

## Current State

- `SessionMetadata` 已有 `title?: string` / `summary?: string`。
- `SessionUpdateEntry` 已支持 append-only 写入 `updates.title` / `updates.summary`。
- `AgentSessionSummaryDto` 已向前端暴露 `title` / `summary`，session snapshot 也复用该摘要字段。
- `SessionSummarizerStateDto` 已作为前端可见投影存在，可表达 `running` / `dirty` / `lastRunAt` / `lastError` / `lastDialogueContentTokens`。
- 创建 session 时，harness 目前会初始化默认标题，`summary` 则由摘要流程写回。
- `compaction.summary` 是上下文压缩摘要，`branch_summary.summary` 是分支摘要，都不应直接混作 session 展示元数据。

## Walkthrough

- 2026-05-27：检查 session/profile/harness 现状，确认 `title` / `summary` 字段已存在，但默认仍主要由程序生成。
- 2026-05-27：实现过第一版 `session.summarizer`、Agent Dialogue Content、后台 system session、summary 状态投影和前端展示；该实现作为历史参考保留。
- 2026-05-28：设计推进后确认 17 不再直接落当前 harness 补丁，等待 18 runtime pipeline 完整重构后重新计划。
- 2026-05-28：确认 summarizer 不限定 leader，所有 profile 都可以通过声明式 `summarizer` 启用。
- 2026-05-28：确认 summarizer source 内容第一版继续使用 Agent Dialogue Content；`title` / `summary` 是 active-path-specific，会随 session active path 回退、切换、fork 一起变化。
- 2026-05-28：确认 summarizer 不保存自身工具调用、tool result 或 assistant transcript；每次模型上下文都从 source session 重新构建，并间接复用 source session compaction。
- 2026-05-28：确认 summarizer 不作为 Run Kernel 特例；profile 作者可以通过 `defineAgentRuntime({ hooks })` 写出 summarizer 行为。summarizer session 有 session 身份和初始化历史，但运行 transcript 不落盘，不是完全 sessionless。
- 2026-05-28：确认术语和 runtime 落点以 18 为准：Run Kernel / Turn Transaction / SessionWritePlan / TurnSnapshot。

## Target Decisions After Runtime Pipeline Redesign

- 系统摘要 profile key 硬切为 `summarizer`。旧 `session.summarizer` 不做兼容别名。
- `summarizer` 只允许 `report_result` 工具，且 `report_result.data` 必须返回 `{ title, summary }`。
- 摘要 profile 作为普通 profile 机制的一部分运行，但由 harness 直接创建后台 system session，不走 linked-agent 路径，也不写 `agent.link.*`。
- `defineAgentProfile` 扩展声明式字段 `summarizer`，放在 `AgentProfile` 顶层，由 profile 作者声明该 profile 需要哪个摘要 companion。
- `summarizer` 使用静态声明对象，不使用函数。profile 作者只声明 `profileKey` 和初始化 `input`，创建、复用、防重入、失败隔离都由 harness 负责。
- `summarizer.profileKey` 第一版支持已知 builtin key 的强类型推导，例如 `profileKey: "summarizer"` 时，`input` 自动收窄到 `Omit<SessionSummarizerInput, "sourceSessionId">`。
- `sourceSessionId` 由 harness 在创建后台 summarizer session 时注入，profile 作者不填写。
- `summarizer` 允许用户覆盖或关闭；它不是 builtin schema lock。
- 摘要 profile 的模型选择与普通 profile 一样走系统配置和 model resolver，不跟随 source profile 的模型。
- `summarizer` 的 `InputSchema` 只承载初始化参数，不承载每轮 prompt。
- `trigger` 用于首次触发时机配置，第一版按 source invocation 结束后运行。
- `interval` 以 source invocation、Turn Transaction、Agent Dialogue Content token 增量之类的规则控制重跑频率；具体字段命名等 18 完整重构后重新计划。
- “session 中 content 字段所包含的 token，不计算 tool calls、不计算 tool result”这一边界命名为 **Agent Dialogue Content**；代码中的 token 计数字段命名为 `dialogueContentTokens`。
- Agent Dialogue Content 第一版只包含普通 user/assistant message 的可见正文与 active path 上的 compaction message，不包含 tool call 参数、tool result、thinking、harness reminder、profile/model-context 注入消息或其他 custom message。
- 每次摘要都从当前 active path 重建 Agent Dialogue Content，branch/tree 切换后不维护 summarizer cursor，直接按当前 active path 重建即可。
- 摘要 profile 不需要做自身 compact；若重建出的 Agent Dialogue Content 超过摘要 profile 设定上限，则本次直接 warn 或报错并跳过。
- 摘要触发采用后台 fire-and-forget，不阻塞 source invocation 返回。
- 摘要运行采用 latest-only/coalesced 语义：如果摘要正在运行，新的触发只标记 dirty，当前完成后再按最新 active path 重跑。
- 摘要调度状态写入源 session 的单个 custom state 对象，例如 `summarizer.state`。
- 摘要结果写回 source session 时使用 path-scoped projection `session_update` entry，保持展示字段的统一 reduce 路径，且不移动 source active leaf。
- `title` / `summary` 语义是 active-path-specific：切换、回退、fork 到不同 active path 时，应看到该 path 对应的元数据；没有匹配元数据时 fallback 到默认 title/last message。
- path-scoped projection 必须绑定 source active leaf；reduce 时只应用与当前 active path 匹配的 projection。
- 摘要 run settle 前必须重新读取 source active leaf；如果 active leaf 与本次输入不一致，只标记 dirty 并跳过旧结果写回，不能覆盖新 active path 的 title/summary。
- 摘要失败不应让已经完成的 source invocation 变成失败；只记录失败状态或日志，并保留旧 title/summary。
- `summarizer` 在 `SessionMetadata` 标记 `systemRole: "summarizer"`，普通 `/api/agent/sessions` 列表默认隐藏 system session，诊断场景可通过 `includeSystem=true` 显示。

## Runtime Pipeline Revision

- summarizer 不再通过普通 `invokeAgent(prompt)` 把 Agent Dialogue Content 写入自身 session。
- summarizer 作为 internal RunFrame 运行，由普通 profile runtime hooks 在每个 `prepareTurn` 从 `sourceSessionId` 指向的 source session 重新构建 Agent Dialogue Content。
- summarizer 的 ModelContext 由自身 system prompt 和重建出的 Agent Dialogue Content 组成；HistorySet 只初始化一次，AppendingSet 为空。
- summarizer 的 `ingestTurn` 是 runtime-only：assistant/toolResult 只闭合当前 runtime turn，不写入 summarizer session history。
- `report_result` 缺失 reminder 通过 `shouldStop -> prepareNextTurn` 注入；summarizer 下 reminder 必须 runtime-only。
- `settleRun` 只在 source active leaf 未变化时写回 source title/summary；变化时只标 dirty 让 latest-only 调度重跑。
- 写回 source 的 `SessionWritePlan` 必须显式 target source session 和 cause `summarizer`。
- 旧 `session.summarizer` profile key、旧 summarizer 自身历史、旧 invocation-level `profile.ingest()` 都不保留兼容路径。

## Proposed Implementation Plan

1. 维持并整理摘要 profile contract。
   - 新增 `SessionSummarizerInputSchema` / `SessionSummarizerOutputSchema`。
   - `InputSchema` 包含 `sourceSessionId`、`trigger`、`interval`、`maxDialogueContentTokens`。
   - 验证：profile check/status 能加载，`report_result` schema 包含 `title` / `summary`。

2. 维持会话正文提取器。
   - 从 source session 当前 active path 中提取纳入 Agent Dialogue Content 的用户/assistant 可见文本。
   - 不计算 assistant tool call 参数，不计算 tool result。
   - 使用稳定 transcript 格式标注来源 entry。
   - 验证：单测覆盖普通用户消息、assistant 文本、tool call、tool result、compaction message、custom message 排除边界和 transcript 稳定性。

3. 维持 profile 声明和摘要调度状态。
   - 在 `AgentProfile` / `defineAgentProfile` 中增加声明式 `summarizer` 配置。
   - 设计类型适配：builtin `summarizer.profileKey` 使用已知 profile key 字面量时，`input` 自动收窄。
   - 在源 session 单个 custom state 对象中记录摘要 profile 绑定关系、运行状态、dirty 标记、最近一次 source leaf、最近一次 Agent Dialogue Content token 数和最近错误。
   - 如果没有摘要 agent session，由 harness 直接创建后台 summarizer session。
   - 验证：重复触发不会重复创建后台 session；后台摘要 session 不进入 linked agent 列表；普通 session 列表默认隐藏后台摘要 session。

4. 在 source invocation 完整结束后触发摘要。
   - `finalResult.status === "completed"` 后检查是否需要摘要。
   - 第一版不在 `waiting` / `error` / `aborted` 后触发。
   - 摘要运行时如果已有正在进行的后台任务，只设置 dirty 标记。
   - Turn Transaction / token interval 的最终字段命名和触发细节以 18 的 Run Kernel 设计为准。
   - 验证：首轮用户消息完成后能后台生成一次；未达间隔不会运行；摘要失败时 source invocation 仍 completed。

5. 将摘要结果写回 source session。
   - 读取摘要 agent 的 `reportResult.data.title` / `summary`。
   - 写回前重新读取 source active leaf；active leaf 不匹配则跳过写回并标记 dirty。
   - harness 二次检查 title/summary：trim 后非空、限长、类型稳定。
   - append path-scoped projection `session_update` 到 source session。
   - publish session entry/state，前端沿现有 snapshot/list 路径刷新。
   - 验证：session list、snapshot、`get_session` 都能读到当前 active path 对应的 title/summary；session 回退/branch 切换后 title/summary 跟随 active path；stale summarizer 结果不会覆盖新 active path。

6. 接入 Agent Dialogue Content 上限保护。
   - 每次摘要前估算当前 active path 的 Agent Dialogue Content token。
   - 超过 `maxDialogueContentTokens` 时跳过本次摘要，记录 warning，不触发摘要者 compaction。
   - 验证：超过上限时不调用模型，不覆盖旧 title/summary，并保留可诊断状态。

## Revision Plan: User-Visible Summarizer State

1. 增加前端可用的 summarizer 状态投影。
   - 后端继续以 `summarizer.state` 作为 append-only session state 真相源。
   - `AgentSessionSnapshotDto` 增加明确的 `summarizer` 状态字段，避免前端读取 raw `customState`。
   - 事件通道优先复用现有 `session_state_changed.snapshot`。

2. 在 Agent 抽屉头部展示后台摘要状态。
   - `running=true` 显示低干扰 chip。
   - `dirty=true` 且 running 时显示“摘要排队”或类似提示。
   - `lastError` 非空且不 running 时显示 warning 状态。
   - summarizer 状态只面向用户，不并入 `running`，不禁用发送、停止、编辑、branch/tree 操作。

3. 会话列表展示 session summary。
   - `AgentSessionDialog.vue` 的列表描述优先使用 `session.summary`。
   - 没有 `summary` 时 fallback 到 `lastMessagePreview`，再 fallback 到 `No recent messages`。
   - 搜索继续覆盖 title、summary、lastMessagePreview、profileKey 和 sessionId。

4. 测试与验收。
   - 后端测试：summarizer 运行中会通过 `session_state_changed.snapshot.summarizer.running` 对前端可见；完成后 running 归 false；失败时保留 `lastError` 且不污染 source invocation。
   - 前端测试：`AgentSessionDialog` 有 summary 时展示 summary，无 summary 时 fallback 到 last message；`useAgentSession` 保留 snapshot 中的 summarizer 字段。

## Files Changed

> 下面记录的是当前已实现版本触碰过的文件；runtime pipeline 硬切后，`session.summarizer` 相关文件/compiled artifact 需要改名或替换为 `summarizer`，不保留旧 key 兼容。

- `assets/workspace/.nbook/agent/profiles/builtin/session.summarizer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/*`
- `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/default-profile.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/session-summarizer-profile.ts`
- `server/agent/profiles/types.ts`
- `server/agent/session/dialogue-content.ts`
- `server/agent/session/dialogue-content.test.ts`
- `server/agent/session/custom-state-keys.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/session/session-repo.test.ts`
- `server/agent/session/types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/variables/generated-profile-variable-types.d.ts`
- `shared/dto/agent-session.dto.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/components/novel-ide/agent/AgentSessionDialog.vue`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `docs/tasks/17-session-title-summary-enhancement/README.md`
- `CONTEXT.md`
- `PROJECT-STATUS.md`

## Verification

- 已运行 `bun scripts/prepare-system-profile-metadata.ts`，刷新系统 profile compiled artifacts 与 metadata。
- 已通过 `bunx vitest run server/agent/session/dialogue-content.test.ts server/agent/session/session-repo.test.ts --reporter=dot`。
- 已通过 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "summarizer|leader completed" --reporter=dot`。
- 已通过 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "summarizer|leader completed|dialogueContentTokens|input 改动|tree 切换|tree empty|tree API|AppendingSet" --reporter=dot`，覆盖 review 修复点和 tree/faux 并发隔离。
- 修订实现后新增验证目标：`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts app/components/novel-ide/agent/useAgentSession.test.ts -t "summarizer|session_state_changed" --reporter=dot`。
- 已尝试 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/session/session-repo.test.ts server/agent/session/dialogue-content.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/report-result-schema.test.ts --reporter=dot`，summarizer 相关测试通过，但宽套件卡在既有 `profile 内 session variable definition 会进入工具 registry` 用例：该测试直接 `variable_patch`，当前变量系统要求同一 invocation 先 `variable_read`。
- 已尝试 `bunx tsc --noEmit --pretty false`，新增 summarizer 代码未暴露类型错误；当前失败来自既有 `server/agent/skills/silly-tavern-card-cli.test.ts` 中 `inspection.markers.* is possibly undefined`。

## TODO / Follow-ups

- 后续可补 profile check/status 对 summarizer profile 不存在、未允许 `report_result` 或输出合同不满足时的显式 issue。
- 18 完整重构落地后，重新计划 summarizer trigger / interval 字段，避免沿用旧 ReAct Loop 术语。
- 后续可为诊断入口暴露 system session filter；当前 session list 已支持 `includeSystem=true`，普通列表默认隐藏。
- 后续清理无关失败测试：`profile 内 session variable definition 会进入工具 registry` 需要按 read-before-patch 合同补 `variable_read`。
- 后续清理无关 typecheck：`server/agent/skills/silly-tavern-card-cli.test.ts` 的 optional marker 断言需要收窄类型。
