# Session Title/Summary Enhancement

## User Request

- 检查 Agent session 是否已有 `title` / `summary` 字段，或相关替代字段。
- 设计并实现一个独立 summarizer profile，用 `report_result` 生成 session `title` / `summary`。
- 18 runtime pipeline hooks 已完成第一版，现在本任务重新按 18 的 Run Kernel / runtime hooks / SessionWritePlan 合同落地。

## Goal

- 任意 source profile 都可以声明启用 summarizer，不限定 leader。
- summarizer 是普通 profile，不是 Run Kernel 特例；用户也可以用自己的 `.profile.tsx` 实现同类 summarizer。
- summarizer 有隐藏 system session 身份，可拥有 HistorySet 初始化历史；但每次摘要运行中的 assistant/toolResult transcript 不写入 summarizer session。
- 每次摘要都从 source session 当前 active path 重建 Agent Dialogue Content，不维护 summarizer cursor，不做 summarizer 自身 compact。
- source session 的 `title` / `summary` 是 active-path-specific projection：rollback / tree 切换 / fork 后，展示元数据跟随当前 active path。
- 摘要失败、超限、过期结果都不影响 source invocation 的 completed / waiting / error 结果，只更新 summarizer 状态。

## Implementation Goal

这轮 17 重做完成时，要交付一个可以真实运行的 session title/summary summarizer 系统，而不是只保留设计草案：

- `summarizer` builtin profile 能被 profile catalog 加载，且只通过 `report_result` 输出 `{ title, summary }`。
- `defineAgentProfile({ summarizer })` 能让任意 source profile 启用摘要；`profileKey: "summarizer"` 时，`input` 类型自动适配 summarizer InputSchema，并由 harness 注入 `sourceSessionId`。
- source invocation `completed` 后，harness 会 fire-and-forget 触发 hidden system summarizer session；source 的 HTTP result、SSE terminal state 和后续操作不等待摘要完成。
- summarizer 每次运行都从 source session 当前 active path 重建 Agent Dialogue Content，并以 runtime-only message 注入模型上下文；summarizer 自己的 assistant/toolResult transcript 不写入 session history。
- summarizer 成功后通过 `SessionWritePlan` 写回 source session 的 active-path-specific `title` / `summary` projection；写回前必须校验 source active leaf 未变化。
- summarizer running / dirty / error / lastRunAt / token 状态能通过 source session snapshot 投影给前端，且不生成 source ErrorBubble。
- 旧 `session.summarizer` profile key、旧 state key、旧 hard-coded 自动运行路径和旧 compiled artifact 被清理；开发版不做 alias 或 legacy 兼容。

验收标准：

- 后端 targeted tests 覆盖 profile key hard-cut、runtime-only transcript、source projection 写回、stale leaf guard、dirty/coalesced 调度和 Agent Dialogue Content 边界。
- 前端 targeted tests 覆盖 snapshot summarizer state 保留、session list 优先展示 summary、摘要错误低干扰展示。
- 18 相关 runtime 宽套件仍通过；`tsc` 如仍失败，只允许剩余既有无关错误，并在任务报告中明确标注。

## Target Outcome

完成后，项目应该得到这些行为：

- profile 作者可以在 `defineAgentProfile({ summarizer: ... })` 声明摘要 companion。
- builtin summarizer profile key 硬切为 `summarizer`；旧 `session.summarizer` 只作为历史实现清理对象，不做兼容 alias。
- summarizer profile 只允许 `report_result` 工具，`report_result.data` 必须符合 `{ title, summary }`。
- harness 在 source invocation 正常完成后触发后台摘要；第一版不在 waiting / error / aborted 后触发。
- summarizer 运行使用普通 Run Kernel，但通过 runtime hooks 组合实现：
  - `prepareRun` 或 `prepareNextTurn` 注入 runtime-only Agent Dialogue Content。
  - `ingestTurn` 返回 `transcript: "runtime_only"`。
  - `settleRun` 读取 `reportResult`，校验 source active leaf 仍匹配，然后用 `SessionWritePlan` 写 source projection。
- 同一个 source session 的摘要调度采用 latest-only / coalesced 语义：运行中又触发时只标 dirty，当前结束后按最新 active path 再跑一次。
- 前端通过 snapshot 看到 summarizer 状态：running / dirty / lastRunAt / lastError / lastDialogueContentTokens。

非目标：

- 第一版不支持 Turn Transaction 中途触发摘要。
- 第一版不把 tool call、tool result、thinking、harness reminder 纳入 Agent Dialogue Content。
- 第一版不做 server restart 后自动恢复正在运行的 summarizer job。
- 第一版不把 summarizer 做成 sessionless 执行体。

## Current State After 18

- `SessionMetadata` 已有 `title?: string` / `summary?: string`。
- `SessionUpdateEntry` 已支持 append-only 写入 `updates.title` / `updates.summary`。
- `AgentSessionSummaryDto` 和 snapshot 已暴露 `title` / `summary`。
- `SessionSummarizerStateDto` 已作为前端投影类型存在。
- 18 已提供 summarizer 所需的 runtime 基础能力：
  - `runtime: { hooks }`。
  - `ctx.input` 类型推导。
  - `ctx.session.read(sessionId?)`。
  - `ctx.session.agentDialogueContent()`。
  - `runtimeMessages`。
  - `ingestTurn.transcript = "runtime_only"`。
  - `settleRun` 读取 `reportResult` 并返回 `SessionWritePlan`。
  - `SessionWritePlan` ordered ops 和 projection append。
- 旧 hard-coded summarizer 自动运行路径已从 active harness 删除。
- 代码里仍残留旧 `session.summarizer` profile、contract、compiled artifact、状态 key、测试和 DTO 命名；本任务实现时按开发版原则硬切清理。

## New Design

### Profile Declaration

source profile 通过顶层 `summarizer` 字段声明 companion：

```ts
export default defineAgentProfile({
    manifest: {
        key: "leader.default",
        name: "Leader",
    },
    inputSchema: LeaderDefaultInputSchema,
    allowedToolKeys: [...],
    summarizer: {
        profileKey: "summarizer",
        input: {
            trigger: "afterInvocation",
            interval: {
                kind: "sourceInvocation",
                value: 1,
            },
            maxDialogueContentTokens: 80000,
        },
    },
    runtime: agentRuntimeBuiltins.defaultSessionRuntime(),
    context(ctx) {
        // normal profile prompt
    },
});
```

约束：

- `summarizer.enabled === false` 表示显式关闭。
- `sourceSessionId` 由 harness 创建 summarizer session 时注入，profile 作者不填写。
- `profileKey: "summarizer"` 时，`input` 类型应自动收窄为 `Omit<SessionSummarizerInput, "sourceSessionId">`。
- summarizer session 不进入 linked-agent 关系，不写 `agent.link.*`。
- summarizer 模型选择走普通 profile 配置，不跟随 source profile。

### Summarizer Profile

builtin `summarizer` profile 是普通 profile：

- `manifest.key = "summarizer"`。
- `allowedToolKeys = ["report_result"]`。
- `InputSchema` 只承载初始化参数和调度参数，不承载每轮 source 文本。
- `OutputSchema` 用于 `report_result.data`，字段为 `{ title, summary }`。
- `HistorySet` 可用于初始化角色/格式要求。
- `AppendingSet` 为空；每轮 source 内容通过 runtime hook 的 `runtimeMessages` 注入。

建议 schema：

```ts
type SessionSummarizerInput = {
    sourceSessionId: number;
    trigger?: "afterInvocation";
    interval?: {
        kind: "sourceInvocation" | "sourceTurn" | "dialogueContentTokens";
        value: number;
    };
    maxDialogueContentTokens?: number;
};

type SessionSummarizerOutput = {
    title: string;
    summary: string;
};
```

### Runtime Hook Shape

第一版可以先给 profile 作者暴露足够的 public helper：

- `agentRuntimeBuiltins.profilePrompt()`
- `agentRuntimeBuiltins.reportResult()`
- `agentRuntimeBuiltins.runtimeOnlyTranscript()`

如果不新增这些 helper，也可以先在 builtin summarizer profile 内显式声明 hook；但文档和 profile 示例不能使用当前代码没有的 public API。

summarizer runtime 行为：

1. `prepareRun` / `prepareNextTurn`
   - `ctx.session.read(ctx.input.sourceSessionId)` 读取 source snapshot。
   - `ctx.session.agentDialogueContent({ snapshot: source.snapshot, input: ctx.input })` 构造 Agent Dialogue Content。
   - 若 token 超过上限，向 source session projection 写 `summarizer.state.lastError`，本次不调用模型。
   - 否则把 dialogue text 作为 runtime-only user message 注入当前 RunFrame。
   - 在 hook runtimeState 里记录 `sourceLeafId`、`dialogueContentTokens`、`dialogueContentFingerprint`。

2. `ingestTurn`
   - 返回 `{ transcript: "runtime_only" }`。
   - assistant/toolResult 只闭合当前 RunFrame，不写 summarizer session history。
   - `report_result` 缺失 reminder 也必须保持 runtime-only。

3. `settleRun`
   - 读取 `ctx.runResult.reportResult.data`。
   - trim 并校验 title / summary 非空和长度。
   - 重新读取 source session，确认 current active leaf 等于 runtimeState.sourceLeafId。
   - 若 leaf 不匹配，只写 `summarizer.state.dirty = true`，不覆盖旧 title/summary。
   - 若匹配，写 source projection：
     - `session_update { title, summary }`
     - `custom summarizer.state { running:false, dirty:false, lastRunAt, lastDialogueContentTokens, lastDialogueContentFingerprint }`

### Agent Dialogue Content

Agent Dialogue Content 是 summarizer 的唯一 source 文本。

第一版包含：

- active path 上的普通 user message 可见正文。
- active path 上的普通 assistant message 可见正文。
- active path 上的 compaction summary message。

第一版排除：

- tool call 参数。
- tool result。
- thinking / reasoning。
- harness reminder。
- profile `HistorySet` / `ModelContext` 注入消息。
- custom message / custom state。
- summarizer 自身 transcript。

如果后续发现 Agent Dialogue Content 不够用，再扩展 helper；不要在 summarizer profile 里临时拼 raw session entry。

### Scheduler

summarizer 调度属于 Harness / Coordinator 周边服务，不进入 Run Kernel 核心对象。

触发规则：

- source invocation `completed` 后检查 summarizer。
- 第一版不在 `waiting`、`error`、`aborted` 后触发。
- 第一版不在每个 Turn Transaction 后触发；`sourceTurn` interval 可以先记录 schema，实际触发可等后续需要。

运行规则：

- 每个 source session 同时最多一个 summarizer run。
- 运行中再次触发，只写 `summarizer.state.dirty = true`。
- 当前 run 完成后，如果 dirty 仍为 true，按最新 source active path 再触发一次。
- summarizer fire-and-forget，不阻塞 source invocation HTTP response。
- summarizer 错误只写 source `summarizer.state.lastError`，不反写 source invocation lifecycle。

### State

状态真相源写在 source session projection custom state：

```ts
type SummarizerState = {
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    summarizerSessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
};
```

key 硬切为 `summarizer.state`。

旧 `session.summarizer.state` 不做兼容读取；开发期旧 session 可以丢弃。

### Projection

title / summary 写回 source session 时必须是 active-path-specific projection。

第一版需要补足 projection scope：

- projection entry 不进入 tree，不移动 active leaf。
- projection 必须绑定 source active leaf。
- reduce session summary 时，只应用与当前 active leaf 匹配的 title/summary projection。
- active path 没有匹配 projection 时 fallback 到默认 title / last message preview。

如果当前 `SessionWritePlan` 的 `append + projection: true` 还没有 scope 字段，本任务需要扩展最小 scope：

```ts
projection?: {
    scope: "activeLeaf";
    leafId: SessionEntryId | null;
};
```

也可以先把 scope 存进 entry metadata，但不建议再做临时 custom state 拼接；title/summary 应继续走 `session_update` reduce 路径。

## Implementation Plan

### Phase 1: Hard-Cut Contract Cleanup

- 将 builtin profile key 从 `session.summarizer` 改为 `summarizer`。
- 将 schema / contract 命名从 `SessionSummarizer*` 视情况保留为类型名，但描述和 KnownProfileInputs key 改为 `"summarizer"`。
- 将 `SESSION_SUMMARIZER_STATE_KEY` 的值改为 `summarizer.state`。
- 清理或替换旧 compiled artifact：`builtin__session.summarizer.mjs`。
- leader 默认 profile 的 `summarizer.profileKey` 改为 `"summarizer"`。

验证：

- profile catalog 能加载 `summarizer`。
- `profileKey: "summarizer"` 时 summarizer input 有类型适配。
- 旧 `session.summarizer` 不再作为 runnable builtin profile 出现。

### Phase 2: Summarizer Runtime Profile

- 实现 builtin `summarizer.profile.tsx`。
- 只允许 `report_result`。
- 使用 runtime hooks 注入 source Agent Dialogue Content。
- `ingestTurn` 使用 `runtime_only`。
- `settleRun` 通过 `SessionWritePlan` 写 source projection。

验证：

- summarizer session 运行后自身 session history 只包含初始化历史，不包含 assistant/toolResult transcript。
- `report_result.data` 成功写回 source title/summary。
- 缺失 `report_result` 时 reminder 不写 summarizer session history。

### Phase 3: Source Profile Declaration + Scheduler

- 保留并收紧 `defineAgentProfile.summarizer` 校验。
- harness 在 source invocation completed 后触发 summarizer。
- harness 直接创建 hidden system summarizer session，不走 linked-agent。
- 实现 latest-only/coalesced 状态机。

验证：

- 任意启用 summarizer 的 profile 完成 invocation 后触发摘要。
- running 时重复触发只标 dirty，不创建重复 session。
- dirty run 完成后按最新 active path 再跑一次。
- waiting/error/aborted 不触发摘要。

### Phase 4: Active-Path Projection

- 为 projection write 增加 active leaf scope。
- title/summary reduce 只应用当前 active leaf 对应 projection。
- tree move / rollback / fork 后 title/summary 跟随 active path。

验证：

- stale summarizer 结果不会覆盖新 active leaf。
- tree 切换后展示对应 path 的 title/summary。
- source active leaf 为空时 projection 行为明确：只能绑定 `null`，且只在 empty path 生效。

### Phase 5: UI State

- snapshot 继续暴露 `summarizer?: AgentSessionSummarizerStateDto`。
- 前端抽屉头部低噪声显示 running / dirty / lastError。
- session list 描述优先显示 `summary`，没有则 fallback 到 last message preview。

验证：

- `session_state_changed.snapshot.summarizer.running` 可见。
- 摘要失败只显示 summarizer warning，不产生 source ErrorBubble。
- 新 prompt / retry 后旧 summarizer error 状态按状态机清理或覆盖。

## Files To Update

- `assets/workspace/.nbook/agent/profiles/builtin/session.summarizer.profile.tsx` -> `summarizer.profile.tsx`
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
- `server/agent/session/write-plan.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `shared/dto/agent-session.dto.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/components/novel-ide/agent/AgentSessionDialog.vue`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `docs/tasks/17-session-title-summary-enhancement/README.md`
- `PROJECT-STATUS.md`

## Verification Plan

- `bunx vitest run server/agent/session/dialogue-content.test.ts server/agent/session/session-repo.test.ts --reporter=dot`
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts --reporter=dot`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "summarizer|summary|title" --reporter=dot`
- `bunx vitest run app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
- `bun scripts/profile.ts compile --all --system`
- `bun scripts/profile.ts compile --all`
- `bunx tsc --noEmit --pretty false`

当前已知：`tsc` 可能仍因既有 `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误失败；本任务只在不扩大 scope 时报告它。

## Walkthrough

- 2026-05-27：检查 session/profile/harness 现状，确认 `title` / `summary` 字段已存在，但默认仍主要由程序生成。
- 2026-05-27：实现过第一版 `session.summarizer`、Agent Dialogue Content、后台 system session、summary 状态投影和前端展示；该实现现在作为历史参考，不再作为目标合同。
- 2026-05-28：设计推进后确认 17 等待 18 runtime pipeline hooks 完成后重新计划。
- 2026-05-28：确认 summarizer 不限定 leader，所有 profile 都可以通过声明式 `summarizer` 启用。
- 2026-05-28：确认 summarizer source 内容第一版继续使用 Agent Dialogue Content；`title` / `summary` 是 active-path-specific，会随 session active path 回退、切换、fork 一起变化。
- 2026-05-28：确认 summarizer 不保存自身工具调用、tool result 或 assistant transcript；每次模型上下文都从 source session 重新构建，并间接复用 source session compaction。
- 2026-05-28：确认 summarizer 不作为 Run Kernel 特例；profile 作者可以通过 `runtime: { hooks }` 写出 summarizer 行为。
- 2026-05-29：18 runtime pipeline hooks 第一版完成，提供 `runtime_only` transcript、runtimeMessages、settleRun writePlans、ctx.session facade 和 SessionWriteExecutor。
- 2026-05-29：重写 17 任务文档。17 新计划以 18 的 runtime hooks 为基础，硬切 `summarizer` profile key，清理旧 `session.summarizer`，并把实现分为 contract cleanup、runtime profile、scheduler、active-path projection 和 UI state 五个阶段。

## Historical Artifacts

这些内容是旧实现留下的参考，不代表新目标合同：

- `session.summarizer` profile key。
- `session.summarizer.state` custom state key。
- hard-coded summarizer 自动运行路径。
- invocation-level `profile.ingest()`。
- append-only summarizer transcript。
- 旧验证记录中针对 `session.summarizer` 的测试命名。

实现时可以直接硬切、硬删，不需要 legacy 兼容。
