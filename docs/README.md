# 文档索引

本目录保存项目文档资产。稳定规范放在 `spec/`，仓库级状态放在根目录 `PROJECT-STATUS.md`。

## 目录分工

- `docs/modules/`：模块说明、需求整理和面向开发者的参考资料。
- `docs/research/`：第三方库、外部资料和方案调研。
- `docs/drafts/`：未定稿草案。
- `docs/tasks/`：重大任务的持续 walkthrough；active task 使用 `{order}-{slug}`，已归档任务放入 `docs/tasks/archived/`。
- `docs/archived/`：过期但仍有参考价值的文档。

## 关键入口

- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库现状和近期任务。
- [operator-bridge.md](operator-bridge.md)：交付与运维桥梁，面向用户和用户 Agent，说明部署、更新、排障和关键文档索引。
- [../spec/README.md](../spec/README.md)：稳定规范索引。
- [modules/README.md](modules/README.md)：模块文档索引。
- [tasks/README.md](tasks/README.md)：任务 walkthrough 规则。
- [tasks/02-pi-agent-harness-migration/README.md](tasks/02-pi-agent-harness-migration/README.md)：当前 Agent 主路径迁移记录。
- [tasks/04-tsx-profile-workbench/README.md](tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前实现边界。
- [tasks/06-leader-default-prompt-parity/README.md](tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt、工具和 skill 迁移记录。

## 维护规则

- 新规范先判断是否稳定：稳定规范进入 `spec/<module>/`，未稳定内容进入 `docs/drafts/`。
- 外部资料和技术选型调研进入 `docs/research/`，不要混入稳定规范。
- 重大任务完成后更新 `PROJECT-STATUS.md` 和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。
- 同一功能的后续调整继续更新原任务 walkthrough，除非目标已经明显独立。
