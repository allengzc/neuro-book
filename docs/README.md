# 文档索引

本目录保存项目文档资产。稳定参考和实现契约放在 `reference/`，仓库级状态放在根目录 `PROJECT-STATUS.md`。

## 目录分工

- `docs/modules/`：模块说明、需求整理和面向开发者的参考资料。
- `docs/tutorials/`：面向普通作者用户的产品教程和上手路径。
- `docs/research/`：第三方库、外部资料和方案调研。
- `docs/drafts/`：未定稿草案。
- `docs/tasks/`：重大任务的持续 walkthrough；active task 使用 `{order}-{slug}`，已归档任务放入 `docs/tasks/archived/`。
- `docs/archived/`：过期但仍有参考价值的文档。

## 关键入口

- [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md)：英文项目入口。
- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库现状和近期任务。
- [operator-bridge.md](operator-bridge.md)：交付与运维桥梁，面向用户和用户 Agent，说明部署、更新、排障和关键文档索引。
- [tutorials/](tutorials/)：基础教程，从第一本书到第一次 RP。
- [agent/](agent/)：站点内 Agent 心智模型、工具、Sidecar 和 Harness 导读。
- [profile/](profile/)：站点内 profile 说明，覆盖 leader、writer 和其他内置 profile。
- [profile-tsx/](profile-tsx/)：站点内 Profile TSX DSL 导读、节点说明和示例。
- [../reference/README.md](../reference/README.md)：NeuroBook Reference Bookshelf。
- [../reference/agent/README.md](../reference/agent/README.md)：Agent 稳定参考入口，处理 profile、prompt、工具协作和 Project Workspace 文件语义时优先阅读。
- [../reference/content/README.md](../reference/content/README.md)：内容结构、lorebook / simulation、Markdown 扩展、retrieval 和 profile context memory 稳定参考入口。
- [modules/README.md](modules/README.md)：模块文档索引。
- [tasks/README.md](tasks/README.md)：任务 walkthrough 规则。
- [tasks/02-pi-agent-harness-migration/README.md](tasks/02-pi-agent-harness-migration/README.md)：当前 Agent 主路径迁移记录。
- [tasks/04-tsx-profile-workbench/README.md](tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前实现边界。
- [tasks/06-leader-default-prompt-parity/README.md](tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt、工具和 skill 迁移记录。

## 维护规则

- 新文档先判断是否稳定：稳定参考进入 `reference/<module>/`，未稳定内容进入 `docs/drafts/`。
- 外部资料和技术选型调研进入 `docs/research/`，不要混入稳定参考。
- 重大任务完成后更新 `PROJECT-STATUS.md` 和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。
- 同一功能的后续调整继续更新原任务 walkthrough，除非目标已经明显独立。
