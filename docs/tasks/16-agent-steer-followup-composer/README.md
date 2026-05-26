# Agent Steer / FollowUp Composer

## User Request

- 前端适配 Agent harness 已支持的 `steer` 和 `followUp` 两个操作，参考 Codex app 的“引导”和“队列”交互。
- 输入框右下角发送按钮需要按状态切换：
  - 最后一条消息不是 AIMessage：`continue` 操作。
  - 当前正在 run，且输入框没有内容：停止操作。
  - 当前正在 run，且输入框有内容：默认点击为引导 `steer`。
  - 当前正在 run，且输入框有内容：Ctrl + 点击为队列 `followUp`。
- `steer` 和 `followUp` 需要显示在输入框上方。

## Goal

- 让 Agent Composer 支持运行中的用户干预：`steer` 用于当前 run 的下一次模型调用前纠偏，`followUp` 用于当前 run 本来要停止时继续排队执行。
- 队列中的 steer / followUp 在输入框上方可见，直到后端消费并通过 snapshot/event 清除。
- 保持现有 session、SSE、Composer 和 Drawer 边界，不把输入框状态重新堆回抽屉主体。

## Current State

- `docs/tasks/02-pi-agent-harness-migration/README.md` 已定义 turn queue / interrupt 语义：`steer` 在当前 assistant turn 和 tool batch 完成后、下一次 LLM 调用前注入；`followUp` 在 agent 本来要停止时注入。
- Pi core 在 drain queued messages 时会发出 queued user message 的 `message_start` / `message_end`，但 Neuro Book 当前使用自有 JSONL session repo，queued message 是否成为 session entry 仍必须由 NeuroAgentHarness 在 drain 点显式写入。
- 当前前端 `AgentComposer.vue` 在 `running` 时统一把发送按钮当作停止按钮；运行中输入内容无法走 steer / followUp。
- 当前 `NovelAgentDrawer.vue` 的 `send()` 只有 prompt / continue 路径；运行中普通 prompt 在后端会隐式进入 followUp queue，但前端没有显式 steer / followUp 操作。
- 当前 session snapshot / event 已有 `followUpQueue` 和 `follow_up_queued`，但还没有 steer queue 的前端展示合同。
- 更精确地说：当前代码已有隐式 followUp 入队能力；显式 `mode: "steer" | "followup"` API、steerQueue、steer 前端入口和队列展示仍待实现。

## Implementation Plan

- 扩展 session invoke 契约：
  - `AgentInvokeRequestDto.mode` 增加 `"steer" | "followup"`。
  - `prompt` / `steer` / `followup` 必须带 `message`；`continue` 不能带 `message`。
  - 继续复用 `/api/agent/sessions/:id/invocations`，不新增独立 queue endpoint。
- 补齐 harness 队列状态：
  - 保留现有 `followUpQueue` FIFO，新增显式 `followup` 调用入口。
  - 新增 `steerQueue`，在当前 assistant turn + tool results 落盘后进入 safe point；无论本轮 assistant 是否产生 tool calls，只要此时存在 pending steer，当前 ReAct loop 就不结束，而是在这个可引导点一次性 drain 当前所有 pending steer，并在下一次模型调用前注入。
  - followUp 只在当前 ReAct loop 没有更多 tool calls、也没有 pending steer 时消费；一次消费一条并重新开启下一轮 loop，重新执行 profile prepare / compaction / model resolve。
  - Snapshot 新增 `steerQueue`；SSE 新增 `steer_queued`，并保留现有 `follow_up_queued`。
  - 消费后不新增 `*_consumed` event；通过正常 `session_entry` 展示被消费的 user message，通过后续 `session_state_changed.snapshot` 清理队列展示。
  - `mode: "steer" | "followup"` 沿用 `InvokeAgentResult`，HTTP 成功时返回 `status: "waiting"` 和 `finalMessage` 中的 queued item id；第一版不新增 `status: "queued"`。
  - abort 默认清空尚未消费的 steer / followUp 队列。
- 调整前端输入动作：
  - `AgentComposer.vue` 根据 `running`、输入内容、`canContinueWithoutInput` 和 Ctrl/Meta 修饰键 emit `send` / `stop` / `steer` / `followup`。
  - Enter 在运行中有输入时默认 `steer`；Ctrl/Meta+Enter 为 `followUp`。
  - `request_user_input` / approval pending 时保持现有回答 UI 优先，底部输入仍作为 note，不触发 steer / followUp。
- 显示队列状态：
  - steer / followUp 提交成功后使用 `useNotification()` 立即反馈：“消息已引导” / “消息已排队”。
  - 在输入框上方显示紧凑条目，文案使用“引导”和“队列”。
  - 显示所有未消费条目，按队列顺序排列；每条显示 message text 的单行截断预览。
  - 提交 steer / followUp 时，HTTP 入队成功后再清空输入框；失败则保留输入。
  - 消费前不追加普通乐观 user 气泡；真正 drain 时由 harness 写入 session entry，之后按普通 user message 进入历史。
  - `steer` 写入模型上下文时需要由后端 harness 增加与 Codex harness 对齐的文本前缀；前端队列预览和 notification 仍显示用户原文。
  - 第一版 session history 可直接显示模型实际看到的 steer 前缀文本；除非现有 schema 很容易记录 raw/origin，否则不额外扩展 rawText / renderedText。
  - 运行中有输入时，发送按钮 hover tooltip 展示“引导 / 队列 Ctrl+Enter”提示；tooltip 只负责解释快捷操作，不提供额外点击功能。
- 更新 session store：
  - `useAgentSession.ts` 支持 `steer_queued`。
  - `follow_up_queued` 保留现有行为，或迁移到统一队列 helper。
  - `InvokeAgentResult` 新增可选 `queuedItem?: AgentQueuedMessageDto`，HTTP 返回后前端可立即显示 queue chip；后续 SSE 按 id 去重。
  - 新增统一 `AgentQueuedMessageDto = { id, kind: "steer" | "followup", message, createdAt }`，snapshot 仍保留 `steerQueue` / `followUpQueue` 两个数组。

## Decisions

- session invoke 入口继续承担 prompt / continue / steer / followUp；不新增独立 queue endpoint。
- steer / followUp 属于 harness control-plane，不交给 profile 或 prompt 决定。
- slash command 只在非 running 的普通发送路径生效；running 输入按 steer / followUp 处理。
- 非 running 时不提交 steer / followUp；普通输入仍走 prompt，空输入且最后一条非 AIMessage 才走 continue。
- `request_user_input` / approval pending 优先级高于 steer / followUp，底部输入只作为当前问题的 note。
- steer / followUp 在 queue drain 后都写成普通 user message，保证模型上下文和 session 历史一致。
- running 时普通 Enter 等同默认按钮动作，提交 steer；Ctrl/Meta+Enter 提交 followUp。
- running 且输入有内容时，默认点击提交 steer；Ctrl/Meta+点击提交 followUp。
- Composer button click 明确 `preventDefault` 后按 `ctrlKey || metaKey` 分派；`AgentReferenceInput` 的 submit 事件需要携带键盘 modifier，供 Ctrl/Meta+Enter 分派 followUp。
- `waiting_user` 状态下后端仍允许 steer / followUp 入队，但它们不抢占当前 approval / user input resolution；resolution 仍必须通过 `continue + resolution` 恢复当前 tool call。
- 第一版固定 drain mode：steer 在同一个可引导点使用 all drain，一次性消费所有 pending steer；followUp 在 ReAct loop 真正结束后 one-at-a-time drain，一次只消费一条并开启下一轮 loop。
- steer / followUp 没有同一个 drain 队列里的优先级比较；loop 结束判定顺序是先检查 pending steer，只有没有 steer 时才算当前 ReAct loop 真正结束并进入 followUp 消费。
- consumed steer / followUp 优先写成标准 user message；如果现有 session entry 已有可用来源字段，则记录 `steer` / `followup` 来源，否则不为此扩展 session entry schema。
- steer 的模型可见文本需要带前缀；不自行发明前缀，后续通过观察 Codex harness 的 steer 前缀后复用。
- followUp 只在当前 ReAct loop 真正结束后自动重新开启一个新 loop；不会在仍有 tool calls 或 pending steer 的当前 loop 中插队。
- 队列条目显示小标签和 icon：`引导` 用 `corner-down-left`，`队列` 用 `list-plus` 或 `clock`，文本单行截断。
- UI 不提供第一版队列删除；如误发，继续发送新的 steer / followUp 纠正，或在已写入历史后使用现有 tree 操作处理。

## Files Changed

- 规划阶段只新增本文档。
- 后续实现预计涉及：
  - `shared/dto/agent-session.dto.ts`
  - `server/agent/harness/neuro-agent-harness.ts`
  - `server/agent/harness/types.ts`
  - `app/composables/useAgentSessionApi.ts`
  - `app/components/novel-ide/agent/useAgentSession.ts`
  - `app/components/novel-ide/agent/AgentComposer.vue`
  - `app/components/novel-ide/NovelAgentDrawer.vue`

## Verification

- DTO 校验：`steer` / `followup` 必须有 message，`continue` 带 message 报错。
- Harness 测试：运行中 enqueue steer 后，在 tool result 后、下一次模型调用前 all drain 注入；assistant 无 tool calls 但 pending steer 时不结束当前 ReAct loop，而是继续下一次模型调用；followUp 只在没有 pending steer 的 loop 结束后 one-at-a-time 继续；abort 清空两个队列。
- Frontend 单测：Composer 按 running / input / Ctrl 状态 emit `send` / `stop` / `steer` / `followup`；`useAgentSession` 正确处理 `steer_queued` 和 `follow_up_queued`。
- 类型检查：`bunx tsc --noEmit --pretty false --skipLibCheck`。
- 浏览器端真实交互验收需要用户确认后再执行，不自动启动浏览器验证。

## TODO / Follow-ups

- 实现上述前后端适配。
- 实现后同步更新本文档的实际变更、验证结果和计划偏差。
- 如队列误发成为高频问题，再设计 queued steer / followUp 删除入口。
