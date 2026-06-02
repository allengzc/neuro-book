# NeuroBook Reference Bookshelf

`reference/` 是 NeuroBook 的稳定参考书架，给 Agent 和人类共同阅读。这里放当前实现契约、目录协议、Agent profile 共享说明和内容系统规则；任务过程、调研、草案和历史记录继续放在 `docs/`。

不要把仓库根 `reference/` 和 Project Workspace 里的 `{project}/reference/` 混淆：

- 仓库根 `reference/`：系统参考书，可被 profile `<Import />` 加载。
- Project Workspace `{project}/reference/`：外部素材、导入归档、低置信迁移材料。

## Modules

- [agent/](agent/)：Agent runtime、profile、TSX DSL、Import、Run Kernel、Sidecar、SSE 和默认协作协议。
- [content/](content/)：Project Workspace 内容目录、lorebook、simulation、information control、Markdown 方言、retrieval / inject 和内容节点状态。
- [plot/](plot/)：Project SQLite 剧情系统、Story / Phase / Thread / Scene / Plot 合同和 Agent 消费方式。
- [workspace/TERMS.md](workspace/TERMS.md)：Workspace Root、Project Workspace、user-assets 和 Bundled Workspace Template 标准术语。
- [workspace-reference/](workspace-reference/)：Project Workspace 内容节点的统一引用系统和 inline 引用规则。
- [editor/](editor/)：Markdown Studio 富文本 / 源码模式稳定规则。
- [theme/](theme/)：主题系统规则。

## Reading Order

- 修改 Agent profile 或 prompt：先读 [agent/README.md](agent/README.md)。
- 处理 Project Workspace 文件、lorebook、simulation 或导入素材：先读 [content/README.md](content/README.md) 和 [agent/neurobook-project-guide.md](agent/neurobook-project-guide.md)。
- 处理小说写作标准流程、emulation tick、writer handoff 或 workflow skill 命名：读 [agent/novel-writing-workflow.md](agent/novel-writing-workflow.md)。
- 处理剧情结构、writer 章节剧情注入或 Plot 工具：先读 [plot/system.md](plot/system.md)。
- 处理 workspace / project / user-assets 术语：先读 [workspace/TERMS.md](workspace/TERMS.md)。
