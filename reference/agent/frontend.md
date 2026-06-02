主链路只用 `GET /api/agent/threads/:threadId/stream` 读、`POST /api/agent/threads/:threadId/invoke` 写、`POST /api/agent/threads/:threadId/abort` 停止。`GET /api/agent/threads/:threadId` 只拿元数据，不再返回运行态。

当前 API 端点

- `GET /api/agent/threads?kind=leader|subagent`：线程列表。
- `POST /api/agent/threads`：创建 leader thread，body 是 `{title?}`。
- `GET /api/agent/threads/:threadId`：thread 详情，只返回 `thread + subagents + leaders`。
- `DELETE /api/agent/threads/:threadId`：删除 thread。
- `GET /api/agent/threads/:threadId/stream`：长期 SSE，首帧是 `history_sync`，之后是 live 事件。
- `POST /api/agent/threads/:threadId/invoke`：统一运行写口，body 是 `{input, options?}`。
- `POST /api/agent/threads/:threadId/abort`：中止当前运行。
- `GET /api/agent/threads/:threadId/subagents`：列 leader 关联的 subagent。
- `POST /api/agent/threads/:threadId/subagents`：创建并挂接新的 subagent，body 是 `{profileKey, title?}`。
- `POST /api/agent/threads/:threadId/subagents/attach`：挂接已有 subagent，body 是 `{subagentThreadId}`。

公开 SSE 事件

- `history_sync`
- `run_state`
- `assistant_delta`
- `tool_call_started`
- `tool_args_delta`
- `tool_exec_started`
- `tool_output_delta`
- `tool_finished`
- `assistant_done`
- `store_updated`

事件约定

- `history_sync`
  - 初始化来源。
  - 包含 `messages`、`status`、`active`。
  - `active` 是当前流式 assistant 气泡快照，字段是 `messageId`、`text`、`status`、`toolCalls`。
- `run_state`
  - 统一表达 `running / waiting_user / completed / stopped / failed`。
  - `failed` 时额外带 `error`。
- `assistant_delta`
  - 只发增量。
  - 文本增量用 `chunkText`。
  - 不再发送 `fullText`。
- `tool_call_started`
  - 表示模型已经决定创建一个 tool 节点，前端应立刻按 `toolName` 渲染对应节点。
  - 包含 `messageId`、`toolNodeId`、`callIndex`、`toolName`、`toolCallId?`。
- `tool_args_delta`
  - 表示 tool 参数流。
  - 包含 `messageId`、`toolNodeId`、`argsChunk`。
- `tool_exec_started`
  - 表示工具真正开始执行。
  - 包含 `messageId`、`toolNodeId`、`toolCallId?`。
- `tool_output_delta`
  - 表示工具输出流。
  - 包含 `messageId`、`toolNodeId`、`outputChunk`。
- `tool_finished`
  - 表示工具执行完成。
  - 包含 `messageId`、`toolNodeId`、`toolCallId?`、`status`、`message`。
- `assistant_done`
  - 表示当前 assistant 气泡已落盘。
  - 用 `messageId` 把流式消息替换成最终消息。
- `store_updated`
  - 变量快照更新事件。
  - 默认不参与聊天主 reducer。

前端正确调用顺序

1. 进入 Agent 首页时，先 `GET /api/agent/threads?kind=leader` 拿 leader 列表。
2. 新建 leader 时，`POST /api/agent/threads`，拿到 `threadId` 后切到该线程。
3. 打开某个 thread 时，立即建立 `GET /api/agent/threads/:threadId/stream` 长连接。
4. 同时并行请求 `GET /api/agent/threads/:threadId`，只拿标题、状态、subagents、leaders 元信息。
5. 前端以 `history_sync` 作为初始化来源，直接恢复历史消息、当前状态、当前流式 assistant。
6. 用户发送消息时，只做乐观追加 user message，然后 `POST /api/agent/threads/:threadId/invoke`。
7. 用户停止时，调用 `POST /api/agent/threads/:threadId/abort`。
8. 离开 thread 或切换 thread 时，才中断旧的 SSE。

subagent 正确调用顺序

1. leader 收到 `invoke_subagent` 的 tool node 后，从 `tool_call_started`、`tool_exec_started` 或 `tool_finished` 里的 `subagentThreadId` 拿到子线程。
2. leader 自己的 `/stream` 只发布 leader thread 的事件，不转发 subagent thread 的实时消息。
3. 子面板必须对这个 `subagentThreadId` 单独建立一条新的 `GET /stream`。
4. 子面板也用首帧 `history_sync` 初始化，不需要自己先拉历史。
5. 用户给 subagent 回复时，直接 `POST /api/agent/threads/:subagentThreadId/invoke`，body 仍然是 `{input: {prompt}}`。

前端渲染约定

- 普通 tool 继续挂在所属 assistant 气泡内，以 inline 方式渲染。
- 特殊 tool 通过 `toolName` 命中 `toolRenderRegistry`，以 block 方式渲染。
- 当前 registry 里：
  - `invoke_subagent` -> `block`
  - `create_subagent` -> `block`
- 未命中的 tool 默认走 inline。
- 若后续需要隐藏某类 tool，统一在 registry 配置 `mode: hidden`，不要在组件里再写硬编码分支。

`invoke_subagent` 结果约定

- leader 侧 `tool_finished` 只应携带 `subagentThreadId`、`status`、最终 `walkthrough` 与可选 `data`。
- 不要把 subagent 自己的 `finalMessages`、完整历史或实时消息数组内嵌到 leader thread 的 tool 结果里。
- 前端若要展示 subagent 的历史、流式输出、运行状态，唯一来源是该 subagent 自己的 `/stream`。
- 后端会在运行时切断 subagent 对 leader 当前 trace 的继承，避免 subagent 的 live 事件被 leader `/stream` 重新包装后再次发布。

请求头

- 所有 agent 请求统一带 `x-agent-client-variables`，内容是 Base64 编码后的 JSON `{ide?, studio?}`。
- `useAgentApi` 的 `buildHeaders()` 负责组装这个头。

按当前代码，不该再用的链路

- 不要用 `GET /api/agent/threads/:threadId/history`。
- 不要用 `GET /api/agent/threads/:threadId/active-run`。
- 不要用 `DELETE /api/agent/threads/:threadId/active-run`。
- 不要走 `history -> active-run -> events` 三段式。
- 不要在前端自己缓存 `fullText`，流式文本只按 `chunkText` 本地追加。

顺手修掉的问题

- `deleteThread()` 返回类型现在与后端一致，统一是 `{ok: true}`。
- `readSseStream()` 继续以 JSON payload 里的 `type` 为准，不依赖浏览器原生事件名。
- 多行 `data:` 的 SSE 帧现在按换行拼接，不再在解析时错误裁剪文本。
