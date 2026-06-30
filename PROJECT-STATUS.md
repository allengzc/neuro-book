# Project Status

## Summary

neuro-book 当前处于快速开发阶段。本轮产品主路径收敛到 **novel 写作模式 v1**：作者围绕 Markdown Studio、Project Workspace、Agent、World Engine 和 Scene-only Plot 工作台写作；旧 RAG subject 面板 / RP / simulation 默认模板先从普通入口隐藏，底层代码和历史资料保留。写作提示词主链已收口为 `灵感探索 → 项目/Lorebook → World Engine 初始化 → 08 剧情规划/状态推进 → 09 章节写作 → 写后回补/修订`。

## Product / Workspace Facts

- 部署主线是 Product-first：Windows Product Portable 是普通用户默认 release，zip 内包含 `app/` Product Payload、`data/` 运行状态、`runtime/bun/` 内置 Bun 和 `launcher/`。
- Windows Product Portable 错误报告日志落在 `data/logs/`；后端提供 `/api/app/logs/status` 与 `/api/app/logs/download`，日志包只包含日志和 manifest，不包含 config、数据库或 workspace 正文。
- 数据库已硬切 SQLite-only：App SQLite 位于 `workspace/.nbook/neuro-book.sqlite`；Project SQLite 位于每个 Project Workspace 的 `.nbook/project.sqlite`。
- Project Workspace 根目录 `project.yaml` 是项目身份真相源，App SQLite 不维护 Project index 或 `Novel` mapping。
- Global Config 位于 `workspace/.nbook/config.json`，Project 覆盖位于 `workspace/{project}/.nbook/config.json`；这些运行态文件不进 Git。
- 默认 Project 模板保留 `manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/`、`world-engine/` 等写作骨架。

## Writing Mode v1

- 普通写作入口以 Novel IDE / Markdown Studio 为主，顶栏保留 Bookshelf / World / Plot / User Assets / Agent。
- 顶栏重新暴露 Plot Workbench，且小屏下保持在视口内；RAG Inspector 仍不暴露，欢迎页仍不暴露 Plot / RAG / simulation 快捷入口。
- 左侧侧栏保留 Files / Characters / Plot；Agent 模式侧栏保留 Sessions，并提供 Plot 快捷入口用于切回 IDE Plot 面板；Outline 和 RAG 面板入口隐藏，`NovelPlotPanel` / `NovelRagPanel` 底层组件保留。
- Agent 新建菜单隐藏 `rp.leader` 和 `simulator.leader`；历史 session 的 profile 名称、图标和旧 profile 文件保留。
- 默认写作 workflow 中，`08` 是 World Engine 剧情事实确认与状态推进手册，`09` 只在状态已推进后调用 writer 写正文；修订产生新事实时回到 `08` 做 World Engine 回补。
- Markdown Studio 的 Inline AI PromptBar 使用 `inline.editor` 后台 session：发送后不自动打开右侧 Agent 面板、不切换主 Agent active session；PromptBar 内可选择、刷新、新建当前 Project 的 Inline AI sessions，并展示 edit/write 预览与最终摘要。
- 默认 Project 模板的 `agents/` 只创建 `leader.default/` 与 `writer/` 上下文，不再默认创建 `director`、`rp.leader`、`rp.writer` 或 `simulator.leader`。
- 本版本目标是先把写作模式体验打顺，RP 模式后续再恢复和重新设计入口。

## World Engine

- World Engine 是写作模式的动态世界状态与时间线真相源，用于替代旧 Plot 系统和 `simulation/` 默认运行态。
- Plot System 已通过 Task 78 改为 Scene-only 桥接层：`StoryPlot / Plot Beat` 不再是正式模型；`StoryScene` 持久化 `startInstant/endInstant/subjectIdsJson/locationSubjectId`，Scene 可通过服务端 API 查询相关 World Engine slices 和 subject states，并能从 Plot World Context 打开真实 World Engine Workbench。Scene World Anchor 读取 DTO 会解析 `subjects/locationSubject/unresolvedSubjectIds`，允许占位 subject ID，但 UI/API/Agent 必须显式暴露 unresolved 状态。
- 后端核心是 Project SQLite 三表：`WorldSubject`、`WorldSlice`、`WorldPatch`；公开写入已硬切为 `patches` + 4-op（`replace` / `increment` / `remove` / `append`），collection 支持 `remove + value` 按 stable JSON 值删除元素，patch 不存旧值字段，后端不自动改写后续切面。
- HTTP API 覆盖 schema、subjects、slices、slice delete、state/query；公开时间入参拒绝 raw instant 调试格式、首尾空白和非法 percent encoding。
- Agent 内置 World Engine 工具收敛为单一 `execute_world`：Leader / world.engine 使用 readwrite CodeAct，公共 API 为分组形态 `world.time.*`、`world.subject.*`、`world.search.*`、`world.slice.*`；writer 使用 readonly 模式，不注入 `world.slice.write/editPatches/delete`。旧的 8 个固定工具、Task 69 三工具、`codePath` 查询分支、旧 6-op 写入入口、旧平铺 `world.*` API 和 `world.getMany` 不再保留。
- 默认 Project 模板包含 `world-engine/schema/index.ts`（**Zod schema，硬切，不再支持 `schema.yaml`**）和 `world-engine/calendar.ts`，新 Project 默认 Calendar 已切到 Gregorian 现实日历，format 到分钟、不带秒；新 Project 不再默认生成 `simulation/`。
- World Engine reference 与 writing workflow 已对齐当前协议：Agent 统一走 `execute_world`，脚本只 return 数据，issues 由运行时 collector 汇总；查询状态时优先在 CodeAct 内把已知 schema 的 attrs 转成文本摘要并 `return string`，工具文本会直接展示该摘要，结构化 `{data, issues}` 仍保留在 details；`world.subject.get()` 返回 attrs 本体；时间在沙箱内用 `world.time.parse/format` 和 instant bigint 互转，读写路径统一 JSON Pointer，同一 instant 只能有一个 slice，同刻多变更必须合并到同一个 `patches` 数组；误写单条 patch 或向已有 slice 补已登记 subject 时优先用 `world.slice.editPatches` 精确修正，冲突错误会返回 `existingSliceId/time/title` 并引导合并 patches；按 subject 查相关切面走 `world.slice.list({subjectIds})`，`world.slice.get` 只接受 sliceId。旧 API 名称仅保留在 migration / legacy / historical research 语境。
- Calendar 已硬切到 `calendar.ts`，不再兼容 `calendar.yaml`；支持 `simple`、`gregorian`、`custom` 三类策略，缺少 `calendar.ts` 时应提示创建；Gregorian calendar 已覆盖公元前年份与默认现实时间 `公元2020年4月12日 18:00` 的 parse/format 往返。`calendar.ts` 与 `schema/index.ts` 是单文件配置入口：入口内容变化可热加载，本地文件、绝对路径和 URL/protocol import/export 会被拒绝，包级 import 与 `node:` 内置模块继续允许。
- EmbeddingText 容器初始化死锁已修复：空 `replace /events []` / `replace /memory {}` 可作为 default 初始化基准，非空 embedding 内容仍必须按单条 patch 写入，错误信息会提示 `{text:"..."}` 写法；`vector/model` 由系统维护，显式字段和内部路径绕过都会被拒绝。
- Round 423 已用临时 Project 验证默认模板 API 链路：`calendar.ts` 时间格式下创建 `world/player`、写入 slice、查询 state、删除 slice 和状态回退均通过且 issues 为 0。
- Round 424 已用临时 Project 验证主 IDE Workbench 空项目第一步：默认模板 Project 可打开 Workbench，看到 schema/calendar 入口与创建入口，`创建 world subject` 会真实写入 `world` subject 和 init slice；临时 Project 已清理。
- Round 425 已完成阶段收尾审计：Round 380-424 的真实项目、新 Project、默认模板、连续推演、常用操作和 Calendar 证据足以证明当前“前后端雏形拼接 + 作者视角主路径”阶段已跑通；后续进入体验打磨和新产品决策。
- 主 IDE World Engine Workbench 支持创建 subject、写入 / 编辑 / 删除 slice、查询 state、展示 issues，并能从历史 `simulation/subjects` 发现真实主体系统摘要；该发现路径不代表 `simulation/` 是写作模式默认状态源。Workbench 已移除“示例世界”入口，SliceCard 主画布按 `path / op label / summary` 展示 patch。

## Hidden Legacy Systems

- RAG subject 面板、RAG Inspector、RP profiles、simulation workflow 和 archived simulation 模板都保留在仓库中，方便历史项目和后续恢复；Plot System 已恢复为普通写作入口中的 Scene-only 工作台。
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
| [74 Agent Command Performance](docs/tasks/74-agent-command-performance/README.md) | Implemented | `/api/agent/sessions/:id/commands` 轻控制命令返回 live state，不再生成完整 snapshot；relation index 已收敛到 write executor after-write observer，并修复 rebuild pending link/detach 漏账；profile catalog dirty cache 已加 generation race 防护和 HTTP runtime watcher。 |
| [75 World Engine API / Calendar / EmbeddingText 收口](docs/tasks/75-world-engine-api-calendar-embedding-cleanup/README.md) | Implemented | World API 改为分组形态，删除 `world.getMany` 和旧平铺 alias，`editMutations` 迁移为 `world.slice.editPatches`；默认 Calendar 切 Gregorian 到分钟，`ming-ding-zhi-shi-2` 保留复兴纪元但去秒；EmbeddingText 空容器初始化、vector/model 公共写入边界、subject 相关切面查询、schema/calendar 单文件热加载契约、task checklist 分支局部稳定性与 `execute_world` 文本摘要返回契约已修。 |
| [78 Plot Scene / World Engine Bridge](docs/tasks/78-plot-scene-world-engine-bridge/README.md) | Complete | Plot System 已收敛为 Scene-only：Scene 通过时间范围、地点 subject 和出场 subject 连接 World Engine；Plot 入口已恢复到顶栏、左侧侧栏、Agent 模式侧栏快捷入口和 Plot 面板内按钮；旧 `StoryPlot / Plot Beat` 已从正式模型、工具和 UI 中删除，旧项目迁移会备份并合并数据到 Scene。Agent 易用性主链已改为 leader.default 直接负责 Plot / Scene：剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer；leader.default 持有 Thread / Scene 读写、Scene World Context 和 `get_chapter_writer_brief`，director 保留为高级/手动 profile，不再是普通写作必经节点；writer 仍无 Plot tools，world.engine 仍只负责复杂世界引擎维护。四个实现切片已完成：Profile Contract Cleanup、OpenAPI Explicit Path、Chapter Writer Brief Module、Agent Tool Binding；`get_chapter_writer_brief` text 返回 `suggestedBriefMarkdown`，details 返回完整 DTO。Round 140 completion audit 跑过 13 files / 62 tests passed；Round 141 调整 leader-owned Plot 主链；Round 142 补齐稳定 reference 与 server 侧测试门禁，移除不被 Vitest 收集的 assets writer 假门禁。真实 Agent 模型行为 smoke 与浏览器验证未执行，不作为 Task 78 完成门禁；ChapterOverride 已单列后续 Task 80。 |
| [79 Profile Build System](docs/tasks/79-profile-build-system/README.md) | Implemented | profile 编译系统 Phase 0–3 已收口：`editor-snapshot` 不再返回/触发 profile settings 大包；settings/build-status 专用接口与前端状态块已接入；`.compiled` 切为内容寻址 `artifacts/<sha>.mjs` + profileKey 映射 manifest；`compile_failed` 写入账本且 runtime 严格拒绝 stale/failed；HTTP runtime worker 只生成 staging release，server 主线程 `ProfileReleasePublisher` 经 `proper-lockfile` 做 in-process 原子发布并翻 Registry；`ProfileArtifactStore` / `ProfileFreshnessChecker` / `ProfileRegistry` / `ProfileSourceWatcher` 已从 catalog facade 拆出；保存/创建/删除/外部编辑 500ms 去抖后台编译，启动 boot sweep 非阻塞自愈 user profile；profile assets sync 改 staging→Publisher，copy-if-absent 并可修复损坏的同 sha user artifact；内容寻址 artifact GC 带 grace，worker service 已扩为受互斥约束的 worker 池，全量编译已改为 worker 池 entry fan-out、主线程 fan-in 一次 manifest 发布；single compile 改为 worker 只产 entry staging、Publisher 在 publish lock 内合并当前 manifest；Publisher 增加 per-root in-process 发布队列，确保磁盘 release 与 Registry 翻转同 root 串行；HTTP runtime user-assets sync 已改为 in-process 强一致返回，profile assets sync 一次同步只发布一个 batch patch release，真实 `.compiled` artifact 修复收敛到 Store publish lock 内；watcher freshness gate 已验证 artifact/type artifact 后再跳过编译，unlink 与 stale source-missing 升格 full build，避免删除/并发保存漏账；final guard 已锁定所有 full replacement 发布前校验 source file set + entry source hash/bytes；profile/workspace 测试 root 已隔离，三文件并行回归不再污染真实 user-assets。 |
| [80 Chapter Override / Writer Brief](docs/tasks/80-chapter-override-writer-brief/README.md) | Follow-up Design | 单列 Task 78 未实现的章节级 writer 指令层：POV、语气、节奏、信息控制、开头/收尾和禁写事项。边界是不保存动态世界状态、不恢复 Plot Beat，只作为 Chapter 到 WriterBrief 的只读/编辑层继续设计。 |
| [81 Profile MCP Config](docs/tasks/81-profile-mcp-config/README.md) | Design | profile 级 MCP 支持先走配置化路线：Workspace Root 注册 MCP server，profile 通过显式 tool allowlist 启用 MCP tools；第一版不提供 profile helper 加载 MCP、不升级 inline execute 工具类型、不自动启用整个 server，并要求模型可见工具集合与执行硬权限共用同一份冻结 run tool snapshot。已补充 [ARCHITECTURE.md](docs/tasks/81-profile-mcp-config/ARCHITECTURE.md)，从性能、用户体验、加载逻辑、Harness 复杂度、开发人员心智、安全与失败恢复比较方案，推荐 `RunToolSnapshotResolver` 作为实现中心。 |
| [83 Project List Performance](docs/tasks/83-project-list-performance/README.md) | Implemented | `/api/projects` 已收口 5s 短缓存契约：include-only 查询与默认完整列表共享缓存，manifest/session count/per-project workspace+plot stats 分层缓存并带 in-flight 去重；Novel IDE 主入口不再发送 include-only query，World Engine preview 保留有限列表补回当前选择；route 已接 `Server-Timing` 与 500ms 慢日志，启动后后台渐进预热子缓存但不占用默认完整列表 pending。 |
| [18 Agent Runtime Pipeline Hooks](docs/tasks/18-agent-runtime-pipeline-hooks/README.md) | Updated | Agent 基础工具协议已补齐并重新修复当前工作区回写回归：`request_user_input` 已从 Low-Code Form 拆出，模型可见结果保持格式化文本和结构化 `details.answers`，协议只保留问题、单选 options、开放 note，不再支持默认值/推荐/多选；`read` 支持按需/自动行号和定位 details，offset/limit 收紧为正整数；`edit` 批量 exact replacement 先预检再写入并返回可读失败诊断；task custom state 维持即时 + savePoint 状态写入，覆盖下一轮读取和旧分支不污染语义。 |
| [51 llmlint Text Lint Skill](docs/tasks/51-anti-ai-slop-skill/README.md) | Updated | `llmlint` 已升级为 flat Rule Registry：默认只启用 `builtin/default`，合并人工 anti-ai-slop 规则与中文规则样本策展结果；中文规则 ID 已改为语义 slug，内置 default 规则资产已硬切为 `rules/` 目录递归加载结构，例如 `rules/absolute/index.json`、`rules/abstraction/hollow.json`、`rules/vocabulary/r18.json`，`ruleset.json` 不再声明规则文件清单，也不兼容旧根 `rules.json` / `ruleFiles`；支持 namespace 关闭 R18、override diagnostics、JSON 输出和 `--min-level` 级别过滤；stylish 输出按 high / medium / low 分段，默认紧凑显示行列范围与命中文本，`--show-lines` 可显示完整命中行；user-assets 同步已清理旧 presets / 旧 `cn-*` ruleset，并会清理未手改的旧平铺 namespace 规则文件。新增独立于 `level` 的 `review`（agent/human/none）与 `fixability`（auto/candidate/manual）维度：`check` 默认 `--review agent` 只展示需 Agent 处理的命中，破折号/比喻/泛词形副词等噪声主犯由命名空间策略表 `DEFAULT_NAMESPACE_POLICY` 降到 `human` 桶（真实章节默认命中 349→61），可用 `--review human/none/all` 查看其它桶；config 覆盖支持 `{enabled,level,review,fixability}` 对象形态，字符串与对象已归一为单一 patch（loader 单一解释点：`enabled` 显式决定启停，纯属性对象不复活被关闭的 ruleset），退出码跟随可见视图。v1 规则内容建设已取三同类项目（shuorenhua 为主、avoid-ai-writing / humanizer 为辅）精华扩充：`src/base-rules.ts` 改为聚合器 + `src/base-rules/` 主题模块，新增 48 条中文/语言无关 static 规则（开场套话/渲染性强调/过渡废话/无源引用/正能量收尾/谄媚助手腔默认进 agent 桶，工程师腔/自媒体腔/翻译腔/戏剧化碎句默认进 human 桶，外加移植自 avoid-ai-writing 的 `mechanical.*` 机械痕迹包：零宽字符/同形字/占位符/chatbot 泄漏），按 shuorenhua Tier 模型映射 level/review、误杀防护写进 note；`builtin/default` 重生成为 340 rules / 311 active（原 292/263），这批 article/chat 腔规则在小说正文里休眠不增噪、遇 AI 文章/聊天腔或粘贴泄漏时密集命中。已在 `.agent/workspace/llmlint` 建立 GitHub-only 独立发布骨架（Bun CLI + Agent Skill，PolyForm Noncommercial 1.0.0，版本 2.0.0，`bun.lock` 已生成），neuro-book 内 `assets/workspace/.nbook/agent/skills/llmlint` 保持 vendored runtime snapshot，不使用 submodule，也不直接依赖外部 GitHub。CLI 已扩展为稿件级工具：`check` 支持多文件与目录递归（`.md`/`.markdown`/`.txt`）、对 Markdown 默认跳过代码块/frontmatter/行内代码/链接等结构区域（`--scan-all` 关闭，新增 `src/markdown-mask.ts`），并新增 `fix` 命令消费 `fixability:auto`（零宽字符删除/连续符号去重，原生 `String.replace` 支持 `$1`/lookbehind，默认 dry-run、`--write` 落盘、尊重遮罩不改代码块）；多文件 JSON 为 `kind:check-multi`，单文件形态不变；glob 输入用 tinyglobby（`**` 递归、`!` 排除、花括号；目录递归仍可用），stylish 输出在 TTY 下用 picocolors 按级别/语义着色、被管道/Agent 抓取/`--format json`/`NO_COLOR` 时自动纯文本；skill 依赖已自包含（`package.json` 声明 + skill 目录 `bun install` + 本地 `.gitignore` 忽略 node_modules，sync 复制 node_modules 到部署副本）；独立发布仓库 `.agent/workspace/llmlint` 依赖与 republish 留作后续。 |
| [58 Agent Profile Settings Low-Code](docs/tasks/58-agent-profile-settings-low-code/README.md) | Updated | `leader.default` 接入低代码 settings 与 profile home persona 资源，支持协作模式、熟练度、提问策略、Leader 人设和最高优先级自定义插入槽位。 |
| Writer Profile 重构 | Done | 去除小猫之神角色定义，理清 profile / reference / skill 职责边界，从 650 行压缩到 535 行。 |

## Known Follow-ups

- World Engine 写作模式主路径已阶段收尾；后续重点是体验打磨、`memory.jsonl` / `state.md` 是否显式 commit、以及真实作者长期使用反馈。
- Plot / World Engine 桥接的 Agent 易用性第一阶段已完成；当前普通写作主链已在 Round 141 改为 leader.default 直接负责 Plot / Scene，leader 持有全套 Plot 读写和 brief 工具，writer 仍无 Plot tools，world.engine 工具面未扩大。Round 140 completion audit 覆盖了原 Director + Brief Compiler 完成态；Round 141 是之后的 profile 主链调整。真实 Agent 模型行为 smoke 尚未执行，因此不声明模型在真实会话中的规划质量已验证。后续章节级 POV、语气、节奏、信息控制、开头/收尾和禁写事项进入 Task 80 的 `ChapterOverride`，继续扩展同一个 brief。Task 78 Round 63-135 是实现前设计、风险和 runbook 记录；当前状态以 Round 136 之后的完成/调整记录为准。
- World Engine 后续单独讨论更大的 API 形态：是否增加 subject 视角便利查询、批量读取命名、列表过滤 DSL。
- RP 模式恢复时需要重新设计入口、profile routing、simulation 资料使用边界。
- Agent 用户输入 pending 已按 Task 63 收口到 durable user resolution 语义；后续前端验收仍建议覆盖多窗口同步、approval resume、Plan Mode、compact、edit/retry/rollback/fallback 和流式工具卡片。
- Agent session 列表已新增分页与服务端搜索；后续如果 Workspace Root 中 session 数增长到数千级，再设计持久化 session 摘要索引。
- Project list 已有 5s 短缓存、启动预热与 `Server-Timing` 分段观测；后续如果 Project 数增长到上百且短缓存仍不足，再考虑持久化 Project stats 索引。
- Agent command 轻控制路径已移出完整 snapshot，relation/profile 热路径一致性已补齐；后续若完整 snapshot 首屏仍慢，优先单独治理 `snapshotSystemPrompt` 冷路径成本。
- Profile 编译系统底层重构（Task 79）已完成 Phase 0–3 收口：读路径硬切、内容寻址 artifact、原子 manifest、`compile_failed` 记账、严格无 stale、主线程 in-process Publisher、Registry 翻转、自动编译 Coordinator、boot sweep、profile assets sync Publisher 化、artifact grace GC、独立 ArtifactStore/FreshnessChecker/Registry/SourceWatcher 组件、全量 worker 池 fan-out/fan-in、发布前 source file set + entry source hash/bytes 重校验、磁盘发布成功后 source 不回滚、Registry 半成功 committed error、profile/workspace 测试 root 隔离与嵌套恢复均已落地；`.compiled` 新格式稳定契约见 `reference/agent/profile-compiled-artifacts.md`。
