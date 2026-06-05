# Sidecar Context

Sidecar Context（旁路上下文）是 profile 声明的旁路 run。它会在 Agent 主运行前或运行后 fork 一段 runtime-only 分支，完成检索、反思、记忆维护或状态整理，再把结果合并回主线。

它的目标是让主 Agent 任务上下文保持纯净和精简。比如 RP actor 主 run 应该专心扮演角色，不应该一边扮演一边翻完整世界书；检索和记忆维护可以放到 sidecar。sidecar transcript 不进入主 history，只把整理后的结果合并回主线。

## 适合什么

Sidecar 适合这些场景：

- actor 主 run 前加载角色可知设定。
- actor 主 run 后更新 `events.md`、`knowledge.md`、`mind.md`。
- writer 写作前检索相关 lorebook。
- simulator leader 推进前做规则或状态审计。

Sidecar 不适合确定性上下文注入。确定性内容应优先用 profile TSX、input schema、variables 或 `<Import />`。

## 当前 RP actor 模式

`simulator.actor` 已接入两个典型 sidecar：

- `actor.context-load`：主 run 前读取 subject 文件并整理 actor-safe context。
- `actor.memory-save`：主 run 后维护 subject-facing 记忆文件。

主 run 仍保持角色扮演纯度。actor 不直接读取完整 `simulation/`、`lorebook/`、`reference/` 或其他 subject。

## 工具权限

Sidecar 的 `allowedToolKeys` 必须是当前 profile 工具集合的子集。provider-visible tools 保持 profile 最大集合，以保护工具 schema 缓存；进入 sidecar 时，执行层和 reminder 再限制本段 run 可用工具。

## 继续阅读

- [Sidecar Profile Pass Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/sidecar-profile-pass.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/reference/agent/context.md)
- [RP 教程：进入世界模拟](/tutorials/06-enter-world-simulation)
