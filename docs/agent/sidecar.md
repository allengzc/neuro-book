# Sidecar Context

Sidecar Context（旁路上下文）是 profile 声明的旁路 run。它会在 Agent 主运行前或运行后从当前 session tree fork 一条旁路 leaf，完成检索、反思、记忆维护或状态整理，再把结果合并回主线，并把 active leaf 恢复到主 run 原位置。

它的目标是让主 Agent 任务上下文保持纯净和精简。比如 RP actor 主 run 应该专心扮演角色，不应该一边扮演一边翻完整世界书；检索和记忆维护可以放到 sidecar。sidecar transcript 会作为旁路分支持久化，便于审计，但不会成为主 active path；主路只消费 `merge()` 结果。

## 适合什么

Sidecar 适合这些场景：

- actor 主 run 前加载角色可知设定。
- actor 主 run 后更新 `events.jsonl`、`memory.jsonl`、`mind.md`。
- writer 写作前检索相关 lorebook。
- simulator leader 推进前做规则或状态审计。

Sidecar 不适合确定性上下文注入。确定性内容应优先用 profile TSX、input schema、variables 或 `<Import />`。

## 当前 RP actor 模式

`simulator.actor` 已接入两个典型 sidecar：

- `actor.context-load`：主 run 前调用 `subject_rag_search` 检索当前 subject 的 `events.jsonl` / `memory.jsonl`，不直接读取 subject 原文，再整理 actor-safe context。
- `actor.memory-save`：主 run 后通过 `subject_event_append` 追加 `events.jsonl`，通过 `subject_memory_update` 维护 `memory.jsonl`，并更新 `mind.md`。

主 run 仍保持角色扮演纯度。actor 不直接读取完整 `simulation/`、`lorebook/`、`reference/` 或其他 subject。

`actor.context-load` 的结果会以 `<actor-sidecar-context>` 写入 actor session 主 active path。它不是一次性的隐藏注入；后续 run 和 compaction 都可以看到这条由 Harness 持久化的 actor-safe context。若注入后上下文超过模型窗口，父 invocation 会失败。

Subject RAG 只检索当前 subject 自己的记忆，不检索 lorebook 或 Project 全局文件。详细机制见 [Subject RAG 记忆](./subject-rag-memory.md)。

## 工具权限

Sidecar 的 `toolKeys` 必须是当前 profile 根 `tools` 的 key 子集。provider-visible tools 和 schema 保持 profile 最大集合，以保护工具 schema 缓存；进入 sidecar 时，执行层和 reminder 再限制本段 run 可用工具。主路结构化结果通过 `report_result.data` 返回；旁路结果通过 `report_sidecar_result({ result, data })` 返回，其中 `data` 必须是只包含当前 sidecar key 的对象，例如 `{ "actor.context-load": {} }`。`report_sidecar_result.data` 的模型可见 schema 来自当前 profile 全部 `sidecarDataSchema` 的 sidecar-name keyed 稳定 union，运行期再按 active sidecar 精确校验 `data[activeSidecar.name]`；校验失败会生成模型可见 tool error，让同一 run 可以自我修正。

## 继续阅读

- [Sidecar Profile Pass Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/sidecar-profile-pass.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/reference/agent/context.md)
- [Subject RAG Reference](https://github.com/notnotype/neuro-book/blob/master/reference/content/subject-rag-memory.md)
- [RP 教程：进入世界模拟](/tutorials/06-enter-world-simulation)
