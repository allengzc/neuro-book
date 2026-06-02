# Sidecar

Sidecar 是 profile 声明的自动旁路 run。它会在主 run 前或主 run 后运行一小段专门任务，再把结果合并回主线。

普通用户可以把它理解成：主 Agent 正式回答前，系统先派一个临时助手去检索、整理或检查；主 Agent 回答后，也可以再派一个临时助手去做记忆维护或状态整理。

## 适合做什么

Sidecar 适合这些任务：

- 主 run 前检索相关 lorebook。
- writer 写作前整理可用设定。
- actor 回答前加载角色可知信息。
- 主 run 后保存记忆或更新辅助状态。
- simulator leader 推进前做规则审计。

这些任务通常有两个特点：它们服务于当前 profile，但不应该把旁路过程完整写进主对话历史。

## 不适合做什么

Sidecar 不适合替代确定性上下文注入。

如果内容是稳定规则、共享说明或 profile 长期协议，应该放在 Profile TSX、input、variables 或 `<Import />` 中。

Sidecar 也不是“临时切换成另一个 profile”。V1 中 sidecar 由当前 profile 声明，沿用当前 session 和当前 profile 边界。

## 运行位置

Sidecar 常见阶段：

- `prepareRun`：主 run 前执行，适合检索和整理上下文。
- `settleRun`：主 run 后执行，适合记录、反思和维护状态。

Sidecar 的 transcript 默认是 runtime-only，不进入主 session history。它通过 merge 把必要信息注入主线。

## 一个 RP 例子

在 RP 模式中，`rp.actor` 可以在主 run 前通过 sidecar 读取 actor-facing 信息，只整理该角色应该知道的设定摘要。

主 run 完成后，另一个 sidecar 可以维护 `knowledge.md` 或 `mind.md`，让角色记忆跟随剧情推进。

这样做的好处是：角色主回答保持干净，设定检索和记忆维护也有明确边界。

## 继续阅读

- [Sidecar Profile Pass Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/sidecar-profile-pass.md)
- [Agent Harness](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness.md)
