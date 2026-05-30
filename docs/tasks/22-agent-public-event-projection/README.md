# Agent Public Event Projection

## User Request

- 用户提供了一份 Agent SSE 文本，指出 event 接口太大，尤其是 `session_state_changed`。
- 经过统计，`session_state_changed` 反复携带完整 `snapshot`，成为 SSE 流体积的绝对大头。
- 用户进一步要求系统性考虑修复方案，并把 `agent_end` 这类 runtime event 也纳入同一套方案。
- 本 task 先记录修复计划，随后按该计划完成 harness / DTO / frontend reducer 的系统性修改。

## Goal

建立一层稳定的 **Public Event Projection**，把内部运行事件、完整 session snapshot、公开 SSE/API 事件彻底分开。

完成后应满足：

- 正常 SSE 流只承载增量 UI 信号，不重复发送完整 session history、active path、tree、system prompt 或 provider context。
- `session_state_changed` 不再携带完整 `AgentSessionSnapshotDto`，而是携带轻量 live state。
- `agent_end` 不再携带完整 `frame.messages`。
- `turn_end` 等仅用于 UI phase 的事件不携带完整 assistant/toolResult payload。
- 完整 snapshot 仍然存在，但只通过 `GET /api/agent/sessions/:sessionId` 在 initial load、manual refresh、seq gap、`snapshot_required` 等恢复场景按需拉取。
- `AgentSessionEventHub` replay buffer 只保存 public event，避免 replay 里长期持有大对象。
- `InvokeAgentResult.events` 删除；HTTP invocation response 只返回终态、usage、report_result、error 等摘要字段，live 事件只走 SSE / `onEvent`。

## Current State

### Captured SSE Size

对用户提供的 SSE 文本进行字段级统计：

- 文件总大小约 `45.79 MB`。
- 事件总数 `69`。
- `session_state_changed`：
  - `14` 条。
  - 总计约 `42.74 MB`。
  - 平均每条约 `3.05 MB`。
  - 最大单条约 `3.06 MB`。
- `agent_end`：
  - `2` 条。
  - 总计约 `3.00 MB`。

`session_state_changed.snapshot` 内部最大字段：

- `entries`：约 `21.05 MB`。
- `messages`：约 `20.89 MB`。
- `systemPrompt`：约 `0.42 MB`。
- `tree`：约 `0.36 MB`。

结论：SSE 体积膨胀的根因不是普通增量事件，而是把完整 snapshot / runtime context 当成 public event payload 反复推送。

### Code Shape

当前相关路径：

- `server/agent/session/write-plan.ts`
  - `SessionWriteExecutor` 在写入后发布 `session_entry`，然后发布 `session_state_changed`。
  - 当前 `session_state_changed` 通过 `snapshotProvider` 携带完整 snapshot。
- `server/agent/harness/neuro-agent-harness.ts`
  - `SessionWriteExecutor` 的 `snapshotProvider` 指向 `getSessionSnapshot(sessionId)`。
  - harness 自身的 `publishSessionState()` 也发送完整 snapshot。
  - `runLoop()` 在结束时调用 `emitFrameEvent(frame, {type: "agent_end", messages: frame.messages})`。
  - `emitFrameEvent()` 当前把内部 `AgentEvent` 原样写入 `frame.events`、`onEvent` 和 SSE。
- `shared/dto/agent-session.dto.ts`
  - `AgentSessionEventDto.kind === "pi"` 当前直接暴露 Pi `AgentEvent`。
  - `AgentSessionControlEvent.session_state_changed` 当前允许携带完整 `AgentSessionSnapshotDto`。
- `app/components/novel-ide/agent/useAgentSession.ts`
  - 前端收到 `session_state_changed.snapshot` 时直接 `applySnapshot()`。
  - 前端已经能用 `session_entry` 增量投影消息，说明正常 SSE 不需要重复发送 `messages` / `entries`。

### Relationship To Existing Tasks

- [14-agent-sse-front-end-contract](../14-agent-sse-front-end-contract/README.md)
  - 已经提出正常 SSE 增量不应触发 snapshot 拉取。
  - 但当时仍把 `session_state_changed` 描述为可更新 snapshot shell，没有严格禁止完整 snapshot 进入 SSE。
- [18-agent-runtime-pipeline-hooks](../18-agent-runtime-pipeline-hooks/README.md)
  - 已经把 `SessionWriteExecutor` 定为统一写入和 publish 入口。
  - 已经明确 hook/profile/tool 不直接 publish event。
  - 本 task 不新增 Run Kernel pipeline stage，而是在 executor / event hub / runtime event emitter 之间补一个 public projection 服务边界。

## Design Decision

### Three Event/Data Shapes

必须硬切为三种数据形态：

1. **Internal Runtime Event**
   - harness / RunFrame 内部使用。
   - 可以保留完整 Pi `AgentEvent`、`frame.messages`、tool result 等。
   - 不直接进入 SSE、EventHub replay 或 HTTP DTO。

2. **Session Snapshot**
   - HTTP 恢复真相接口使用。
   - 可以包含 `messages`、`entries`、`tree`、`systemPrompt`。
   - 只在 initial load、manual refresh、seq gap、`snapshot_required` 等场景按需读取。

3. **Public Stream Event**
   - SSE 和 harness `onEvent` 使用。
   - 必须是轻量、稳定、可 replay 的 DTO。
   - 不允许携带完整 session history、完整 active path、完整 tree、完整 system prompt、完整 provider context。

### Public Session State

新增轻量状态 DTO，概念形态：

```ts
type AgentSessionLiveStateDto = {
    summary: AgentSessionSummaryDto;
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    pendingApproval: AgentPendingApprovalDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    thinkingLevel: ThinkingLevel | null;
    effectiveThinkingLevel: ThinkingLevel;
    planModeActive: boolean;
    usage?: Usage;
};
```

`session_state_changed` 改为：

```ts
{
    type: "session_state_changed";
    state: AgentSessionLiveStateDto;
}
```

明确禁止 `session_state_changed` 携带：

- `messages`
- `entries`
- `tree`
- `systemPrompt`

### Public Runtime Events

当前 `kind: "pi"` 直接暴露 `AgentEvent`，这是 `agent_end` 膨胀的直接原因。需要新增 public runtime event DTO。

概念形态：

```ts
type AgentRuntimeStreamEventDto =
    | {type: "agent_start"}
    | {type: "agent_end"; status?: "completed" | "waiting" | "failed" | "aborted" | "interrupted"; usage?: Usage}
    | {type: "turn_start"; turnIndex?: number}
    | {type: "turn_end"; turnIndex?: number}
    | PublicMessageStreamEvent
    | PublicToolExecutionEvent;
```

第一版重点：

- `agent_end` 不带 `messages`。
- `turn_end` 不带完整 assistant/toolResults，只保留 UI phase 所需的轻量字段。
- `message_start` / `message_update` / `message_end` 可以继续携带当前 message 投影，因为前端需要 live assistant patch；后续如发现大 payload，再做 preview/ref 分层。
- `tool_execution_end` 当前可继续携带工具结果，因为前端工具卡需要 live result；如果工具结果也进入 MB 级，再追加 result preview / session entry ref 策略。

### Snapshot Required

`snapshot_required` 继续作为恢复真相信号。

触发场景：

- EventHub replay buffer 不足。
- 前端检测到 seq gap。
- 某些结构性操作无法用 lightweight state + `session_entry` 准确恢复，例如需要刷新完整 tree / entries 视图。

原则：

- `snapshot_required` 是例外路径，不是每次 state changed 后的常规补偿。
- 不允许把 `session_state_changed` 改成空事件后让前端每次都 `getSession()`，那只是把 SSE 体积转移到 HTTP snapshot 流量。

## Implementation Plan

### Phase 1: Define Public DTOs

- 在 `shared/dto/agent-session.dto.ts` 中新增：
  - `AgentSessionLiveStateDto`
  - `AgentRuntimeStreamEventDto`
  - 更新 `AgentSessionEventDto`，让 public event 不再直接暴露 raw Pi `AgentEvent`。
- 决定是否把 `kind: "pi"` 硬切为 `kind: "runtime"`。
  - 推荐硬切为 `runtime`，因为 public event 已经不是 Pi 原始事件。
  - 如果短期为了少改前端，也可以保留 `kind: "pi"` 名字，但类型必须变成 projected event；这种命名会误导后续维护者。

### Phase 2: Add Event Projectors

新增投影层：

- `projectSessionLiveState(sessionId)`：
  - 读取 session reduce 结果。
  - 只构造轻量 `AgentSessionLiveStateDto`。
  - 不调用 `getSessionSnapshot()`。
- `projectRuntimeEventForPublicStream(event, frame)`：
  - 输入内部 runtime event。
  - 输出 public runtime event。
  - 对 `agent_end`、`turn_end` 等事件删掉大字段。

推荐文件位置：

- `server/agent/events/public-event-projection.ts`

### Phase 3: Wire SessionWriteExecutor

- `SessionWriteExecutor` 不再接收 `snapshotProvider`。
- 改为接收 `liveStateProvider`。
- 写入完成后发布：
  - 每条 entry 对应 `session_entry`。
  - 每个 touched session 对应一次 `session_state_changed.state`。
- executor 仍然不让 hook/profile/tool 直接控制 publish。

### Phase 4: Wire Run Kernel Event Emission

- 修改 `emitFrameEvent()`：
  - raw Pi runtime event 只在投影函数输入侧短暂停留，不进入 `RunFrame` 历史、SSE replay 或 HTTP response。
  - 对外 `onEvent`、`publishRuntimeEvent()` 只使用 projected public event。
- `runLoop()` 结束时不再构造 `{type: "agent_end", messages: frame.messages}` 作为 public event。
- `InvokeAgentResult.events` 从 HTTP response 中删除。

### Phase 5: Update Frontend Reducers

- `useAgentSession.applyEvent()`：
  - `session_state_changed.state` 调用 `applyLiveState()`。
  - `applyLiveState()` 只更新 snapshot shell / runtime shell，不重建历史消息。
  - 如果本地没有 snapshot，标记 `needsSnapshot`，而不是凭空构造完整聊天状态。
- `useAgentSessionStream()`：
  - `applySnapshotSideEffects` 只在完整 snapshot 到达时运行。
  - live state 到达时如需同步 model/title 等 UI shell，提供轻量 side effect 或由 store 派生。
- `agent-message.ts`：
  - 输入 event 类型从 raw `AgentEvent` 改为 public runtime event。
  - `agent_end` / `turn_end` 不再假设有 messages。

### Phase 6: Regression Tests And Size Budget

新增或更新测试：

- `session_state_changed` 不包含 `snapshot`。
- `session_state_changed.state` 不包含 `messages` / `entries` / `tree` / `systemPrompt`。
- 大 session 下多次 write 只产生小体积 state event。
- `agent_end` 不包含 `messages`。
- `turn_end` 不包含完整 assistant/toolResults。
- 前端收到 `session_entry + session_state_changed.state` 后能维持消息、running、waiting、queue、summarizer 状态。
- seq gap / `snapshot_required` 仍能通过完整 snapshot 恢复。

建议加入事件体积预算测试：

```text
给定一个包含大 tool result 的 session：
  session_state_changed serialized size < 50 KB
  agent_end serialized size < 5 KB
```

具体阈值可以后续按 UI 字段实际大小调整，但测试必须防止再次把完整 snapshot 或 frame.messages 塞回 public event。

## Resolved Decisions

- `AgentSessionEventDto.kind === "pi"` 已硬切为 `runtime`。
- `InvokeAgentResult.events` 已删除，避免阻塞 HTTP response 继续聚合 live event。
- `tool_execution_end.result` 是否也需要 preview/ref。
  - 第一版不做，先修当前数据证明最大的问题：`session_state_changed` 和 `agent_end`。
  - 后续如果工具输出事件本身也进入 MB 级，再单独做 tool result preview。
- tree / linked agents 这类结构性变化，是放进 live state 还是触发 `snapshot_required`。
  - 第一版保持 live state 小而稳定；复杂结构变化触发 `snapshot_required` 或让前端主动刷新完整 snapshot。

## Implementation Result

- `shared/dto/agent-session.dto.ts`
  - 新增 `AgentSessionLiveStateDto` 和 `AgentRuntimeStreamEventDto`。
  - `session_state_changed` 从 `snapshot?: AgentSessionSnapshotDto` 硬切为 `state: AgentSessionLiveStateDto`。
  - runtime event `kind` 从 `pi` 硬切为 `runtime`。
- `server/agent/events/public-event-projection.ts`
  - 新增 runtime public projector。
  - `agent_start` / `agent_end` / `turn_start` / `turn_end` 不从 raw Pi event 透出，由 Run Kernel 直接生成轻量公开事件。
- `server/agent/session/write-plan.ts`
  - `snapshotProvider` 改为 `liveStateProvider`。
  - 写入后发布 `session_entry` + `session_state_changed.state`。
- `server/agent/harness/neuro-agent-harness.ts`
  - 新增 `getSessionLiveState()`，只投影 summary、summarizer、activeLeafId、approval、queue、activeInvocation、model/thinking、plan mode、usage。
  - 删除 `RunFrame.events` / `InvokeAgentResult.events` 聚合路径。
  - `agent_end` 只发送 `{status, usage?}`；`turn_end` 只发送 `{turnIndex, status}`。
- 前端 `useAgentSession` / `agent-message` reducer
  - 只消费 `runtime` public event。
  - `session_state_changed.state` 只更新 live shell，不重建消息历史。
  - 没有本地 snapshot 时标记 `missing_snapshot`，仍通过完整 snapshot 恢复真相。

## Files Changed

- `shared/dto/agent-session.dto.ts`
- `server/agent/events/public-event-projection.ts`
- `server/agent/events/public-event-projection.test.ts`
- `server/agent/session/write-plan.ts`
- `server/agent/session/write-plan.test.ts`
- `server/agent/harness/types.ts`
- `server/agent/harness/types.test.ts`
- `server/agent/harness/run-kernel-types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/harness/run-frame-state.ts`
- `server/agent/harness/run-frame-state.test.ts`
- `server/agent/harness/turn-transaction.ts`
- `server/agent/harness/turn-transaction.test.ts`
- `server/agent/harness/turn-failure.ts`
- `server/agent/harness/turn-failure.test.ts`
- `server/agent/harness/prepare-next-turn.test.ts`
- `server/agent/http.test.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/tools/builtin-tools.ts`
- `app/components/novel-ide/agent/agent-message.ts`
- `app/components/novel-ide/agent/agent-message.test.ts`
- `app/components/novel-ide/agent/useAgentSession.ts`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `app/components/novel-ide/agent/useAgentSessionStream.ts`
- `app/utils/agent-message-projection.test.ts`
- `docs/tasks/18-agent-runtime-pipeline-hooks/README.md`
- `docs/tasks/22-agent-public-event-projection/README.md`

## Verification

- `bunx vitest run server/agent/events/public-event-projection.test.ts server/agent/harness/types.test.ts server/agent/session/write-plan.test.ts app/components/novel-ide/agent/useAgentSession.test.ts --reporter=dot`
  - 4 files, 15 tests passed.
- `bunx vitest run server/agent/session/session-repo.test.ts server/agent/session/write-plan.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/run-kernel-error.test.ts server/agent/harness/run-frame-state.test.ts server/agent/harness/prepare-run.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/compaction.test.ts server/agent/harness/types.test.ts server/agent/events/public-event-projection.test.ts server/agent/variables/variables.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/components/novel-ide/agent/useAgentSessionStream.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
  - 20 files, 213 tests passed.
- `bunx tsc --noEmit --pretty false`
  - 本次相关类型错误已清掉；仍失败于既有 unrelated SillyTavern 类型错误：
    - `assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts` 的 `inspection` 字段类型不匹配。
    - `server/agent/skills/silly-tavern-card-cli.test.ts` 的 optional marker/string undefined 错误。

## TODO / Follow-ups

- 更新 [14-agent-sse-front-end-contract](../14-agent-sse-front-end-contract/README.md) 中 public event contract，把 raw Pi event 改为 projected runtime event。
- 用用户提供的 SSE 文本或构造 fixture 做 before/after 体积对比。
