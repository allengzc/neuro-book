# Harness Black-Box Contract

本文从外部可观察行为定义 `NeuroAgentHarness`。内部 Run Kernel、Turn Transaction、hook 和 save point 必须服务这个合同。

## Inputs

第一版 invocation mode：

```text
prompt | continue | steer | followup
```

其他 control-plane 操作，如 abort、tree command、manual compact、profile change 和 linked-agent 管理，按各自 API 合同处理。

## Observable State

粗粒度运行状态：

- `Idle`：没有 active invocation。
- `Running`：正在 provider call、tool batch、turn boundary 或 settlement。
- `WaitingUser`：等待 approval、request_user_input 或其他 resolution。
- `Aborting`：已请求 abort，正在清理。

## Output Channels

Harness 的输出只能通过四类通道观察：

- session writes：append-only durable truth。
- SSE events：实时增量和 runtime queue 信号。
- HTTP invocation response：本次请求的直接语义。
- frontend state：由 snapshot、SSE 和 response 推导，不是真相源。

## Operation Rules

- `prompt` 在 `Idle` 下接受并启动 run；在 `Running` 下应作为 follow-up queue 处理或由前端显式改发 `followup`。
- `continue` 在 `WaitingUser` 下携带 resolution，恢复同一个 logical invocation。
- `steer` 只引导当前 active invocation，入队时不是 session history，drain 后才写入模型可见消息。
- `followup` 是下一轮用户输入，只有当前 run 正常 completed 后才自动消费。
- terminal `error` / `aborted` / `interrupted` 后，pending steer 必须清理，follow-up queue 必须暂停。

## Error Rules

- admission error 不创建 invocation，不写 session history。
- accepted invocation 运行失败必须写 terminal lifecycle error；不能只靠 HTTP 500。
- provider error before stream 不写空 assistant。
- provider stream partial failure 可以保存已展示文本，但必须剥离未闭合 tool calls，并标记 partial / interrupted / error。
- session history 中不能出现无法闭合的 assistant tool call。
- retry 不复活 terminal error invocation；只有 waiting resume 复用原 logical invocationId。

## Recovery

- Snapshot 是恢复真相源。
- SSE cursor 使用 `(eventEpoch, seq)`，后端 reload 或 epoch mismatch 时前端必须拉 snapshot。
- waiting UI 可以从 session active path 的 pending approval / user input 和 lifecycle `waiting` hydrate。
- 重启后不要求自动恢复 running provider call 或自动 drain ready follow-up。

完整历史合同见 [../../docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md](../../docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)。
