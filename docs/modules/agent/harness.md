# Agent Harness

本文档说明当前 `server/agent` harness 如何把 invoke、profile、session、ReAct loop、SSE 和前端展示串起来。当前真实合同以 `ProfileTurnPlan` 和 TSX Profile DSL 为准，旧 `PreparedTurn` / `dynamicMessages` / `profile.history.injected` 语义已经硬切。

## 文档状态

- 当前实现事实：`server/agent/harness/neuro-agent-harness.ts`、`server/agent/profiles/types.ts`、`server/agent/profiles/profile-dsl.ts`、`server/agent/session/session-repo.ts`。
- 关联任务：`docs/tasks/05-leader-profile-v2-adaptation/README.md`、`docs/tasks/04-tsx-profile-workbench/README.md`、`docs/tasks/02-pi-agent-harness-migration/README.md`。
- 暂缓内容：`ingest` 作为 ReAct loop 结果归档策略的重设计先不做；当前 assistant / toolResult 由 harness 在 `turn_end` 作为一组 durable turn commit 写入 session。

## 关键位置

- Harness 主入口：`server/agent/harness/neuro-agent-harness.ts`
- Profile contract：`server/agent/profiles/types.ts`
- TSX DSL runtime：`server/agent/profiles/profile-dsl.ts`
- Profile catalog：`server/agent/profiles/catalog.ts`
- Session 存储：`server/agent/session/session-repo.ts`
- Session event hub：`server/agent/events/session-event-hub.ts`
- Tool registry：`server/agent/tools/**`
- Workbench profile API：`server/api/agent/profiles/**`

## Profile Compile Boundary

当前 profile runtime 已硬切为 `.compiled` 运行真相源：

- `.profile.tsx` / `.profile.ts` / `.profile.js` / `.profile.mjs` 是编辑真相源。
- `.compiled/manifest.json` 与 `.compiled/*.mjs` 是运行真相源；`.mjs` / `.types.d.ts` 使用稳定文件名，hash 保存在 manifest 和 import query 中。
- `AgentProfileCatalog` 仍扫描源码文件以判断存在性、source hash 和覆盖关系，但不会在 catalog、config snapshot、创建 session 或 invoke 中自动编译 TSX。
- catalog 只在 manifest 中的源码 hash、artifact hash 和依赖 hash 都匹配时 import `.compiled/*.mjs`，并用 artifact hash query bust Node ESM cache。
- 未编译或过期的 profile 会进入 `not_compiled` / `compile_stale` / `compiled_load_failed` / `source_error` 状态，`get(profileKey)` 不会回退到源码自动编译，也不会静默使用同 key memory fallback。
- 系统 profile 在 `bun run dev`、`bun run build`、`bun run nuxt:build` 前由 `scripts/prepare-system-profile-metadata.ts` 预编译，并作为 system assets 发布。
- 系统 profile / variable definition manifest 是 tracked 发布产物；prepare 脚本必须保持幂等，内容未变化时保留原 `generatedAt`，避免 dev/build/deploy 制造无意义 Git diff。
- `bun run dev` 会在 prepare 后同步未手改 user-assets，让用户覆盖层的源码、manifest 和 artifact 与 freshly prepared system assets 对齐；已手改用户 profile 不会被覆盖，仍需用户手动编译。
- 用户 profile 由 Workbench “编译”按钮或 Agent runtime CLI `profile compile` 手动生成用户侧 `.compiled` 产物。
- Workbench 自动编辑路径只走 `source-draft` 轻量源码解析；保存源码不等于可运行。
- `profile preview` dry-run 已保存源码的 `prepare()`，但不写 `.compiled`，也不改变运行可用状态。

## Harness 职责

`NeuroAgentHarness` 是 Agent 运行时编排器。它负责：

- 创建和读取 session，维护 append-only session tree。
- 按 `profileKey` 从 profile catalog 加载 profile，并用 `inputSchema` 解析 session instance input。
- 调用 profile `prepare()`，得到 `ProfileTurnPlan`。
- 在 ReAct loop 前按统一顺序提交 profile 需要写入 session 的消息或状态。
- pre-loop 写入后重新 reduce session，组装 provider 可见 messages。
- 根据 profile `allowedToolKeys` 选择可见工具，并为 `report_result` 按目标 profile 动态派生 schema。
- 调用 Pi provider streaming，执行 tool call，并广播 Pi-like events。
- 将普通 ReAct turn 的 assistant / toolResult 在 `turn_end` 成组写回 session。
- 管理 active invocation、follow-up queue、abort、approval waiting、compaction 和 tree command。

## Session 模型

Session 是 append-only 消息树。repository 每次追加普通 entry 后会自动追加一个 `leaf` entry，把 active leaf 移到新 entry；切换分支只移动 leaf，不删除旧历史。

常见 entry：

- `message`：真实 Pi message，通常是 `user` / `assistant` / `toolResult`。普通 prompt 写入的 user message 会带 `origin: "prompt"`；harness 自动提醒、toolResult、ingest 等写入会使用其他 origin 或旧 entry 为空。
- `custom_message`：profile / harness 生成的 message；`visibleToModel: true` 时进入模型上下文，也会进入前端历史。
- `custom`：profile / harness / UI 状态，例如 linked agent、plan mode、`profileState.${profileKey}`。
- `session_update`：title / summary。
- `model_change` / `thinking_level_change` / `profile_change`：session 级运行配置变更。
- `compaction`：压缩摘要与保留边界。
- `invocation_lifecycle`：run start / end / error / aborted。

`JsonlSessionRepository.reduce(snapshot)` 沿 active path 生成 `NeuroSessionContext`：

- `messages`：active path 中的 `message`，以及 `visibleToModel` 的 `custom_message`。
- `customState`：由 `custom`、`variable_change` 等 entry reduce 得到。
- `linkedAgents`：由 `agent.link.*` / `agent.detach.*` custom entry reduce 得到。
- `model`、`thinkingLevel`、`profileKey`、`title`、`summary`、`planModeActive` 等运行状态。

`thinkingLevel` 在 session context 中有两层语义：`null` 表示当前 session 没有显式覆盖，运行时继续使用 Agent Profile 的 `reasoningEffort`；`off` 表示用户在当前 session 显式关闭 thinking。有效发送给 Pi provider 的 level 会由 harness 合并成 `off | minimal | low | medium | high | xhigh`。

## Profile Contract

profile 外层是：

```ts
defineAgentProfile({
    manifest,
    inputSchema,
    outputSchema,
    allowedToolKeys,
    context, // 普通作者推荐
    prepare, // 高级覆写
    ingest,
});
```

`context(ctx) => JSX` 与 `prepare(ctx) => ProfileTurnPlan` 二选一；同时存在会报 profile contract error。`defineAgentProfile()` 会把 `context()` 返回的 TSX DSL tree 编译为底层 `ProfileTurnPlan`。

`InputSchema` 描述创建 agent/session 时的实例初始化参数，不描述每轮用户任务。普通 agent 可以使用 `InputSchema = Type.Object({})`，表示没有特殊实例配置；每轮任务通过 invocation 的用户 message 传入。

`OutputSchema` 描述 `report_result` 的结构化 payload。是否走 report 完成协议由 `allowedToolKeys` 是否包含 `report_result` 决定；空 `OutputSchema = Type.Object({})` 且允许 `report_result` 时，只要求通用 `walkthrough`。

工具集合不由 `prepare()` 返回。harness 始终从 `profile.allowedToolKeys` 和 runtime tool registry 取本轮可见工具。

`ProfilePrepareContext.runtime` 提供本轮运行只读信息：

- `now`：本轮 prepare 时间。
- `promptUserTurnCount`：当前 active path 中 `origin: "prompt"` 的真实用户 prompt 轮数。`AppendingSet` 写入的 `custom_message`、approval resolution、report_result 缺失提醒等不参与计数。
- `pendingUserMessage`：prompt 模式下尚未写入 session 的本轮用户消息；continue 模式为空。它用于 `ActivatedSkills`、条件提醒等贴近当前输入的上下文判断，但真实用户消息仍由 harness 在 pre-loop appending/state 写入后统一落盘。

## ProfileTurnPlan

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

约束：

- 不返回最终 `contextMessages` / `messages`。
- 不返回 `toolKeys`。
- `historyInitMessages` 只在当前 active path 没有 model-visible message 时写入。
- `appendingMessages` 每轮 ReAct 前写入 session，是用户层唯一 session append 通道。
- `modelContextAppendingMessages` 来自 `ModelContext` 内触发的 `Reminder`，按 appending 语义在 ReAct 前写入 session 并展示，但源码归属仍是 `ModelContext`。
- `modelContextMessages` 只进入本轮 provider messages，不写 session，不显示在前端历史。
- `stateWrites` 只允许写 `custom profileState.${profileKey}`，用于 Reminder / Watch 状态。

最终 ReAct messages 由 harness 在 pre-loop 写入后重新 reduce session，再追加 `modelContextMessages` 得到。

## TSX Profile DSL

active DSL 节点：

- `ProfilePrompt`：根节点。
- `System`：provider `systemPrompt`，不写 session。
- `HistorySet`：空会话首轮初始化历史。
- `ModelContext`：本轮 context，替代旧 `DynamicSet`。普通消息是 model-only；内部 `Reminder` 触发后会按 appending 语义写入 session。
- `AppendingSet`：本轮 ReAct 前写入 session 的上下文。
- `Message`：用户消息节点；禁止 `role="system"`。
- `AIMessage` / `ToolCall` / `ToolResult`：示例 assistant/tool 序列，校验 tool call/result 顺序。
- `Reminder`：可在 `AppendingSet` 或 `ModelContext` 内，按状态决定是否产出 pre-loop 可见 message。
- `Watch`：可在 `AppendingSet` 或 `ModelContext` 内，观察路径变化并更新 baseline。
- `If`：条件 false 时不渲染子树，也不更新子树状态。
- `SkillCatalog` / `ActivatedSkills`：string fragment，可放在支持 string children 的节点内。当前没有独立 `skill` 工具；Agent 通过 catalog 的 `location` 用 `read` 打开 `SKILL.md`，reference/scripts/templates/examples 按入口说明按需继续读取。

`DynamicSet` 不再是公开 DSL 节点。需要 model-only context 时使用 `ModelContext`。

## Invoke 生命周期

一次 prompt invocation 的当前顺序：

```text
1. 写 invocation_lifecycle:start。
2. prompt 模式构造 pending user message，但暂不写 session。
3. continue + resolution 时，先把 resolution 转为 toolResult 写入 session。
4. 读取 session snapshot，reduce 当前 session。
5. 调用 profile.prepare() 得到 ProfileTurnPlan；prompt 模式下 `ctx.runtime.pendingUserMessage` 可读，但还没有写入 session。
6. harness 写入 historyInitMessages（仅空 active path）、modelContextAppendingMessages、appendingMessages、stateWrites。
7. prompt 模式把 pending user message 写入 session。
8. 重新读取 session 并 reduce。
9. 如需要，基于 reduced messages + modelContextMessages 做 compaction。
10. 再次 reduce，组装 ReAct loop 输入。
11. 进入 ReAct loop。
12. ReAct loop 内 `message_end` / `tool_execution_*` 只作为 live event 广播；普通 assistant / toolResult 在 `turn_end` 成组写入 session。
13. loop 完成后运行当前 ingest。
14. 写 invocation_lifecycle:end/error/aborted。
15. 清理 active invocation，drain follow-up queue。
```

这保证前端顺序为：profile appending 消息先出现，然后是真实用户消息，然后是 AI streaming。

## ReAct Loop

`runLoop()` 输入：

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

`workspaceRoot` 是 agent 工具执行 cwd，不等同于当前小说 Project Workspace。普通小说入口现在把 cwd 固定为 Workspace Root `workspace`，这样同一个 agent 可以显式访问多个 Project Workspace；当前小说通过 session `novelId` 和 RuntimeContext 的 `Current Project Workspace` 提示给模型。`user-assets` 入口仍使用 `workspace/.nbook` 作为 cwd。

### Agent Bash CLI

`bash` 工具启动时会把 Agent assets bin 目录加入 PATH：

- 用户覆盖：`workspace/.nbook/agent/bin`
- 系统内置：`assets/workspace/.nbook/agent/bin`

用户覆盖目录优先于系统目录。内容节点 CLI 的 Agent 稳定入口是 `workspace node ...`，对应脚本位于 `.nbook/agent/scripts/workspace.ts`。项目根 `scripts/` 只用于开发、部署和源码级检查，不作为 Agent runtime 合同写入 profile/skill prompt。bash runtime 同时注入 `RIPGREP_CONFIG_PATH`，指向 `.nbook/agent/config/ripgreprc`，使 `rg --files` 输出统一使用 `/`。Windows 上也执行 Git Bash，因此 prompt / skill 里的 shell 示例必须使用 bash 语法；workspace 相对路径优先写 `/` 分隔，批量枚举路径使用 `rg --files | rg '(^|/)index\.md$'` 这类基于 `/` 的过滤。不要提示模型写未加引号的 Windows 反斜杠路径。

流程：

```text
agent_start
while shouldContinue:
    turn_start
    streamAssistant(systemPrompt, messages, visibleTools)
    assistant message_end -> live event
    collect assistant tool calls
    runToolBatch(toolCalls)
    toolResult message_end -> live event
    commitTurn(assistant, toolResults) -> one JSONL batch record
    turn_end
    if waiting approval/input:
        agent_end
        return waiting
    shouldContinue = any tool result does not terminate
agent_end
return finalAssistant/reportResult
```

## SSE 与前端同步

Harness 通过 `AgentSessionEventHub` 广播：

- `kind: "session"`：`session_entry`、`session_state_changed`、`follow_up_queued`、`snapshot_required`、`invocation_aborted`。
- `kind: "pi"`：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`turn_end`、`agent_end`。

前端展示规则：

- 稳定历史来自 session snapshot。
- 当前 AI 输出来自 live Pi event。
- SSE replay 是 bounded memory buffer。客户端中途订阅或重连时不保证一定收到本次 invocation 的 `agent_start` / `agent_end`；运行状态必须结合 snapshot `activeInvocation`、live Pi event 和 `session_state_changed.snapshot.activeInvocation` 推导。
- SSE route 的 `connected` 只表示 HTTP 事件流建立，不是 session hub 的 durable event，不应推进前端 `lastSeq` 或触发 snapshot。
- `session_state_changed.snapshot` 已携带完整 snapshot，前端可以直接应用它同步 shell 状态，但不应因此额外 `GET /api/agent/sessions/:sessionId`。
- snapshot 顶部展示当前 profile 的 `systemPrompt`，默认收起，使用 Markdown 渲染；它不作为普通历史消息写入 session。
- `session_entry` 事件会即时投影 profile system reminder / prompt 用户消息，避免等 invocation 结束后才刷新。
- `modelContextMessages` 不展示；`ModelContext` 内的 `Reminder` 已转成 pre-loop 可见消息，因此会展示。
- 需要用户看见、需要分支保存、需要 replay 的内容必须通过 `AppendingSet` 写入 session。

稳定 SSE 合同见 `spec/agent/sse.md`；当前重构 walkthrough 见 `docs/tasks/14-agent-sse-front-end-contract/README.md`。

### Run Error 可见化

运行失败的后端真相源是 `invocation_lifecycle` entry：

```ts
{
    type: "invocation_lifecycle",
    status: "error",
    error: string,
    errorInfo?: {
        message: string;
        phase: "prepare" | "pre_loop" | "model" | "tool" | "ingest" | "compaction" | "unknown";
        retryable?: boolean;
        code?: string;
    };
}
```

当前 phase 规则：

- profile catalog / config / tool compatibility / `prepare()` 前后失败归为 `pre_loop`。
- 自动压缩失败归为 `compaction`。
- provider streaming 抛错，或 provider 返回 assistant `stopReason: "error"`，归为 `model`。
- `profile.ingest()` 失败归为 `ingest`。
- 手动 `/compact` 失败归为 `compaction`。
- abort 暂不显示为错误卡，phase 仍可能是 `unknown`。

前端收到 snapshot 或 `session_entry` 增量中的 lifecycle error 后，会投影为可见的 system 消息：

- `systemDisplayKind: "error"`
- `systemLabel: "Run Error"`
- `content = errorInfo.message ?? error`
- `invocationId = entry.invocationId`

这条 Run Error 卡片只是前端投影，不是 `message` entry，也不会进入 `JsonlSessionRepository.reduce().messages`，因此不会污染下一轮模型上下文。如果同一个 invocation 已经有 provider assistant error message，前端只显示 assistant error，不再额外生成 Run Error 卡；但 lifecycle error 仍保留为运行状态真相。

阻塞式 `/api/agent/sessions/:sessionId/invocations` 返回 `{status: "error", invocationId, error, errorPhase}` 时，前端会先重新同步 snapshot。若同步后仍没有同 invocation 的 Run Error 或 assistant error，再用 notification 提示一次，覆盖 SSE 断开或事件丢失场景。

### Durable Turn Commit

普通 ReAct turn 的持久化边界是 `turn_end`，不是 assistant `message_end`。

- `message_start` / `message_update` / `message_end`、`tool_execution_start` / `tool_execution_end` 会立即通过 SSE 发给前端，用于当前运行中的 UI。
- 普通 turn 结束后，harness 一次性写入 assistant message，再按 assistant tool call 的 source order 写入 toolResult messages；这些 entry 与最终 leaf 移动会落在同一条 JSONL `batch` record 中。
- 无工具 assistant 也在 `turn_end` 写入，保持统一 durable commit 入口。
- 如果服务在普通工具执行中重启，当前 turn 尚未 commit，JSONL 不会留下半截普通 tool call。
- 如果服务在 commit 期间崩溃，普通 turn 也不会留下 assistant 已可见、toolResult 未可见的中间 leaf；旧 `entry` record 仍可读取，新 turn 使用 `batch` record。
- approval / request-user-input 类工具是合法 suspend point：waiting 时会持久化 assistant toolCall，等待用户 resolution 后再写对应 toolResult。
- 如果历史里已经存在旧的未闭合普通 tool call，harness 会拒绝继续发送给 provider，并提示需要切换干净分支或执行显式 session repair。

## Ingest

当前 `profile.ingest()` 在 ReAct loop 完成后运行，允许返回：

```ts
{
    messageWrites?: Message[];
    sessionUpdates?: {
        title?: string;
        summary?: string;
    };
}
```

本阶段不把 `ingest` 改造成 assistant / toolResult 归档策略。assistant / toolResult 仍由 harness 归档，但 durable 边界已经从 `message_end` 收敛到 `turn_end`，以避免服务重启留下普通未闭合 tool call。

## Compaction

自动 compaction 在进入 ReAct loop 前检查，输入是：

```text
reduced session messages + prepared.modelContextMessages
```

如果发生 compaction，会写 `compaction` entry。之后重新 reduce session，再进入 ReAct loop。手动 `/compact` 走 command 入口，不作为普通用户消息进入模型。

compaction policy 由 profile 的 `ProfileTurnPlan.compaction` 提供；profile 未配置时使用 harness 默认策略。TSX Profile 可以在 `<ProfilePrompt>` 顶层声明：

- `<Compaction triggerPercent={0.8}>`：按 `contextTokens / model.contextWindow` 自动触发。
- `<Compaction triggerTokens={120000}>`：按绝对 token 阈值自动触发。
- `reserveTokens`：默认 `8000`，也是 summary 输出预算来源。
- `keepRecentTokens` / `keepRecentPercent`：控制 recent context 保留预算；默认 `24000`。
- `<CompactionPrompt>`：覆盖压缩摘要调用的 provider `systemPrompt`。
- `<CompactionSummaryPrefix>`：覆盖 summary 写入 session 后注入后续上下文的前缀。

`triggerPercent` 与 `triggerTokens` 不能同时配置；`keepRecentPercent` 与 `keepRecentTokens` 不能同时配置。自动 compaction 和手动 `/compact` 共用同一套解析后的 policy；手动命令只读取 compaction policy，不写入 `HistorySet` / `AppendingSet` / `stateWrites`。

## Workbench Preview

TSX Profile Workbench 预览调用真实 profile `prepare()`，展示：

- `systemPrompt`
- `historyInitMessages`
- `appendingMessages`
- `modelContextAppendingMessages`
- `modelContextMessages`
- `compaction`
- `stateWrites`
- 当前目标 profile 派生出的 `report_result` schema

Workbench parser 解析 `context()` 中稳定的 `<ProfilePrompt>` DSL tree。复杂 TypeScript helper 仍以源码为真相源；可视化编辑只替换可定位的 `ProfilePrompt` JSX 片段。

预览里的最终 ReAct messages 使用真实 harness 规则近似计算：非空 session 不再把 `historyInitMessages` 追加到最终输入；`appendingMessages` 会作为 pre-loop 可见消息出现在 `reactMessages` 前半段，`modelContextMessages` 只出现在最终输入和自己的分区预览里。
