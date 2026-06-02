# 模块文档索引

本目录保存模块说明、需求整理和开发参考。稳定实现契约应放到 `spec/<module>/`。

## Agent

- [agent/harness.md](agent/harness.md)：Agent Harness 的 session、profile、ReAct loop、SSE 和消息持久化流程。
- [../../spec/agent/](../../spec/agent/)：Agent 稳定规范入口；Profile、上下文、Import、默认 Leader 协作协议和项目文件语义优先看这里。
- [../../spec/agent/leader-default.md](../../spec/agent/leader-default.md)：当前 `leader.default` 工具、任务、多 Agent、SQL、Plan Mode 和 Skills 操作协议。
- [../../spec/agent/neurobook-project-guide.md](../../spec/agent/neurobook-project-guide.md)：Agent 处理 Project Workspace、内容节点、Plot、simulation 和 workspace node CLI 的共享规范。
- [../tasks/02-pi-agent-harness-migration/README.md](../tasks/02-pi-agent-harness-migration/README.md)：Pi-based Agent v3 后端 harness 迁移计划。
- [../tasks/04-tsx-profile-workbench/README.md](../tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前任务记录。
- [../tasks/05-leader-profile-v2-adaptation/README.md](../tasks/05-leader-profile-v2-adaptation/README.md)：leader.default v2 适配、ProfileTurnPlan 和 TSX DSL 调整记录。
- [../tasks/06-leader-default-prompt-parity/README.md](../tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt parity、task/plot/SQL 工具和 skill 迁移记录。

## Character

- [character/requirements.md](character/requirements.md)：Character 模块需求、界面字段和搜索设计。

## Editor

- [../../spec/editor/rich-text-live-preview.md](../../spec/editor/rich-text-live-preview.md)：Markdown Studio 富文本与源码模式稳定规范。
- [../research/tiptap/00-overview.md](../research/tiptap/00-overview.md)：Tiptap 调研总览。

## Plot / Story

- [plot/functional-description.md](plot/functional-description.md)：Plot 系统完整功能说明。
- [../../spec/plot/system.md](../../spec/plot/system.md)：剧情模块规范。
- [../../spec/plot/frontend.md](../../spec/plot/frontend.md)：剧情模块前端规范。
- [../drafts/plot-system.md](../drafts/plot-system.md)：剧情系统早期草案。
