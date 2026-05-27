# Session Title/Summary Enhancement

## User Request

- 检查当前 Agent session 是否已有 `title` / `summary` 字段，或相关替代字段。
- 设计一个用独立摘要 profile 生成 session `title` / `summary` 的机制。
- 该机制第一阶段只对 leader session 应用。
- 新建 task walkthrough 记录计划，后续实现继续更新本文件。

## Goal

- 让 leader session 的 `title` / `summary` 从程序默认值升级为由 Agent Summarizer Profile 生成的稳定元数据。
- Agent Summarizer Profile 作为后台 Agent Summarizer Session 实例化，使用 `InputSchema` 固定初始化参数，并通过 `report_result` 返回最终 `title` / `summary`。
- 摘要流程保持 session event log append-only：多次运行只追加状态和结果 entry，不修改既有 entry；`customState` 中的单个状态对象只是 reduce 后的当前投影。
- Agent Summarizer Session 不依赖自身 append-only 长上下文。每次摘要模型输入都从源 session 当前 active path 重建 Agent Dialogue Content，旧 summarizer 历史只用于诊断。

## Current State

- `SessionMetadata` 已有 `title?: string` / `summary?: string`。
- `SessionUpdateEntry` 已支持 append-only 写入 `updates.title` / `updates.summary`。
- `AgentSessionSummaryDto` 已向前端暴露 `title` / `summary`，session snapshot 的 `summary` 字段也复用该 DTO。
- `JsonlSessionRepository.reduce()` 会沿 active path 读取最新 `session_update`，所以现有数据结构已经支持增量更新。
- 创建 session 时，harness 目前只把 `title` 初始化为 `profile.manifest.name`。
- `summary` 没有默认持久生成；`get_session` 工具在缺少 `summary` 时只用最近消息生成临时 fallback，不写回 session。
- 现有 `profile.ingest()` 能写 `sessionUpdates.title/summary`，但这是当前 profile 自己的 post-run hook，不是独立摘要者 profile。
- `compaction.summary` 是上下文压缩摘要，`branch_summary.summary` 是分支摘要，都不应直接混作 session 展示元数据。

## Walkthrough

- 2026-05-27：只读检查 session/profile/harness/documentation 现状，确认字段、append-only 更新入口和当前默认生成逻辑。
- 2026-05-27：记录第一版设计计划。本轮不修改运行时代码。
- 2026-05-27：实现第一版 Agent Summarizer Profile、Agent Dialogue Content 渲染、profile `summarizer` 声明、后台 system session 创建、leader completed 后 fire-and-forget 调度、手动 `summarize` command、结果校验写回和失败隔离。
- 2026-05-27：修正后台 summarizer 状态写入为基于最新 session reduce 合并，避免创建 summarizer session 后的失败路径丢失 `sessionId` 并导致后续重复创建。
- 2026-05-27：根据代码审查修正三处语义：`dialogueContentTokens` 改为按上次成功摘要 token 基线累计；summarizer 初始化 input 指纹变化时创建新的后台 system session；前端 `moveTree()` active path 切换后触发后台刷新。额外修正后台 summarizer 对源 session 的写入方式：`session_update` / state 使用 projection entry，不移动 active leaf，避免污染分支和 tree empty。
- 2026-05-27：用户修订需求：summarizer 运行时应对用户可见，前端能收到状态并展示；会话列表需要展示 session summary，而不是只展示 title 或最近消息。
- 2026-05-27：实现修订需求：`AgentSessionSnapshotDto` 增加 `summarizer` 状态投影，复用 `session_state_changed.snapshot` 让前端收到摘要中/排队/失败状态；Agent 抽屉头部显示低干扰 summarizer chip；会话列表描述改为优先展示 session summary。

## Decisions

- 新建一个 Agent Summarizer Profile，例如内置 `session.summarizer`。
- 内置 `session.summarizer` 只允许 `report_result` 工具；自定义 summarizer 的最低合同是必须能通过 `report_result.data` 返回 `title` / `summary`。
- Agent Summarizer Session 是后台 session，不显示在 linked agent 面板，也不通过 `agent.link.*` 建立可见关联。
- Agent Summarizer Session 由 harness 直接创建后台 session，不走带 `parentSessionId` 的 `createAgent` linked-agent 路径，也不写 `agent.link.*`。
- `defineAgentProfile` 扩展字段第一版命名为 `summarizer`，放在 `AgentProfile` 顶层，不放进 `manifest`。
- `summarizer` 使用静态声明对象，不使用函数。profile 作者声明 summarizer profile key 和初始化 input；harness 负责创建、复用、隐藏展示和失败隔离。
- `summarizer.profileKey` 不限制必须指向系统 profile；但被引用的 profile 必须能作为 Agent Summarizer Profile 运行，并通过 `report_result.data` 返回 `title` / `summary`。
- `summarizer.profileKey` 第一版对 builtin key 做强类型推导：例如 `profileKey: "session.summarizer"` 时 `input` 能推导为 `Omit<SessionSummarizerInput, "sourceSessionId">`，不要退化成 `Record<string, unknown>`；runtime string 先交给目标 profile 的 `InputSchema` 做运行时校验。
- `sourceSessionId` 由 harness 在创建 Agent Summarizer Session 时注入，profile 作者不填写。
- 用户覆盖 builtin leader profile 时，可以通过不声明 `summarizer` 或显式关闭来禁用摘要；`summarizer` 不按 `InputSchema` / `OutputSchema` 那种 builtin schema lock 处理。
- Agent Summarizer Profile 的模型选择与普通 profile 一样走系统配置和 model resolver，不跟随源 leader 的模型。
- summarizer 配置错误分层处理：静态 shape 错误在 `defineAgentProfile` / profile check 阶段暴露；目标 profile 不存在、未允许 `report_result` 或输出 contract 不满足 `title` / `summary` 时，profile check/status 尽量报 issue，运行时记录 warning 并不阻断源 leader。
- Agent Summarizer Session 在 `SessionMetadata` 标记 `systemRole: "summarizer"`。普通 `/api/agent/sessions` 列表默认隐藏 system session，诊断场景后续可通过 `includeSystem=true` 或 debug filter 显示。
- Agent Summarizer Session 的 `workspaceKey` / `workspaceRoot` 跟随源 session。
- 源 session archived 后不再自动触发摘要；已有 Agent Summarizer Session 保留，不自动归档。
- 当前没有 delete session 主路径，暂不设计源 session 删除后的 summarizer 清理；后续如新增 delete，再同步处理或标记 orphaned。
- 第一版不通过 SSE 暴露“摘要中”状态，只在摘要完成后沿既有 `session_update` / `session_state_changed` 刷新列表和 snapshot。2026-05-27 修订：用户希望前端看到后台摘要状态；后续改为通过 snapshot 中的明确 summarizer 状态投影展示，不让 Agent 模型感知。
- 后续手动 `summarize` command 应对源 session 调用，由 harness 查找或创建后台 Agent Summarizer Session。
- Agent Dialogue Content fingerprint 是摘要调度的源正文变化指纹，不是 provider prompt cache key。它应基于 renderer version、纳入 Agent Dialogue Content 的 active path entry id、正文 hash、summarizer profile key/input hash 计算；`dialogueContentTokens` 单独记录用于间隔判断和诊断，不作为正文身份的核心部分。
- 摘要 profile 的 `OutputSchema` 使用：

```ts
Type.Object({
    title: Type.String({description: "简短 session 标题，建议不超过 32 字。"}),
    summary: Type.String({description: "当前 session 的可读摘要，建议不超过 240 字。"}),
})
```

- Agent Summarizer Profile 的 `InputSchema` 承载实例初始化参数，不承载每轮用户 prompt。建议字段：
  - `trigger`: 首次触发时机，第一版建议只实现 `after_invocation`。
  - `interval`: 周期触发配置，支持按 `turn`、`loop`、`dialogueContentTokens`；`loop` 的语义是已完成的 Agent ReAct Loop，第一版检查点仍在 leader invocation 完整结束后，不在 ReAct Loop 中途触发。
  - `maxDialogueContentTokens`: 本次从源 session 重建出的 Agent Dialogue Content 最大 token 数，超过时跳过摘要并记录 warning/error。
  - `sourceSessionId`: 绑定的 leader session id。
- “session 中 content 字段所包含的 token，不计算 tool calls、不计算 tool result”对应的内容边界命名为 **Agent Dialogue Content**；代码中的 token 计数字段建议用 `dialogueContentTokens`。
- Agent Dialogue Content 第一版只包含普通 user/assistant message 的可见正文与 active path 上的 compaction message；不包含 tool call 参数、tool result、assistant thinking、harness reminder、profile/model-context 注入消息或其他 custom message。
- Agent Dialogue Content 包含源 session active path 上的 compaction message，因为它代表旧对话的正文替代物。
- Agent Dialogue Content 渲染为稳定 transcript 格式，显式标注来源，例如 `[user entry-id]`、`[assistant entry-id]`、`[compaction entry-id]`。
- 第一版触发点选在 leader invocation 完整结束后，而不是插入每个 ReAct loop 内部。`loop` 若作为配置项，语义必须明确为 Agent ReAct Loop。
- 摘要失败不应让已经完成的 leader invocation 变成失败；只记录摘要失败状态或日志，并保留旧 title/summary。
- 摘要触发采用后台 fire-and-forget，不阻塞 leader invocation 返回。leader 对摘要系统透明、无感。
- 摘要运行采用 latest-only/coalesced 语义：如果摘要正在运行，新的触发只标记需要再次按最新 active path 重建，不并发跑多个摘要。
- 摘要输入每次从源 session 当前 active path 重建 Agent Dialogue Content。branch/tree 切换后不维护 cursor，直接按当前 active path 重新构建。
- Agent Summarizer Session 可保留自身普通 assistant/tool 历史用于诊断，但每次运行 summarizer 模型时必须使用本次重建的 Agent Dialogue Content 作为摘要原文，不能把旧 summarizer 历史当作增量摘要上下文继续累积。
- Agent Dialogue Content 超过 Agent Summarizer Profile 配置的上限时，本次摘要跳过并记录 warning/error，不自动对摘要者上下文做 compaction。
- 可扩展 `defineAgentProfile` 增加声明式 `summarizer` 字段，让 profile 作者声明该 profile 需要哪个摘要 companion 以及初始化 input。profile 作者不直接创建 session，创建、复用、防重入和失败隔离仍由 harness 控制。
- 摘要调度状态写入源 session 的单个 custom state 对象，例如 `session.summarizer.state`：
  - `sessionId`
  - `running`
  - `dirty`
  - `lastDialogueContentFingerprint`
  - `lastDialogueContentTokens`
  - `lastRunAt`
  - `lastError`
- 摘要结果写回 leader session 时使用现有 `session_update` entry，保持展示字段的统一 reduce 路径。
- Agent Summarizer Session 仍走普通 profile/harness/report_result 机制，并保留自身普通 assistant/tool 历史用于诊断；但不依赖自身历史做增量摘要。
- 系统默认 `session.summarizer` 只允许 `report_result`，不读文件、不查工具；自定义 summarizer 如打开其他工具，由 profile 作者自行承担行为边界，但仍必须满足 `title` / `summary` 输出合同。
- 写回 source session 前，harness 二次校验 title/summary 长度：title 默认上限 32 字，summary 默认上限 240 字。超限时记录 warning，不写脏字段。
- 本轮不新增 ADR；该设计先记录在 active task walkthrough 和 `CONTEXT.md` 中。

## Proposed Implementation Plan

1. 增加摘要 profile contract。
   - 新增 `SessionSummarizerInputSchema` / `SessionSummarizerOutputSchema`。
   - 新增系统 profile `session.summarizer.profile.tsx`。
   - `allowedToolKeys` 只包含 `report_result`。
   - `InputSchema` 包含 harness 注入的 `sourceSessionId` 和摘要上限配置。
   - 验证：profile check/status 能加载，`report_result` schema 包含 `title` / `summary`。

2. 增加会话正文提取器。
   - 从 leader session 当前 active path 中提取纳入 Agent Dialogue Content 的用户/assistant 可见文本。
   - 不计算 assistant tool call 参数。
   - 不计算 tool result。
   - 默认不计算 thinking。
   - 第一版排除 harness reminder、profile/model-context 注入消息和其他 custom message。
   - 使用稳定 transcript 格式标注来源 entry。
   - 验证：单测覆盖普通用户消息、assistant 文本、assistant tool call、tool result、compaction message、custom message 排除边界和 transcript 稳定性。

3. 扩展 profile 声明和摘要调度状态。
   - 在 `AgentProfile` / `defineAgentProfile` 中增加声明式 summarizer 配置，字段名为 `summarizer`。
   - 字段只声明 summarizer profile key 和 input/default interval，不允许 profile 自行创建 session。
   - 设计类型适配：builtin `summarizer.profileKey` 使用已知 profile key 字面量时，`input` 自动收窄到 `Omit<目标 profile input, "sourceSessionId">`；runtime string 走运行时 schema 校验。
   - 在源 session 单个 custom state 对象中记录摘要 profile 绑定关系、运行状态、dirty 标记、最近一次 Agent Dialogue Content 指纹和最近错误。
   - 如果没有摘要 agent session，由 harness 直接创建一个后台 summarizer session，并在 metadata 写入 `systemRole: "summarizer"`；该路径不传 `parentSessionId`，不写 `agent.link.*`。
   - 验证：重复触发不会重复创建 Agent Summarizer Session；后台摘要 session 不进入 linked agent 列表；用户覆盖 profile 后可关闭摘要；普通 session 列表默认隐藏后台摘要 session。

4. 在 leader invocation 完整结束后触发摘要。
   - `finalResult.status === "completed"` 后检查是否需要摘要。
   - 第一版不在 `waiting` / `error` / `aborted` 后触发。
   - 满足触发条件时后台调用摘要 agent，不阻塞 leader invocation。
   - 如果摘要正在运行，只设置 dirty 标记；当前摘要完成后按最新 active path 再跑一次。
   - 如果使用 `loop` interval，按已完成的 Agent ReAct Loop 累计触发资格，但实际后台摘要仍在 invocation 完整结束后调度。
   - 摘要失败不改变 leader invocation 结果。
   - 验证：首轮用户 prompt 完成后能后台生成一次；未达间隔不会运行；摘要失败时 leader 仍 completed；连续触发不会并发运行。

5. 将摘要结果写回 leader session。
   - 读取摘要 agent 的 `reportResult.data.title` / `summary`。
   - harness 二次检查 title/summary：trim 后非空、限长、类型稳定；title 默认 32 字以内，summary 默认 240 字以内。
   - append `session_update` 到 leader session。
   - publish session entry/state，前端沿现有 snapshot/list 路径刷新。
   - 验证：session list、snapshot、`get_session` 都能读到更新后的 title/summary。

6. 接入 Agent Dialogue Content 上限保护。
   - 每次摘要前估算当前 active path 的 Agent Dialogue Content token。
   - 超过 `maxDialogueContentTokens` 时跳过本次摘要，记录 warning，不触发摘要者 compaction。
   - 验证：超过上限时不调用模型，不覆盖旧 title/summary，并保留可诊断状态。

## Revision Plan: User-Visible Summarizer State

1. 增加前端可用的 summarizer 状态投影。
   - 后端继续以 `session.summarizer.state` 作为 append-only session state 真相源。
   - `AgentSessionSnapshotDto` 增加明确的 `summarizer` 状态字段，避免前端读取 raw `customState`。
   - 字段候选：`running`、`dirty`、`lastRunAt`、`lastError`、`lastDialogueContentTokens`。
   - 事件通道优先复用现有 `session_state_changed.snapshot`；summarizer state 每次写入后已经会发布 session state。

2. 在 Agent 抽屉头部展示后台摘要状态。
   - 推荐位置：`app/components/novel-ide/NovelAgentDrawer.vue` 当前 session title 附近。
   - `running=true` 显示低干扰 chip，例如“摘要中”。
   - `dirty=true` 且 running 时显示“摘要排队”或通过 tooltip 说明“当前摘要完成后会按最新分支重跑”。
   - `lastError` 非空且不 running 时显示“摘要失败” warning chip，并把错误文本放进 tooltip。
   - summarizer 状态只面向用户，不并入 `running`，不禁用发送、停止、编辑、branch/tree 操作。

3. 会话列表展示 session summary。
   - `AgentSessionDialog.vue` 的列表描述优先使用 `session.summary`。
   - 没有 `summary` 时 fallback 到 `lastMessagePreview`，再 fallback 到 `No recent messages`。
   - 搜索继续覆盖 title、summary、lastMessagePreview、profileKey 和 sessionId。
   - 第一版保持列表密度，不同时展示 summary 和 last message 两行，除非后续明确需要。

4. 测试与验收。
   - 后端测试：summarizer 运行中会通过 `session_state_changed.snapshot.summarizer.running` 对前端可见；完成后 running 归 false；失败时保留 `lastError` 且不污染 leader invocation。
   - 前端测试：`AgentSessionDialog` 有 summary 时展示 summary，无 summary 时 fallback 到 last message；`useAgentSession` 保留 snapshot 中的 summarizer 字段。
   - 手动验收：发送消息后 header 短暂显示“摘要中”；摘要完成后会话列表显示生成的 session summary。

## Files Changed

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
- 后续可把 `loop` interval 接入更细粒度的 ReAct Loop 完成计数；当前第一版仍在 invocation 完整结束后统一检查。
- 后续可为诊断入口暴露 system session filter；当前 session list 已支持 `includeSystem=true`，普通列表默认隐藏。
- 后续清理无关失败测试：`profile 内 session variable definition 会进入工具 registry` 需要按 read-before-patch 合同补 `variable_read`。
- 后续清理无关 typecheck：`server/agent/skills/silly-tavern-card-cli.test.ts` 的 optional marker 断言需要收窄类型。
