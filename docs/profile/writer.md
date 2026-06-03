# Writer

`writer` 是正式章节正文 agent。它的任务是把已经明确的章节目标、Plot、设定上下文和写作约束写进唯一章节文件。

它不是 planner，不是 retrieval，不是 RP writer，也不维护 `simulation/`。

## 一章节一 agent

当前 writer 合同是“一章节一 agent”。`writer.input.chapterPaths` 必须且只能包含一个章节目录，例如：

```text
my-novel/manuscript/001-volume/001-chapter/
```

writer 会写该章节目录下的 `index.md`。如果切换章节，应该创建新的 writer；如果继续润色同一章且创建 input 语义不变，可以复用旧 writer。

## writer 能看到什么

writer 自动读取：

- 唯一目标章节。
- 该章节的 Chapter Plot。
- leader 显式传入的 `lorebookEntries`。
- 相关内容节点的 `index.md` 和可选同级 `state.md`。

writer 不自动遍历完整 `lorebook/`、`simulation/` 或 `reference/`。需要设定召回时，leader 应先调用 `retrieval`，再把选中的 `entries[].path` 传给 writer。

## 写作前的准备

调用 writer 前，leader 应尽量准备好：

- 章节目标。
- 本章冲突和结尾钩子。
- Plot System 中挂到本章的 Scene / Plot。
- 必要 lorebook entries。
- 风格预设或写作参考。
- 禁止改动的事实和边界。

如果剧情状态尚未裁决，先使用世界运行态流程，而不是让 writer 自己判断世界怎么变。

## RP writer 不同

`rp.writer` 只用于 RP Tick 的可见文本渲染。它消费 `simulation/writer.md` 和 simulator leader brief，不写正式章节，也不维护选项或状态。

## 继续阅读

- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/reference/agent/novel-writing-workflow.md)
- [写出前三章](/tutorials/04-first-three-chapters)
- [Leader 协作协议](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)
