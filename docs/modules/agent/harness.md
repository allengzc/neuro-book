# Agent Harness

本文档说明当前 `server/agent` 的 harness 系统如何把调用方 invoke、profile prepare、session 写入、ReAct loop、SSE 和前端展示串起来。它同时记录已经确定的下一步 TSX Profile 目标边界，避免把旧 `PreparedTurn` 字段误当成长期合同。

## 文档状态

- 当前实现事实：以 `server/agent/harness/neuro-agent-harness.ts`、`server/agent/profiles/types.ts`、`server/agent/session/session-repo.ts` 为准。
- 目标设计边界：来自 `docs/tasks/leader-profile-v2-adaptation/README.md` 与 `docs/tasks/tsx-profile-workbench/README.md` 中已经确认的 TSX Profile 讨论。
- 暂缓内容：`ingest` 作为 ReAct loop 结果归档策略的重设计先不做；当前仍由 harness 在 streaming `message_end` 时持久化 assistant / toolResult。

## 关键位置

- Harness 主入口：`server/agent/harness/neuro-agent-harness.ts`
- HTTP 适配：`server/agent/http.ts` 与 `server/api/agent/sessions/**`
- Profile contract：`server/agent/profiles/types.ts`
- Profile catalog：`server/agent/profiles/catalog.ts`
- Session 存储：`server/agent/session/session-repo.ts`
- Session event hub：`server/agent/events/session-event-hub.ts`
- Tool registry：`server/agent/tools/**`
- Compaction：`server/agent/harness/compaction.ts`
- Workbench profile API：`server/api/agent/profiles/**`

## Harness 职责

`NeuroAgentHarness` 是 Agent 运行时编排器。它不直接拥有业务 prompt，也不直接实现工具业务逻辑，而是负责把这些模块接成一条确定的运行链路：

- 创建和读取 session，维护 append-only session tree。
- 按 `profileKey` 从 profile catalog 加载 profile，并用 `inputSchema` 解析 session instance input。
- 调用 profile 的 `prepare()`，得到进入 ReAct loop 前需要的上下文分区。
- 在 ReAct loop 前统一提交 profile 需要写入 session 的消息或状态。
- 从 session reduce 结果组装 provider 可见 messages。
- 根据 profile 的 `allowedToolKeys` 选择可见工具，并为 `report_result` 按目标 profile 动态派生 schema。
- 调用 Pi provider streaming，并执行 tool call。
- 将 assistant / toolResult 的 `message_end` 结果写回 session。
- 通过 event hub 广播 session entry、snapshot 变化和 Pi-like streaming event。
- 管理 active invocation、follow-up queue、abort、approval waiting、compaction 和 tree command。

## Session 模型

Session 是 append-only 消息树。repository 每次追加普通 entry 后会自动追加一个 `leaf` entry，把 active leaf 移到新 entry。切换分支只移动 leaf，不删除旧历史。

常见 entry：

- `message`：真实 Pi message，通常是 `user` / `assistant` / `toolResult`。
- `custom_message`：系统或 profile 生成的 message；`visibleToModel: true` 时进入模型上下文。
- `custom`：profile / harness / UI 状态，例如 linked agent、plan mode、profile history injected。
- `session_update`：title / summary。
- `model_change` / `thinking_level_change` / `profile_change`：session 级运行配置变更。
- `compaction`：压缩摘要与保留边界。
- `invocation_lifecycle`：run start / end / error / aborted。

`JsonlSessionRepository.reduce(snapshot)` 沿 active path 生成 `NeuroSessionContext`：

- `messages`：active path 中的 `message`，以及 `visibleToModel` 的 `custom_message`。
- `customState`：由 `custom`、`variable_change` 等 entry reduce 得到。
- `linkedAgents`：由 `agent.link.*` / `agent.detach.*` custom entry reduce 得到。
- `model`、`thinkingLevel`、`profileKey`、`title`、`summary`、`planModeActive` 等运行状态。

前端 snapshot 也以 active path reduce 结果为真相源。前端历史展示只来自 session 中已经落盘的消息，加上当前 invocation 的 live streaming 事件。

## Profile 与 Input

当前 profile 外层仍是：

```ts
defineAgentProfile({
    manifest,
    inputSchema,
    outputSchema,
    allowedToolKeys,
    prepare,
    ingest,
});
```

`InputSchema` 描述创建 agent/session 时的实例初始化参数，不描述每轮用户任务。普通 agent 可以使用 `InputSchema = Type.Object({})`，表示没有特殊实例配置；每轮任务通过 invocation 的用户 message 传入。

`OutputSchema` 描述 `report_result` 的结构化 payload。如果 profile 没有允许 `report_result`，`OutputSchema` 不会自动触发输出校验。当前约定是：

- `OutputSchema = Type.Object({})` 且允许 `report_result`：走 report 完成协议，但模型只需要提交通用 `walkthrough`。
- `OutputSchema = Type.Object({})` 且不允许 `report_result`：普通 agent，不走 report 完成协议。
- 非空 `OutputSchema` 且允许 `report_result`：`report_result` 参数包含 `walkthrough` 和必填 `data`，`data` 按该 schema 校验。

Tools 不应由普通 `prepare()` 决定。当前实现还支持 `PreparedTurn.toolKeys` 作为过渡字段，但目标合同是 harness 从 `profile.allowedToolKeys` 和 runtime registry 决定本轮工具集合。

## 当前 Prepare 合同

当前代码里的底层类型仍叫 `PreparedTurn`：

```ts
type PreparedTurn = {
    systemPrompt?: string;
    historyMessages?: Message[];
    dynamicMessages?: AgentMessage[];
    appendingMessages?: Message[];
    toolKeys?: string[];
    sessionWrites?: SessionEntryDraft[];
};
```

当前实现规则：

- `systemPrompt`：不写 session，只传给 provider。
- `historyMessages`：如果 `customState["profile.history.injected"]` 不存在，则写入 session，然后写 `custom profile.history.injected = true`。
- `appendingMessages`：每轮 ReAct 前写入 session。
- `dynamicMessages`：不写 session，只拼入本轮 provider context。
- `sessionWrites`：每轮 ReAct 前写入 session entry。
- `toolKeys`：过渡期字段；如果没有返回，则使用 `profile.allowedToolKeys`。

这套字段描述当前实现，不是 TSX Profile DSL 的最终目标。后续改造要把它收敛成更清楚的分区输出，避免 profile 返回已经混好历史的最终 context。

## 目标 Profile Turn Plan

下一步 TSX Profile 的目标底层输出暂称 `ProfileTurnPlan`：

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

目标约束：

- 不返回最终 `contextMessages` / `messages`。
- 不同时返回 `historySeed` 与已经包含 history 的 context，避免双真相源。
- 不返回 `toolKeys`；工具集合来自 `profile.allowedToolKeys`。
- 用户层向 session 增加模型可见消息的唯一通道是 `AppendingSet`。
- `stateWrites` 只用于受控 profile/session 状态，例如 Reminder / Watch baseline，不作为任意写 session 的逃生口。
- 最终 ReAct messages 由 harness 在 pre-loop 写入后重新 reduce session，再追加 model-only context 得到。

因此目标链路是：

```text
profile.prepare()
-> ProfileTurnPlan
-> harness 提交 history init / appending / state
-> harness 写入当前用户 message
-> 重新 reduce session
-> reduce 后 messages + modelContextMessages
-> ReAct loop
```

## TSX Profile DSL 边界

普通 profile 作者未来主要写 TSX DSL，而不是直接手写底层 `ProfileTurnPlan`。高级用户仍可以覆写 `prepare()`，但 `prepare()` 也必须遵守同一分区语义。

已经确定的 DSL 边界：

- Profile 能通过 JSX/XML 标签直观构造上下文，也可以用普通 TypeScript 函数返回 JSX tree 复用片段。
- 不继续使用过时的 `SimpleProfile` class 继承模型。
- 不支持 `<Message role="system">`。provider 级 system prompt 由专门的 `System` / system prompt 分区表达。
- `System` 只影响 provider `systemPrompt`，不写 session，不展示为前端历史消息。
- `HistorySet` 表达首轮稳定上下文。它不是每轮追加消息，也不负责隐式改写旧会话。
- `AppendingSet` 表达本轮 ReAct 前需要写入 session 的上下文，是用户层唯一的 session append 通道。前端需要看到的 `<system-reminder>`、activated skill、plan mode reminder 等都应通过这里进入 session。
- `ModelContext` 或等价的 model-only 分区表达不持久化上下文。它进入模型，但不进入 session，前端历史不会展示。
- `Reminder` / `Watch` 必须迁移，并围绕 `AppendingSet` 与受控 profile state 工作，避免无限重复写入历史。
- `SkillCatalog` / `ActivatedSkills` 必须迁移，但它们属于 history、appending 还是 model-only，需要按具体节点语义明确落点。

Workbench 和 preview 应展示 DSL 编译后的分区结果：`systemPrompt`、history init、AppendingSet pre-loop 写入、model-only context，以及最终 ReAct messages 预览。

## Invoke 生命周期

调用入口：

- `POST /api/agent/sessions/:sessionId/invocations`
- `invokeAgentSession(sessionId, body)`
- `NeuroAgentHarness.invokeAgent(input)`

DTO 规则：

- `mode: "prompt"` 必须带 `message`。
- `mode: "continue"` 不带普通用户 message，可带 `resolution`。
- `block: false` 当前尚未实现。

一次 prompt invocation 的当前顺序：

```text
1. 写 invocation_lifecycle:start。
2. prompt 模式构造 pending user message，但暂不写 session。
3. continue + resolution 时，先把 resolution 转为 toolResult 写入 session。
4. 读取 session snapshot，reduce 当前 session。
5. 调用 profile.prepare(snapshot context)。
6. harness 写入 prepare 产物中的 historyMessages / appendingMessages / sessionWrites。
7. prompt 模式把 pending user message 写入 session。
8. 重新读取 session 并 reduce。
9. 如需要，基于 context.messages + dynamicMessages 做 compaction。
10. 再次 reduce，组装 ReAct loop 输入。
11. 进入 ReAct loop。
12. ReAct loop 内 assistant / toolResult 的 message_end 事件写入 session。
13. loop 完成后运行当前 ingest。
14. 写 invocation_lifecycle:end/error/aborted。
15. 清理 active invocation，drain follow-up queue。
```

这个顺序解释了 AppendingSet 的前端同步要求：如果希望用户发起一次输入后，前端先看到 `<system-reminder>` 或 profile 生成的本轮上下文，再看到用户消息，再看到 AI 流式输出，那么这些 reminder 必须在 ReAct loop 前由 harness 写入 session，并且写入顺序必须早于 pending user message。

## ReAct Loop

`runLoop()` 是当前 harness 的 ReAct 主循环。输入：

```ts
{
    sessionId,
    workspaceKey,
    workspaceRoot,
    systemPrompt,
    messages,
    model,
    apiKey,
    toolKeys,
    profileKey,
    thinkingLevel,
    abortSignal,
    invocationId,
    onEvent,
}
```

输出：

```ts
{
    events,
    finalAssistant?,
    reportResult?,
    waiting?,
}
```

流程：

```text
agent_start
while shouldContinue:
    turn_start
    streamAssistant(systemPrompt, messages, visibleTools)
    assistant message_end -> session
    collect assistant tool calls
    runToolBatch(toolCalls)
    toolResult message_end -> session
    turn_end
    if waiting approval/input:
        agent_end
        return waiting
    shouldContinue = any tool result does not terminate
agent_end
return finalAssistant/reportResult
```

`streamAssistant()` 会把输入 messages 过滤为 provider 支持的 `user | assistant | toolResult`，然后调用 Pi `streamSimple(model, { systemPrompt, messages, tools })`。

`runToolBatch()` 负责：

- 校验 approval 类工具是否允许。
- 对普通工具发 `tool_execution_start` / `tool_execution_end`。
- 将工具结果转成 `ToolResultMessage`。
- 对每个 tool result 发 `message_start` / `message_end`。
- 读取 `report_result` 的结构化结果。
- 根据 `terminate` 判断是否继续下一轮。

## 消息如何进入 Session

当前有四类主要写入来源：

1. Invocation lifecycle：harness 在 run 开始、结束、错误、abort 时写 `invocation_lifecycle`。
2. Pre-loop profile writes：`prepare()` 产出的 history / appending / session writes。
3. Prompt user message：`prompt` 模式的用户输入在 prepare 之后写入 session。
4. ReAct streaming result：`persistEvent()` 在 `message_end` 时把 `assistant` / `toolResult` 写入 session。

`dynamicMessages` / model-only context 不写 session，因此前端不会把它显示为历史消息。前端只展示 session 内消息，加上当前 ReAct loop 的 live SSE 事件。

后续 DSL 要保持这个原则：凡是前端需要看见、需要分支保存、需要 replay 的内容，都必须作为 pre-loop session entry 写入；只想影响模型、但不希望成为历史的内容，才能放在 model-only context。

## SSE 与前端同步

Harness 通过 `AgentSessionEventHub` 广播两类事件：

- `kind: "session"`：session control event。
- `kind: "pi"`：Pi-like streaming event。

Session control event 包括：

- `session_entry`：某个 entry 已写入 session。
- `session_state_changed`：snapshot 发生变化。
- `follow_up_queued`：运行中收到后续 prompt。
- `snapshot_required`：replay buffer 不足，需要前端重拉 snapshot。
- `invocation_aborted`：中断请求。

Pi event 包括 `agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_end`、`turn_end`、`agent_end` 等。

事件中心是单进程内存广播，带 bounded replay。前端断线后用 `after` 请求 replay；如果 `after` 太旧，会收到 `snapshot_required`。

前端展示规则：

- 稳定历史来自 session snapshot。
- 当前 AI 输出来自 live Pi event。
- model-only context 不展示。
- 如果 AppendingSet 需要可见，必须先写 session，再进入 ReAct loop。

## Ingest

当前 `profile.ingest()` 在 ReAct loop 完成后运行。它接收与 `prepare()` 类似的 profile context，目前允许返回：

```ts
{
    messageWrites?: Message[];
    sessionUpdates?: {
        title?: string;
        summary?: string;
    };
}
```

Harness 会校验返回字段，只允许写 message 和 title/summary 更新。

本阶段暂不把 `ingest` 改造成 assistant / toolResult 归档策略。原因是这会同时影响：

- 已经通过 SSE 展示给前端的 live 消息是否最终进入 session。
- waiting approval/input 时 pending assistant tool call 是否可恢复。
- abort/error 后已经展示的内容如何归档。
- session tree 的 append-only 分支一致性。

因此当前仍由 harness 在 ReAct loop `message_end` 时持久化 assistant / toolResult。后续若重设 ingest，应先单独设计 live event、session replay 和 waiting resume 的一致性。

## Follow-up Queue

如果 session 已有 active invocation，又收到新的 prompt：

- harness 不立刻写 user message。
- 新 prompt 进入内存 follow-up queue。
- event hub 广播 `follow_up_queued`。
- 当前 invocation 完成后，`drainFollowUps()` 以 `prompt` 模式启动下一轮。

第一版 follow-up queue 是内存状态；snapshot 会带当前队列，便于前端展示。

## Approval / Waiting

approval 类工具调用不会立即生成普通 toolResult。若遇到需要等待的 tool call：

- ReAct loop 返回 `waiting`。
- active invocation 状态变为 `waiting`。
- session 尾部保留 assistant message 中的 pending tool call。
- 前端 snapshot 通过 `findPendingApprovalCall()` 找到 pending approval。
- 用户提交 resolution 后，`continue + resolution` 会把 resolution 转成 toolResult 写入 session，再继续 invoke。

这也是暂缓 ingest 改造的重要原因：pending assistant message 必须可恢复。

## Compaction

Harness 在进入 ReAct loop 前会检查是否需要自动 compaction。当前输入是：

```text
context.messages + prepared.dynamicMessages
```

如果发生 compaction，会写 `compaction` entry。之后重新 reduce session，再进入 ReAct loop。

手动 `/compact` 通过 command 入口触发 `runCompactCommand()`，它有自己的 lifecycle，并不作为普通用户消息进入模型。

## Tree / Branch

Session tree 由 append-only entry 和 leaf 组成：

- `tree` command 只移动 leaf。
- `retry` 移动到目标 entry 之前。
- `fork` 创建新 session。
- `tree + next.invoke` 先移动 leaf，再 invoke；当前不是事务，invoke 失败不会自动回滚 leaf。

ReAct invocation 运行中禁止 tree 操作，避免 live 事件写入已经移动的分支。

## 对 TSX Profile 改造的要求

后续实现 TSX Profile DSL 与 `leader.default` v2 适配时，harness 需要锁住这些边界：

- `prepare` 是 profile 给 harness 的底层接口，但普通用户主要通过 TSX DSL 构造上下文。
- `prepare` 不返回最终 context messages，不返回同时包含 history 的 `contextMessages` 和单独 `historySeed`。
- tools 不由 `prepare` 提供；harness 从 `profile.allowedToolKeys` 获取。
- `AppendingSet` 是本轮 ReAct 前向 session 追加模型可见消息的唯一用户层通道。
- 需要前端展示的 system reminder 必须写入 session，不能只放 model-only context。
- model-only context 只影响模型，不进入前端历史。
- `ingest` 先不参与 ReAct loop 生成消息的持久化决策。
- waiting approval/input 的恢复优先级高于 profile 对消息归档的自定义。
- Workbench preview 应展示 harness 实际会使用的分区和最终 ReAct 输入，而不是只展示 system prompt 字符串。

