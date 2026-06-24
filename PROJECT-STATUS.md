# Project Status

## Summary

neuro-book 当前处于快速开发阶段。本轮产品主路径收敛到 **novel 写作模式 v1**：作者围绕 Markdown Studio、Project Workspace、Agent 和 World Engine 写作；旧 Plot / RAG subject 面板 / RP / simulation 默认模板先从普通入口隐藏，底层代码和历史资料保留。

## Product / Workspace Facts

- 部署主线是 Product-first：Windows Product Portable 是普通用户默认 release，zip 内包含 `app/` Product Payload、`data/` 运行状态、`runtime/bun/` 内置 Bun 和 `launcher/`。
- 数据库已硬切 SQLite-only：App SQLite 位于 `workspace/.nbook/neuro-book.sqlite`；Project SQLite 位于每个 Project Workspace 的 `.nbook/project.sqlite`。
- Project Workspace 根目录 `project.yaml` 是项目身份真相源，App SQLite 不维护 Project index 或 `Novel` mapping。
- Global Config 位于 `workspace/.nbook/config.json`，Project 覆盖位于 `workspace/{project}/.nbook/config.json`；这些运行态文件不进 Git。
- 默认 Project 模板保留 `manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/`、`world-engine/` 等写作骨架。

## Writing Mode v1

- 普通写作入口以 Novel IDE / Markdown Studio 为主，顶栏保留 Bookshelf / World / User Assets / Agent。
- 顶栏不再暴露 Plot Workbench 和 RAG Inspector；欢迎页不再暴露 Plot / RAG / simulation 快捷入口。
- 左侧侧栏只保留 Files / Characters；Outline 和 RAG 面板入口隐藏，`NovelPlotPanel` / `NovelRagPanel` 底层组件保留。
- Agent 新建菜单隐藏 `rp.leader` 和 `simulator.leader`；历史 session 的 profile 名称、图标和旧 profile 文件保留。
- 本版本目标是先把写作模式体验打顺，RP 模式后续再恢复和重新设计入口。

## World Engine

- World Engine 是写作模式的动态世界状态与时间线真相源，用于替代旧 Plot 系统和 `simulation/` 默认运行态。
- 后端核心是 Project SQLite 三表：`WorldSubject`、`WorldSlice`、`WorldMutation`；mutation 不存旧值字段，后端不自动改写后续切面。
- HTTP / Agent 工具覆盖 schema、subjects、slices、slice delete、state/query；公开时间入参拒绝 raw instant 调试格式、首尾空白和非法 percent encoding。
- Agent 内置工具覆盖 `get_world_state`、`list_world_slices`、`write_world_slice`、`edit_world_slice`、`delete_world_slice`、`create_world_subject`、`get_world_schema`、`list_world_subjects`。
- 默认 Project 模板包含 `world-engine/schema.yaml` 和 `world-engine/calendar.ts`，新 Project 不再默认生成 `simulation/`。
- Calendar 已硬切到 `calendar.ts`，不再兼容 `calendar.yaml`；支持 `simple`、`gregorian`、`custom` 三类策略，缺少 `calendar.ts` 时应提示创建。
- Round 423 已用临时 Project 验证默认模板 API 链路：`calendar.ts` 时间格式下创建 `world/player`、写入 slice、查询 state、删除 slice 和状态回退均通过且 issues 为 0。
- Round 424 已用临时 Project 验证主 IDE Workbench 空项目第一步：默认模板 Project 可打开 Workbench，看到 schema/calendar 入口与创建入口，`创建 world subject` 会真实写入 `world` subject 和 init slice；临时 Project 已清理。
- Round 425 已完成阶段收尾审计：Round 380-424 的真实项目、新 Project、默认模板、连续推演、常用操作和 Calendar 证据足以证明当前“前后端雏形拼接 + 作者视角主路径”阶段已跑通；后续进入体验打磨和新产品决策。
- 主 IDE World Engine Workbench 支持创建 subject、写入 / 编辑 / 删除 slice、查询 state、展示 issues，并能从历史 `simulation/subjects` 发现真实主体系统摘要；该发现路径不代表 `simulation/` 是写作模式默认状态源。

## Hidden Legacy Systems

- Plot Workbench、Plot System、RAG subject 面板、RAG Inspector、RP profiles、simulation workflow 和 archived simulation 模板都保留在仓库中，方便历史项目和后续恢复。
- `assets/workspace/.nbook/templates/project-directory-templates/simulation/` 已归档到 `assets/workspace/.nbook/templates/archived/project-directory-templates/simulation/`。
- 新建 Project 不复制根目录 `simulation/`；真实用户 Project 中已有的 `simulation/` 数据不迁移、不删除。
- 用户 assets 同步会清理未手改的旧 `templates/project-directory-templates/simulation/**` 受管副本；手改副本按现有冲突规则保留。

## Recent Tasks

| Task | Status | Notes |
| --- | --- | --- |
| [56 World Engine](docs/tasks/56-world-engine/README.md) | Stage Complete | 核心模型、API、Workbench、subject system discovery 与作者主路径已完成阶段收尾审计。 |
| [64 World Engine Prompt Engineering](docs/tasks/64-world-engine-prompt-engineering/README.md) | Updated | 写作模式接入 World Engine，RP 模式隐藏但保留资料。 |
| [65 Calendar Enhancement](docs/tasks/65-world-engine-calendar-enhancement/README.md) | Done | `calendar.ts` 硬切，`calendar.yaml` 仅作为历史记录。 |
| [66 Codebase Cleanup](docs/tasks/66-codebase-cleanup/README.md) | Stage Complete | 已完成一轮 World Engine / 写作模式阶段后的代码清理收口：Workbench 纯规则下沉、filter preservation、draft surface auto-open、issue level/status mapping 和专用 util 测试拆分已落地；命名 / 文件结构与复杂主体语境候选已记录待审批，后续等待真实作者使用反馈或用户重新开启。 |
| Writer Profile 重构 | Done | 去除小猫之神角色定义，理清 profile / reference / skill 职责边界，从 650 行压缩到 535 行。 |

## Known Follow-ups

- World Engine 写作模式主路径已阶段收尾；后续重点是体验打磨、`memory.jsonl` / `state.md` 是否显式 commit、以及真实作者长期使用反馈。
- RP 模式恢复时需要重新设计入口、profile routing、simulation 资料使用边界。
- Agent 前端迁移后仍建议补一次浏览器交互验收，覆盖多窗口同步、approval resume、Plan Mode、compact、edit/retry/rollback/fallback 和流式工具卡片。
- `bun run typecheck` 如仍只剩 Task 62 的 `control-tools.test.ts` / pendingApprovals 类型漂移，按既有遗留记录处理。
