# Agent Runtime Pipeline Hooks

## User Request

- 为 Agent harness 设计一套更强的 runtime hook 架构。
- 让 `compactIfNeeded`、message 落盘、summarizer、后续 profile 运行策略都能通过 hook / plan 统一表达。
- 不要把能力收敛成简单的 `{ persist: false }` 开关。
- 参考 PI `AgentHarness` 的做法，但不要照搬；重新设计成适合 Neuro Book 的 harness。

## Goal

- 把 `NeuroAgentHarness` 重塑成一个小而稳定的 **Run Kernel**。
- 把普通持久化、summarizer runtime-only transcript、compact、queue、approval、turn-level ingest 等能力表达成 **内置 Hook**。
- 明确区分三层状态：
  - `SessionLog`：append-only 持久事实。
  - `RunFrame`：一次 invocation 的运行态。
  - `TurnSnapshot`：一次模型请求使用的冻结快照。
- 所有 hook 只返回 plan，不直接写 session、不直接 publish event、不直接改 repo。
- 第一批消费者是 `summarizer` 和 compaction；summarizer 必须通过普通 profile runtime hooks 表达，不作为 Run Kernel 硬编码特例。

## Target Outcome

18 完成后，项目应该得到这些能力：

- `NeuroAgentHarness` 的入口调度、run 执行、turn 执行、session 写入各有清晰边界，不再由 `invokeAgent()` 串联所有副作用。
- 所有 session 写入统一走 `SessionWritePlan` / `SessionWriteExecutor`；hook、profile、tool 都不能直接 append repo 或 publish event。
- 普通 profile 的行为与当前一致：HistorySet 初始化、AppendingSet 写入、assistant/toolResult transcript 持久化、compact、steer、follow-up、approval、report_result 都能继续工作。
- profile 作者可以在 `defineAgentProfile()` 里通过 `runtime: defineAgentRuntime({ hooks })` 声明运行方式，表达 custom context、custom ingest、custom settle 这类行为。
- summarizer 不作为 Run Kernel 特例；它只是一个普通 profile，通过 runtime hooks 组合完成 source Agent Dialogue Content 摘要。
- waiting/resume 有显式 lifecycle：`start -> waiting -> resumed -> end/error/aborted/interrupted`，同一 logical invocation 复用同一个 `invocationId`。
- source session 的 active-path-specific projection 能稳定表达 title/summary 等展示元数据，后台写入不移动 source active leaf，不污染 tree。

非目标：

- 不在第一版开放任意低层 provider/tool mutation hook。
- 不把所有 session command 塞进 Run Kernel；command/tree/list/snapshot/link 仍属于 Session Control Plane。
- 不把 summarizer 做成 sessionless 或内核分支；它必须用普通 profile 能力表达。

## Design Principles

- 当前 Agent runtime 仍处于开发版。新架构实施时允许硬切、硬删旧合同，不为旧 `profile.ingest()`、旧 summarizer profile key 或旧 harness 内部入口做兼容层。
- 不为了“降低安全风险”牺牲系统表达力。安全边界应通过清晰 capability、facade、tool policy 和 executor 合同表达，而不是削弱 hook / profile 能力。
- 首要服务对象是 runtime 开发者和 profile 作者。外部心智模型要少：profile 作者只理解 profile input、context/prepare、runtime hooks；runtime 开发者只理解 control plane、coordinator、kernel、turn transaction、write executor。
- 灵活度可以高，但隐式行为必须少。跨 session 写入、runtime-only transcript、report_result retry、tool-side writes、lifecycle waiting 都要有显式类型和固定顺序。
- 本文档描述的是目标架构，不承诺兼容当前实现中的临时 API 名称。实现时以本文档为新真相源。

## Current State

- 当前生产入口是自研 `NeuroAgentHarness`，没有直接使用 PI 的 `AgentHarness` class。
- 当前复用 PI 的部分是：
  - message / event / tool 类型。
  - `streamSimple()` provider streaming。
  - `validateToolArguments()` tool 参数校验。
- 当前自研的部分是：
  - session JSONL append-only repo。
  - profile prepare / legacy ingest。
  - invocation lifecycle、queue、abort、event hub。
  - 旧 ReAct loop、tool batch、turn commit。
  - tool 执行上下文里的 session custom state 写入、client variable patch ack。
  - compaction、summary、projection entry。
- 当前主要问题：
  - `invokeAgent()` 同时做入口、prepare、持久化、compaction、loop、ingest、summarizer 调度。
  - `prepare()` 既调用 profile，又直接写 session。
  - `commitTurn()` 默认一定把 assistant/toolResult 写入 session，阻塞 summarizer runtime-only transcript 设计。
  - provider context、runtime messages、session history 三者边界不够明确。
  - 现有 `profile.ingest()` 是 invocation 结束后处理，不能控制每个 ReAct turn；新架构硬删该旧 API，改为 runtime 内置 `ingestTurn`。

## PI Reference

PI 的 `AgentHarness` 值得借鉴的是边界，不是具体实现。

### 1. Harness Config vs Turn Snapshot

PI 把状态分成：

- 最新 harness config：模型、thinking、tools、resources、stream options、system prompt provider。
- turn snapshot：单次 LLM 请求使用的冻结状态。

运行中更新 config 不会修改正在进行的 provider request，只影响下一次 turn snapshot。

Neuro Book 应借鉴：

- `RunFrame` 保存本次 invocation 的 live runtime。
- 每个 turn 创建 `TurnSnapshot`。
- provider request 只能读取 `TurnSnapshot`，不能读半路变化的 session/config。
- `prepareNextTurn` 或 save point 后才能刷新下一轮 context/model/tool/thinking。

### 2. Save Point

PI 的 save point 出现在 assistant turn 和 tool-result messages 完成之后。

在 save point：

- 先按确定顺序持久化 agent-emitted messages。
- 再 flush pending session writes。
- 如果 loop 继续，重新创建下一轮 turn snapshot。

Neuro Book 应借鉴：

- turn settlement 是唯一允许把本轮 assistant/toolResult 转成 session write plan 的地方。
- pending writes 不能插队到 assistant/toolResult 中间。
- compact、summarizer、ingest 这类写入都走 `SessionWritePlan` executor。
- 术语以本文为准：`Turn Transaction` 表示一次模型请求及其工具批次，不再混用旧文档中的 ReAct Loop 计数。

### 3. Pending Writes

PI 允许 busy 时接受 session write，但先排到 pending writes，并在 save point / settlement / failure cleanup 确定顺序 flush。

Neuro Book 第一阶段不一定马上实现完整 pending writes，但设计上要预留：

- hook 不能直接写 repo。
- hook 返回 `SessionWritePlan`。
- executor 负责排序、落盘、publish、错误归因。

### 4. Low-level Loop Hooks

PI 低层 loop 有几个关键 extension points：

- `transformContext`
- `beforeToolCall`
- `afterToolCall`
- `prepareNextTurn`
- `shouldStopAfterTurn`

Neuro Book 应借鉴这些点，但放在自己的 session/profile 语义上。

### 5. Hook Reducer

PI 的 hooks 设计倾向：

- event 自带 result type。
- observational hook 和 mutation hook 分开。
- result-producing hooks 由 reducer 顺序合并。
- hook context 是 facade，不暴露 raw internals。

Neuro Book 应借鉴：

- hook slot 有明确 result reducer。
- 例如 context transform 是顺序变换，tool call 是 early block，tool result 是 patch accumulation，turn settlement 是 write plan 合并。
- 不允许 hook 自己 append session。

## Redesign Decision

采用 **Neuro Run Kernel + Turn Transaction + Built-in Hooks**。

不再把文档设计成 20 个一等 pipeline stage。核心 pipeline 只保留少量事务边界；功能通过内置 hook 表达。细节可以拆成内部函数和测试点，但不都成为外部 hook slot。

在 Run Kernel 外侧保留一个很薄的 **Invocation Coordinator**。它不是 pipeline stage，而是入口调度器，负责那些“可能根本不会开始一次 run”的请求：

- active invocation lock。
- `prompt` / `continue` / `steer` / `followup` 的入口分流。
- running 时把 `steer` / `followup` 入队并立即返回。
- inactive 时拒绝 `steer` / `followup`。
- abort controller 和 active invocation runtime state。
- run 完成后启动下一条 follow-up。

这样 Run Kernel 只处理已经被接受、确实要执行的 invocation。否则 `enterRun` 会同时承担 admission、queue、abort、lifecycle、frame 创建，边界会再次变胖。

```text
Invocation Coordinator
  -> admit or enqueue request
  -> start Run Kernel for accepted runs
  -> release active lock / dispatch queued follow-up

Run Kernel
  -> enterRun
  -> prepareRun
  -> runTurns
  -> settleRun
  -> cleanup

Turn Transaction
  -> prepareTurn
  -> executeTurn
  -> ingestTurn
  -> savePoint
```

其中：

- `enterRun` 只打开已经被 coordinator 接受的 run：写 lifecycle start、创建 abort-aware `RunFrame`、读取初始 session snapshot。
- `prepareRun` 合并 session hydrate、profile prepare、pre-turn write plan 编译。
- `prepareTurn` 合并 queue drain、context build、context transform、turn snapshot 创建。
- `executeTurn` 合并 provider call 和 tool batch；provider/tool 细粒度 hook 后续作为它的子扩展点。
- `ingestTurn` 是每个 ReAct turn 后的核心控制点：决定本轮 assistant/toolResult 进入 runtime、session、projection，还是只用于下一轮 context。
- `settleRun` 只处理整个 run 的最终结果、session update/projection、后台任务触发和 lifecycle close。
- `cleanup` 释放 runtime state，让 coordinator 可以启动 queued follow-up。
- `SessionWriteExecutor` 不是独立 stage，而是各个安全点调用的服务：`prepareRun` 写 pre-turn plans，`ingestTurn` 写 turn plans，`settleRun` 写最终 plans，`cleanup` flush 剩余 pending plans。

这样牺牲一部分首发细粒度 hook，但显著降低实现复杂度。后续如果某个内部点真的需要开放，再从对应事务边界里拆出来。

### Complexity Reduction Tradeoffs

为了降低首发复杂度，做这些取舍：

- 不把 route、operation gate、lifecycle start、frame 创建拆成多个公开 stage；统一放进 `enterRun`。
- active invocation gate、`steer` / `followup` 入队、abort 这类入口调度放在 Invocation Coordinator，不进入 hook runtime。
- 不把 session hydrate、profile prepare、pre-turn writes 拆成多个公开 stage；统一放进 `prepareRun`。
- 不把 queue drain、context build、context transform、model/tool snapshot 拆成多个公开 stage；统一放进 `prepareTurn`。
- 不把 provider call 和 tool batch 拆成首发公开 hook；统一放进 `executeTurn`，等 provider payload 或 tool gate 真需要扩展时再拆。
- 不把 turn persistence 称为 `settleTurn`；统一叫 `ingestTurn`，强调它是“吸收本轮 turn 输出”的策略点。
- 不把 `flushWrites` 做成独立 pipeline stage；写入执行器是服务，在安全点被调用。
- 不在第一阶段实现完整 semi-durable pending writes；先由 `SessionWriteExecutor` 保证当前进程内顺序，恢复能力后续再补。
- 第一阶段开放 `defineAgentRuntime({ hooks })`，但 hook 必须绑定到固定事务边界，避免让 profile 作者面对完整 kernel 内部状态。

代价：

- 首发无法在 provider/tool 的每个细点上自定义行为。
- 某些内置 hook 的事件对象会稍大，因为多个内部步骤合并在一个事务边界中。
- 如果后续确实需要 provider payload inspection、tool argument mutation、tool result patch，需要从 `executeTurn` 里拆子 hook。

收益：

- kernel 心智更小，只有 run 和 turn 两层。
- summarizer、compact、普通 persistence 都能用同一套 turn ingest / runtime hook 语义表达。
- 实现顺序更直接：先统一写入和 turn ingest，再逐步开放更细 hook。

## Current Harness Capability Audit

当前 `NeuroAgentHarness` 里有几类能力会影响新 pipeline 设计。

### Invocation Admission

现状：

- `invokeAgent()` 直接检查 `activeInvocations`。
- session 正在运行时，`steer` 会进入 `steerQueues`，`prompt` / `followup` 会进入 `followUpQueues`。
- 没有 active invocation 时，`steer` / `followup` 直接拒绝。
- 真正开始 run 后才写 `invocation_lifecycle:start`，设置 `activeInvocations`、`steerableSessions`、`abortControllers`。

新架构落位：

- 这部分放在 **Invocation Coordinator**，不放在 hook slot。
- Coordinator 可以返回三种结果：`started`、`queued`、`rejected`。
- 只有 `started` 才进入 Run Kernel。

理由：

- `steer` / running `followup` 入队不是一次完整 run。
- 如果把它塞进 `enterRun`，`enterRun` 会不得不支持“创建了 invocationId 但没有 RunFrame”的半状态。

### Approval / User Input Waiting

现状：

- `runToolBatch()` 遇到 approval tool 时把它当 batch barrier。
- approval tool 之前的 tool result 保留。
- approval tool 之后的 tool call 生成 skipped tool result，避免 turn 中出现悬空普通 tool call。
- `commitTurn()` 允许唯一一个未闭合 approval tool call，其他未闭合 tool call 拒绝落盘。
- `finalizeInvokeResult()` 把 active invocation 标成 `waiting`，不执行后续完成态处理。
- `continue + resolution` 会先 `appendResolution()` 写 approval tool result，再调用 `prepare()`，保证 tool call / tool result 邻接性不被 appending message 打断。

新架构落位：

- `executeTurn`：approval tool 是 tool batch 的内置 barrier rule。
- `ingestTurn`：落 assistant、已完成 tool result、skipped tool result；允许单个 pending approval。
- `settleRun`：如果 `RuntimeTurn.waiting` 存在，run 结果是 `waiting`，active invocation 保持 waiting，不触发 summarizer / follow-up drain。
- `prepareRun`：处理 `continue + resolution` 的第一件事必须是写 resolution tool result，然后刷新 snapshot，再执行 profile prepare 和 pre-turn writes。

关键约束：

- resolution write 必须早于 `profile.prepare()` 产生的 `appendingMessages`。
- waiting run 不能触发 summarizer，也不能 drain follow-up。
- snapshot 的 `pendingApproval` 仍然由 session active path 推导，不应从 runtime map 人工拼出来。
- resume 不创建新的用户可见 invocation；它只是同一 active invocation 从 `waiting` 转回 `running`。

### Recovery / Resume

这里有两种“恢复”，需要分开。

第一种是 approval resume：

- 用户提交 resolution 后，`continue` 从同一个 session 继续跑。
- 这是 Run Kernel 的正常输入，属于 `prepareRun` 的 resolution restore。

第二种是 UI / SSE recovery：

- `AgentSessionEventHub` 维护 bounded replay 和全局 seq。
- replay buffer 不够时只给落后的 subscriber 发送 `snapshot_required`。
- 前端收到 `session_state_changed.snapshot` 或 `snapshot_required` 后以 `getSessionSnapshot()` 的结果作为真相。

新架构落位：

- approval resume 在 `prepareRun`，并复用同一个 logical `invocationId` 写入 `resumed` lifecycle。
- UI recovery 不进入 Run Kernel stage；它属于 SessionLog + EventHub + Snapshot projection。
- `SessionWriteExecutor` 每次落盘后负责 publish entry/state，保证 snapshot 永远可以恢复 UI。

关键约束：

- event stream 是增量优化，snapshot 是恢复真相。
- pipeline hook 不能直接 publish event；只能返回 write plan，由 executor 统一 publish。

### Invocation Identity For Waiting / Resume

推荐合同：approval / user-input waiting 和后续 resume 使用同一个用户可见的 logical `invocationId`。

原因：

- 对用户和前端来说，waiting 不是一次 run 结束，而是同一次 run 暂停在“等待外部输入”的状态。
- 同一个 `invocationId` 可以表达清楚的生命周期：`start -> waiting -> resumed -> end/error/aborted`。
- pending approval、active invocation、abort、queued steer 都可以继续挂在同一个逻辑运行上，不需要把“恢复”伪装成新 run。
- follow-up 才是新的用户轮次，所以 follow-up 应该拿新的 `invocationId`。

技术上仍可增加内部 `attemptId` / `resumeId`：

- `invocationId`：用户可见的逻辑运行身份，跨 waiting/resume 不变。
- `attemptId`：一次实际执行片段，例如初始 provider request、approval resolution 后的 resume provider request、失败重试。它服务日志、trace、metrics，不作为 session active invocation 身份。

因此 resume 的 lifecycle write 应该是：

```text
invocation_lifecycle { invocationId, status: "waiting" }
invocation_lifecycle { invocationId, status: "resumed", attemptId? }
invocation_lifecycle { invocationId, status: "end" }
```

不要把 approval resume 建模为“新 invocation link 到旧 invocation”。那样日志上看似简单，但 UI 会把一次暂停恢复切成两段，abort/follow-up/steer/pending approval 也会变成跨 invocation 协议，心智负担更高。

### Steer

现状：

- 只有 active 且 steerable 的 session 接受 `steer`。
- `steer` 入 `steerQueues` 后立即返回 queued。
- `runLoop()` 在每个模型请求前 drain steer，写成 `origin: "harness"` 的 user message。
- steer 文本被包装为 `<user_steer>...</user_steer>`，前端 projection 再识别为“引导”。
- 当前实现也会在 tool batch 后再 drain 一次 steer，用来决定是否继续下一轮。

新架构落位：

- 入队：Invocation Coordinator。
- 消费：`prepareTurn` 的 Queue Hook。
- 持久化：Queue Hook 返回 write plan，写入 `origin: "harness"` user message。
- 是否继续：`shouldStop` 或 `prepareNextTurn` 检查 queue 是否还有 steer；有则继续下一轮，由下一轮 `prepareTurn` drain。

建议调整：

- 不需要保留“tool batch 后立刻 drain steer”作为独立 stage。
- 更简单的语义是：每轮只在 `prepareTurn` drain；turn 结束时只检查 queue 是否非空来决定是否开下一轮。

### Follow-Up

现状：

- running 时新的 `prompt` / `followup` 被放入 `followUpQueues`。
- 当前 run 非 waiting 结束后，`finishInvocation()` 释放 active lock，然后 `drainFollowUps()` 用下一条 queued message 启动新的 `prompt` invocation。
- follow-up 是新的用户轮次，不是当前 ReAct turn 的中途 steer。

新架构落位：

- 入队：Invocation Coordinator。
- 启动下一条：Coordinator 在 Run Kernel `cleanup` 释放 active lock 后调度。
- 具体执行仍然是一条新的 Run Kernel invocation，mode 可以规范化成 `prompt`。

关键约束：

- follow-up 不应该进入当前 run 的 `prepareTurn`。
- waiting 状态不应自动 drain follow-up；必须先完成 pending approval / user input。

### Abort

现状：

- `abortInvocation()` 不进入 `invokeAgent()`；它直接改 active status、触发 AbortController、可清空 steer/followUp queue、publish `invocation_aborted` 和 snapshot。
- provider/tool 通过 AbortSignal 尽量停止。
- run catch/finalize 会写 lifecycle `aborted` 或 `error` 并 cleanup。

新架构落位：

- abort request 由 Invocation Coordinator 处理。
- AbortSignal 作为 RunFrame 的 runtime resource 传给 `executeTurn`。
- `cleanup` 统一释放 active invocation、queue、abort controller、variable patch 等运行态。

关键约束：

- abort 是外部控制面，不是 profile hook。
- hook 可以看到 `abortSignal.aborted` 的结果，但不负责发起 abort。

### Report Result Reminder

现状：

- 如果 profile 允许 `report_result` 但 run 没有拿到 `reportResult`，`finalizeInvokeResult()` 会写一条 harness reminder user message，然后再跑一次 `runLoop()`。
- summarizer 迁移后，这条 reminder 不能落进 summarizer session 历史。

新架构落位：

- `shouldStop` 的 Report Result Hook 判断是否缺少必需的 `report_result`。
- 如果必须 retry，`shouldStop` 返回 `continue`，`prepareNextTurn` 注入一条 reminder message。
- reminder retry 表现为同一个 run 内的下一次 Turn Transaction，而不是递归调用一套旧 `runLoop()`，也不是 `settleRun` 里的补救逻辑。
- reminder 是否持久化由 `ingestTurn` 决定：普通 profile 可持久化，summarizer runtime-only。

关键约束：

- reminder retry 仍然要遵守同一个 Turn Transaction：`prepareTurn -> executeTurn -> ingestTurn -> savePoint`。
- `settleRun` 只看最终结果，不负责重新开启模型请求。

### Session Commands / Tree Control

现状：

- `runCommand()` 支持 `new`、`fork`、`retry`、`tree`、`plan`、`model`、`thinking`、`summarize`、`archive`、`compact`。
- 除 `compact` 外，大多数命令要求 session idle。
- `moveTree()` 支持切换 active leaf 到 `empty` / `at` / `before`，并可在树移动后立即发起 `next.invoke`。
- `summarize` 只触发后台 summarizer，不作为普通用户消息进入模型。
- `compact` 以单独 active invocation 运行，但不是普通 ReAct run。

新架构落位：

- 这些属于 **Session Control Plane**，不属于 Run Kernel hook。
- `new` / `fork` / `archive` / `model` / `thinking` / `plan` / tree move 通过 `SessionWriteExecutor` 写 session entry 并发布 snapshot。
- `retry` 是 tree leaf move，不启动模型。
- `moveTree(... next.invoke)` 在 tree 写入完成后交给 Invocation Coordinator 启动一次正常 `prompt` / `continue` run。
- `compact` 可以作为 `operation="compact"` 的特殊 coordinator operation，复用 Compact Hook / compaction service，但不需要伪装成普通 ReAct turn。
- `summarize` 触发 Summarizer Coordinator，后者启动 internal run。

关键约束：

- command 不应该被塞进 `prepareRun`；否则每个 command 都会污染模型 invocation 的生命周期。
- tree move 后的 `next.invoke` 目前不是原子事务；新架构第一阶段可以保持现状，后续若要修复，应在 Session Control Plane 做 tree + run admission 的 transaction，不需要新增 Run Kernel stage。

### Session Snapshot / Projection / Event Recovery

现状：

- `getSessionSnapshot()` 是前端恢复真相，包含 summary、messages、tree、entries、linked agents、pending approval、queues、active invocation、model/thinking、plan mode、summarizer 状态和 `lastSeq`。
- `AgentSessionEventHub` 提供 bounded replay；replay 不足时发送 `snapshot_required`。
- `publishSessionEntry()` 和 `publishSessionState()` 分散在 harness 多处。
- projection entry 用于 session title/summary 等展示状态，不应该移动 active leaf，也不应该污染 tree。
- path-scoped projection 需要绑定 source active leaf；reduce 时只应用与当前 active path 匹配的 projection，保证 title/summary 这类 active-path-specific 元数据能随 rollback/tree 切换一起变化。

新架构落位：

- snapshot / event recovery 仍属于 SessionLog + EventHub，不进入 Run Kernel stage。
- `SessionWriteExecutor` 是唯一发布入口：写入 entry 后统一决定 publish `session_entry`、`session_state_changed.snapshot` 或静默。
- projection write 是 `SessionWritePlan.projectionEntries`，由 executor 保证不进入 tree，不移动 active leaf。
- Run Kernel 只通过 write plan 间接影响 snapshot；hook 不直接 publish event。

关键约束：

- event 是增量优化，snapshot 是恢复真相。
- 新架构要把“写 repo + publish entry + publish state”的重复代码集中到 executor，否则 hook 化后会更难排查前端恢复问题。

### Linked Agents / Sub-Agent Tools

现状：

- `create_agent` tool 调 `harness.createAgent()` 创建 child session，并在 owner session 写 `agent.link.${sessionId}` custom entry。
- `invoke_agent` tool 调 `harness.invokeAgent()`，目标 session 运行一条独立 invocation；tool result 只保存目标 agent 的摘要结果，不保存完整 events。
- `get_agent` / `get_session` 读取 session summary、summary、recent messages、linked agents。
- `detach_agent` 写 `agent.detach.${sessionId}` custom entry，不删除 child session。
- summarizer system session 不走 linked-agent 路径。

新架构落位：

- child session 创建、link/detach、查询属于 Session Control Plane / SessionLog。
- `invoke_agent` 在 `executeTurn` 的 tool execution 中调用 Invocation Coordinator；目标 session 进入自己的 Run Kernel，和当前 parent run 是两个独立 run。
- parent run 等待 `invoke_agent` tool result；目标 run 的 session 写入和 event 发布走目标 session 自己的 executor/event hub。
- summarizer 继续作为 hidden system session，由 Summarizer Coordinator 创建，不写 `agent.link.*`。

关键约束：

- `invoke_agent` 不能调用当前 session 自己，避免自递归 lock。
- 目标 session 如果正在 active，应由 Invocation Coordinator 统一决定 queued / rejected / started，而不是 tool 自己绕过 active lock。
- 跨 session 依赖仍先通过 profile input / ctx 表达，不引入 `RuntimeBinding`。

### Profile Prepare / DSL / Variables

现状：

- profile `prepare()` / TSX DSL 生成 `ProfileTurnPlan`。
- `HistorySet` 只在空 active path 首次写入。
- `AppendingSet` / `modelContextAppendingMessages` / `stateWrites` 在 ReAct 前写入 session。
- `ModelContext` 的普通 message 只进本轮 provider context，不写 session。
- `ctx.vars` 可读写变量；`client.*` patch 会请求前端 ack，并在 ack 后写 `client_variable_patch_ack` entry。
- invocation 结束时会清理 `invocationClientStates`、`invocationVariableStates` 和未完成 client patch。

新架构落位：

- profile prepare 属于 `prepareRun`。
- `ProfileTurnPlan` 只编译成 write plan 和 frame 上的 model-only context，不直接写 repo。
- prompt 模式下的 pending user message 仍在 `profile.prepare()` 后写入，这保留当前“profile appending 先展示，真实用户消息随后展示”的 UI 顺序。
- variable accessor 挂在 `RunFrame` / ToolExecutionContext 上；它产生的 session writes 必须进入 executor。
- client variable patch request 是 EventHub 控制事件；ack 写入由 Session Control Plane 或 Tool Session Write Sink 统一落盘。

关键约束：

- `prepareRun` 的内部顺序不能被 hook reducer 打乱。
- `stateWrites` 仍只允许写 `profileState.${profileKey}`，否则 profile prepare 会变成任意 session mutation 入口。
- `dryRun` prepare 用于 preview / snapshot system prompt，不应创建 write plan。

### Tool Execution / Tool-Side Session Writes

现状：

- `executeTool()` 给工具传 `ToolExecutionContext`，包含 harness、sessionId、workspaceRoot、workspaceKey、projectPath、invocationId、vars。
- `task_tools`、plot tools、变量工具等会在工具执行期间写 session custom state 或变量 entry。
- file/bash/sql 等工具有外部副作用或长输出；tool execution events 会实时广播。
- `commitTurn()` 只负责 assistant/toolResult transcript，不知道工具执行期间已经写过的 custom state。

新架构落位：

- provider call 和 tool batch 仍在 `executeTurn`。
- 工具参数校验、approval barrier、report_result 捕获都在 `executeTurn` 的内部规则。
- 工具侧 session 写入不直接调用 repo；通过 `ToolSessionWriteSink` 或 `SessionFacade` 生成 `SessionWritePlan`，再交给 `SessionWriteExecutor`。
- tool-side writes 必须显式声明 durability：
  - `immediate`：progress/task/client ack 等实时状态，可在工具执行期间立即 flush，可接受服务崩溃后没有对应 assistant/toolResult transcript。
  - `savePoint`：必须和本轮 assistant/toolResult transcript 一起提交的写入，只能进入 `RunFrame.pendingWrites`，在 save point flush。
- 第一阶段只允许工具默认写 `immediate`；需要强一致性的工具必须显式选择 `savePoint`。
- `ingestTurn` 只处理本轮 transcript 如何吸收；不负责重放或改写工具已经产生的 side writes。

关键约束：

- transcript 写入仍在 `ingestTurn` / save point，避免普通 assistant/toolResult 半提交。
- tool-side custom state 是独立 session fact，可以在 tool 执行中间出现；这类 entry 不应插入 assistant/toolResult batch 内部。
- abort/cleanup 必须 reject 未完成的 client patch ack，避免悬挂 Promise。
- executor 必须在事件里保留 `cause.invocationId` / `cause.toolCallId`，让前端和诊断工具能把 side write 关联回对应工具。

### Model / Thinking / Provider Config

现状：

- session 可通过 `model_change` 覆盖模型，通过 `thinking_level_change` 覆盖 reasoning。
- 运行时从 effective config、session context、profile 默认值一起解析 model / apiKey / provider options / thinking。
- `TurnSnapshot` 尚未显式存在，当前这些值散落在 `invokeAgent()` 和 `runLoop()` 参数里。

新架构落位：

- `prepareTurn` 创建 `TurnSnapshot` 时冻结 model、apiKey、requestOptions、thinkingLevel 和 tools。
- `model` / `thinking` command 是 Session Control Plane 写入，不影响已经开始的 provider request，只影响下一次 `prepareTurn`。
- 如果 run 中途外部改变 session model/thinking，当前 turn 不变；下一 turn 是否刷新由 `prepareNextTurn` 决定。

关键约束：

- provider streaming 开始后不能读 mutable session config。
- snapshot 展示的 effective thinking 应复用同一套解析规则，避免 UI 和真实 run 不一致。

### Plan Mode

现状：

- `enter_plan_mode` / `exit_plan_mode` 是 approval tools。
- approval resolution 时 `appendPlanModeResolution()` 写 `ui.planMode.active` 和 `AGENT_PLAN_MODE_STATE_KEY`。
- UI 也可以通过 `plan` command 直接切换 plan mode state。
- `exit_plan_mode` 可以携带 `planFilePath`，pending approval DTO 会读取文件内容给前端预览。

新架构落位：

- tool 触发的 plan mode suspend 走 Approval Hook：`executeTurn` barrier，`ingestTurn` 允许 pending approval，`settleRun` 返回 waiting。
- resolution restore 在 `prepareRun` 最早执行，先写 toolResult，再写 plan mode custom state，再进入 profile prepare。
- UI `plan` command 留在 Session Control Plane。
- pending approval DTO 仍由 snapshot projection 从 active path 推导。

关键约束：

- plan mode resolution 的 state write 必须与 approval toolResult 邻近发生，不能被 `AppendingSet` 插到中间。
- waiting run 不触发 summarizer 或 follow-up drain。

### Manual Compaction

现状：

- 自动 compaction 在普通 invocation 进入 ReAct loop 前运行。
- `/compact` command 单独启动 active invocation，读取当前 profile compaction 配置后写 compaction entry。
- compact run 只写 lifecycle，不跑普通 assistant/toolResult turn。

新架构落位：

- 自动 compaction 是 Compact Hook，第一版直接在 save point / `prepareNextTurn` 生效。
- 手动 compact 是 Session Control Plane 启动的 `operation="compact"`，复用 compaction service 和 `SessionWriteExecutor`。
- 手动 compact 不需要进入 `runTurns`，也不需要创建 `RuntimeTurn`。

关键约束：

- compact entry 是 SessionLog 事实，后续 Runtime Context Hook 从 reduce 后的 context 重建 provider messages。
- summarizer 不 compact 自己，只读取 source session 已 compact 后的 Agent Dialogue Content。

## Agent System Capability Inventory

当前项目 Agent 系统需要覆盖的能力可以分成四层。

**Session Control Plane**

- 创建普通 session、创建 hidden system session、列 session、读 snapshot。
- session command：new、fork、retry、tree、plan、model、thinking、summarize、archive、compact。
- tree / branch active leaf 切换，以及 tree move 后的 next invoke。
- linked agent link/detach/query，system session 默认隐藏。
- snapshot projection、event replay、snapshot_required 恢复。

**Invocation Coordinator**

- active invocation lock。
- prompt / continue / internal / compact operation 的 admission。
- running 时接收 steer / follow-up queue。
- inactive 时拒绝 steer / follow-up。
- abort controller、active invocation state、queue cleanup。
- run 完成后按规则 drain follow-up。
- background summarizer latest-only/coalesced 调度；所有声明了 `summarizer` 的 profile 都可启用，不限定特定 source profile。
- summarizer ModelContext 每次由 summarizer system prompt 和 source Agent Dialogue Content 重建；AppendingSet 为空，summarizer 自身 assistant/toolResult transcript 不落盘也不进入下一轮上下文。

**Run Kernel / Turn Transaction**

- lifecycle start/end/error/aborted。
- approval resolution restore。
- profile prepare、pre-turn writes、pending prompt write。
- model/tool/thinking/provider option snapshot。
- runtime context build、compaction、steer drain。
- provider streaming、tool batch、approval barrier、report_result 捕获。
- turn-level ingest、save point、prepare next turn、should stop。
- report_result reminder retry、summarizer settle。

**Tool / Variable Runtime**

- tool 参数校验和 per-profile allowed tool 集合。
- tool context 里的 workspaceRoot / projectPath / sessionId / invocationId。
- tool-side session custom state writes。
- variable read/patch/read-before-patch fingerprints。
- client.* variable patch request / ack / timeout cleanup。
- external side effects：文件、bash、SQL、workspace 数据修改。

## Capability Fit Matrix

| 能力 | 新架构归属 | Stage / Hook | 好实现吗 | 备注 |
| --- | --- | --- | --- | --- |
| prompt / continue invocation | Invocation Coordinator + Run Kernel | coordinator -> `enterRun` -> `prepareRun` | 是 | `enterRun` 只处理已 accepted run。 |
| running prompt/follow-up 入队 | Invocation Coordinator | coordinator queue | 是 | 不进入 Run Kernel。 |
| steer | Coordinator + Queue Hook | enqueue；`prepareTurn` drain | 是 | 建议每轮只在 `prepareTurn` drain，turn 末只检查是否需要下一轮。 |
| follow-up | Invocation Coordinator | cleanup 后 drain | 是 | 新 invocation，不是当前 turn context。 |
| abort | Invocation Coordinator + cleanup | abort signal；`cleanup` | 是 | 外部控制面，不是 profile hook。 |
| approval / request-user-input waiting | Approval Hook | `executeTurn` barrier；`ingestTurn`；`settleRun`；`prepareRun` restore | 是 | 要保护 resolution toolResult 先于 appending writes。 |
| report_result schema | Report Result Hook | `prepareTurn` tool snapshot | 是 | 由 profile OutputSchema 动态派生。 |
| report_result reminder | Report Result Hook | `shouldStop` -> `prepareNextTurn` | 中 | 缺 report_result 时同一 run 内追加 turn，`settleRun` 不重开模型请求。 |
| 普通 assistant/toolResult 持久化 | Turn Ingest Hook | `ingestTurn` + save point | 是 | 当前 `commitTurn()` 迁移为默认 ingest。 |
| summarizer runtime-only transcript | Profile Runtime Hooks | `prepareTurn` / `ingestTurn` / `settleRun` | 是 | summarizer 是 hook 组合的第一目标，不是 kernel 特例。 |
| profile.prepare / DSL writes | Default Persistence Hook | `prepareRun` | 是 | 转 write plan，不直接 append。 |
| automatic compaction | Compact Hook | save point；`prepareNextTurn` | 中 | 本次硬切直接使用新时机，避免继续携带旧 pre-loop 语义。 |
| manual compact command | Session Control Plane | `operation="compact"` + compaction service | 是 | 不需要普通 ReAct turn。 |
| tree / branch / retry / fork | Session Control Plane | session write executor | 是 | `next.invoke` 交 coordinator；原子性后续补。 |
| model / thinking command | Session Control Plane + TurnSnapshot | command writes；下一次 `prepareTurn` 生效 | 是 | 当前 provider request 不受影响。 |
| plan mode UI command | Session Control Plane | command writes | 是 | 与 tool approval plan mode 共享 state key。 |
| linked agent create/detach | Session Control Plane | link/detach custom entries | 是 | summarizer 不走 linked agent。 |
| invoke_agent tool | Tool execution + Coordinator | `executeTurn` calls coordinator | 中 | 需要避免 self-invoke 和目标 active lock 绕过。 |
| get_agent / get_session tool | Session facade | tool read facade | 是 | 只读，不进 pipeline。 |
| tool-side custom state writes | Tool Session Write Sink | inside `executeTurn` via executor | 中 | 需要保留实时 UI，同时避免绕过统一写入。 |
| variable read/patch | Tool/runtime variable accessor | `prepareRun` / `executeTurn` | 中 | invocation-scoped state 放 RunFrame，cleanup 必须清理。 |
| client variable patch ack | Session Control Plane + Tool runtime | event request；ack write | 中 | 不是 ReAct stage，但必须关联 invocation/toolCall。 |
| SSE replay / snapshot recovery | EventHub + SessionLog | executor publish | 是 | 不进 hook；snapshot 是真相。 |
| session title/summary summarizer | Summarizer Coordinator + internal Run Kernel | source invocation completed 后 trigger | 是 | 所有 profile 可启用；失败隔离，不影响 source result。 |

## Pipeline Stage Review

这次审查后，当前新架构不需要推翻。更准确的分层应该是：

```text
Session Control Plane
  - create/list/snapshot/commands/tree/link/detach/ack
  - all writes go through SessionWriteExecutor

Invocation Coordinator
  - admit/enqueue/reject/abort
  - owns active invocation and queues
  - starts Run Kernel only for accepted runs

Run Kernel
  - enterRun
  - prepareRun
  - runTurns
  - settleRun
  - cleanup

Turn Transaction
  - prepareTurn
  - executeTurn
  - ingestTurn
  - savePoint
  - prepareNextTurn / shouldStop
```

不建议新增一堆 pipeline stage。需要补的是两个“非 stage”服务：

- `SessionWriteExecutor`：统一 session writes、projection writes、lifecycle writes、publish entry/state。
- `ToolSessionWriteSink`：工具执行期间的 session writes 入口，内部仍使用 `SessionWriteExecutor`。

为什么不新增 stage：

- command/tree/list/snapshot/link 不是模型运行，不应进入 Run Kernel。
- follow-up admission 可能根本不开始 run，不应进入 `enterRun`。
- tool-side writes 是工具副作用的一部分，不是 assistant/toolResult transcript ingest。
- snapshot recovery 是事件/投影层能力，不是 run lifecycle。

未来可能拆出的子 hook：

- `beforeModelCall` / `afterModelCall`：当需要 provider payload inspection、cache hint、request mutation 时再拆。
- `beforeToolCall` / `afterToolCall`：当需要 tool gate、tool arg patch、tool result patch 时再拆。
- `transformModelContext`：当 runtime hooks 需要多个 context transform 组合时再拆。

第一阶段保持少量 stage 更稳：先把写入统一、RunFrame/TurnSnapshot 明确、turn-level ingest 跑通，再扩展细粒度 hook。

## Stage Fit Decision

审查现有能力后，当前设计不需要推翻，但需要三个边界收紧。

### 1. Coordinator Is Outside Kernel

`activeInvocations`、`steerQueues`、`followUpQueues`、`abortControllers` 这些状态属于 invocation admission / scheduling，不属于 ReAct runtime。

因此：

- 不新增 `admitRun` 作为 Run Kernel stage。
- 增加外侧 Invocation Coordinator 概念。
- `enterRun` 只服务已经 accepted 的 run。

### 2. `prepareRun` Has A Strict Internal Order

`prepareRun` 不是一个无序的大 prepare。它内部必须固定顺序：

```text
hydrate session
  -> if continue resolution: append resolution toolResult
  -> refresh session snapshot
  -> profile.prepare()
  -> compile pre-turn write plans
  -> flush pre-turn writes
  -> refresh projection for first turn
```

这个顺序主要保护 approval resume 的 tool call / tool result 邻接性。

### 3. Turn Queue Belongs To `prepareTurn`

`steer` 是当前 run 的中途引导，所以在 turn 边界消费。

`followup` 是下一次 invocation，所以不进入 turn pipeline。

这条分界能避免 Queue Hook 同时处理两种完全不同的语义。

## Runtime Objects

### SessionLog

`SessionLog` 是持久事实层，当前对应 `JsonlSessionRepository`。

职责：

- 保存 append-only entries。
- 保存 active leaf。
- reduce active path + projection entries 成 session projection。
- 提供 snapshot/list/tree 视图。

非职责：

- 不决定 provider context。
- 不决定 turn 是否落盘。
- 不知道某个 write plan 来自 compact、summarizer、ingest 还是 profile hook。

目标约束：

- 所有写入经过 `SessionWriteExecutor`。
- projection entry 只参与 projection/reduce，不污染 tree 展示和 active branch。
- 业务层不再散落调用 `appendEntry()` / `appendProjectionEntry()`。

### RunFrame

`RunFrame` 表示一次 invocation 的运行态。它只描述“这次运行是谁、用哪个 profile、当前有哪些运行材料”，不把 summarizer 这类业务关系硬编码成顶层字段。

```ts
type RunFrame = {
    invocationId: string;
    sessionId: number;
    mode: "prompt" | "continue" | "internal" | "compact";
    operation?: string;
    snapshot: SessionSnapshot;
    projection: NeuroSessionContext;
    profile: AgentProfile;
    profileInput: JsonValue;
    prepared?: ProfileTurnPlan;
    runtimeMessages: AgentMessage[];
    pendingWrites: SessionWritePlan[];
    runtimeState: JsonObject;
    turnIndex: number;
};
```

核心意义：

- session history 是输入，不等于当前 loop 内存。
- assistant/toolResult 可以只进入 `runtimeMessages`，不进入 session。
- profile 可以通过 hook 组合选择 runtime-only transcript 行为：它有自己的 session 和初始化历史，但不把运行中的 assistant/toolResult transcript 写进 session history。
- summarizer 依赖哪个 source session 由 `defineAgentProfile.summarizer` 初始化 input 表达，harness 注入 `sourceSessionId`，summarizer profile 再通过 ctx/input 读取源 session。kernel 不需要额外的 `RuntimeBinding` 抽象。
- `internalQueued` 这类 bypass boolean 不进入新架构。internal run、summarizer run、tree next invoke、manual compact 都由 Invocation Coordinator 以明确 mode/operation 创建 RunFrame。
- queue、transcript persistence、compact、report_result required 这类行为不再作为 RunFrame boolean flags；它们由 runtime hook bundle 决定。

### TurnSnapshot

`TurnSnapshot` 是一次 provider request 的冻结快照。

```ts
type TurnSnapshot = {
    index: number;
    systemPrompt: string;
    modelMessages: AgentMessage[];
    providerMessages: Message[];
    model: Model<any>;
    apiKey?: string;
    thinkingLevel: ThinkingLevel;
    tools: ReturnType<AgentToolRegistry["allowed"]>;
    requestOptions?: Record<string, JsonValue>;
};
```

约束：

- provider streaming 开始后，当前 `TurnSnapshot` 不再被修改。
- 运行中 config/profile/session/resource 的变化只能通过下一次 `createTurnSnapshot` 生效。
- `buildModelContext` / `transformModelContext` 在 provider request 前完成。

### RuntimeTurn

`RuntimeTurn` 是一次 ReAct turn 的结果对象。

```ts
type RuntimeTurn = {
    index: number;
    snapshot: TurnSnapshot;
    assistant?: AssistantMessage;
    toolCalls: AgentToolCall[];
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    waiting?: {
        toolCallId: string;
        toolName: string;
    };
};
```

它是 `ingestTurn`、`savePoint`、`prepareNextTurn`、`shouldStop` 的主要输入。

### SessionWritePlan

`SessionWritePlan` 是唯一的持久化申请单。

```ts
type SessionWritePlan = {
    target: {
        sessionId: number;
        workspaceKey?: string;
    };
    cause: {
        source:
            | "prompt"
            | "profile.prepare"
            | "turn.ingest"
            | "tool"
            | "command"
            | "compact"
            | "summarizer"
            | "lifecycle"
            | "variable";
        invocationId?: string;
        turnIndex?: number;
        toolCallId?: string;
    };
    atomicity?: "batch" | "entry";
    messages?: Array<{
        message: Message;
        origin?: "prompt" | "harness" | "manual" | "ingest";
    }>;
    entries?: SessionEntryDraft[];
    projectionEntries?: SessionEntryDraft[];
    projectionScope?: {
        kind: "global" | "active_path";
        sourceLeafId?: string | null;
    };
    lifecycle?: Array<{
        invocationId: string;
        attemptId?: string;
        status: "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted";
        error?: string;
        errorInfo?: InvocationErrorInfo;
    }>;
    publish?: "none" | "state" | "entry_and_state";
};
```

硬性约束：

- `target` 必填。write plan 不默认写当前 session；summarizer 写 source session、child agent 写 parent link、tool 写当前 session 都必须显式 target。
- `cause` 必填。所有 entry/event 都能追溯到 command、invocation、turn 或 tool call。
- `atomicity: "batch"` 表示 message transcript 或必须同批提交的 writes；executor 必须使用 batch append。
- `atomicity: "entry"` 表示 progress/custom state 等独立事实，可单条 append。
- 第一版同一个 session 内的 batch 采用“先整批校验，再按顺序 append，再统一 publish”的语义；不做 commit marker，不承诺进程崩溃级别的半批恢复。
- projection writes 只能通过 `projectionEntries` 表达，不能伪装成普通 entries。
- active-path-specific 元数据必须设置 `projectionScope.kind = "active_path"`，并绑定 `sourceLeafId`；executor/reducer 不得把它当成全局 projection。
- lifecycle status 硬切为 `start -> waiting/resumed* -> end/error/aborted/interrupted`。waiting 是持久状态，不再用重复 `start` 表示。
- waiting / resume 使用同一个 logical `invocationId`；如需区分实际执行片段，用可选 `attemptId`，不要创建用户可见的新 invocation。
- 普通 turn messages 能表达。
- projection writes 能表达。
- lifecycle writes 能表达。
- turn ingest/session_update 能表达。

## Hook Runtime

### Hook Object

首发 hook object 是带 `stage` / `name` / `run` 的插件对象。stage 只围绕 run 和 turn 的事务边界，不把 provider/tool 内部每个动作都提升成一等 pipeline stage：

```ts
type AgentRuntimeHook<TInput, TOutput> =
    | {stage: "prepareRun"; name: string; run(ctx: PrepareRunContext<TInput, TOutput>): MaybePromise<PrepareRunResult>}
    | {stage: "prepareTurn"; name: string; run(ctx: PrepareTurnContext<TInput, TOutput>): MaybePromise<PrepareTurnResult>}
    | {stage: "ingestTurn"; name: string; run(ctx: IngestTurnContext<TInput, TOutput>): MaybePromise<IngestTurnResult>}
    | {stage: "prepareNextTurn"; name: string; run(ctx: PrepareNextTurnContext<TInput, TOutput>): MaybePromise<PrepareNextTurnResult>}
    | {stage: "settleRun"; name: string; run(ctx: SettleRunContext<TInput, TOutput>): MaybePromise<SettleRunResult>};
```

第一阶段真正需要先落地的是：

- `prepareRun`
- `prepareTurn`
- `ingestTurn`
- `prepareNextTurn`
- `settleRun`

`shouldStop` 第一版是 Run Kernel 内置 reducer 点，不作为 profile hook 暴露。Report Result Hook 可以参与这个 reducer，但 profile 作者不直接实现 `shouldStop`。

后续再按真实需求拆出子 hook：

- `transformModelContext`
- `beforeModelCall`
- `afterModelCall`
- `beforeToolCall`
- `afterToolCall`

### Hook Result

Hook result 必须按 slot 定义窄类型，不使用一个可 patch 一切的通用结果。下面是概念形状：

```ts
type PrepareRunResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type PrepareTurnResult = {
    systemPrompt?: string;
    modelContext?: AgentMessage[];
    runtimeState?: JsonObject;
    turnSnapshotPatch?: Pick<Partial<TurnSnapshot>, "systemPrompt" | "modelMessages" | "tools" | "requestOptions">;
    writePlans?: SessionWritePlan[];
};

type IngestTurnResult = {
    transcript?: "persist" | "runtime_only" | "drop";
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type PrepareNextTurnResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type SettleRunResult = {
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};
```

Reducer 只能合并当前 slot 允许的字段。需要新能力时先扩展对应 slot result，而不是把 `runtimeState` / `turnSnapshotPatch` 放大成任意 patch。

### Reducer Rules

- `prepareRun`：合并 profile prepare 输出、pending prompt、resolution restore、pre-turn writes。
- `prepareTurn`：顺序构建本轮 `TurnSnapshot`，包括 queue drain、model context、tools、model/thinking。
- `ingestTurn`：默认 plan 可被系统 hook 替换；决定本轮 assistant/toolResult 如何进入 runtime/session/projection。
- `savePoint`：本轮 write plan 已落盘后的安全点，可刷新 snapshot/projection。
- `prepareNextTurn`：只为同一个 run 的下一轮准备材料，例如重建 context、更新 compact 后 projection、注入 report_result reminder；不启动 follow-up。
- `shouldStop`：Run Kernel 内置 reducer 根据 tool batch、waiting、report_result、steer queue 和 max loop 等信号判断当前 run 是否结束；缺必需 report_result 时返回 continue。
- `settleRun`：合并最终 session update/projection/lifecycle plans；waiting run 不执行 summarizer trigger 或 follow-up drain。

### Hook Context

Hook context 提供 facade，不暴露 raw repo：

```ts
type RuntimeHookContext = {
    session: SessionFacade;
    profiles: ProfileFacade;
    tools: ToolFacade;
    config: ConfigFacade;
    events: EventFacade;
};
```

`SessionFacade` 只允许：

- read persisted snapshot/projection。
- create `SessionWritePlan` draft。

它不提供：

- `appendEntry()` / `appendMessage()` / `appendProjectionEntry()`。
- `publish()`。
- `enqueueWritePlan()`。

Hook 只能返回 plan。只有 Run Kernel reducer 和 Session Control Plane 可以把 plan 交给 `SessionWriteExecutor`。

## Built-in Hooks

### Default Persistence Hook

普通 profile 默认启用。

职责：

- `prepareRun` 时将 pending prompt 写入 session。
- `prepareRun` 时将 `HistorySet` 首轮消息、`AppendingSet`、stateWrites 编译成 pre-turn write plan。
- `ingestTurn` 时写 assistant/toolResult。
- 保持现有 `origin` 语义：`prompt` / `harness` / `ingest`。

### Runtime Context Hook

普通 profile 默认启用。

职责：

- `prepareTurn` 时从当前 session active path reduce 出 `context.messages`。
- 追加 `prepared.modelContextMessages`。
- 过滤 provider 可见 message。
- 校验未闭合 tool call。

### Profile Runtime Hooks

普通 profile 和用户自定义 profile 都可以通过 `defineAgentRuntime({ hooks })` 在固定事务边界改写 context / transcript / settle 行为。summarizer 是第一批使用者，但不是 Run Kernel 特例。

职责：

- `prepareRun`：允许 profile 把 HistorySet 初始化、AppendingSet、stateWrites 编译成 write plan，或选择不使用默认 prepare 行为。
- `prepareTurn`：允许 profile 读取 `ctx.session.read(sourceSessionId)`，并通过 helper 从 source session 当前 active path 重建 Agent Dialogue Content。
- `ingestTurn`：允许 profile 决定 assistant/toolResult 只进入 runtime，还是写入当前 profile session。
- `prepareNextTurn`：如果还需要继续，允许 profile 重新读取 source session 并重建 ModelContext。
- `settleRun`：允许 profile 把 `report_result.data` 转成写往目标 session 的 projection/session_update plan。
- queue / compact / approval 能力由是否组合对应 built-in hook 决定。

summarizer 用这个通用机制表达：

- 不组合默认 transcript persistence hook，改用 runtime-only ingest：HistorySet 初始化后，assistant/toolResult 不再 append。
- ModelContext 每次由 summarizer system prompt + source Agent Dialogue Content 重建，AppendingSet 为空。
- `ingestTurn` runtime-only，只闭合 runtime turn，不写 summarizer session transcript。
- `settleRun` 把 title/summary 写回 source session projection。

硬性约束：

- summarizer 的 write plan `target` 必须是 source session，不能默认写 summarizer 自己。
- summarizer session 只保存实例 metadata、HistorySet 初始化内容和必要 custom state，不保存运行中的 assistant/toolResult transcript。
- source session 发生 branch/tree 切换或新 message 写入后，旧 source leaf 的 summarizer 输出不能覆盖新 active path 的 title/summary。

### Compact Hook

第一版直接放在 save point / `prepareNextTurn`，不保留旧 pre-loop 语义：

- 估算下一轮 context token。
- 超阈值时写 compaction entry。
- 重新 reduce session。
- 创建下一轮 `TurnSnapshot`。

summarizer 不跑自身 compact；它读取 source session compact 后的 Agent Dialogue Content。

### Queue Hook

职责：

- 在 `prepareTurn` 的 turn-safe 点 drain `steer` queue。
- drain 出来的 user message 通过 write plan 持久化，或按 profile 策略只进入 runtime。

默认策略：

- 普通 profile 开启外部 queue。
- summarizer/internal profile 禁用外部 queue。
- `followup` 不由 Queue Hook 消费；它是下一次 invocation，由 Invocation Coordinator 在当前 run cleanup 后调度。

### Approval Hook

职责：

- 处理 pending approval resolution。
- 生成恢复用 toolResult write plan。
- 默认 summarizer runtime 不组合 approval hook，因此不进入 approval suspend。

落位：

- `prepareRun` 处理 resolution restore。
- `executeTurn` 处理 approval batch barrier。
- `ingestTurn` 按 waiting 语义允许唯一 pending approval tool call。
- `settleRun` 把 run 标成 waiting，并跳过 summarizer / follow-up drain。
- resume 时仍使用原 logical `invocationId`；如需技术追踪，可给恢复后的执行片段分配新的 `attemptId`。

### Report Result Hook

职责：

- `report_result` schema 根据 profile `OutputSchema` 动态生成。
- 缺少 report_result 时通过 `shouldStop -> prepareNextTurn` 插入 reminder。
- reminder 是否持久化由当前 runtime 的 `ingestTurn` 结果决定。

summarizer 下 reminder 必须是 runtime-only。

### Turn Ingest Hook

新的 ingest 语义是 **turn-level ingest**，不是旧 ReAct Loop 结束后的统一后处理。

职责：

- 每个 ReAct turn 结束后运行一次。
- 输入是本轮 `RuntimeTurn`，包括 assistant、tool calls、toolResults、reportResult、waiting。
- 输出是：
  - 本轮哪些消息进入 runtime context。
  - 本轮哪些消息写入当前 profile session。
  - 本轮哪些结果写入 projection 或其他绑定 session。
  - 下一轮是否需要重建 context。
- 普通 profile 默认 ingest hook 持久化 assistant/toolResult。
- summarizer 的自定义 ingest hook 是 runtime-only transcript，只保留 runtime closure，不写自身 session。

### Coordinator Follow-Up Hook

这不是 Run Kernel hook，而是 Coordinator 内置策略。

职责：

- running 时把新的 `prompt` / `followup` 放入 follow-up queue。
- 当前 run completed/error/aborted 后，如果不是 waiting，则取下一条 follow-up 启动新的 Run Kernel。
- waiting run 不自动消费 follow-up。
- abort 时按请求决定是否清空 follow-up queue。

### Legacy Ingest Removal

旧 `profile.ingest()` 不保留兼容层。新架构硬切后：

- profile 作者不再实现 invocation-level `ingest()`。
- 普通 transcript 持久化由默认 Turn Ingest Hook 完成。
- title/summary 由普通 summarizer profile 通过 runtime hooks 完成。
- 需要额外 session update 的系统能力必须做成内置 hook、tool-side write 或明确的 profile runtime hook。

## Summarizer Flow

```text
source invocation completed
  -> background trigger
  -> ensure hidden summarizer session
  -> create internal RunFrame for summarizer profile
  -> runtime hooks keep transcript runtime-only after HistorySet initialization
  -> sourceSessionId comes from summarizer profile input
  -> buildModelContext from source session Agent Dialogue Content
  -> AppendingSet is empty
  -> provider sees summarizer system prompt + source dialogue content
  -> assistant calls report_result
  -> toolResult closes call in runtime
  -> ingestTurn skips summarizer transcript persistence
  -> settleRun rechecks source active leaf
  -> if unchanged, writes title/summary projection to source session
  -> if changed, marks dirty and skips stale write
```

关键语义：

- source profile / source invocation 对 summarizer 透明、无感。
- summarizer 有 session 身份，也可以有 HistorySet 初始化历史，但运行中的 assistant/toolResult 不 append 到 session。
- summarizer session 的 leaf 只会因 HistorySet 初始化等少数初始化写入移动；摘要运行本身不通过 transcript append 推进 leaf，所以表现近似一条固定初始化线。
- summarizer ModelContext 只由自身 system prompt 和 source Agent Dialogue Content 组成。
- source title/summary 写回 source session。
- branch/tree 切换后每次按当前 active path 重新构建 Agent Dialogue Content。
- 如果 Agent Dialogue Content 超过 summarizer 上限，跳过本次摘要并记录状态，不自动 compact summarizer。

## Implementation Plan

### Phase 1: Write Plan Foundation

- 引入 `SessionWritePlan` / `SessionWriteExecutor`。
- 引入 `ToolSessionWriteSink`，让工具执行期间的 custom state / variable writes 也经过 executor。
- 硬删 legacy `profile.ingest()` 调用路径，先迁移 `commitTurn()`、summary projection 写回和工具侧 session writes。
- 明确 projection entries 不进入 tree、不移动 active leaf。
- 验证：
  - 普通 turn assistant/toolResult 顺序不变。
  - projection 不污染 tree。
  - 旧 `profile.ingest()` 不再被调用。
  - task/plot/variable 这类工具侧状态写入仍能实时刷新 UI。
  - write plan 必须显式 target/cause，缺失时 executor 拒绝执行。

### Phase 2: RunFrame + TurnSnapshot

- 在 `invokeAgent()` 创建 `RunFrame`。
- 在每轮模型请求前创建 `TurnSnapshot`。
- `runLoop()` 改为操作 frame/turn，而不是散落参数。
- 验证：
  - steer/followUp 不回归。
  - approval waiting 不回归。
  - report_result 不回归。

### Phase 3: Built-in Hook Runtime

- 实现最小 hook runner 和 reducer。
- 首发注册内置 hooks，并开放固定事务边界的 `defineAgentRuntime({ hooks })`；不开放任意 provider/tool 低层 mutation hook。
- 默认普通 profile 使用：
  - default persistence hook。
  - runtime context hook。
  - compact hook。
  - queue hook。
  - report result hook。
  - turn ingest hook。
- report_result reminder 从 `settleRun` 迁到 `shouldStop -> prepareNextTurn`。
- 验证普通 profile 行为与当前一致。

### Phase 4: Summarizer Migration

- 将 `session.summarizer` 改名为 `summarizer`。
- summarizer 走 `mode="internal"` 的普通 `RunFrame`，额外依赖通过 profile input / ctx.session.read 表达。
- 用 profile runtime hooks 替换当前普通 `invokeAgent()` 路径中的硬编码 summarizer 分支。
- assistant/toolResult 不写入 summarizer session history。
- `report_result` 仍正常闭合 tool call 并写回 source title/summary。
- settle 前校验 source active leaf；不匹配则只标 dirty，不写旧 title/summary。
- 验证：
  - summarizer session 不出现自身 assistant/toolResult transcript。
  - source session title/summary 正常更新。
  - branch/tree 切换后按 active path 重新摘要。
  - source active path 在 summarizer 运行期间变化时，旧摘要不会覆盖新 active path。
  - report_result reminder 是 runtime-only。

### Phase 5: Compact Save Point

- 把 `compactIfNeeded()` 从 pre-loop 硬编码迁入 compact hook，并直接在 save point / `prepareNextTurn` 生效。
- 验证：
  - compact 后 context 从 session truth 重建。
  - long session 仍能继续。
  - summarizer 不做自身 compact。

### Phase 6: Public Profile Runtime Hooks

第一版需要给 `defineAgentProfile` 暴露足够表达 summarizer 的 runtime hook 组合；后续再按真实需求增加更细 hook。

### `defineAgentProfile` Target API

现有 `context()` / `prepare()` 继续保留，用于普通 profile 的 system prompt、HistorySet、AppendingSet、ModelContext 和 stateWrites。新增单一 `runtime` 字段；hook 只出现在 `defineAgentRuntime({ hooks })` 内，不在 `defineAgentProfile` 顶层再放一份 `hooks`。

默认普通 profile 不写 `runtime` 时，等价于使用 `builtins.defaultSessionRuntime()`。自定义 profile 可以组合 built-in hooks 和自定义 hooks。`defineAgentRuntime()` 只是 runtime hook bundle 的规范化 helper，不是新的 agent，也不创建新的 session。

```ts
export default defineAgentProfile({
    manifest: {
        key: "summarizer",
        name: "Session Summarizer",
    },
    inputSchema: SessionSummarizerInputSchema,
    outputSchema: SessionSummarizerOutputSchema,
    allowedToolKeys: ["report_result"],

    context(ctx) {
        return (
            <ProfilePrompt>
                <System>...</System>
                <HistorySet>
                    <Message role="user">...</Message>
                </HistorySet>
            </ProfilePrompt>
        );
    },

    runtime: defineAgentRuntime({
        hooks: [
            builtins.profilePrompt(),
            builtins.reportResult({required: true}),
            hooks.prepareTurn("source-dialogue-context", async (ctx) => {
                const source = await ctx.session.read(ctx.input.sourceSessionId);
                const dialogue = ctx.session.agentDialogueContent(source, {
                    maxTokens: ctx.input.maxDialogueContentTokens,
                });

                return {
                    modelContext: dialogue.messages,
                    runtimeState: {
                        sourceLeafId: source.leafId,
                        dialogueContentTokens: dialogue.tokens,
                    },
                };
            }),
            hooks.ingestTurn("runtime-only-transcript", () => ({
                transcript: "runtime_only",
            })),
            hooks.settleRun("write-source-summary", async (ctx) => {
                const report = ctx.reportResult?.data;
                if (!report) {
                    return {};
                }
                const source = await ctx.session.read(ctx.input.sourceSessionId);
                if (source.leafId !== ctx.runtimeState.sourceLeafId) {
                    return {
                        writePlans: [ctx.session.writeCustomState({
                            target: ctx.input.sourceSessionId,
                            key: "summarizer.state",
                            value: {dirty: true},
                            cause: "summarizer",
                        })],
                    };
                }
                return {
                    writePlans: [ctx.session.writeSessionUpdate({
                        target: ctx.input.sourceSessionId,
                        title: report.title,
                        summary: report.summary,
                        projectionScope: {
                            kind: "active_path",
                            sourceLeafId: source.leafId,
                        },
                        cause: "summarizer",
                    })],
                };
            }),
        ],
    }),
});
```

推荐类型形状：

```ts
type AgentRuntime<TInput, TOutput> = {
    hooks: AgentRuntimeHook<TInput, TOutput>[];
};

type AgentRuntimeHook<TInput, TOutput> =
    | {
        stage: "prepareRun";
        name: string;
        run(ctx: PrepareRunContext<TInput, TOutput>): MaybePromise<PrepareRunResult>;
    }
    | {
        stage: "prepareTurn";
        name: string;
        run(ctx: PrepareTurnContext<TInput, TOutput>): MaybePromise<PrepareTurnResult>;
    }
    | {
        stage: "ingestTurn";
        name: string;
        run(ctx: IngestTurnContext<TInput, TOutput>): MaybePromise<IngestTurnResult>;
    }
    | {
        stage: "prepareNextTurn";
        name: string;
        run(ctx: PrepareNextTurnContext<TInput, TOutput>): MaybePromise<PrepareNextTurnResult>;
    }
    | {
        stage: "settleRun";
        name: string;
        run(ctx: SettleRunContext<TInput, TOutput>): MaybePromise<SettleRunResult>;
    };

type PrepareRunResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type PrepareTurnResult = {
    systemPrompt?: string;
    modelContext?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type IngestTurnResult = {
    transcript?: "persist" | "runtime_only" | "drop";
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
    continue?: boolean;
};

type PrepareNextTurnResult = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};

type SettleRunResult = {
    runtimeState?: JsonObject;
    writePlans?: SessionWritePlan[];
};
```

约束：

- `defineAgentProfile` 顶层不提供 `hooks` 字段，避免和 runtime hooks 形成双控制面。
- `defineAgentRuntime()` 只负责规范化 hooks、校验 hook name/stage、展开 built-in hook bundle。
- 普通 profile 默认 runtime 是 `builtins.defaultSessionRuntime()`，包含 profile prompt、session context、transcript persistence、compact、queue、approval、report_result optional 等默认行为。
- 自定义 runtime 写了 hooks 后，不会自动注入默认 session context 或默认 transcript persistence；需要哪些行为就显式组合哪些 built-in hook。
- summarizer 不暴露“history mode”或“context mode”这类 enum。它的“运行 transcript 不落盘”表现来自 hook 组合：不组合 session context，不组合 transcript persistence，`ingestTurn` 返回 runtime-only，`settleRun` 写 source projection。
- hook context 暴露 `ctx.session.read()` 和 `ctx.session.agentDialogueContent()` helper；profile 作者不直接拼 active path。
- hook 只能返回 slot result 和 `SessionWritePlan` draft，不能 append repo、publish event、启动 invocation。
- `context()` / `prepare()` 仍只负责 profile prompt DSL；不要把 hook 能力塞进 TSX 节点里。
- `builtins.reportResult({required: true})` 要求 profile `allowedToolKeys` 包含 `report_result`。
- hook 的 `runtimeState` 是 RunFrame scoped、profile 私有，只在一次 invocation 内传递给后续 hook，不写 session。

## Decisions

- 不直接采用 PI `AgentHarness`，继续维护 Neuro Book 自己的 harness。
- 借鉴 PI 的 turn snapshot、save point、pending writes、hook reducer 思路。
- 不把所有功能都做成 pipeline stage；pipeline 是 run/turn 事务边界，功能是内置 hook。
- hook 不直接做副作用，只返回 plan。
- `ingest` 的新语义是 turn-level ingest，能控制每一个 ReAct turn。
- 旧 `profile.ingest()` 硬删，不保留 after-run 兼容层。
- `summarizer` 是第一个强需求消费者，但不是唯一目标；所有 profile 都可以通过声明式 `summarizer` 启用它。
- `RunFrame` 不设置 hard-coded `source` 或 `RuntimeBinding` 字段；跨 session 依赖先通过 profile input / ctx 表达，等出现第二类真实需求后再抽象。
- Run Kernel 固定为 `enterRun -> prepareRun -> runTurns -> settleRun -> cleanup` 五个事务边界。
- `SessionWriteExecutor` 是各安全点调用的服务，不作为独立 pipeline stage。
- `ToolSessionWriteSink` 是工具执行期间的写入入口，不作为独立 pipeline stage，内部仍调用 `SessionWriteExecutor`。
- 第一阶段开放足够表达 summarizer 的 `defineAgentRuntime({ hooks })`；summarizer 不能作为 Run Kernel 硬编码特例。
- `SessionWritePlan.target` / `cause` 必填，跨 session 写入是第一等能力。
- report_result retry 属于 `shouldStop -> prepareNextTurn`，不是 `settleRun` 的职责。
- lifecycle waiting 是显式持久状态，不再用重复 `start` 表示。
- approval / user-input resume 复用同一个用户可见 logical `invocationId`；内部 trace 如需拆分执行片段，再加 `attemptId`。
- 第一版不做 deterministic entry id、durable pending queue、batch commit marker；同 session batch 只承诺先整批校验、顺序 append、统一 publish。

## Open Questions

- 暂无必须阻塞 18 第一版实现的架构 open question；后续 semi-durable recovery 另开任务设计。

## Walkthrough

- 2026-05-28：基于 summarizer 设计讨论，确认现有 `ingest()` 不足以表达每 turn 行为控制。
- 2026-05-28：创建新的 active task，用于沉淀 runtime pipeline / hooks 架构，不立即改代码。
- 2026-05-28：补充当前 `NeuroAgentHarness` 的完整 pipeline 分解。确认当前项目没有直接使用 PI `AgentHarness`，而是自研 harness 复用 PI message/event/tool/provider 类型。
- 2026-05-28：重新阅读 PI `AgentHarness` lifecycle、durable harness、hooks、low-level loop 源码，决定从“20 个 pipeline stage”收敛为 “Invocation Kernel + Built-in Hooks” 设计。
- 2026-05-28：进一步降低复杂度，把设计收敛为 run/turn 两级事务边界；确认新 ingest 语义应控制每一个 ReAct turn。
- 2026-05-28：用户确认删除 `RuntimeBinding`。summarizer 的 source session 关系继续由 `defineAgentProfile.summarizer` 初始化 input 和 summarizer profile 的 ctx/input 读取表达。
- 2026-05-28：用户确认当前 Run Kernel / Turn Transaction 取舍可接受。Run Kernel 保留五个 stage；`flushWrites` 不作为 stage，`SessionWriteExecutor` 作为服务在安全点调用。
- 2026-05-28：审查当前 `NeuroAgentHarness` 的现有能力，补充 Session Control Plane、Invocation Coordinator、Run Kernel、Tool / Variable Runtime 四层能力清单，并确认不需要推翻新架构；需要新增的是 `ToolSessionWriteSink` 这类服务边界，不是更多 pipeline stage。
- 2026-05-28：按开发版硬切原则收紧合同：硬删 legacy `profile.ingest()`，write plan 必须显式 target/cause，hook 只能返回 plan，report_result retry 移到 `shouldStop -> prepareNextTurn`，tool-side writes 区分 `immediate` / `savePoint` durability，summarizer 写回前校验 source active leaf。
- 2026-05-28：用户确认 summarizer ModelContext 由自身 system prompt 和 source Agent Dialogue Content 组成；AppendingSet 为空，工具和 ReAct 过程中生成的消息都不进入 summarizer 历史；source title/summary 绑定 source active leaf。
- 2026-05-28：同步 17 的最新决策：summarizer 不限定 leader，所有 profile 可启用；source 关系通过 profile input / ctx 表达，不引入 `RuntimeBinding`；waiting/resume 使用同一个用户可见 logical `invocationId`，内部追踪可另加 `attemptId`。
- 2026-05-28：用户确认删除 `AgentProfileRuntimePolicy` / `history: "persistent" | "history_frozen"` 这类双控制面。profile 只通过 `runtime: defineAgentRuntime({ hooks })` 组合 built-in hooks 和自定义 hooks；summarizer 的运行 transcript 不落盘由 hook 组合表达，不作为 public enum。
- 2026-05-28：用户确认第一版不做 batch commit marker。deterministic entry id、durable pending queue、commit marker 都推迟到后续 semi-durable recovery 任务；18 第一版只做先校验后顺序 append。

## Files Changed

- `docs/tasks/18-agent-runtime-pipeline-hooks/README.md`
- `docs/tasks/17-session-title-summary-enhancement/README.md`
- `CONTEXT.md`

## Verification

- 本轮仅更新架构计划文档，未改运行时代码。
- 已核对 PI 文档与源码入口：
  - `.agent/workspace/pi/packages/agent/docs/agent-harness.md`
  - `.agent/workspace/pi/packages/agent/docs/durable-harness.md`
  - `.agent/workspace/pi/packages/agent/docs/hooks.md`
  - `.agent/workspace/pi/packages/agent/src/agent-loop.ts`
  - `.agent/workspace/pi/packages/agent/src/harness/agent-harness.ts`
- 已核对当前 Neuro Book harness 入口：
  - `NeuroAgentHarness.invokeAgent()`
  - `prepare()`
  - `runLoop()`
  - `streamAssistant()`
  - `runToolBatch()`
  - `commitTurn()`
  - `finalizeInvokeResult()`
  - `applyIngest()`
  - `triggerSessionSummarizer()`

## TODO / Follow-ups

- 18 完整重构落地后，重新计划 `docs/tasks/17-session-title-summary-enhancement/README.md` 的 summarizer 实现细节。
- 后续实现前先补最小 targeted tests：
  - projection 不污染 tree。
  - runtime-only transcript turn 不落盘。
  - report_result reminder 遵守 runtime-only ingest。
  - ingestTurn 能替换默认 turn persistence。
  - prepareNextTurn 重建 context。
  - write executor 保持 assistant/toolResult 顺序。
  - write executor 拒绝缺少 target/cause 的 plan。
  - waiting lifecycle 写入显式 `waiting`，resolution 后写入 `resumed`。
  - tool-side custom state writes 通过 executor 发布 entry/state，且不插入 assistant/toolResult batch 内部。
  - tool-side `savePoint` writes 与 transcript 同批提交，`immediate` writes 可实时发布。
  - `moveTree(... next.invoke)` 仍能先切 active leaf 再由 coordinator 启动 run。
  - `invoke_agent` tool 遵守目标 session active lock，且拒绝 self-invoke。
  - summarizer stale source leaf 不覆盖 source title/summary，只标 dirty 重跑。
