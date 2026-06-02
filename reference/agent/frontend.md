# Agent Frontend Contract

本文档记录当前 Agent 前端主路径。旧 `thread` / `subagent` / `/api/agent/threads/**` / `history_sync` / `assistant_delta` 合同已经下线，不再作为 active reference。

## Core Model

前端只使用 `/api/agent/sessions/**`。核心心智是：

- `session` 是可继续、可分支、可恢复的 Agent 对话和执行历史。
- `profile` 定义 session 的身份、输入、工具权限和上下文。
- `linked agent` 是由当前 session 创建、关联和复用的专用 agent session。
- `snapshot` 是恢复真相源；SSE 只是实时增量。
- `invocation` 是一次运行；一次 invocation 可以包含多轮 ReAct turn。

## HTTP Entry Points

当前前端稳定入口由 `app/composables/useAgentSessionApi.ts` 封装：

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agent/sessions` | 列出 session 摘要，可按 profile / status / relation 等筛选。 |
| `POST` | `/api/agent/sessions` | 创建 session，body 使用 `AgentCreateSessionRequestDto`。 |
| `GET` | `/api/agent/sessions/:sessionId` | 获取完整 session snapshot。 |
| `GET` | `/api/agent/sessions/:sessionId/events?after=<seq>&eventEpoch=<epoch>` | 订阅 SSE 增量事件。 |
| `POST` | `/api/agent/sessions/:sessionId/invocations` | 发起 blocking invocation。运行过程仍通过 SSE 同步。 |
| `POST` | `/api/agent/sessions/:sessionId/abort` | 中止当前 active invocation。 |
| `POST` | `/api/agent/sessions/:sessionId/commands` | 执行 session command，例如 model、plan、compact。 |
| `POST` | `/api/agent/sessions/:sessionId/tree` | 移动 active leaf，必要时继续 invoke。 |
| `POST` | `/api/agent/sessions/:sessionId/client-variable-patch-acks` | 确认前端已应用 client variable patch。 |

DTO 以 `shared/dto/agent-session.dto.ts` 为准。HTTP helper 以 `server/agent/http.ts` 为准。

## Session Opening Flow

打开一个 session 时：

1. `GET /api/agent/sessions/:sessionId` 获取 snapshot。
2. 用 snapshot 派生稳定消息、active invocation、pending approval、linked agents、usage、model、plan mode 和 `lastSeq`。
3. 使用 `events?after=<snapshot.lastSeq>&eventEpoch=<snapshot.eventEpoch>` 建立 SSE。
4. 收到 `connected` 只更新连接状态，不推进 `lastSeq`。
5. 后续正常 live 更新只应用 SSE reducer，不轮询 snapshot。

## Invocation Flow

用户发送消息时：

1. 前端可以先显示 optimistic user message。
2. 调用 `POST /api/agent/sessions/:sessionId/invocations`。
3. 后端写入 invocation lifecycle、profile appending messages 和真实 user message。
4. 前端通过 `session_entry` 对齐真实历史。
5. SSE 推送 `agent_start`、`turn_start`、`message_*`、`tool_execution_*`、`turn_end`、`agent_end` 等事件。
6. blocking invocation 返回只作为提交结果和错误兜底；聊天 UI 主要跟随 SSE / snapshot 投影。

一次 invocation 可能跨多轮工具调用。前端不能把 `turn_end` 当成 run end；只有 `agent_end` 或 snapshot 中 `activeInvocation = null` 才表示运行结束。

## Linked Agents

前端不再使用 subagent thread API。linked agent 是普通 session 之间的关系：

- 当前 session 的 linked agents 来自 snapshot / `session_state_changed`。
- 创建或调用 linked agent 由 Agent 工具完成，前端只展示关系和 session 入口。
- 打开 linked agent 时，使用该 linked agent 的 `sessionId` 走同一套 `/api/agent/sessions/:sessionId` snapshot + SSE 流程。
- 父 session 不转发 linked agent 的实时消息。需要查看 linked agent 历史和运行状态时，订阅 linked agent 自己的 session events。

## SSE And Snapshot Rules

稳定 SSE 合同见 [sse.md](sse.md)。前端必须遵守：

- `snapshot` 是恢复真相源。
- `seq` 用于去重、gap detection 和 replay。
- `eventEpoch` 改变时，不继续使用旧 epoch 的 `lastSeq` 过滤新事件。
- `session_state_changed.snapshot` 已携带完整 snapshot，可直接 apply，不额外拉取。
- `snapshot_required`、seq gap、event epoch mismatch 或 replay buffer 过期时，单飞拉取一次 snapshot。
- SSE 断开不是 run error；重连期间保持当前 run 状态，显示连接状态。

## Client State And Variables

发起 invocation 时，前端通过 body 的 `clientState` 传入当前 UI / workspace 状态。Harness 将其作为本轮变量快照提供给 profile。

后端需要修改 `client.*` 变量时，通过 `client_variable_patch_requested` session event 请求前端应用 patch；前端应用后调用 `client-variable-patch-acks` 确认。

## Rendering Rules

- session entry 和 SSE event 都要投影到同一套聊天消息模型。
- Tool arguments streaming 来自 assistant message 的 toolCall block；工具真正执行状态来自 `tool_execution_start` / `tool_execution_end`。
- `tool_execution_update` 能力保留；普通工具可先展示最终结果，专用工具再做高质量流式 UI。
- Run Error 是由 invocation lifecycle error 投影出的系统卡，不进入模型上下文。
- pending approval / request-user-input 是合法 suspend point，需要 durable pending tool call 和后续 tool result resume。

## Removed Legacy Paths

不要再使用：

- `/api/agent/threads/**`
- `/api/agent-v3/**`
- `history_sync`
- `assistant_delta`
- `invoke_subagent`
- `create_subagent`
- `subagentThreadId`
- `threadId` 作为当前 Agent session 标识

历史背景只在 archived docs 或 task walkthrough 中保留。当前实现和前端合同以 `/api/agent/sessions/**`、[sse.md](sse.md) 和 [harness.md](harness.md) 为准。
