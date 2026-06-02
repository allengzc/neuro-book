# Content Specs

本目录保存 NeuroBook 内容结构、内容节点、lorebook / simulation 信息分层、Markdown 扩展和 retrieval / inject 的稳定规范。它是 Agent 处理 Project Workspace 内容时的主要规范入口。

## Agent-Facing Entry Points

- [lorebook-information-control.md](lorebook-information-control.md)：NeuroBook Directory Protocol，定义 `lorebook/`、`simulation/subjects/`、`simulation/entities/`、`reference/` 与 `.nbook/` 的职责。
- [markdown-dialect.md](markdown-dialect.md)：NeuroBook Markdown 扩展格式，包括 workspace links、inline comment、mark、颜色、上下标和对齐。
- [retrieval.md](retrieval.md)：内容节点 `retrieval` / `inject` frontmatter 以及 retrieval profile 到 writer 的 handoff 合同。
- [state.md](state.md)：内容节点同级 `state.md` 当前状态兼容规范。
- [middleware.md](middleware.md)：内容中间件和统一引用系统入口。

## Reading Rules

- 创建、移动、校验 lorebook / manuscript 内容节点时，同时参考 [../agent/neurobook-project-guide.md](../agent/neurobook-project-guide.md)。
- 设计目录结构、信息控制主体、实体状态或 SillyTavern worldbook 迁移时，读 [lorebook-information-control.md](lorebook-information-control.md)。
- 修改 Markdown 正文、批注和富文本兼容格式时，读 [markdown-dialect.md](markdown-dialect.md)。
- 为 writer 选择设定上下文时，读 [retrieval.md](retrieval.md)；不要把 retrieval 的 `reason` / `use` / `risk` 直接传给 writer。
- `docs/tasks/**` 只记录历史过程；稳定内容协议以本目录为准。
