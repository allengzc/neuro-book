# 高级概念

本页先作为高级主题索引。后续会逐步补成更完整的解释文档。

## Agent Harness

Agent Harness 负责把 invoke、profile、session、ReAct loop、工具执行、SSE 和前端展示串起来。

如果你只是使用 NeuroBook，不需要先理解 Harness。只有在你要修改 Agent runtime、调试 session 行为、设计 profile 合同或排查工具执行问题时，才需要深入阅读。

参考入口：

- [Agent Harness](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness.md)
- [Runtime Hooks](https://github.com/notnotype/neuro-book/blob/master/reference/agent/runtime-hooks.md)
- [Harness Black-Box Contract](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness-black-box-contract.md)

## Runtime Hooks

Runtime hooks 用于把 profile prepare、turn ingest、下一轮准备、run settle 等阶段拆成可组合机制。

后续文档会解释这些 hook 如何影响 prompt、history、runtime state 和 write plan。

## Session Tree

Agent session 是 append-only tree。它可以保留历史分支，通过 active leaf 表达当前正在看的路径。

后续文档会解释 retry、edit、rollback、fallback 和 session recovery 如何依赖这套结构。

## SSE 与前端状态

SSE 用于把运行中的消息、工具执行和 session 状态增量推给前端。session snapshot 仍是恢复真相源。

后续文档会解释 live event、snapshot、重连和 waiting resume 的关系。
