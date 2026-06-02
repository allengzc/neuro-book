# Agent Specs

本目录保存 Agent runtime、profile、上下文、默认协作协议和前端事件相关的稳定规范。它是 Agent 优先阅读的规范入口；任务 walkthrough 和历史迁移记录只作为背景材料。

## Agent-Facing Entry Points

- [profile-guide.md](profile-guide.md)：Profile 作者和 Agent 修改 profile 时的主入口，说明 `defineAgentProfile()`、TSX DSL、`System` / `HistorySet` / `ModelContext` / `AppendingSet` 和检查清单。
- [context.md](context.md)：active TSX Profile DSL 的上下文分区、历史写入和模型可见顺序。
- [profile-import.md](profile-import.md)：`<Import />` 节点 API、安全边界、放置位置和 build contract。
- [leader-default.md](leader-default.md)：`leader.default` 可共享的操作协议，包括工具使用、任务、多 Agent、SQL、Plan Mode 和 Skills。
- [neurobook-project-guide.md](neurobook-project-guide.md)：Project Workspace、内容节点、lorebook、manuscript、simulation、Plot System 和 workspace node CLI 的 Agent 使用指南。

## Runtime And Product Contracts

- [system.md](system.md)：多 Agent 系统需求规格，偏产品和业务边界。
- [frontend.md](frontend.md)：Agent 前端状态与交互约定。
- [sse.md](sse.md)：Agent session SSE / snapshot / event contract。

## Reading Rules

- 实现 profile 或修改 prompt 时，先读 [profile-guide.md](profile-guide.md)，再按需要读 [context.md](context.md) 和 [profile-import.md](profile-import.md)。
- 处理默认 Leader prompt、工具使用、writer / retrieval / researcher 调度、Plan Mode 或 Skills 时，读 [leader-default.md](leader-default.md)。
- 处理 Project Workspace 文件、内容节点、lorebook、manuscript、simulation 或 Plot System 时，读 [neurobook-project-guide.md](neurobook-project-guide.md)。
- `docs/tasks/**` 记录迁移过程和历史决策；当前稳定规则以本目录和 `spec/content/` 为准。
