# Task 105 Agent Event Memory Boundaries

## 背景

用户反馈：主 Agent 通过 `invoke_agent` 调 writer agent 写作时，writer 的 `write` 工具耗时较长，进程内存飙升到约 5GB 后被 OOM kill。

诊断结论：这不是典型的永久 Map 泄漏，更像运行中大文本被多层 live event / replay / SSE queue 暂存放大的问题。`invoke_agent` 会等待子 Agent 完成；运行期间 EventHub 为 transcript replay pin 保留事件，而 `tool_execution_start` 曾把 `write.content`、`apply_patch.patch`、`edit` 文本字段原样公开，慢订阅者队列也没有硬上限。

## 目标

- live runtime event 不再携带完整写作正文、patch 或大 diff。
- pinned replay 仍支持刷新恢复；active transcript 不再受普通事件数上限裁剪，只受更高的字节预算保护。
- 慢 SSE 订阅者不能无限积压事件。
- 前端工具卡继续展示路径、短预览、字节数和成功/失败状态。

## 实现记录

- `public-event-projection` 对工具参数/结果做公开事件瘦身：
  - `write.content` -> `contentPreview/contentBytes/contentOmitted`
  - `edit.edits[].oldText/newText` -> preview/bytes/omitted 字段
  - `apply_patch.patch` -> `patchPreview/patchBytes/touchedFiles/patchOmitted`
  - `edit/apply_patch` result details 中的 `diff` -> `diffPreview/diffBytes/diffOmitted`
  - 过长 `bash.command` 也按 preview 公开
- `AgentSessionEventHub` 增加 replay byte limit、active pinned replay byte limit 和 subscriber queue limit：
  - 普通 replay 继续受 `replayLimit / replayByteLimit` 约束。
  - active transcript pin 不受普通 `replayLimit` 裁剪，避免主 Agent 调 writer 长时间等待时，运行中未落盘对话被 snapshot 恢复吞掉。
  - active transcript pin 超过 `pinnedReplayByteLimit` 时才按字节预算裁剪旧事件。
  - 落后 cursor 无法 replay 时继续返回 `snapshot_required`。
  - 慢订阅者队列溢出时丢弃积压并推送 `snapshot_required`。
- `AgentWriteFileBubble` / `AgentEditFileBubble` / `AgentApplyPatchBubble` 兼容 preview 字段，并提示“仅显示预览”。

## 验证

- `bun run test server/agent/events/public-event-projection.test.ts server/agent/events/session-event-hub.test.ts app/components/novel-ide/agent/agent-message.test.ts`
  - 37 passed
- `bun run typecheck`
  - passed

## 反馈修复

- 用户反馈内存下降后，主 Agent 调 writer agent 时主 Agent 对话会少一些。
- 根因判断：上一版让 active transcript pin 也受普通 `replayLimit` 裁剪；writer 长时间运行时，主 Agent 当前 turn 尚未落盘，前端收到 `snapshot_required` 后只能用 snapshot 恢复已落盘 entries，因此运行中对话临时丢失。
- 修复：active transcript pin 不再套普通事件数上限，只在超过更高的 pinned replay 字节预算时裁剪，保留刷新恢复完整性。
- 追加前端保护：`applySnapshot()` 在 active invocation 仍存在时保留同一 invocation 的未落盘 live 消息，避免轻量 snapshot 恢复时把最新工具气泡/assistant 流式消息清掉。

## 后续

- 本轮先收口 live event / replay / SSE queue 的主要放大路径。
- `write` 工具的 workspace history 仍会为 before/after 构造正文快照；如果超长章节仍有内存峰值，需要第二轮专门优化 `recordAgentWorkspaceWrite` / `nb-history` 的大文件 snapshot 写入路径。
