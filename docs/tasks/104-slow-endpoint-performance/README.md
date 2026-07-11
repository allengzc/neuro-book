# Slow Endpoint Performance

## User Request

2026-07-11。用户反馈三个慢路径：

- AgentChat 长会话打开时 `/api/agent/sessions/:id` 可达约 3000kB，弱网下加载数分钟。
- `/api/config/editor-snapshot?workspaceKind=user-assets` 可慢到十多秒。
- `/api/workspace-files/tree?projectPath=workspace%2Fvilos` 很慢。

目标是在不改变主要业务语义的前提下先做可落地的止血优化，降低响应体重复、并发重复请求和脏索引阻塞。

## Implementation

### Agent Session Snapshot

- `AgentSessionSnapshotDto.messages` 改为可选兼容字段。
- `NeuroAgentHarness.buildSessionSnapshot()` 默认不再返回 provider 可见的 `context.messages`。
- 前端聊天恢复仍使用 `entries` 派生 UI 消息，因此本轮不改变聊天展示、pending approval、tree 细节行为。
- 新增 harness 回归：`getSessionSnapshot()` 默认不返回 `messages`，但 repository reduce 的 provider context 仍完整保留。

### Config Editor Snapshot

- `readConfigEditorSnapshot()` 增加按 query + config 文件 mtime 的 2s 短缓存。
- 同一 query 的后端并发请求通过 in-flight promise 去重。
- 前端 `useConfigApi().editorSnapshot()` 增加同 query in-flight 去重，设置页多个面板同时加载时共享请求。
- 缓存签名包含 Global Config 和 Project Config mtime；保存配置后 mtime 变化会自然失效。

### Workspace Tree

- 完整树已有旧 index 时，即使 dirty，也先立即返回旧 snapshot，并后台触发重建；避免用户请求被大项目全量扫描阻塞。
- 首次读取或 watcher error 时仍同步重建，保证没有旧数据时不返回空假数据。
- 释放底层已有 `target/type/depth` 扫描能力：过滤查询走一次性扫描，不污染完整树 index。
- 新增 index 回归：已有旧 user-assets index 后，dirty 读取先返回旧快照，后台刷新后可读到新文件。

## Verification

- `bun test server/workspace-files/project-workspace-index.test.ts app/components/novel-ide/agent/agent-message.test.ts`：23 pass。
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t "session snapshot 默认不返回 provider messages"`：1 pass。
- `bun test server/config/config-service.test.ts`：72 pass。
- `bun run typecheck`：仍失败于既有 `app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue:422` 缺少 `acts` prop，本轮相关类型错误已清除。

## Notes

- 本轮没有做浏览器验证，遵循当前项目指令不自动浏览器验收。
- `/api/agent/sessions/:id` 仍携带 `entries` 和 `tree`，因此超长历史下还会有进一步优化空间；下一步应拆主聊天轻 snapshot、tree/detail 按需接口和消息分页。
- Workspace tree 仍是全量重建模型；本轮只是避免旧缓存存在时阻塞用户请求，后续若大项目仍慢，需要把正文派生数据和目录树元数据拆分或做增量 patch。
