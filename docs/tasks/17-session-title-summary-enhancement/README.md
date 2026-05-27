# Session Title/Summary Enhancement

## User Request

- 检查当前 Agent session 是否已有 `title` / `summary` 字段，或相关替代字段。
- 设计一个用独立摘要 profile 生成 session `title` / `summary` 的机制。
- 该机制第一阶段只对 leader session 应用。
- 新建 task walkthrough 记录计划，后续实现继续更新本文件。

## Goal

- 让 leader session 的 `title` / `summary` 从程序默认值升级为由专职摘要 agent 生成的稳定元数据。
- 摘要 agent 作为普通 profile 实例化，使用 `InputSchema` 固定初始化参数，并通过 `report_result` 返回最终 `title` / `summary`。
- 摘要流程保持 session append-only：多次运行只追加状态和结果，不修改既有 entry。
- 摘要 profile 自身支持上下文缓存和自动压缩，避免长 session 后摘要上下文无限膨胀。

## Current State

- `SessionMetadata` 已有 `title?: string` / `summary?: string`。
- `SessionUpdateEntry` 已支持 append-only 写入 `updates.title` / `updates.summary`。
- `AgentSessionSummaryDto` 已向前端暴露 `title` / `summary`，session snapshot 的 `summary` 字段也复用该 DTO。
- `JsonlSessionRepository.reduce()` 会沿 active path 读取最新 `session_update`，所以现有数据结构已经支持增量更新。
- 创建 session 时，harness 目前只把 `title` 初始化为 `profile.manifest.name`。
- `summary` 没有默认持久生成；`get_session` 工具在缺少 `summary` 时只用最近消息生成临时 fallback，不写回 session。
- 现有 `profile.ingest()` 能写 `sessionUpdates.title/summary`，但这是当前 profile 自己的 post-run hook，不是独立摘要者 profile。
- `compaction.summary` 是上下文压缩摘要，`branch_summary.summary` 是分支摘要，都不应直接混作 session 展示元数据。

## Walkthrough

- 2026-05-27：只读检查 session/profile/harness/documentation 现状，确认字段、append-only 更新入口和当前默认生成逻辑。
- 2026-05-27：记录第一版设计计划。本轮不修改运行时代码。

## Decisions

- 新建一个专职摘要 profile，例如 `session.summarizer`。
- 摘要 profile 只允许 `report_result` 工具。
- 摘要 profile 的 `OutputSchema` 使用：

```ts
Type.Object({
    title: Type.String({description: "简短 session 标题。"}),
    summary: Type.String({description: "当前 session 的可读摘要。"}),
})
```

- 摘要 profile 的 `InputSchema` 承载实例初始化参数，不承载每轮用户 prompt。建议字段：
  - `trigger`: 首次触发时机，第一版建议只实现 `after_invocation`。
  - `interval`: 周期触发配置，支持按 `turn`、`loop`、`dialogueContentTokens`。
  - `compressionTriggerTokens`: 摘要 profile 自身上下文超过阈值后触发压缩，默认可从 `80000` 起步。
  - `sourceSessionId`: 绑定的 leader session id。
- “session 中 content 字段所包含的 token，不计算 tool calls、不计算 tool result”命名为 **会话正文 Token**，代码字段建议用 `dialogueContentTokens`。
- 第一版触发点选在 leader invocation 完整结束后，而不是插入每个 ReAct loop 内部。这样避开 tool loop、审批等待、流式状态和半提交 turn 的复杂性。
- 摘要调度状态写入 leader session 的 custom entry，例如：
  - `session.summarizer.sessionId`
  - `session.summarizer.lastProcessedEntryId`
  - `session.summarizer.dialogueContentTokens`
  - `session.summarizer.lastRunAt`
- 摘要结果写回 leader session 时使用现有 `session_update` entry，保持展示字段的统一 reduce 路径。
- 摘要 agent 自己的上下文仍走普通 profile/harness 机制，并通过 profile `compaction` 策略支持长上下文自动压缩。

## Proposed Implementation Plan

1. 增加摘要 profile contract。
   - 新增 `SessionSummarizerInputSchema` / `SessionSummarizerOutputSchema`。
   - 新增系统 profile `session.summarizer.profile.tsx`。
   - `allowedToolKeys` 只包含 `report_result`。
   - 验证：profile check/status 能加载，`report_result` schema 包含 `title` / `summary`。

2. 增加会话正文提取器。
   - 从 leader session active path 中提取新增的用户/assistant 可见文本。
   - 不计算 assistant tool call 参数。
   - 不计算 tool result。
   - 默认不计算 thinking。
   - 验证：单测覆盖普通用户消息、assistant 文本、assistant tool call、tool result、custom visible message 的边界。

3. 增加摘要调度状态。
   - 在 leader session custom entry 中记录摘要 profile 绑定关系和处理 cursor。
   - 如果没有摘要 agent session，按 leader 的配置创建一个 `session.summarizer` session。
   - 验证：重复触发不会重复创建摘要 agent；cursor 只向前推进。

4. 在 leader invocation 完整结束后触发摘要。
   - `finalResult.status === "completed"` 后检查是否需要摘要。
   - 第一版不在 `waiting` / `error` / `aborted` 后触发。
   - 满足触发条件时调用摘要 agent。
   - 验证：首轮用户 prompt 完成后能生成一次；未达间隔不会运行。

5. 将摘要结果写回 leader session。
   - 读取摘要 agent 的 `reportResult.data.title` / `summary`。
   - append `session_update` 到 leader session。
   - publish session entry/state，前端沿现有 snapshot/list 路径刷新。
   - 验证：session list、snapshot、`get_session` 都能读到更新后的 title/summary。

6. 接入摘要 profile 压缩策略。
   - 在摘要 profile 中配置 compaction 触发阈值。
   - 保持摘要 agent session append-only，不回写改旧消息。
   - 验证：超过阈值时追加 compaction entry，后续摘要继续可用。

## Files Changed

- `docs/tasks/17-session-title-summary-enhancement/README.md`

## Verification

- 本轮只新增任务计划文档，未运行代码测试。
- 后续实现阶段建议最小验证：
  - `bun scripts/profile.ts check assets/workspace/.nbook/agent/profiles/builtin/session.summarizer.profile.tsx`
  - `bun scripts/profile.ts status --all --system`
  - `bunx vitest run server/agent/session/session-repo.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "session title|session summary|summarizer"`

## TODO / Follow-ups

- 实现摘要 profile 和 builtin contract。
- 设计 `dialogueContentTokens` 估算与真实 token 统计边界。
- 决定摘要配置放在 leader profile `InputSchema`、global/project config，还是 harness 默认常量。当前倾向先由 leader session 初始化时直接实例化摘要 profile，并把参数写入摘要 profile `InputSchema`。
- 明确是否允许用户关闭摘要 agent，或只在 leader profile 生效。
- 实现后同步 `PROJECT-STATUS.md` 的 Agent 模块状态与 TODO。
