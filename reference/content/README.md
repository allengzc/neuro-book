# Content Reference

本目录保存 NeuroBook 内容结构、内容节点、lorebook / simulation 信息分层、Markdown 扩展和 retrieval / inject 的稳定参考。它是 Agent 处理 Project Workspace 内容时的主要入口。

## Entry Points

- [directory-protocol.md](directory-protocol.md)：Project Workspace 目录职责，定义 `lorebook/`、`simulation/subjects/`、`simulation/entities/`、`reference/` 与 `.nbook/`。
- [information-control.md](information-control.md)：Prototype / Entity / Subject 信息控制模型，说明 subject knowledge、entity state 和 lorebook canon 的边界。
- [markdown-dialect.md](markdown-dialect.md)：NeuroBook Markdown 扩展格式。
- [retrieval.md](retrieval.md)：内容节点 `retrieval` / `inject` frontmatter 以及 retrieval profile 到 writer 的 handoff 合同。
- [state.md](state.md)：内容节点同级 `state.md` 当前状态兼容规范。
- [middleware.md](middleware.md)：内容中间件和统一引用系统入口。
- [lorebook-information-control.md](lorebook-information-control.md)：旧文件名兼容入口，转向上面两份文档。

## Reading Rules

- 创建、移动、校验 lorebook / manuscript 内容节点时，同时参考 [../agent/neurobook-project-guide.md](../agent/neurobook-project-guide.md)。
- 设计目录结构、实体状态、SillyTavern worldbook 迁移或 Project 模板时，读 [directory-protocol.md](directory-protocol.md)。
- 设计角色可知信息、subject knowledge、entity hidden state 或 sidecar context-load 时，读 [information-control.md](information-control.md)。
- 修改 Markdown 正文、批注和富文本兼容格式时，读 [markdown-dialect.md](markdown-dialect.md)。
- 为 writer 选择设定上下文时，读 [retrieval.md](retrieval.md)；不要把 retrieval 的 `reason` / `use` / `risk` 直接传给 writer。
