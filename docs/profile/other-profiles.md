# 其他 Profile

除了 leader 和 writer，NeuroBook 还有一组专用 profile。它们的共同目标是缩小职责边界，让每个 agent 只处理自己擅长的任务。

## retrieval

`retrieval` 是内容节点召回和候选判断 agent。它接收自然语言 prompt，搜索 `lorebook/`、`manuscript/` 等内容节点，并通过结构化结果返回候选条目。

leader 会读取 `entries[].path`、`reason`、`use` 和 `risk`，再决定哪些路径交给 writer。不要把 retrieval 的完整分析原样塞给 writer。

## researcher

`researcher` 用于联网研究。`leader.default` 本身不直接拥有联网搜索能力；需要最新资料、价格、政策、版本、新闻或来源核验时，应交给 researcher。

researcher 通常返回普通 Markdown 结果和来源链接，不使用 `report_result`。

## summarizer

`summarizer` 是后台 profile，用于生成 session title 和 summary。它不保存自身 assistant/tool transcript 到主历史，而是通过 runtime-only 方式读取 source dialogue 并写回 source session 元数据。

## leader.assets

`leader.assets` 帮助用户维护 `workspace/.nbook` 下的 profile、Skill、模板、profile 默认 home 资源和配置覆盖层。它适合解释 user-assets 机制、创建 profile 模板、检查 profile 编译状态。

## Simulation profiles

RP / 世界模拟主要使用：

- `simulator.leader`：写作模式和 RP 共用的世界模拟主管。
- `simulator.actor`：subject simulator，只处理 actor-facing message。
- `rp.writer`：RP prose renderer。

`simulator.actor` 已接入 sidecar，用于主 run 前加载 actor-safe context、主 run 后维护记忆文件。主 run 不直接读取 subject 文件原文。

## 继续阅读

- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)
- [Sidecar](../agent/sidecar.md)
- [进入世界模拟](/tutorials/06-enter-world-simulation)
