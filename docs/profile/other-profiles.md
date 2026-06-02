# 其他 Profile

除了 leader 和 writer，NeuroBook 还提供一些更专门的 profile。它们通常由 leader 创建或调用，普通用户不需要直接管理每个 profile 的底层参数。

## retrieval

retrieval 是内容节点召回和候选判断专用 profile。

适合：

- 为当前章节选择相关 lorebook。
- 为 writer 准备参考设定。
- 在大量角色、地点、规则和笔记中筛选候选。

retrieval 应返回候选条目的路径、理由、用途和风险。leader 再判断哪些路径传给 writer。

## researcher

researcher 是联网研究专用 profile。

适合：

- 当前网页资料。
- 新闻、版本、价格、政策等可能变化的信息。
- 外部文档核对。
- 跨来源事实检查。

默认 leader 不直接联网。需要联网时，应交给 researcher。

## leader.rp

`leader.rp` 是 RP / simulation 模式的用户入口。

它负责读取 `simulation/` 目录，调度 actor 和 writer，并向用户展示可交互的 RP 推进结果。

普通 writer 不应该承担 RP Tick 渲染；RP 模式应优先使用 `leader.rp`。

## rp.actor

`rp.actor` 代表某个角色的主观响应。

它应该只看到 actor-facing 信息，例如自己的 `subject.md`、`knowledge.md`、`mind.md`、`state.md` 和由 sidecar 加载的角色可知设定摘要。

它不应该拥有上帝视角，也不应该直接遍历完整 `simulation/`、`lorebook/` 或 reference 材料。

## rp.writer

`rp.writer` 负责把 simulator leader 的 brief 渲染成用户可见正文。

它只消费 RP 写作相关材料，不替代普通 writer，也不承担角色主观决策。

## 如何选择

简单判断：

- 用户主入口：`leader.default`
- 正文章节写作：`writer`
- 内容节点召回：`retrieval`
- 联网研究：`researcher`
- RP 用户入口：`leader.rp`
- RP 角色主观响应：`rp.actor`
- RP 文本渲染：`rp.writer`

稳定参考入口见 [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md)。
