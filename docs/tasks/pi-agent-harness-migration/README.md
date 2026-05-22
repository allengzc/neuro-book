# Pi Agent Harness Migration

## User Request

- 全面重构当前 Agent 系统，逐步替换 LangChain provider/message/tool 边界，转向 `earendil-works/pi`。
- 本阶段先只考虑把后端 harness 做好，前端先不作为主要约束。
- 记录已经确认的设计方向、剩余关键问题和后续实现任务，后续实现继续基于本文档推进。

## Goal

- 建立新的后端 Agent Harness 方案，使用 Pi 的 message、event、tool execution 和 session 语义作为主干。
- 保留 Neuro Book 的 TSX Profile、用户 assets、workspace、agent、skill 等领域能力。
- 明确哪些部分直接采用 Pi，哪些部分由 Neuro Book 自己拥有。
- 在真正实现前，先固定关键边界，避免只把 LangChain provider 局部替换后继续保留旧系统复杂度。

## Current State

- 当前生产链路仍是 `server/agent` v2，大量依赖 LangChain `BaseMessage` / `AIMessage` / `ToolMessage`、LangChain provider adapter、LangChain tool schema 适配。
- 当前 thread/message 持久化已经有树结构和 active cursor，但运行时仍需要大量 codec 修复 tool call id、tool result 顺序、reasoning、usage、streaming delta 等边界。
- TSX Profile 系统已经支持 builtin/user assets 动态加载、profile preview、InputSchema/OutputSchema、allowed tools、workspace 默认 leader profile 和用户资产工作区。
- 旧 `server/agent-v3` NeuroAgent 原型已清空；新的 Pi-based v3 将继续在 `server/agent-v3` 内落地。新 v3 完成后，删除当前 `server/agent` v2，并将 `server/agent-v3` 移动/重命名为 `server/agent`。
- 当前 v2 后端 Agent 测试已删除，后续新 v3 测试重新按 Pi harness contract 建立。
- 本地 Pi 仓库位于 `.agent/workspace/pi`；已完成基础调研，见 `docs/research/pi-agent-harness.md`。
- Pi TUI / coding-agent 产品层作为 Neuro Book harness 的主要参考：它证明“产品自己拥有 session manager、资源解析、UI/TUI 状态，再调用 Pi core Agent”是可行路径。

## Walkthrough

- 已确认 `pi-ai` 的 canonical LLM message 只有 `user` / `assistant` / `toolResult`，assistant content 使用 `text` / `thinking` / `toolCall` block。
- 已确认 `pi-ai.Context` 支持 `systemPrompt?: string`，provider adapter 会将其映射到 OpenAI system/instructions、Anthropic system、Google systemInstruction 等 provider-native 字段。
- 已确认 `pi-agent-core` 的事件主干包含 `agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end` / `turn_end` / `agent_end`。
- 已确认 Pi 的 session/thread 机制是 append-only entry tree：entry 通过 `id` / `parentId` 组成树，active leaf 表示当前分支，`buildSessionContext()` 从 leaf 回溯并 reduce 出 LLM context。
- 已确认 Pi 的低层 tool lifecycle 使用 `beforeToolCall` / `afterToolCall` callback；高层 `AgentHarness` 会把它们包装成 hook event。
- 已确认 Pi 的 subagent 示例是 extension + CLI subprocess，不适合 Neuro Book 长期直接照搬；Neuro Book 只借鉴其 agent 调用模式，不保留 leader/subagent 领域分层。
- 已确认 `pi-coding-agent` 没有直接以 `AgentHarness` 作为产品主干，而是使用自己的 `AgentSession` / `SessionManager` / extension runner 包装 Pi core `Agent`。这支持 Neuro Book 自己实现 `NeuroAgentHarness`。
- 已确认 Pi 推荐把可编辑资源和会话状态放到清晰的本地目录约定下，例如 project-local `.pi/skills` / `.pi/prompts` / `.pi/extensions`、global `~/.pi/agent/...`、session JSONL 目录等；Neuro Book 应借鉴“约定目录直接挂在项目配置根下”，而不是继续把所有覆盖资源都塞进 `workspace/.nbook/assets`。
- Pi 相关参考文档已确认并用于本计划：`packages/coding-agent/README.md`（`/tree`、`/fork`、`/clone`、session 存储与互动命令）、`packages/coding-agent/docs/session-format.md`（JSONL session tree、`leaf`、`branchWithSummary`、`getTree`）、`packages/coding-agent/docs/compaction.md`（auto/manual compaction、branch summarization）、`packages/agent/docs/agent-harness.md`（harness phase、leaf 持久化、compaction/tree navigation）。

## Decisions

- 后端 harness 内部运行时事件主干采用 Pi `AgentEvent` 语义。
- 后端 harness 第一版不直接依赖 Pi `AgentHarness`。Neuro Book 自建 `NeuroAgentHarness`，底层使用 `pi-ai` + `pi-agent-core` 的 `Agent` / `AgentLoop` 能力。
- 前端暂不作为本阶段主约束；后端 v3 直接产出 Pi-like event DTO，不兼容当前前端旧 SSE DTO。后续前端接入时再基于 Pi event 与 Neuro Book custom event 设计新的 adapter。
- 第一版启用 `custom` entry 承载产品/运行时状态，例如 agent link/detach、session metadata、UI 状态和内部索引。`custom_message` 作为 entry 类型保留，但默认不主动使用；只有确实需要“模型可见 + UI 可自定义渲染 + 不归类为普通 user/assistant/toolResult”的内容时再启用。
- 采用 Pi 的 `Context` 形状：

```ts
type Context = {
    systemPrompt?: string;
    messages: Message[];
};
```

- `messages[]` 不允许直接放 LangChain `SystemMessage` 或 OpenAI 风格 `{ role: "system" }`。现有 TSX Profile 迁移时必须适配这一点。
- 当前阶段不 fork Pi 的 `Message` union 去加入 `SystemMessage`。system prompt 可以属于 session 可追踪历史，但发送给 provider 时走 `Context.systemPrompt`。
- v3 彻底禁止 TSX Profile 在 `messages[]` 中生成中间 `SystemMessage`。Profile prepare contract 只能输出 `systemPrompt?: string` 与 Pi-compatible `messages: Message[]`。旧 profile 如果需要“中途提醒”，应改成普通 user/assistant message、dynamic context 或 custom session state，而不是 SystemMessage。
- TSX Profile 机制保留。Pi 不替代 Neuro Book profile，Pi 替代的是 profile 之后的 provider/message/tool/runtime 形状。
- 未来 `prepare()` 不再返回 LangChain `BaseMessage[]`，而应返回 Pi/Neuro Book harness 可消费的 prepared turn plan，例如 `systemPrompt`、`messages`、`toolKeys`、`sessionWrites`、metadata writes。
- Pi append-only entry tree 语义全面采用。实现上可以先用 JSONL，也可以直接做 DB-compatible entry schema；长期应能从 JSONL 迁移到 DB。
- Profile 即 Agent。用户可以像开发本地插件一样开发 `.profile.tsx`，系统在不重启的情况下动态发现、加载和校验这些 agent。
- 删除 leader/subagent 领域分层，统一为 agent。`leader.default`、`leader.assets` 只是历史命名保留的 agent key，和其他 agent 没有类型层级差异。旧 `create_subagent` / `invoke_subagent` 在 v3 迁移为 `create_agent` / `invoke_agent`；Pi subagent 示例只借鉴 single / parallel / chain、输出截断、失败诊断、usage 汇总等模式。
- Agent runtime 统一采用 TypeBox / JSON Schema。v3 profile 的 `InputSchema` / `OutputSchema`、内置工具 schema 和 agent catalog schema 都迁移为 TypeBox，不保留 Zod 兼容层。非 Agent 的 API DTO 暂不作为本重构范围。
- 新 v3 直接落在 `server/agent-v3`，不再保留旧 v3 原型兼容层。完成后采用目录替换策略：删除 v2 `server/agent`，再将 `server/agent-v3` 提升为 `server/agent`。
- v2 后端测试不作为迁移包袱保留。新 v3 根据新的 harness/session/tool/profile contract 重新建立测试。
- 不直接把 Pi `AgentHarness` 作为 Neuro Book 后端主干。Neuro Book 实现自己的 `NeuroAgentHarness`，参照 Pi TUI / coding-agent 的产品层做法：产品层拥有 session、workspace、profile、resource、tool policy、SSE/事件适配和前端状态语义，底层使用 Pi core `Agent` / `AgentLoop`、Pi message/tool/event 类型。
- JSONL session 第一版放在 `workspace/.nbook/agent/sessions`。这是 Neuro Book workspace 容器级运行时状态目录，不是用户 assets 覆盖目录；session entry schema 要保持 append-only tree，并预留未来迁移到数据库的字段形状。
- 用户资产工作区根目录从旧的 `workspace/.nbook/assets` 重新评估为 `workspace`。第一阶段先限定可打开工作区为 `workspace/{novel}` 与 `workspace` 两类，不做任意文件夹选择器；长期再演进到 VS Code 式指定文件夹作为 workspace。
- `.nbook` 作为 Neuro Book workspace 配置目录，既承载运行时元数据，也承载用户可编辑的配置/资源覆盖层。
- 去掉 `resources` 目录层级。参照 Pi 的 project-local `.pi/...` 习惯，资源目录直接挂在 `.nbook` 下。
- Agent 相关可编辑资源放在 `.nbook/agent/...` 下：profiles、skills 与 sessions 同属 agent 体系，但通过子目录区分“可编辑定义”和“运行时会话”。
- 非 Agent 的可覆盖资源放在 `.nbook/assets/...` 下，但不再保留旧的 `.nbook/assets/server/workspace/...`。旧 `server/workspace` 暴露实现分层，迁移后改成更领域化的 `templates`。
- 系统级 assets 采用和用户 workspace 配置根完全镜像的结构：系统根从 `assets/` 调整为 `assets/.nbook/`，用户根为 `workspace/.nbook/`。resolver 从“系统 `.nbook` 根 + workspace `.nbook` 根”合成，而不是依赖旧 `assets/server/workspace` 与 `workspace/.nbook/assets/server/workspace` 的历史路径。

## Pi Tool Execution Notes

- assistant message 中的 tool call 是 content block：

```ts
{
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
```

- 执行流程：
  - 解析 assistant message 中的 tool calls。
  - 根据全局 `toolExecution` 和单个 tool `executionMode` 决定 parallel 或 sequential。
  - 对每个 tool call 执行 `prepareArguments`。
  - 使用 TypeBox schema 校验参数。
  - 调用 `beforeToolCall`，可返回 `{ block: true, reason }` 阻止执行。
  - 调用 tool `execute(toolCallId, params, signal, onUpdate)`。
  - tool 可通过 `onUpdate` 产生 `tool_execution_update`。
  - 调用 `afterToolCall`，可改写 `content` / `details` / `isError` / `terminate`。
  - 生成标准 `ToolResultMessage`，然后进入下一轮 LLM context。
- 并行执行时，`tool_execution_end` 可按完成顺序发出；tool result message 应按 assistant 原始 tool call 顺序进入上下文。
- Neuro Book 的审批、白名单、Plan Mode gate、skill gate、workspace/assets 权限检查适合落在 `beforeToolCall` 对应的后端 harness hook。
- `report_result`、`request_user_input`、agent 结果归一化、超长输出截断适合落在 `afterToolCall` 对应的后端 harness hook。
- 第一版不做插件式 hook registry，采用固定 tool pipeline：schema validate -> tool policy / allowedToolKeys -> workspace permission -> execute -> result normalize -> special handling -> persist events。
- `report_result` 实现为普通 tool，但 `afterToolCall` / harness completion collector 会识别它的结构化结果并更新 run completion state。
- `report_result` 不作为所有 agent 的隐式内置工具。profile 作者必须在工具权限中显式允许 `report_result`，目标 agent 才能调用它。第一版不自动给所有 agent 注入 `report_result`。
- `request_user_input` 保留为 v3 tool contract，并与 Plan Mode / skill 审批共用 `continue + resolution` 恢复入口。第一版不新增 custom pending entry；等待态由 session 尾部未完成的 hardcoded approval tool call 推导。
- tool result 的 model-visible content 进入 LLM context；raw/details 只进入 session entry metadata，不默认塞给模型。
- `report_result` 缺失时的返回规则：
  - 如果目标 agent 正常结束 ReAct，但最后一条消息不是 `report_result`，harness 先自动追加一条提醒，要求目标 agent 以 `report_result` 结束；如果下一轮仍然以普通消息结束，则把“最后一条普通消息 + 未正确 report 的提醒”一起返回给调用方。
  - 如果是 harness 级错误，例如 provider/API 超时，则调用方直接收到错误报告。
  - 如果是 `report_result` 参数错误，不单独做特殊分支处理；目标 agent 的 ReAct loop 自行纠错，这类情况归入上面两种结果路径。

## Session / Thread Plan

- 新后端 harness 使用 session 作为核心抽象，不再把 provider history 当作一组可变 message。
- 第一版 session repo 使用 JSONL 文件，根目录固定为 `workspace/.nbook/agent/sessions`。
- session 文件属于运行时数据，不进入用户 assets 覆盖体系。用户在 `workspace` 工作区编辑资源时，默认不应该把 session JSONL 当作普通 profile/skill 文件来维护。
- 目标 entry 类型至少包含：
  - `message`
  - `model_change`
  - `thinking_level_change`
  - `profile_change`
  - `variable_change`
  - `session_update`
  - `compaction`
  - `branch_summary`
  - `custom`
  - `custom_message`
  - `label`
  - `leaf`
- `leaf` 必须持久化，不能只是内存 cursor。
- `session_update` 用于 append-only 地更新 session metadata，例如 `title` / `summary`。最终 session 标题和摘要由 reducer 取 active path 上最新值，不做原地覆盖。
- `custom` 和 `custom_message` 的区别：
  - `custom` 是运行时/产品状态 entry，例如 UI 状态、pending 状态、内部索引、工具详情或审计信息。它参与 session reducer 的 `customState`，但不进入 LLM context。
  - `custom_message` 是产品自定义但模型可见的消息 entry。它可以进入 LLM context，并可单独控制 UI 是否展示。
- `request_user_input`、Plan Mode、skill approval 等等待态统一通过硬编码 approval tool 集合处理。第一版集合为 `request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`skill`。
- 第一版不为等待态新增 `custom pending` entry。pending 状态由 session active leaf 推导：最后一条 assistant message 中存在 hardcoded approval tool call，且后续没有对应 `toolResult`。
- 活跃进程内，`beforeToolCall` 可以等待用户操作；用户批准/拒绝/回答后，harness 生成对应 `toolResult` 并继续当前 run。
- 如果程序在等待审批期间终止，重启后前端/后端通过 session 尾部 assistant tool call 恢复待处理状态。恢复时调用 `continue` 的 `resolution` 参数，由 harness 先 append 对应 `toolResult`，再执行 Pi `continue()`。未批准的工具不会因为重启被自动执行。
- 构造模型上下文时，从 active leaf 回溯到 root，得到 path，再 reduce 出 `systemPrompt`、`messages`、model、thinking level、profile/runtime state。
- Neuro Book 的 reducer 结果采用 `NeuroSessionContext` 方向，比 Pi `SessionContext` 多保留 profile、workspace 和产品状态：

```ts
type NeuroSessionContext = {
    systemPrompt: string;
    messages: AgentMessage[];
    model: ModelRef | null;
    thinkingLevel: string;
    profileKey: string;
    workspaceRoot: string;
    customState: Record<string, unknown>;
};
```

- 旧 thread 历史不应被静默改写；继续采用 append-only 语义。
- 如果先用 JSONL，应保持 entry schema 和未来 DB 表结构兼容。
- 参照 Pi session tree：单个 session 文件内保留分支树，`leaf` / active cursor 需要持久化；fork/clone/tree navigation 后续在同一 entry tree 语义上实现。
- Pi 中可回溯/选择的“阶段”是 session `entry`。每个 entry 都有 `id`、`parentId`、`timestamp`，组成 append-only tree；当前所在阶段由 `leaf` 指针表示。
- 回到任意阶段不是删除历史，而是把 `leaf` 移到目标 entry。之后继续追加会在该 entry 下产生新 branch。Pi 的 `moveTo(entryId)` / tree selection 就是这个语义。
- entry 可以存自定义数据：
  - `custom` entry：存扩展/产品状态，不进入 LLM context。
  - `custom_message` entry：存自定义消息，可进入 LLM context，并可控制是否在 UI 显示。
  - `label` entry：给某个 entry 加用户标签/书签。
  - `branch_summary` / `compaction` entry：系统级 summary entry，也可带 `details`。
- 旧 v2 `AgentThread` / `AgentMessage` 不迁移到 v3 session。当前还没有真实用户数据，允许彻底重构，避免为了旧模型引入兼容补丁。
- v3 内部与 API 命名都使用 `sessionId`，不继续沿用旧 `threadId`。`sessionId` 第一版使用全局唯一数字递增 ID，便于模型、UI、日志和跨 workspace agent 调用直接引用；本阶段先把后端 contract 定干净，前端后续跟随迁移。
- 本次是完全重构，不做兼容补丁。过时的 v2 设计只作为理解材料，不作为 v3 约束；遇到边界不清时优先参考 Pi 的 session / resource / event 设计重新优化。
- Agent 调用第一版保留两个显式接口，而不是一个接口里塞 `mode`：
  - `prompt`：追加新的用户输入并启动 run。
  - `continue`：不追加新用户输入，从当前 session/context 继续 run。
- session JSONL 文件按 workspace key 分目录，但文件名使用全局唯一数字 `sessionId`：

```text
workspace/.nbook/agent/sessions/
  global/
    <session-id>.jsonl
  <novel-workspace-key>/
    <session-id>.jsonl
```

- 全局 `workspace` 的 workspace key 使用 `global`。小说 workspace key 后续可用 novel slug/id，但必须稳定、文件名安全，并能从 session metadata 反查真实 workspace root。
- `sessionId` 不按 workspace 重新从 1 开始。全局递增可以避免两个 workspace 同时存在 `sessionId=1` 时，工具/API 必须额外携带 workspace scope 才能定位 session。
- 全局 session 计数器第一版可以放在 `workspace/.nbook/agent/session-seq.json` 或 `workspace/.nbook/agent/sessions/index.json`。后续迁移到数据库时，数字 `sessionId` 可以直接映射为自增主键。
- `profileKey` 是选择 profile/agent 实现的稳定业务 key，例如 `leader.default`、`leader.assets`、`writer.default`、`retrieval.default`。session metadata / session entry 记录 `profileKey`，构造上下文时用它加载当前最新 profile。
- 不引入 `profile epoch` 作为第一版核心概念。当前基础模型仍是“session 历史消息 + profileKey + 每轮 prepare”。`HistorySet` 是否注入由历史状态决定：如果历史里已经有 profile 稳定前缀，则不重复注入；如果是新 session 或显式切换 profile 后需要新稳定前缀，则按新 session 状态处理。
- profile source hash 不冻结执行。v3 保持“下次运行按 profileKey 加载当前最新 profile 实现”的语义；hash 不写入 session schema，第一版不做 profile 来源审计。
- profile TSX 源码变化本身不主动改写所有旧 session，也不追加 `profile_snapshot` entry。是否重新注入 `HistorySet` 只由 session 历史状态和显式 profile 切换行为决定。
- session entry 不保存完整 prepared prompt。持久化历史由真实 user/assistant/tool messages、`HistorySet` 首次稳定前缀、`AppendingSet` 需要写入历史的运行期消息，以及 profile/session state entry 组成。
- `HistorySet` 渲染结果是 `message[]`，并作为普通 `message` entries 写入 session。第一版不引入 `profile_history` entry 作为历史容器，也不写 origin metadata。
- `create_agent` 创建空 session 时不立刻注入 `HistorySet`。空 session 只保存实例配置、metadata 和必要 session entries；第一次 `invoke_agent(prompt)` 或 `continue` 实际运行时再 prepare，并在需要时把 `HistorySet` 写入 session。
- `HistorySet` 首次写入 session 后，不因 profile 源码更新自动替换。profile 更新只影响后续 `SystemSet` / `DynamicSet` / prepare 行为，不改写已经落入 history 的稳定前缀。
- `DynamicSet` 是本轮临时上下文：进入本轮 provider context，不写 session。
- `AppendingSet` 是贴近当前输入的最新上下文区域：进入本轮 provider context，并且渲染出的非空 messages 默认全部写入 session。v3 可以优化具体 entry 形态，但不能把它降级成“不进上下文”或“只是不持久化”的区域。
- `AppendingSet`、本轮 user message、需要写入 history 的运行期上下文，应在 provider 调用前写入 session。这样即使 run 被 abort 或 provider 报错，session 仍记录模型实际看到过的上下文。
- run 被 abort、provider error 或工具系统错误时，已经写入的 user message / AppendingSet / 部分 assistant streaming message 都保留，并追加 run status / error entry 标记结果，不做回滚。
- v3 profile DSL 新增 `SystemSet`，并把现有 `HistorySet` 的“唯一 system prompt”职责拆出去：
  - `SystemSet` 只生成 Pi `Context.systemPrompt` 字段。Pi 当前 `systemPrompt` 类型是 `string`，因此第一版 `SystemSet` 输出也只支持最终 string，不支持 image/content blocks 等富文本片段。
  - `SystemSet` 第一版严格只接受 string system prompt，不设计富文本 systemPrompt。原因是 Pi 当前 `Context.systemPrompt` 就是 string，强行加富文本会制造额外 provider adapter 复杂度。
  - `SystemSet` 不进入 `Context.messages[]`，也不作为普通 session message 反复追加。
  - `HistorySet` 继续表达稳定历史前缀。它在新 session 或显式新 profile 历史前缀需要落地时进入 session history；后续普通 turn 不重复注入。
  - compact 不重新注入原始 `HistorySet`。compact 前，profile 看到的 history 来自 session active path；compact 后，history reducer 按 Pi 语义提供 compaction summary + recent messages。
- `reserveTokens` / `keepRecentTokens` 属于 compaction policy，第一版跟随 harness/config 设置。profile 不提供 compaction 建议值，也不提供压缩提示词。

## Workspace / Assets Redesign Notes

- 当前代码仍大量使用 `workspaceKind: "user-assets"` 和 `workspace/.nbook/assets`：
  - Novel IDE store 把用户资产工作区显示为 `workspace/.nbook/assets`。
  - workspace-files API 通过 `workspaceKind: "user-assets"` 固定解析到该目录。
  - asset resolver、skill catalog、profile registry、workspace 模板覆盖和 profile settings 都依赖这个常量。
- 新方向是把“用户资产工作区”改成普通 workspace 根的一种：打开 `workspace`，而不是打开 `workspace/.nbook/assets`。
- 第一版只支持两类 workspace root：
  - `workspace/{novel}`：单本小说工作区。
  - `workspace`：全局用户工作区，替代旧 `?workspace=user-assets`。
- 这意味着 `workspaceKind` 后续不应继续表达为 `"novel" | "user-assets"`，而应逐步转向 workspace root / workspace scope 概念。旧 query 可以保留短期迁移入口，但内部应收敛到“当前打开的 workspace root”。
- `.nbook` 是 workspace 级 Neuro Book 配置目录，不再只表达 metadata/internal。
- 目标目录结构：
  - `.nbook/agent/profiles`：用户自定义或覆盖 Agent profile。
  - `.nbook/agent/skills`：用户自定义或覆盖 skill；同名 skill 继续按整个目录覆盖。
  - `.nbook/agent/sessions`：Pi-style append-only session JSONL。
  - `.nbook/assets/templates/content-nodes`：内容节点模板，替代旧 `server/workspace/content-node-templates`。
  - `.nbook/assets/templates/novel-workspace`：新小说 workspace 初始模板，替代旧 `server/workspace/novel-directory-template`。
- 系统内置 `assets/.nbook/` 同步调整为相同结构：
  - `assets/.nbook/agent/profiles` 覆盖到 `workspace/.nbook/agent/profiles`。
  - `assets/.nbook/agent/skills` 覆盖到 `workspace/.nbook/agent/skills`。
  - `assets/.nbook/assets/templates/content-nodes` 覆盖到 `workspace/.nbook/assets/templates/content-nodes`。
  - `assets/.nbook/assets/templates/novel-workspace` 覆盖到 `workspace/.nbook/assets/templates/novel-workspace`。
- 覆盖机制以 `.nbook` root 为统一边界比较内部相对路径。系统 `assets/.nbook/<relative>` 被用户 `workspace/.nbook/<relative>` 覆盖；同名 skill 目录仍按整个目录覆盖，其他资源按文件覆盖。
- 系统 assets 路径迁移采用一次性硬切，不保留旧 `assets/agent/...`、`assets/server/workspace/...`、`workspace/.nbook/assets/...` 的兼容扫描 fallback。迁移实现必须同步更新 resolver、同步系统 assets、profile catalog、skill catalog、workspace template loader、profile check/prepare 脚本、测试 fixture 和提示词中的路径说明。
- 全局 `workspace` 工作区的文件树默认显示 `.nbook`，包括 `.nbook/agent/sessions`。这个入口用于编辑和检查 Neuro Book 配置、资源与运行时会话。普通 `workspace/{novel}` 小说工作区可以继续隐藏或弱化 `.nbook`，避免写作时被内部配置和 session 文件干扰。
- 旧 `workspace/.nbook/assets/...` 用户目录不做迁移脚本，也不做运行时 fallback；当前还没有真实用户数据，直接硬切。
- “同步系统 assets”迁移后从 `assets/.nbook` 复制缺失文件到 `workspace/.nbook`，目标已存在时继续跳过，不覆盖用户文件。

## Profile Fusion Plan

- 当前 TSX Profile 的 DSL 和用户资产体系继续保留。
- v3 术语收敛为：profile 就是 agent 定义；agent session 是某个 profile/agent 的运行实例。不再保留 `leader` / `subagent` 作为架构概念。
- `leader.default` 和 `leader.assets` 只是系统内置 agent 的 key/name。使用这两个 agent 的入口负责按它们各自的 `InputSchema` 创建实例配置；运行时不再因为 key 前缀给它们特殊类型待遇。
- Agent session 与 agent instance 第一版保持 1:1：
  - `AgentDefinition` 是 `.profile.tsx` 定义。
  - `AgentInstance` 是 `profileKey + input`，其中 `input` 由该 agent 的 `InputSchema` 校验。
  - `AgentSession` 绑定一个 `AgentInstance` 的 append-only 历史。
  - `AgentSession` metadata 第一版包含 `title` 和 `summary` 两个可读字段。它们可以由 AI 或用户更新，用于在 `get_agent()`、UI 列表和父 agent prepare snapshot 中识别 agent 目的。
  - 允许空 session：`create_agent` 可以只创建 `AgentInstance + AgentSession`，不立即写入 user message。`profileKey + input` 必须已知并通过 schema 校验，但 `title` / `summary` 初始可以为空；第一次 run 后再由 profile/harness 生成或更新。`get_agent` 列表中如果 `title` 为空，展示层可退回 `profileKey`。
  - 同一个 session 不允许中途切换 `profileKey` / agent definition；要换 agent 就创建或打开另一个 session。
  - 第一版不允许修改已创建 agent 的 `input`。要调整实例配置就创建新 agent。未来如果需要支持修改，应采用 append-only input update entry，并由 reducer 取 active path 上最后一次合法 update 作为当前 input，不做原地覆盖。
  - 这样可以避免 `HistorySet`、`SystemSet`、compact summary、tool allowlist 和实例 input 在同一条历史里混用。
  - `create_agent` 返回最小可识别信息：`sessionId`、`profileKey`，以及可选 `title`。调用方后续只用全局 `sessionId` 调用或查询该 agent。
  - `workspaceRoot` 在 `create_agent` 时固定，第一版不允许修改。要换 workspace 就创建新 agent，避免文件工具权限、相对路径和历史消息里的路径语义混用。
- 用户自定义 agent 开发方式：
  - agent/profile 模块继续使用 `defineAgentProfile` 契约。
  - 模块显式导出 `profileManifest`、`InputSchema`、`OutputSchema`、`Input`、`Output`。
  - 用户或 Agent 修改 `.profile.tsx` 后，通过单文件 typecheck 命令校验；共享源码变化再跑 `bun run typecheck`。第一版不依赖任何准备好的兼容层，profile 源码与静态类型索引保持同一套 TypeBox 约束。
  - 动态 loader 监听或按需扫描系统/用户 `.nbook/agent/profiles/**/*.profile.tsx`，支持不重启发现新增、删除和修改的 agent。
  - 用户自定义 profile 的运行时加载与静态类型推导分两层：运行时直接动态 import + TypeBox 校验，不依赖 prepare/typegen；开发期如果需要按 `profileKey` 静态推导 `Input` / `Output`，则通过 typegen 生成 `DynamicProfileInputMap` / `DynamicProfileOutputMap` 并与 builtin map 合并。builtin key 的静态类型永远不被用户覆盖改写。
- Profile catalog 是运行时事实源：可以列出动态发现的 agent，并读取每个 agent 的 manifest、InputSchema、OutputSchema、allowed tools、加载错误和可预览的 prepare 结果；v3 runtime 删除 `kind` 字段，不再区分 leader/subagent。
- Profile catalog loader 的错误策略分层处理：单个 profile 加载失败时，catalog snapshot 继续可用，只记录该 profile 的加载错误且不把它作为可调用 agent；当前 session 正在使用的 profile 本身加载或 prepare 失败时，本次 run 直接失败并返回明确错误，不静默 fallback 到旧版本或系统默认 profile。
- 每个 profile 实例在 prepare 时都可以访问当前已注册 agent catalog 的 schema/manifest，并自行决定是否把这些信息用于 `DynamicSet` 或 `AppendingSet` 注入到自己的提示词中。schema 不是专门注入给某个 leader，而是 profile prepare runtime 可访问的能力。
- prepare runtime 暴露的是本轮只读 catalog snapshot。虽然 Node 运行在单线程事件循环上，`prepare` 仍可能 `await`，期间文件 watcher 或用户操作可能更新 registry；因此本轮 prepare 应捕获一致快照，避免同一轮提示词构造中前后读到不同 catalog。
- catalog schema 访问第一版使用 getter / lazy detail 形态：
  - `ctx.agentCatalog.list()` 返回轻量条目：key、name、description、allowed tools、schema 摘要、加载状态。
  - `ctx.agentCatalog.detail(profileKey)` 返回该 agent 的完整 InputSchema / OutputSchema JSON Schema。
  - getter 从本轮 snapshot 读取，不触发 registry mutation。
  - profile 作者决定是否把 list/detail 结果渲染进 `DynamicSet` 或 `AppendingSet`。
- `allowedToolKeys` 在 v3 仍作为 runtime 硬权限和默认可见工具集合。用户自定义 profile 可以自己放开工具，但 harness 只向模型暴露目标 profile 声明允许的工具，不把所有工具默认暴露。
- `allowedToolKeys` 同时是“模型可见工具集合”和“执行硬权限上限”。harness 只向模型暴露其中列出的工具，执行前也必须再次校验；即使模型生成了未暴露工具的 tool call，也要拒绝。
- profile 可以声明空 `allowedToolKeys`，用于纯聊天或纯提示 agent。没有 `report_result` 权限的 agent 不能调用结构化结果工具，`invoke_agent` 按普通 completion / missing report 规则处理。
- skill 第一版不做代码层面的 `allowedSkillKeys` 硬拦。可见性先由 `SkillCatalog` 支持属性过滤：Agent 只能在 catalog 中看到指定 skill；但如果后续通过其他路径获得 skill name，第一版不在工具执行层强制拒绝。TODO：未来补 skill 白名单硬权限。
- v3 调整 InputSchema 语义：
  - `InputSchema` 不再表示每次 invoke 时的自然语言请求参数。
  - `InputSchema` 表示创建某个 agent 实例时的结构化配置，也就是“用这些字段构造一个 Profile 实例”。
  - `ctx.input` / `scope.input` 在 `buildPrompt(ctx)` 中仍然可用，含义是该 agent 实例的配置字段。
  - 每次调用 agent 的运行时输入统一为 `message`，可以包含文本和图片。
  - 用户自定义 profile 的静态类型靠 prepare/typegen 生成索引；运行时直接按 profile module 的 TypeBox schema 校验，不走 Zod 或旧兼容分支。
- `create_agent` / `invoke_agent` 工具语义：
  - `create_agent` 使用目标 agent 的 `InputSchema` 校验并保存实例配置，可以创建任意 agent 实例和空 session。
  - 当 `create_agent` 由某个父 agent session 调用时，默认自动建立 owned / linked agent 关系；该关系挂在当前父 session 上，不挂到整个 workspace。父 agent 后续 prepare 能看到这个 agent session。
  - `create_agent` 创建的目标 agent 不继承父 agent 的工具权限。目标 agent 始终使用自己的 profile `allowedToolKeys`、模型设置、thinking 设置和 workspaceRoot。
  - `create_agent` 第一版只允许传目标 agent `InputSchema` 所需字段，不允许额外覆盖 model / thinkingLevel / workspaceRoot。后续如需修改这些运行设置，应设计独立 agent settings。
  - `create_agent` 可以接受可选 `title` / `summary` 初始值；如果未提供，后续由 agent 或 UI 根据运行结果更新。
  - `invoke_agent` 调用已有 session，只接收目标 `sessionId` 和 `message`，message 可包含图片；它不再接收目标 agent 的 `InputSchema` 结构。
  - 所有 agent 遵循相同 invoke 输入形态。
- `invoke_agent` 同样支持两种调用模式：`prompt` 和 `continue`。`prompt` 追加新输入并开启新一轮运行；`continue` 不追加新用户消息，只从当前 session active leaf 继续执行。基于上一次 invocation 的恢复/继续也归入 `invoke_agent`，而不是单独拆成别的工具。
  - `invoke_agent` 的 `prompt` 模式必须带 `message`；`continue` 模式不允许带 `message`。
  - `continue` 模式可以携带 `resolution`，用于补齐尾部未完成 approval tool call 的 `toolResult` 后再继续运行。`resolution` 是 harness control-plane 入参，不直接暴露给模型；模型最终只看到由 harness 生成的标准 textual `toolResult`。
  - `resolution` 第一版只支持 hardcoded approval tool 集合：`request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`skill`。harness 必须验证 session 尾部 assistant message 中存在匹配 `toolCallId` / `toolName`，且尚无对应 `toolResult`，否则拒绝恢复。
  - `resolution` 建议 DTO：

    ```ts
    type InvokeAgentResolution =
        | {
            kind: "tool_approval";
            toolCallId: string;
            toolName: "request_user_input" | "enter_plan_mode" | "exit_plan_mode" | "skill";
            approved: boolean;
            payload?: Record<string, unknown>;
        }
        | {
            kind: "user_input";
            toolCallId: string;
            toolName: "request_user_input";
            answers: Array<{
                questionIndex: number;
                text: string;
            }>;
        };
    ```

  - `request_user_input.answers` 第一版允许自由文本回答。前端负责按题号组装最终文本，后端只接收 `questionIndex + text` 结构，不在 harness 内做文本拼装。
  - `payload` 用于承载审批型工具的结构化业务参数，例如 `exit_plan_mode` 的 `planFilePath` / `planContent`、`skill` 的 skill name 或后续 UI-only 预览字段。harness 读取这些字段来应用副作用和生成 tool result；tool result 的 model-visible content 仍然是短文本。
  - approval 恢复流程：读取尾部 assistant tool call -> 校验 `resolution` -> 按 hardcoded tool 逻辑应用副作用或拒绝副作用 -> append 标准 `ToolResultMessage` -> 调用 Pi `continue()`。
  - `invoke_agent.block` 可选，默认 `true`。阻塞调用等待目标 agent 本轮运行结束后返回结果；非阻塞调用后续再做，第一版只在 schema / TODO 中预留方向。
  - `invoke_agent` 运行目标 session 时，使用目标 session 自己绑定的 workspaceRoot，不继承调用方 workspaceRoot。跨 workspace 调用可以发生，但被调用 agent 仍在自己的 workspace 边界内运行。
  - 父 agent 调用子/关联 agent 时，不把目标 session tree 挂到父 session tree 下面。父 session 只记录一次 tool call / tool result 摘要，目标 agent 的完整历史留在目标 session 中。
  - 父 agent 拥有或关联的 agent 列表仍然需要对 profile prepare 可见。v2 `leader.default` 里依赖 `scope.agent.subagents` 注入“当前已关联 subagent”；v3 删除 leader/subagent 概念后，应改成通用的 owned / linked agents snapshot。
  - `create_agent` 可以创建任意 agent。由某个 agent 调用创建时，自动 link 到该父 agent；用户/API 显式给某个 agent 创建子 agent 时，也按该父 agent owned link 处理。普通用户/API 直接创建 agent 则只创建独立 session，第一版不做前端自动 link。
  - `get_agent(id?: number)` 作为第一版查询工具：无参时返回当前父 agent 拥有且未 detach 的 agents 列表；有参时返回指定 agent 的轻量详情。它面向模型识别和继续协作，不返回运维噪声。
  - `get_agent` 不返回完整 `input` 配置，也不引入 `inputSummary`。识别 agent 用途统一依赖 session metadata 的 `title` / `summary`。
  - `get_agent` 第一版字段收敛为：`sessionId`、`profileKey`、`title`、`summary`、`status`、`lastResult`、`lastError`。`lastResult` 优先来自最后一次成功 `report_result`，没有时可退回最后 assistant 摘要；usage、run timing、messageCount、toolCallCount 等运行统计不默认暴露给模型工具，后续进入 session/API 调试面。
  - `get_agent` 的 `id` 直接使用数字递增 `sessionId`，不再引入父 agent 本地短 ID 或额外映射表。
  - `get_agent(id)` 的 `id` 只接受全局 `sessionId`，不支持别名、局部 id 或 profile key 查询。
  - `get_agent(id)` 第一版允许按全局 `sessionId` 查询 agent，不限制必须是当前父 agent owned。后续如果需要权限隔离，再在 session API/tool policy 层收紧。
  - `get_agent` 只做状态查询，不承接恢复逻辑；恢复/继续统一回到 `invoke_agent` 的 `prompt` / `continue` 两种模式。
  - `detach_agent` 解除当前父 agent 对某个 owned agent 的拥有/可见关系。它不删除目标 agent session，不修改目标 agent history，不停止正在运行的目标 agent，只让父 agent 的 prepare snapshot 和 `get_agent()` 无参列表不再显示它。
  - link / detach 事实可以作为 session entry 保留以便回放和排障，但 detached agent 不再进入当前父 session 的 prepare snapshot。
- `sessionId` 与 `invocationId`：
  - `sessionId` 是长期 agent session 标识，绑定一个 `AgentInstance` 和 append-only entry tree。第一版使用全局唯一数字递增 ID；一个 session 可以被多次 `invoke_agent` / prompt / continue。
  - `invocationId` 是单次调用/run 标识，只表示“这一次 invoke_agent 请求”。它用于非阻塞调用、事件订阅、日志追踪和精确查询某一次 run；不是 agent 长期身份。
  - 第一版如果只做阻塞 `invoke_agent`，可以不把 `invocationId` 暴露给模型工具；等实现 `block: false` 或 run 级查询时再引入。引入时建议同样使用全局唯一数字递增 ID。
- `invoke_agent` 阻塞返回契约：
  - Pi core 的 `prompt()` / `continue()` await 到 `agent_end`，事件里 `turn_end` 带本 turn 的 assistant message 和 toolResults，`agent_end` 带本次 run 新产生的 messages。Pi coding-agent 的 subagent extension 返回 model-visible content，同时把完整子进程结果放在 tool details：每个结果包含 messages、usage、model、stopReason、errorMessage 等。
  - Neuro Book v2 `invoke_subagent` 当前会同步等待 subagent 完成，然后从子线程历史中优先解析最后一次 `report_result`，否则退回最后一条 assistant 文本；中间 live 消息不嵌回父线程。
  - v3 采用两者折中：`invoke_agent` 返回目标 session 的本次运行摘要、最终 assistant 摘要、usage 汇总和 `report_result` 结果；完整 history 只通过 session API 查询，不塞入工具返回。
  - 建议 DTO：

    ```ts
    type InvokeAgentResult = {
        sessionId: number;
        invocationId: number;
        status: "completed" | "failed" | "stopped";
        block: true;
        finalMessage?: string;
        reportResult?: unknown;
        error?: {
            message: string;
            code?: string;
        };
    };
    ```

  - 阻塞返回值必须包含 `sessionId` 与 `invocationId`。`sessionId` 是目标 agent 长期身份；`invocationId` 是本次 run 的追踪号，用于后续事件订阅、调试和非阻塞调用。第一版 `invocationId` 只在 API/tool 返回值中出现，不额外暴露给模型提示词。
  - `block: false` 第一版不实现，只保留 TODO。当前 `invoke_agent` 默认并实际只支持阻塞调用。

- `report_result` 是 OutputSchema 的提交点：如果目标 agent 的 `OutputSchema` 校验失败，`report_result` 工具返回 tool error，让目标 agent 在自己的 session 内观察错误并更正；这不是立刻返回给父 agent 的失败。
  - 目标 agent 只有遇到不可挽回错误才向调用方返回错误，例如 provider/API 错误、工具系统错误、被显式停止且没有可用结果，或运行结束但目标 profile/policy 要求 `report_result` 而始终没有成功提交。
  - v3 可以参考 v2 `collectSubAgentCompletion` / `resolveSubAgentCompletionResult` 的完成判定：等待目标 session run 结束后，从历史里优先解析最后一次成功的 `report_result`；没有时再按 profile/policy 决定是否退回最后 assistant 文本，或报“未产出可用最终结果”。
  - 如果目标 agent 没有调用 `report_result`，但产出了最终 assistant 文本，`invoke_agent` 是否可返回 `finalMessage` 由目标 profile/policy 决定；通用 agent 可以允许，结构化输出 agent 应要求 `report_result`。

## Agent Tool Inventory

### 当前 v2 已注册工具

- `create_subagent`：创建并挂接 subagent，按当前可用 subagent profile 选型。
- `list_subagents`：列出当前 leader 线程挂接的 subagent。
- `invoke_subagent`：同步调用已挂接 subagent，等待完成后返回最终结果。
- `report_result`：agent 提交最终结果，校验输出结构。
- `request_user_input`：请求用户补充输入。
- `enter_plan_mode` / `exit_plan_mode`：软 Plan Mode 入口。
- `skill`：skill 相关入口。
- `task_create` / `task_set_status`：任务列表创建与状态更新。
- `execute_sql`：数据库查询/写入工具。
- `execute_shell`：命令执行工具。
- `read_file` / `edit_file` / `apply_patch` / `write_file`：文件读写编辑工具。
- `update_novel`：小说元数据/工作区更新工具。
- `get_plot_tree` / `get_story_thread` / `get_story_scene_context` / `get_chapter_plot`：剧情与内容节点查询工具。
- `create_story_thread` / `update_story_thread` / `create_story_scene` / `update_story_scene` / `create_story_plot` / `update_story_plot`：剧情结构编辑工具。

### v3 计划中的 agent 相关工具

- `create_agent`：创建任意 agent 实例和空 session。
- `invoke_agent`：按 `sessionId` 调用 agent，支持 `prompt` / `continue`，支持 `block`。
- `get_agent(id?: number)`：无参列出当前拥有的 agents；有参查询指定 owned agent 详情。
- `detach_agent`：解除当前父 agent 对某个 owned agent 的拥有/可见关系，不删除目标 session。
- 第一版不再单独设计 `query_agent` / `get_agent_status` / `list_agents` / `list_linked_agents`，统一收敛到 `get_agent`。
- 迁移重点是 profile output contract：
  - 从 LangChain `BaseMessage[]` 改为 Pi-compatible prepared turn。
  - `SystemMessage` 不允许出现在 Pi `messages[]`。
  - 首要系统提示词由 `SystemSet` 进入 `systemPrompt`。
  - 中间位置已有 `SystemMessage` 的 profile 直接迁移为非法输出，profile 作者需要改写为 dynamic context 或普通 message。
- Profile prepare 仍然是“History + 动态内容”：
  - SystemSet 来自当前 profile，生成本轮唯一 `systemPrompt`。它可以随 profile 源码变化在下一次运行生效，但不写为普通历史消息。
  - History 来自 session active path，包含真实对话历史、profile `HistorySet` 首次稳定前缀，以及已持久化的 `AppendingSet` 运行期消息。
  - DynamicSet 来自当前 profile、runtime scope、workspace 状态等，是本轮临时上下文；它进入 provider context，但不写 session。
  - AppendingSet 是贴近当前输入的最新上下文区域；它进入 provider context，并且其中的非空 messages 默认全部写入 session。
- v3 正式引入 `profile.ingest()`，但第一版保持窄权限。它只负责 profile-generated messages 和 session metadata 的写入建议，不接管 harness 权限。

```ts
type ProfileIngestResult = {
    messageWrites?: Message[];
    sessionUpdates?: {
        title?: string;
        summary?: string;
    };
};
```

- `ingest()` 第一版不允许写任意 `custom` entry，不允许修改 `profileKey`、model、thinking level，不允许 link/detach agent，也不触发 queue、compact 或 tool policy。`Reminder` / `Watch` 的 state 更新仍由 harness 的 `AppendingSet` renderer 处理。
- `HistorySet` 的新边界：
  - 它不再承担 system prompt 角色；需要 provider 级系统提示的内容必须进入 `SystemSet`。
  - 它仍然适合放 SkillCatalog、长期规则、工作区初始背景等需要首轮持久化的上下文。
  - 新 session 首轮把 `HistorySet` 渲染结果写成普通 session message entries。旧 session 下次运行时不会因为 profile 源码变化自动重写这段历史，也不会写 profile 来源审计 entry。
  - compact 后 context reducer 用 compaction summary + recent messages 取代被压缩的旧历史；profile 不应该再把原始 `HistorySet` 当作“补丁”重新塞回上下文。
- `AppendingSet` 保留名称，语义继续对齐现有 TSX Profile 文档：当前用户输入、运行时提醒、watch/reminder 触发文本、显式激活 skill 摘要等需要靠近本轮请求的上下文放在这里。v3 可以重新设计它写入 session 的 entry 形态，但不能把它变成“不写上下文”。
- `Reminder` / `Watch` 保留为 `AppendingSet` 专用节点。它们不是普通 string 片段，而是带 session state 更新、注入频率、变量 fingerprint 和历史写入语义的动态节点；第一版不允许放入 `HistorySet` 或 `DynamicSet`。`SkillCatalog`、`ActivatedSkills` 等大多数返回 string 的通用节点仍由 profile 作者决定包进哪个 `Message` / set 中。
- Pi 没有等价的 `AppendingSet` DSL，但有相同层次的机制：`transformContext` 可在 provider 调用前转换本轮上下文，`prepareNextTurn` 可在 save point 后刷新下一轮 context/model/state，`nextTurn` 会把消息插入下一轮用户消息之前。Neuro Book 的 `AppendingSet` 应映射到这类 turn-preparation/context-tail 语义，同时保留“必要运行期消息可持久化”的产品语义。
- Profile preview 后续应展示 `systemPrompt + Message[]`，而不是 LangChain message list。
- Profile 的 InputSchema/OutputSchema 迁移策略：
  - builtin profile 的静态类型保持稳定。
  - 用户覆盖 builtin key 不允许改 builtin Input/Output 类型。
  - 用户自定义 profile 要获得 key -> input/output 静态推导，仍需要 prepare 类型索引。
  - v3 agent 模块统一使用 TypeBox / JSON Schema，profile `InputSchema` / `OutputSchema` 也属于 agent 模块，新的 v3 profile 必须使用 TypeBox。
  - 前端和非 agent 业务模块仍可继续使用 Zod；跨边界时通过 JSON Schema / DTO 转换，不要求全仓统一到 TypeBox。
  - 现有 v2 Zod profile 不作为 v3 兼容来源；v3 迁移时直接改写为 TypeBox，不保留 Zod -> JSON Schema runtime fallback。

## Turn Queue / Interrupt Plan

- NeuroAgentHarness 采用 Pi 的 turn-safe queue 语义，但用 Neuro Book 的 session/profile/context 组织实现。
- Pi 层级归属：
  - `steer` / `followUp` 是 Pi core `Agent` 已提供的队列 API，并在 `AgentLoop` safe point 通过 `getSteeringMessages` / `getFollowUpMessages` 注入。
  - `nextTurn` 不是低层 `Agent` 的基础 API；它存在于 Pi `AgentHarness` / `coding-agent` 这类产品层。Neuro Book 第一版不实现 `nextTurn`。
  - NeuroAgentHarness 第一版只暴露 `steer/followUp` 运行期队列；后续如果需要“下一次用户 prompt 前插入”的语义，再作为独立产品层能力评估。
- `steer`：用户或系统在 agent 工作中追加的“纠偏/补充”消息。它不打断当前 assistant message 和当前 tool batch；等当前 assistant turn 及其 tool result 完成后，在下一次 LLM 调用前注入上下文。
- `followUp`：等待 agent 本来要停止时再送入的后续消息。只有当当前 run 没有更多 tool calls、没有 steering messages 时才注入，然后继续下一轮。
- `steer` / `followUp` 的固定提示词不交给 profile 决定。它们属于 harness 交互协议，由 NeuroAgentHarness 写死或通过 harness-level policy 配置；profile 只负责常规 SystemSet/HistorySet/DynamicSet/AppendingSet。
- `steer` / `followUp` / `abort` / clear queue 第一版全部由 harness 写死，不开放给 profile 直接触发或改写。
- `abort` / interrupt：取消当前低层 run，向 provider/tools 传递 abort signal，清空 steering/followUp 队列。已完成的 session writes 不回滚，pending writes 按 save point / failure cleanup 规则落盘或标记中断。
- queue drain mode 第一版可跟 Pi 一样支持 `"one-at-a-time"` 与 `"all"`，默认 `"one-at-a-time"`：
  - `"one-at-a-time"`：每个 safe point 只取最早一条 queued message。
  - `"all"`：safe point 一次注入所有 queued messages。
- save point 定义为一次 assistant turn 和对应 tool results 完成之后。save point 负责：
  - 按事件顺序持久化 agent-emitted messages。
  - flush pending session writes。
  - 重新从 session/profile/workspace resources 构造下一轮 context snapshot。
  - 应用 run 期间发生的 model/profile/tool/resource 设置变化到下一轮，而不修改正在进行中的 provider request。
- AppendingSet 和 queue 机制的关系：
  - AppendingSet 是 profile prepare 阶段根据当前 input/scope/history 生成的 turn-tail context。
  - steer/followUp 是运行期间或用户交互产生的 queued user messages。
  - 两者最终都会参与 provider context，但来源和持久化时机不同；实现上不要把 queued user messages 塞进 profile TSX 节点里。
- `request_user_input` / Plan Mode / skill 审批第一版不走 queue 恢复，而是走 `continue + resolution`：用户操作先补齐对应 tool call 的 `toolResult`，然后由 Pi `continue()` 从 tool result 继续。queue 只负责运行中的 steer/followUp 消息，不负责审批恢复。

## Continue / Compaction Plan

- Pi 调用链：
  - core `Agent.prompt(...)` 会把文本或消息归一成 `AgentMessage[]`，然后调用 `runAgentLoop(prompts, context, config, ...)`。
  - `runAgentLoop` 会把 prompts 追加到 `context.messages`，并为这些 prompt messages 发出 `message_start/message_end`。
  - core `Agent.continue()` 调用 `runAgentLoopContinue(context, config, ...)`，不新增 prompt message。
  - Pi `Agent.continue()` 如果当前最后一条是 assistant，会先尝试 drain queued steering/follow-up；没有 queued message 时才报 `Cannot continue from message role: assistant`。
  - Pi `AgentLoop` 在每轮 assistant/tool 结束后调用 `prepareNextTurn`，让上层刷新 context/model/reasoning；随后通过 `getSteeringMessages` / `getFollowUpMessages` drain 队列。
- Pi 的 `agentLoopContinue(context, config)` 语义是：从已有 context 继续跑，不新增 prompt message，不发新的 user `message_start/end`。它要求 context 最后一条能转换成 LLM 的 `user` 或 `toolResult`，不能从 assistant message 继续。
- Neuro Book 后端 API / service 层也按 Pi 语义拆成两个调用入口：
  - `prompt(sessionId, input)`：写入新的 user message entry，再运行 prompt loop。
  - `continue(sessionId)`：不新增 user message，基于当前 active leaf 继续运行。
- NeuroAgentHarness 的 continue 应沿用这个语义：当用户输入已经先写入 session，或 tool result 已经落入 session，需要继续触发模型时，使用 continue run。Profile prepare 负责把 session history、DynamicSet、AppendingSet 和当前尾部用户输入整理成合法 provider context。
- 当 session 尾部是需要审批/用户输入的 assistant tool call 时，不能直接调用 Pi `continue()`；必须先通过 `continue(sessionId, { resolution })` 让 harness append 对应 `toolResult`。这样重启后也能从 session 尾部自然恢复，而不需要额外 custom pending entry。
- `CurrentUserInput` 是 v2 为适配“前端先写用户消息，再 continue run”而引入的 prepare 内部技巧，不作为 v3 概念保留。
- v3 第一版实现 session slash command，命令本身对 LLM 透明，不作为普通 user message 写入模型上下文：
  - `/new`：基于当前 session 的 `profileKey + input + workspaceRoot` 新建空 session，不清空旧 session，返回新 `sessionId`。新 session 初始没有 user message，LLM 对该命令无感。
  - `/retry [entryId?]`：在同一个 session tree 内重新生成。若未传 entryId，默认从当前 leaf 找到可继续点；如果当前 leaf 是 assistant message，则把 leaf 移回其 parent，再重新 continue，生成 sibling assistant branch；如果当前 leaf 是 user/toolResult，则直接从当前 leaf continue。旧回复保留，用户后续可用 `/tree` 切换。
  - `/tree [entryId?]`：查看或切换当前 session tree。无参数时返回 tree 摘要；带 entryId 时把当前 leaf 移到目标 entry。它承接“回溯”“回退到某条消息”“切换旧回复/新回复”等操作，不再单独设计 `/back`、`/rollback`。
  - `/fork [entryId?]`：从当前 session 的当前 leaf 或指定 entry 创建一个新 session，保留 parent session 关系。它适合从历史点另开一条线，不影响当前会话。
  - `/compact [instructions]`：手动压缩当前 session，instructions 作为本次 compact 的附加要求进入压缩请求，并写入 `compaction.details.instructions`。
- `/tree` 参考 Pi 的 tree navigation：在当前 session 内移动 leaf，并在跨分支离开当前路径时可生成 `branch_summary` 保存被离开分支的上下文。`/fork` 参考 Pi coding-agent 的 `/fork`：创建新 session，而不是只在当前 tree 内移动 leaf。
- v3 参考 Pi 重新设计用户输入流：
  - prompt run：用户输入作为新 `message` entry 写入 session，并作为 prompts 传给低层 loop；profile prepare 不再负责伪造这一条输入。
  - continue run：session/context 已经以 `user` 或 `toolResult` 结尾，不新增 prompt message，直接调用 continue loop。
  - profile 负责围绕当前 session history 生成 HistorySet / DynamicSet / AppendingSet 上下文，但不负责“把当前用户输入从 history 尾部取出再塞回最后”这类 v2 补丁。
- AppendingSet 仍然是靠近当前输入的上下文区域。prompt run 时它应排在新用户输入之前；continue run 时它应排在既有尾部 user/toolResult 之前或由 harness 的 context assembler 保证最终 provider context 合法。
- DynamicSet 不需要特殊节点才能“动态”：profile 在 prepare 阶段运行 TSX/函数表达式，本来就可以读取 input/scope/history 并输出动态内容。`DynamicSet` 的价值是给这些动态内容一个明确位置和“不写 session”的可读契约；不写 `DynamicSet` 的顶层裸 Message 也会按规则归入 dynamic 区域。
- Pi compaction 采用 append-only session entry，不删除原 JSONL 历史。NeuroAgentHarness 第一版实现自动与手动压缩：自动压缩在 provider 调用前按 token 阈值触发，手动压缩通过 slash command `/compact [instructions]` 触发。核心规则：
  - 自动触发：`contextTokens > contextWindow - reserveTokens`，也可手动 `/compact [instructions]`。
  - 从最新消息往前保留约 `keepRecentTokens`，找到 cut point。
  - 生成 summary。
  - 追加 `compaction` entry，包含 `summary`、`firstKeptEntryId`、`tokensBefore`、`details`。
  - `buildSessionContext()` 后续输出 summary message + `firstKeptEntryId` 之后的消息；完整旧历史仍留在 JSONL 中，可通过 tree 回看。
  - cut point 尽量落在 turn 边界，避免把 tool result 和 tool call 拆开；超长单 turn 会走 split-turn summary。
- NeuroAgentHarness 应借鉴 Pi compaction：使用 append-only `compaction` entry，保留完整 session tree，通过 context reducer 决定 provider 看到 summary + recent messages。compact 只影响后续 provider context，不删除旧 entries。
- Pi 的“保留最近几条消息”不是按固定条数做，而是通过 `keepRecentTokens` 按 token 预算从最新消息向前保留 recent context；同时会找合法 cut point，避免截断 tool result。NeuroAgentHarness 第一版不开放 profile compaction policy，底层必须尊重 tool-call/result 完整性。
- 第一版 compaction summary 的提示词由 harness 写死，不由 profile 自定义，也不引入单独 compaction profile。固定压缩提示词为：

```text
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

- compact 后注入后续 context 的摘要前缀固定为：

```text
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

- harness 负责压缩提示词、cut point、token budget、entry 写入和 tool-call/result 完整性。profile 不参与 compaction prompt / summary 生成策略。

## Remaining Questions

- `profile.ingest()` 已定为窄 contract：只返回 profile-generated message writes 与 `title` / `summary` 等 session metadata update，不写 arbitrary custom entry 或 harness 权限状态。
- `get_agent(id?: number)` 已定为轻量模型工具，不返回完整 history、完整 input 或运行统计噪声。是否支持按 `invocationId` 精确查询单次 run 后续放到 session/API 调试面评估。恢复/继续动作不放在查询工具里，统一由 `invoke_agent` 的 `prompt` / `continue` 模式承接。
- 当前阶段不兼容旧前端 SSE DTO；后端直接切到 Pi-like event DTO，并允许 Neuro Book 用 Pi custom/custom_message 语义扩展自定义事件。

## Files Changed

- `docs/tasks/pi-agent-harness-migration/README.md`
- `server/agent-v3/.gitkeep`
- `server/agent-v3/**`：删除旧 NeuroAgent 原型内容。
- `server/agent/**/*.test.ts`、`server/api/agent/**/*.test.ts`：删除旧 v2 后端 Agent 测试，后续以 v3 contract 重建。

## Verification

- 本阶段只写计划文档，未改运行代码。
- 设计依据来自本地 Pi 源码和调研文档 `docs/research/pi-agent-harness.md`。
- 第一阶段实现需要补齐测试，至少覆盖 profile loader、create_agent / invoke_agent、approval resume、report_result、compaction 和 session JSONL 基本流程。

## TODO / Follow-ups

- 根据本文档制定第一阶段后端 harness 实现计划。
- 做一个最小 spike：Pi `Context` + `AgentLoop` + 一个 TypeBox tool + JSONL session + TSX profile adapter。
- 在 `server/agent-v3` 内建立新 v3 目录骨架，优先补 harness/session/tool/profile adapter 的最小测试。
- 记录 spike 结果，决定 `NeuroAgentHarness` 内部使用 Pi core `Agent` 还是低层 `AgentLoop` 更合适。
- 第一阶段直接接真实 provider，保留必要的 smoke / 回归测试，不做 fake provider 作为主路径。
- 设计并实现 v3 `create_agent` / `invoke_agent`：`create_agent` 使用目标 agent `InputSchema` 创建实例配置和空 session，`invoke_agent` 使用 `sessionId + message` 调用任意 agent session，并支持 `prompt` / `continue` 两种调用模式。
- 实现 `continue + resolution` 审批恢复：hardcoded approval tool 集合为 `request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`skill`；恢复时验证尾部 assistant tool call，append 标准 `ToolResultMessage`，再调用 Pi `continue()`。
- 实现 v3 tool policy：`allowedToolKeys` 仍是 runtime 硬权限；子 agent 使用自己的工具权限、模型设置、thinking 设置和 workspaceRoot，不继承父 agent。
- TODO：未来区分“可被 invoke_agent 调用的 agent”和“只能由用户直接打开/运行的 agent”，避免没有合适完成协议的 agent 被其他 agent 误调用。
- TODO：为 `invoke_agent` 预留非阻塞调用。`block: false` 后续应立即返回 invocationId / sessionId，并通过 session event 或订阅 API 观察完成状态；第一版不实现非阻塞调用。
- 设计并实现 v3 `get_agent(id?: number)` 工具：无参列出当前 owned agents；有参查询指定 owned agent 的运行状态和最近结果。
- 设计并实现 v3 `detach_agent` 工具，解除当前父 agent 对指定 owned agent 的拥有/可见关系，但不删除目标 session，也不停止正在运行的目标 agent。
- 后续补 session API / session tool：按 `sessionId` 查询完整历史、active leaf、summary、usage 和 linked agents；`invoke_agent` 本身不返回完整 history。
- 设计 owned / linked agents 存储：v3 删除 leader/subagent 后，由父 agent 调用 `create_agent` 默认自动 link，并让 profile prepare 能枚举当前 session 拥有或关联的 agent session，替代 v2 `scope.agent.subagents`。
- 为动态 agent catalog 增加运行时只读 snapshot + lazy detail 查询能力，使任意 profile prepare 可以读取已注册 agent 的 InputSchema / OutputSchema，并自行注入到 DynamicSet / AppendingSet。
- 调整用户资产工作区计划：用户覆盖根为 `workspace/.nbook`，系统资源根为 `assets/.nbook`，agent profile/skill 放入 `.nbook/agent`，workspace 模板放入 `.nbook/assets/templates`。
- 执行 assets 路径硬切迁移时，先用 `rg` 列出旧路径引用，移动文件后逐一改为新路径，并删除旧路径 fallback/TODO。
- 后续评估文件/变量回溯能力：变量可通过 `variable_set` / custom state entry reduce；文件回溯需要专门的 `file_snapshot` / `file_patch` entry 或接入 Git/worktree snapshot，第一版 session 只记录文件操作事实，不承诺文件内容回滚。
- 实现 compaction：使用 append-only `compaction` entry，保留完整历史，cut point / token budget / tool-call 完整性、压缩提示词和 summary 生成由 harness 负责。
- 若开始实现，持续更新本文档和 `PROJECT-STATUS.md`。
