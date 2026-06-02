# Architecture Notes

当前项目的稳定参考和实现契约按模块放在 `reference/`，日常文档、调研、草案、任务 walkthrough 放在 `docs/`。仓库级进度和风险统一记录在 `PROJECT-STATUS.md`。

## 主要入口

- [PROJECT-STATUS.md](PROJECT-STATUS.md)：仓库现状、当前重点、模块状态和近期任务。
- [docs/README.md](docs/README.md)：文档体系入口。
- [reference/README.md](reference/README.md)：NeuroBook Reference Bookshelf。

## 核心模块规范

- [reference/agent/](reference/agent/)：多 Agent、Profile、上下文和前端运行状态。
- [reference/editor/](reference/editor/)：Markdown Studio 与富文本 live preview 参考。
- [reference/plot/](reference/plot/)：剧情系统和前端工作区参考。
- [reference/workspace-reference/](reference/workspace-reference/)：统一引用系统和 inline 引用参考。
- [reference/content/](reference/content/)：内容校验与规范化流程。
- [reference/theme/](reference/theme/)：主题系统参考。
