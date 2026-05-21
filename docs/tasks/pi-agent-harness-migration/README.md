# Pi Agent Harness Migration

## User Request

- 全面重构当前 Agent 系统，逐步替换 LangChain provider/message/tool 边界，转向 `earendil-works/pi`。
- 本阶段先只考虑把后端 harness 做好，前端先不作为主要约束。
- 记录已经确认的设计方向和未决问题，后续实现继续基于本文档推进。

## Goal

- 建立新的后端 Agent Harness 方案，使用 Pi 的 message、event、tool execution 和 session 语义作为主干。
- 保留 Neuro Book 的 TSX Profile、用户 assets、workspace、subagent、skill 等领域能力。
- 明确哪些部分直接采用 Pi，哪些部分由 Neuro Book 自己拥有。
- 在真正实现前，先固定关键边界，避免只把 LangChain provider 局部替换后继续保留旧系统复杂度。

## Current State

- 当前生产链路仍是 `server/agent` v2，大量依赖 LangChain `BaseMessage` / `AIMessage` / `ToolMessage`、LangChain provider adapter、LangChain tool schema 适配。
- 当前 thread/message 持久化已经有树结构和 active cursor，但运行时仍需要大量 codec 修复 tool call id、tool result 顺序、reasoning、usage、streaming delta 等边界。
- TSX Profile 系统已经支持 builtin/user assets 动态加载、profile preview、InputSchema/OutputSchema、allowed tools、workspace 默认 leader profile 和用户资产工作区。
- 旧 `server/agent-v3` NeuroAgent 原型已清空；新的 Pi-based v3 将继续在 `server/agent-v3` 内落地。新 v3 完成后，删除当前 `server/agent` v2，并将 `server/agent-v3` 移动/重命名为 `server/agent`。
- 当前 v2 后端 Agent 测试已删除，后续新 v3 测试重新按 Pi harness contract 建立。
- 本地 Pi 仓库位于 `.agent/workspace/pi`；已完成基础调研，见 `docs/research/pi-agent-harness.md`。

## Walkthrough

- 已确认 `pi-ai` 的 canonical LLM message 只有 `user` / `assistant` / `toolResult`，assistant content 使用 `text` / `thinking` / `toolCall` block。
- 已确认 `pi-ai.Context` 支持 `systemPrompt?: string`，provider adapter 会将其映射到 OpenAI system/instructions、Anthropic system、Google systemInstruction 等 provider-native 字段。
- 已确认 `pi-agent-core` 的事件主干包含 `agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end` / `turn_end` / `agent_end`。
- 已确认 Pi 的 session/thread 机制是 append-only entry tree：entry 通过 `id` / `parentId` 组成树，active leaf 表示当前分支，`buildSessionContext()` 从 leaf 回溯并 reduce 出 LLM context。
- 已确认 Pi 的低层 tool lifecycle 使用 `beforeToolCall` / `afterToolCall` callback；高层 `AgentHarness` 会把它们包装成 hook event。
- 已确认 Pi 的 subagent 示例是 extension + CLI subprocess，不适合 Neuro Book 长期直接照搬；Neuro Book 仍应保持服务端原生 child session/subagent 工具。

## Decisions

- 后端 harness 内部运行时事件主干采用 Pi `AgentEvent` 语义。
- 前端暂不作为本阶段主约束；短期可以保留现有 SSE DTO adapter，后端先切干净。
- 自定义消息暂不确定清单。先跑通 Pi 标准 message、event、session entry，再决定哪些 Neuro Book 特有状态需要 `custom` 或 `custom_message`。
- 采用 Pi 的 `Context` 形状：

```ts
type Context = {
    systemPrompt?: string;
    messages: Message[];
};
```

- `messages[]` 不允许直接放 LangChain `SystemMessage` 或 OpenAI 风格 `{ role: "system" }`。现有 TSX Profile 迁移时必须适配这一点。
- 当前阶段不 fork Pi 的 `Message` union 去加入 `SystemMessage`。system prompt 可以属于 session 可追踪历史，但发送给 provider 时走 `Context.systemPrompt`。
- TSX Profile 机制保留。Pi 不替代 Neuro Book profile，Pi 替代的是 profile 之后的 provider/message/tool/runtime 形状。
- 未来 `prepare()` 不再返回 LangChain `BaseMessage[]`，而应返回 Pi/Neuro Book harness 可消费的 prepared turn plan，例如 `systemPrompt`、`messages`、`toolKeys`、`sessionWrites`、metadata writes。
- Pi append-only entry tree 语义全面采用。实现上可以先用 JSONL，也可以直接做 DB-compatible entry schema；长期应能从 JSONL 迁移到 DB。
- Subagent 机制按 Neuro Book 自己的服务端 child session 设计继续推进；Pi subagent 示例只借鉴 single / parallel / chain、输出截断、失败诊断、usage 汇总等模式。
- Tool schema 方向倾向 Agent runtime 采用 TypeBox/JSON Schema，现有 Zod profile/schema 先兼容迁移；非 Agent 的 API DTO 暂不作为本重构范围。
- 新 v3 直接落在 `server/agent-v3`，不再保留旧 v3 原型兼容层。完成后采用目录替换策略：删除 v2 `server/agent`，再将 `server/agent-v3` 提升为 `server/agent`。
- v2 后端测试不作为迁移包袱保留。新 v3 根据新的 harness/session/tool/profile contract 重新建立测试。

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
- `report_result`、`request_user_input`、subagent 结果归一化、超长输出截断适合落在 `afterToolCall` 对应的后端 harness hook。

## Session / Thread Plan

- 新后端 harness 使用 session 作为核心抽象，不再把 provider history 当作一组可变 message。
- 目标 entry 类型至少包含：
  - `message`
  - `model_change`
  - `thinking_level_change`
  - `profile_change`
  - `variable_change`
  - `compaction`
  - `branch_summary`
  - `custom`
  - `custom_message`
  - `label`
  - `leaf`
- `leaf` 必须持久化，不能只是内存 cursor。
- 构造模型上下文时，从 active leaf 回溯到 root，得到 path，再 reduce 出 `systemPrompt`、`messages`、model、thinking level、profile/runtime state。
- 旧 thread 历史不应被静默改写；继续采用 append-only 语义。
- 如果先用 JSONL，应保持 entry schema 和未来 DB 表结构兼容。

## Profile Fusion Plan

- 当前 TSX Profile 的 DSL 和用户资产体系继续保留。
- 迁移重点是 profile output contract：
  - 从 LangChain `BaseMessage[]` 改为 Pi-compatible prepared turn。
  - `SystemMessage` 不允许出现在 Pi `messages[]`。
  - 首要系统提示词进入 `systemPrompt`。
  - 中间位置已有 `SystemMessage` 的 profile 需要显式适配，暂不定最终语义。
- Profile preview 后续应展示 `systemPrompt + Message[]`，而不是 LangChain message list。
- Profile 的 InputSchema/OutputSchema 迁移策略仍需继续讨论：
  - builtin profile 的静态类型保持稳定。
  - 用户覆盖 builtin key 不允许改 builtin Input/Output 类型。
  - 用户自定义 profile 要获得 key -> input/output 静态推导，仍需要 prepare 类型索引。
  - Agent runtime schema 长期倾向 TypeBox/JSON Schema；现有 Zod profile 先兼容。

## Unresolved Questions

- 后端 harness 第一版是直接依赖 Pi `AgentHarness`，还是只使用 `pi-ai` + `pi-agent-core` 低层 `AgentLoop`，由 Neuro Book 自己实现 harness？
- Session 第一版落 JSONL 还是直接落 Prisma/DB entry 表？
- 旧 `AgentThread` / `AgentMessage` 数据是否需要迁移，还是新 harness 使用新表，旧 v2 只保留只读/兼容入口？
- TSX Profile 中间 `SystemMessage` 的最终语义是什么：拒绝、合并到 `systemPrompt`、降级为 user message，还是用 `custom_message` 表达？
- 自定义消息清单什么时候定，哪些状态应进入 LLM context，哪些只作为 UI/runtime state？
- Tool schema 从 Zod 到 TypeBox 的迁移边界：是否先写 adapter，还是新 harness tool 全部重写为 TypeBox？
- `beforeToolCall` / `afterToolCall` 上层是否需要做完整 hook registry，还是第一版只做固定的 tool policy pipeline？
- Subagent 工具命名继续沿用 `create_subagent` / `invoke_subagent` / `list_subagents`，还是迁移到 child-agent 命名？
- 当前 profile 的 Watch / Reminder / SkillCatalog / ActivatedSkills 如何映射到 session entry、custom entry 和 turn preparation？
- 当前 `request_user_input`、Plan Mode、skill approval 的等待态如何映射到 Pi run lifecycle 和 session pending writes？
- 当前 SSE 前端 DTO 的兼容 adapter 保留多久，什么时候切到 Pi-like event DTO？

## Files Changed

- `docs/tasks/pi-agent-harness-migration/README.md`
- `server/agent-v3/.gitkeep`
- `server/agent-v3/**`：删除旧 NeuroAgent 原型内容。
- `server/agent/**/*.test.ts`、`server/api/agent/**/*.test.ts`：删除旧 v2 后端 Agent 测试，后续以 v3 contract 重建。

## Verification

- 本阶段只写计划文档，未改运行代码。
- 设计依据来自本地 Pi 源码和调研文档 `docs/research/pi-agent-harness.md`。

## TODO / Follow-ups

- 根据本文档制定第一阶段后端 harness 实现计划。
- 做一个最小 spike：Pi `Context` + `AgentLoop` + 一个 TypeBox tool + JSONL session + TSX profile adapter。
- 在 `server/agent-v3` 内建立新 v3 目录骨架，优先补 harness/session/tool/profile adapter 的最小测试。
- 记录 spike 结果，决定是否直接依赖 Pi `AgentHarness`。
- 若开始实现，持续更新本文档和 `PROJECT-STATUS.md`。
