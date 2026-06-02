# Agent Reference

本目录保存 Agent runtime、profile、上下文、默认协作协议和前端事件相关的稳定参考。任务 walkthrough 和历史迁移记录只作为背景材料。

## Profile And Prompt

- [profile-guide.md](profile-guide.md)：Profile 作者和 Agent 修改 profile 时的主入口。
- [context.md](context.md)：TSX Profile DSL 的上下文分区、历史写入和模型可见顺序。
- [profile-import.md](profile-import.md)：`<Import />` 节点 API、安全边界、渲染格式和 build contract。
- [leader-default.md](leader-default.md)：`leader.default` 工具、任务、多 Agent、SQL、Plan Mode 和 Skills 操作协议。
- [neurobook-project-guide.md](neurobook-project-guide.md)：Project Workspace、内容节点、lorebook、manuscript、simulation、Plot System 和 workspace node CLI 的 Agent 使用指南。

## Runtime

- [harness.md](harness.md)：当前 harness、session、profile、turn loop、SSE 和持久化流程的实现参考。
- [runtime-hooks.md](runtime-hooks.md)：Run Kernel / runtime hooks 稳定心智模型。
- [sidecar-profile-pass.md](sidecar-profile-pass.md)：profile 声明式旁路 run 机制。
- [harness-black-box-contract.md](harness-black-box-contract.md)：prompt / continue / steer / followup 的外部行为合同。
- [frontend.md](frontend.md)：Agent 前端状态与交互约定。
- [sse.md](sse.md)：Agent session SSE / snapshot / event contract。

## Reading Rules

- 实现或修改 profile：先读 [profile-guide.md](profile-guide.md)，再读 [context.md](context.md) 和 [profile-import.md](profile-import.md)。
- 处理默认 Leader prompt、工具、writer / retrieval / researcher、Plan Mode 或 Skills：读 [leader-default.md](leader-default.md)。
- 处理 Project Workspace 文件、内容节点、lorebook、manuscript、simulation 或 Plot：读 [neurobook-project-guide.md](neurobook-project-guide.md)。
- 处理 harness 行为、sidecar、runtime hooks 或队列语义：先读 [harness-black-box-contract.md](harness-black-box-contract.md)，再读 [runtime-hooks.md](runtime-hooks.md) 和 [sidecar-profile-pass.md](sidecar-profile-pass.md)。
