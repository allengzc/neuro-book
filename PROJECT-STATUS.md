# Project Status

## Summary

neuro-book 当前处于快速开发阶段。本轮产品主路径收敛到 **novel 写作模式 v1**：作者围绕 Markdown Studio、Project Workspace、Agent 和 World Engine 写作；旧 Plot / RAG subject 面板 / RP / simulation 默认模板先从普通入口隐藏，底层代码和历史资料保留。写作提示词主链已收口为 `灵感探索 → 项目/Lorebook → World Engine 初始化 → 08 剧情规划/状态推进 → 09 章节写作 → 写后回补/修订`。

## Product / Workspace Facts

- 部署主线是 Product-first：Windows Product Portable 是普通用户默认 release，zip 内包含 `app/` Product Payload、`data/` 运行状态、`runtime/bun/` 内置 Bun 和 `launcher/`。
- Windows Product Portable 错误报告日志落在 `data/logs/`；后端提供 `/api/app/logs/status` 与 `/api/app/logs/download`，日志包只包含日志和 manifest，不包含 config、数据库或 workspace 正文。
- 数据库已硬切 SQLite-only：App SQLite 位于 `workspace/.nbook/neuro-book.sqlite`；Project SQLite 位于每个 Project Workspace 的 `.nbook/project.sqlite`。
- Project Workspace 根目录 `project.yaml` 是项目身份真相源，App SQLite 不维护 Project index 或 `Novel` mapping。
- Global Config 位于 `workspace/.nbook/config.json`，Project 覆盖位于 `workspace/{project}/.nbook/config.json`；这些运行态文件不进 Git。
- 默认 Project 模板保留 `manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/`、`world-engine/` 等写作骨架。

## Writing Mode v1

- 普通写作入口以 Novel IDE / Markdown Studio 为主，顶栏保留 Bookshelf / World / User Assets / Agent。
- 顶栏不再暴露 Plot Workbench 和 RAG Inspector；欢迎页不再暴露 Plot / RAG / simulation 快捷入口。
- 左侧侧栏只保留 Files / Characters；Outline 和 RAG 面板入口隐藏，`NovelPlotPanel` / `NovelRagPanel` 底层组件保留。
- Agent 新建菜单隐藏 `rp.leader` 和 `simulator.leader`；历史 session 的 profile 名称、图标和旧 profile 文件保留。
- 默认写作 workflow 中，`08` 是 World Engine 剧情事实确认与状态推进手册，`09` 只在状态已推进后调用 writer 写正文；修订产生新事实时回到 `08` 做 World Engine 回补。
- Markdown Studio 的 Inline AI PromptBar 使用 `inline.editor` 后台 session：发送后不自动打开右侧 Agent 面板、不切换主 Agent active session；PromptBar 内可选择、刷新、新建当前 Project 的 Inline AI sessions，并展示 edit/write 预览与最终摘要。
- 默认 Project 模板的 `agents/` 只创建 `leader.default/` 与 `writer/` 上下文，不再默认创建 `director`、`rp.leader`、`rp.writer` 或 `simulator.leader`。
- 本版本目标是先把写作模式体验打顺，RP 模式后续再恢复和重新设计入口。

## World Engine

- World Engine 是写作模式的动态世界状态与时间线真相源，用于替代旧 Plot 系统和 `simulation/` 默认运行态。
- 后端核心是 Project SQLite 三表：`WorldSubject`、`WorldSlice`、`WorldPatch`；公开写入已硬切为 `patches` + 4-op（`replace` / `increment` / `remove` / `append`），collection 支持 `remove + value` 按 stable JSON 值删除元素，patch 不存旧值字段，后端不自动改写后续切面。
- HTTP API 覆盖 schema、subjects、slices、slice delete、state/query；公开时间入参拒绝 raw instant 调试格式、首尾空白和非法 percent encoding。
- Agent 内置 World Engine 工具（Task 71 重构后）收敛为单一 `execute_world`：Leader / world.engine 使用 readwrite CodeAct，在同一 deferred 事务内通过 `world.get/list/findRefs/searchText/slices/getSlice/parseTime/formatTime/writeSlice/editMutations/deleteSlice` 完成查 / 写 / 改 / 删；writer 使用 readonly 模式，不注入写方法。旧的 8 个固定工具、Task 69 三工具、`codePath` 查询分支和旧 6-op 写入入口不再保留。
- 默认 Project 模板包含 `world-engine/schema/index.ts`（**Zod schema，硬切，不再支持 `schema.yaml`**）和 `world-engine/calendar.ts`，新 Project 不再默认生成 `simulation/`。
- World Engine reference 与 writing workflow 已对齐当前协议：Agent 统一走 `execute_world`，脚本只 return 数据，issues 由运行时 collector 汇总；时间在沙箱内用 instant bigint，读写路径统一 JSON Pointer，误写单条 mutation 优先用 `editMutations` 精确修正。旧 API 名称仅保留在 migration / legacy / historical research 语境。
- Calendar 已硬切到 `calendar.ts`，不再兼容 `calendar.yaml`；支持 `simple`、`gregorian`、`custom` 三类策略，缺少 `calendar.ts` 时应提示创建；Gregorian calendar 已覆盖公元前年份 parse/format 往返。
- Round 423 已用临时 Project 验证默认模板 API 链路：`calendar.ts` 时间格式下创建 `world/player`、写入 slice、查询 state、删除 slice 和状态回退均通过且 issues 为 0。
- Round 424 已用临时 Project 验证主 IDE Workbench 空项目第一步：默认模板 Project 可打开 Workbench，看到 schema/calendar 入口与创建入口，`创建 world subject` 会真实写入 `world` subject 和 init slice；临时 Project 已清理。
- Round 425 已完成阶段收尾审计：Round 380-424 的真实项目、新 Project、默认模板、连续推演、常用操作和 Calendar 证据足以证明当前“前后端雏形拼接 + 作者视角主路径”阶段已跑通；后续进入体验打磨和新产品决策。
- 主 IDE World Engine Workbench 支持创建 subject、写入 / 编辑 / 删除 slice、查询 state、展示 issues，并能从历史 `simulation/subjects` 发现真实主体系统摘要；该发现路径不代表 `simulation/` 是写作模式默认状态源。Workbench 已移除“示例世界”入口，SliceCard 主画布按 `path / op label / summary` 展示 patch。

## Hidden Legacy Systems

- Plot Workbench、Plot System、RAG subject 面板、RAG Inspector、RP profiles、simulation workflow 和 archived simulation 模板都保留在仓库中，方便历史项目和后续恢复。
- `novel-workflow-05-emulation-bootstrap` 与 `novel-workflow-06-emulation-tick` 保留为 legacy RP / simulation skill，不作为普通写作模式推荐路径。
- `workspace/ming-ding-zhi-shi-2` 已标注为 legacy RP / SillyTavern 导入项目，可作为复杂 schema/calendar 参考，但不是普通写作模式 World Engine 端到端验收样本。
- `assets/workspace/.nbook/templates/project-directory-templates/simulation/` 已归档到 `assets/workspace/.nbook/templates/archived/project-directory-templates/simulation/`。
- 新建 Project 不复制根目录 `simulation/`；真实用户 Project 中已有的 `simulation/` 数据不迁移、不删除。
- 用户 assets 同步会清理未手改的旧 `templates/project-directory-templates/simulation/**` 受管副本；手改副本按现有冲突规则保留。

## Recent Tasks

| Task | Status | Notes |
| --- | --- | --- |
| [56 World Engine](docs/tasks/56-world-engine/README.md) | Stage Complete | 核心模型、API、Workbench、subject system discovery 与作者主路径已完成阶段收尾审计。 |
| [64 World Engine Prompt Engineering](docs/tasks/64-world-engine-prompt-engineering/README.md) | Updated | 写作模式提示词主链与模板已收口：`08` 负责 World Engine 剧情推进，`09` 负责状态已推进后的 writer 写作，legacy RP/simulation 从普通入口降级。 |
| [65 Calendar Enhancement](docs/tasks/65-world-engine-calendar-enhancement/README.md) | Done | `calendar.ts` 硬切，`calendar.yaml` 仅作为历史记录。 |
| [66 Codebase Cleanup](docs/tasks/66-codebase-cleanup/README.md) | Stage Complete | 已完成一轮 World Engine / 写作模式阶段后的代码清理收口：Workbench 纯规则下沉、filter preservation、draft surface auto-open、issue level/status mapping 和专用 util 测试拆分已落地；命名 / 文件结构与复杂主体语境候选已记录待审批，后续等待真实作者使用反馈或用户重新开启。 |
| [69 World Engine Tool Cleanup](docs/tasks/69-world-engine-tool-cleanup/README.md) | Done | 历史任务：旧协议收口到 `patches/path/4-op`，运行时/DB 术语改为 `WorldPatch`，collection 支持按值删，内部全量查询统一走 `queryState`；其 Agent 三工具形态已在 Task 71 继续收敛为 `execute_world`。 |
| [71 World Engine CodeAct Readwrite](docs/tasks/71-world-engine-codeact-readwrite/README.md) | Implemented | Agent World Engine 工具收敛为单一 `execute_world`，读写合一进入 CodeAct deferred 事务；新增 issue collector、`editMutations` 精确编辑、`parseTime` / `formatTime`、`slices({withPatches:true})` patchId 与 JSON Pointer 读写统一。 |
| [72 Error Report Logs](docs/tasks/72-error-report-logs/README.md) | Implemented | 新增后端 JSONL 日志、日志包下载 API、请求/异常/Agent 摘要日志和 Windows portable `data/logs/` 落盘。 |
| [73 Agent Session List Performance Pagination](docs/tasks/73-agent-session-list-performance-pagination/README.md) | Implemented | `/api/agent/sessions` 改为分页 Page 返回，新增服务端 search；列表路径使用轻量运行态摘要和 profileKey 批量解析，避免按 session 重复解析 profile catalog。 |
| [58 Agent Profile Settings Low-Code](docs/tasks/58-agent-profile-settings-low-code/README.md) | Updated | `leader.default` 接入低代码 settings 与 profile home persona 资源，支持协作模式、熟练度、提问策略、Leader 人设和最高优先级自定义插入槽位。 |
| Writer Profile 重构 | Done | 去除小猫之神角色定义，理清 profile / reference / skill 职责边界，从 650 行压缩到 535 行。 |

## Known Follow-ups

- World Engine 写作模式主路径已阶段收尾；后续重点是体验打磨、`memory.jsonl` / `state.md` 是否显式 commit、以及真实作者长期使用反馈。
- RP 模式恢复时需要重新设计入口、profile routing、simulation 资料使用边界。
- Agent 用户输入 pending 已按 Task 63 收口到 durable user resolution 语义；后续前端验收仍建议覆盖多窗口同步、approval resume、Plan Mode、compact、edit/retry/rollback/fallback 和流式工具卡片。
- Agent session 列表已新增分页与服务端搜索；后续如果 Workspace Root 中 session 数增长到数千级，再设计持久化 session 摘要索引。
