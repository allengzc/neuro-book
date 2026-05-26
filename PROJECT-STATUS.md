# Project Status

## Summary

neuro-book 当前处于快速开发阶段。项目主线正在从数据库中心逐步转向文件化 Workspace Root / Project Workspace，并围绕 Markdown Studio、引用系统、剧情结构、多 Agent 协作、统一配置系统、全站鉴权、管理员后台和主界面账户入口补齐核心体验。

部署侧已硬切 SQLite-only：App SQLite 默认位于 `workspace/.nbook/neuro-book.sqlite`，只保存 `User`、auth、global config 相关应用级数据和全局锁；Project SQLite 位于每个 Project Workspace 内的 `.nbook/project.sqlite`，保存 Story / StoryPhase / StoryThread / StoryScene / StoryPlot / StorySceneRef 等项目结构化数据。PostgreSQL schema、adapter、pool、部署选项和 compose override 已移除，旧 PostgreSQL 数据不提供内置迁移。部署默认入口是“本机 + Git” `local-git`，执行 git clone/pull、宿主机依赖安装、构建、迁移并生成 `.deploy/start-local-git.*`；`native` 只作为旧参数兼容别名，`ghcr` / `source` 保留为高级 Docker 模式。Project Workspace 根目录 `project.yaml` 是项目唯一真相源，保存 `kind`、`title`、`summary`；App SQLite 不记录 Project index、Project 状态或 `Novel`/`novelId` mapping。模型 Provider、API Key、Agent 默认 profile、UI/editor 偏好已迁入 Global Config `workspace/.nbook/config.json`，Project 覆盖写入 `workspace/{project}/.nbook/config.json`。这些运行时文件都不进 Git，真实文件不再作为仓库文件维护。

`execute_sql` 已收敛为 Project SQLite-only 工具：不接受 SQLite 文件路径参数，不访问 App SQLite，只能在当前 Project Workspace 上下文中操作 `.nbook/project.sqlite`，继续允许受限 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`，并禁止 DDL、多语句、事务控制和危险 PRAGMA。

模型 Provider 侧已把 `openai-compatible` 收敛为增强版 OpenAI 兼容 adapter，默认接收、标准化并回放 `reasoning_content`，覆盖 MiMo、DeepSeek 网关等 Agent thinking 场景；严格 OpenAI 官方接口使用 `openai-official`，避免把 provider extension 字段发给官方 OpenAI。

本文档记录仓库级现状。每次重大任务完成后，需要同步更新本文档和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。

## Current Focus

- 文件化 workspace：按 Project Workspace 隔离，根 `project.yaml` 是项目身份与展示元数据真值源；前端通过 SSE 订阅真实文件变化，保存时使用 `mtimeMs` 做冲突检测。
- Markdown Studio：收敛为 Notion-like 富文本模式 + 源码模式；Markdown 原文仍是唯一真相，TipTap 负责运行时 ProseMirror 富文本表面，表单 Markdown 编辑器也复用同一底层能力并只做工具栏包装。
- 引用与内容节点：统一 inline ref、structured refs、content node 校验、warning 策略、`state.md` 当前状态，以及 `retrieval` / `inject` 上下文策略；`knowledge[]` 使用自然语言字符串并校验其中的 Markdown 内容节点链接；内容节点不再生成通用 `writingTip` frontmatter。
- Agent 系统：主路径已硬切到 Pi-based `server/agent`。旧 v2 已归档到 `server/agent-v2` 与 `assets/agent-v2`，不再进入 typecheck、测试或运行时；旧 Prisma `AgentThread` / `AgentMessage` 数据模型已删除。新主路径使用 TypeBox profile contract、active TSX Profile DSL、`ProfileTurnPlan` harness 合同、Pi-compatible message/event/tool 语义、JSONL append-only session、动态 `.nbook/agent/profiles` catalog、`.nbook/agent/skills` SkillCatalog、`read/write/edit/apply_patch/bash` 基础工具、`create_agent/invoke_agent/get_agent/detach_agent` agent 工具，以及已迁移的 task / Plot / SQL 业务工具。普通 Project agent 的工具 cwd 是当前 Project Workspace，当前项目通过 `projectPath` 和 RuntimeContext 的 `Current Project Workspace` 表达；user-assets agent cwd 仍是 `workspace/.nbook`。独立 `skill` 工具已禁用，Agent 通过 `SkillCatalog` 的 `location` 用 `read` 打开 `SKILL.md`，reference 由入口文档按需继续读取。系统 profile 已包含 `leader.default`、`leader.assets`、`writer`、`retrieval`；`writer` 已硬切为“一章节一 agent”，输入使用 `chapterPaths` 和 `lorebookEntries: string[]`，自动展开本章 Chapter Plot 并只写显式章节 `index.md`；writing presets 已迁到 `agent/writing-presets/{styles,references}` 并纳入 user-assets 同步。正式 HTTP 和前端抽屉已迁到 `/api/agent/sessions/**` 的 session/invocation/event contract，旧 thread/subagent 前端心智已替换为 session/linked agent；临时 `/api/agent-v3/**` 和旧 `/api/agent/threads/**` 已删除。
- Config 系统：配置已拆为 Boot Config、Global Config、Project Config 和 Browser State。Boot Config 使用根 `config.yaml`；Global Config 使用 `workspace/.nbook/config.json`；Project Config 使用 `workspace/{project}/.nbook/config.json`；正式 API 是 `/api/config/*`，旧 `/api/settings/*` 与 `/api/workspace-settings` 已删除。
- 外部小说素材：新增番茄小说导入 skill，第一版支持免费小说 epub 与 Tomato Novel Downloader 本地结果导入到当前小说 workspace 的 `reference/tomato/`，用于后续拆书和结构分析。
- 文档治理：把稳定规范、调研资料、任务 walkthrough 分开维护。
- 全站鉴权：默认启用的 cookie session 登录、管理员用户管理页、主界面右上角头像菜单、登录失败限流、复杂密码生成、Global Config `auth.enabled` 开关和初始管理员创建脚本已经接入。

## Module Status

| Module | Status | Notes |
| --- | --- | --- |
| Workspace | Active | 已转向 portable Project Workspace，术语以 [spec/workspace/TERMS.md](spec/workspace/TERMS.md) 为准：Workspace Root 默认 `workspace/`，Project Workspace 默认 `workspace/{project}/`，根 `project.yaml` 是项目唯一真相源。内容节点模板和新小说目录模板已切到 Bundled Workspace Template `assets/workspace/.nbook/templates/...`，用户覆盖层是 `workspace/.nbook/templates/...`；manuscript 新小说模板已使用 `manuscript/001-volume/001-chapter/` 的 volume / chapter 层级；文件树和干净编辑器会响应真实文件变化，网页/磁盘同时修改时走保存冲突对话框。 |
| Markdown Studio | Active | 主编辑器只保留富文本和源码两种模式；图片、inline code、workspace/domain reference 和表格在富文本侧使用真实 ProseMirror node / mark，并序列化回 Markdown；`StructuredTextEditor` 不再维护独立 schema，只作为表单工具栏包装层。 |
| Config | Active | 新配置真值源为 `/api/config/*`：Boot Config `config.yaml` 只放启动/部署字段，Global Config `workspace/.nbook/config.json` 保存 auth/models/agent/UI/editor 长期偏好，Project Config `workspace/{project}/.nbook/config.json` 只覆盖 registry 允许的字段；Provider API Key GET 脱敏、PUT 支持保留/清空/覆盖。设置 Dialog 已升级为配置中心，可显式切换 Global Config / Project Config / Browser State，并能选择任意 Project Config 编辑默认模型、默认 Profile 和 Agent Profile 模型覆盖。 |
| Auth | Active | 默认开启的全站 cookie session 鉴权已接入；Global Config `auth.enabled` 可关闭整站守卫；包含登录页、管理员用户管理页、主界面账户菜单、登录失败限流、复杂密码生成、用户状态/角色/密码重置和初始管理员脚本。 |
| Reference | Active | 文件化内容节点 refs 不再承载 visibility；Agent prompt 已收敛为 inline ref 表达自然提及、structured refs 表达稳定系统关系；Plot refs 已迁到内容节点路径，不再依赖数据库 Lorebook。 |
| Plot / Story | Active | 剧情系统已迁入 Project SQLite：每个 Project Workspace 的 `.nbook/project.sqlite` 保存 Story / StoryPhase / StoryThread / StoryScene / StoryPlot / StorySceneRef，不再依赖 App SQLite 的 `Novel` / `novelId`。refs 指向设定/角色/地点时使用 `lorebook/.../` 内容节点路径，剧情内部对象仍使用 thread/scene/plot URI；数据库不再维护 `Volume` / `Chapter` 表，Scene 挂章使用 `chapterPath` 指向 `manuscript/.../` content-node 目录。 |
| Agent v2 | Archived | 旧实现已移动到 `server/agent-v2` 与 `assets/agent-v2`，只作为迁移参考，不进入 active typecheck、测试或运行时。旧 `AgentThread` / `AgentMessage` Prisma 模型已删除。 |
| Agent | Active | Pi-based harness 已成为 `server/agent` 主实现：TypeBox profile、active TSX Profile DSL、`ProfileTurnPlan`、动态 `.nbook` profile/skill catalog、JSONL session、slash command、approval resume、profile ingest、linked agents、compaction、Pi 风格基础文件工具、agent 工具、task 工具、Plot 工具、SQL 工具和真实 provider smoke 均已跑通。正式 HTTP 入口是 `/api/agent/sessions/**`；前端 Agent 抽屉已迁到 session snapshot + event hub + command/tree/invocation contract，保留聊天、停止、审批恢复、模型选择、Plan Mode、`/compact`、linked agents、edit/retry/rollback/fallback 的核心入口；`/clear` 现在通过 tree 清空同一 session 的 active leaf。Harness 运行错误会写入 `invocation_lifecycle.errorInfo`，前端投影为模型不可见的 Run Error 卡，并用 invoke HTTP 返回做兜底通知。变量系统第一版已接入：invoke 传 `clientState`，`ctx.input` 回到 profile 静态输入，Profile 通过 `ctx.vars` / `<Variable>` / `<VariableSchema>` 读取 `client/global/project/session` 变量，profile 内 `variableDefinitions` 可随 profile artifact 注册 `session.*` 变量，`variable_schema` / `variable_read` / `variable_patch` 已注册为 Agent 工具并按注册 schema 校验读写；`ctx.workspace` / `ctx.input.studio` 旧入口已从 active 代码删除，`leader.default` 的 Project Workspace 和 Plot Focus runtime 提醒已改为普通内联 `Reminder`。`client.*` 前端写回 ack 管线和 Workspace Root / Project 变量 definition `.compiled` 仍是后续 TODO。active user profile 覆盖已通过 `.system-profile-metadata.json` / `.profile-sync-state.json` 同步到最新版，`leader.default` 实际运行时可见 `get_agent_profile`；writer 已硬切为 `chapterPaths` 单章节合同，retrieval 输入已精简为 prompt-only，输出 `{ entries, note? }` 给 Leader 判断，Leader 调 writer 时只传 `entries[].path` 数组；writing presets 位于 `agent/writing-presets/{styles,references}`，user-assets 同步会区分缺失、未手改和已手改。 |
| Skills | Active | 新 Agent 后端只扫描 `assets/workspace/.nbook/agent/skills` 与 `workspace/.nbook/agent/skills`；v2 的写作流程、初始化、番茄导入、skill-creator 和 TSX profile editing skills 已整体迁到 v3 系统 skill root，`assets/agent-v2/skills` 仅作为归档参考。独立 `skill` 工具已禁用；模型通过 `SkillCatalog` 看到 key/name/description/when_to_use/location，需要使用时用 `read` 打开对应 `SKILL.md`，reference/scripts/templates/examples 按入口说明按需读取。系统 skill 还包含 `profile-system-guide`，用于让 `leader.assets` 用通俗方式协助用户理解和修改 harness / TSX profile / skill / user-assets 覆盖层，并提供文档索引、profile compile CLI、恢复系统版本和新建模板指导；该 skill 已新增 reference 文档，详细说明 session truth、invoke 生命周期、ProfileTurnPlan 分区、TSX DSL、user-assets 覆盖和 compile/preview/run 区别。TSX Profile Workbench 第一版已接入用户 profile 源码写入、新建模板、文件 diagnostics、prepare preview、创建 session 入口，并可解析/局部写回稳定的 `<ProfilePrompt>` TSX DSL tree；用户 profile 编辑已切为自动轻量 DSL 解析 + 手动后台 worker 编译，保存不触发自动编辑期 runtime profile loader，创建 Session 需要最近一次编译通过且源码未改动；普通 runtime catalog 已硬切为 `.compiled` 运行真相源，系统 compiled artifact 随 system assets 预编译发布，用户 compiled artifact 只能由 Workbench 或 `profile compile` 手动生成；profile 和变量 definition compiled artifact 已改为稳定文件名，hash 只保存在 manifest 中，编译和 user-assets 同步都会清理未引用旧产物；旧 `scripts/compile-profile.ts` / `scripts/check-profile.ts` / `scripts/profile-compile-cli.ts` 已被 `profile status/check/compile/preview` CLI 替换；旧 `profile-templates` / `user-profile-templates` API 仍作为 501 tombstone，不再作为新合同。 |
| Docs | Active | 本轮完成目录重排、状态报告和任务 walkthrough 约定。 |

## TODO

- 跑通剧情系统的核心写作链路。
- 跑通 Lore / mention / reference 的端到端体验。
- 补齐 Writer / Planner / Critic / Editor 的多 Agent 工作流。
- 简化 story 工具和 content node schema 的重复定义。
- 继续把旧章节面板和预览页从 DB Chapter 心智收敛到 manuscript content-node。
- 收尾 Project API 命名：前端 store 和部分兼容 DTO 仍沿用 `Novel` / `currentNovelId` 命名承载 `projectPath`，后续需要在不扩大行为面的前提下重命名为 Project 术语。
- 继续清理非 Plot 链路中的旧 `lorebook://` 引用入口。
- 继续稳定 Markdown Studio/表单包装层的标题、inline code、引用、图片和表格编辑体验。
- 优化 request_user_input 的自由输入、收起、切换和取消状态。
- 设计泛用自然语言编辑工具：输入目标文件、自然语言操作说明和可选上下文消息数量，由轻量模型辅助修改文件；后续可用于 Agent 记忆系统、RP 状态维护和常规文件编辑减负。
- 建立 token statistics、写作历史 statistics 和缓存命中统计。
- 扩展番茄小说导入：补基础数据、评论、全站搜索、正文下载含段评和图片等能力。
- 将 workspace 保存冲突视图与后续 Git 版本控制能力整合。
- 后续如新增独立发版脚本，需要确认它同样先运行 `profile:metadata`；当前 `scripts/prepare-system-profile-metadata.ts` 已接入 `build` / `nuxt:build`，会生成 `.system-profile-metadata.json`，用户 assets 同步会基于 `.profile-sync-state.json` 自动更新未手改的系统 profile 覆盖，手改或缺 state 时保留用户文件并提示遮蔽。
- 设置页后续继续增强 raw/effective 差异展示；当前配置中心已支持 Global / Project / Browser State 目标切换、Project selector、Project 默认模型、默认 Profile 和 Agent Profile 模型覆盖。
- 清理动态 profile 渐进迁移 fallback：生产注册路径已切到 assets profile + builtin contract，系统 assets profile 也已改成 `defineAgentProfile`；后续删除旧源码 builtin class，或把仍被复用的 prompt helper 迁成稳定公共 helper。
- 重新设计 TSX profile 的 TypeBox Schema Builder：旧 Zod 低代码 schema 编辑不再作为新合同保留；新的 Profile Workbench 第一版只做 schema 只读展示和 TypeBox 骨架生成，后续再基于 v3 profile 经验补可稳定定位的局部辅助编辑。
- 为 skill catalog 增加类似 tool 的白名单或启用控制，避免所有可发现 skill 默认进入模型可见 catalog。
- 后续如果支持加载第三方 profile，新增 profile 审查 skill，用于检查陌生 `.profile.tsx` 的危险代码、工具权限、schema contract 和提示词行为；当前动态 profile 不做 sandbox，按用户可信本地代码处理。
- 后续如有需要，再把系统默认 profile 暴露到系统设置；当前默认 Agent Profile 写入 Global / Project Config，system default 仍为小说 `leader.default`、用户 assets `leader.assets`。
- 让 workspace 默认 Profile 设置页复用 profile catalog 的 loadStatus / issue 信息，避免 contract-only 或 missing profile 在设置列表中被当作普通可运行项展示；当前运行路径已阻止 contract-only profile 执行。
- Agent 前端迁移后补一次浏览器交互验收：重点验证多窗口事件同步、followUp queue、approval resume、Plan Mode、model command、compact、edit/retry/rollback/fallback 和流式工具卡片。
- Agent SSE 前端合同第一轮已落地：`/api/agent/sessions/:id/events` 已有 stream manager、自动重连、snapshot single-flight、连接状态、run phase、`contentIndex` assistant block 合并和手动重连/刷新历史入口；后续保留真实浏览器验收与工具执行输出流式后端贯通。
- 后续为 Agent session 增加 provider 级 `systemPrompt` metadata/hash 记录，避免 TSX profile 源码变化后旧 session 的系统提示不可追踪；当前前端不把 systemPrompt 展示成聊天消息。
- Agent session event hub 后续支持跨进程/多实例广播；第一版是单进程内存 replay，重启或多 worker 场景通过 snapshot 恢复，不保证实时 fan-out。
- TSX Profile Workbench 后续补完整辅助编辑：当前第一版已能从系统模板新建、保存、轻量解析、手动后台编译、诊断、预览、创建自定义 profile session，并解析/局部写回稳定 `ProfilePrompt` DSL tree；TypeBox Schema Builder、工具权限 checklist 局部替换、复杂 `Watch.render`、跨 helper 的完整 AST round-trip，以及是否为多 profile catalog 编译引入 worker pool 仍待重做。
- Agent 变量系统已接入 profile 编辑期类型补全底层：从 builtin/client、Workspace Root/global、Project Workspace/project 和 profile/session definitions 派生 generated `.d.ts`，让 `ctx.vars.get()`、`<Variable>`、`<VariableSchema>` 和 `watchPath` 获得 path 补全和返回值类型提示；类型产物只作为 authoring aid，不改变 runtime registry/schema 校验真相源。后续补 Workbench 变量选择器和更细的 schema-aware patch builder。
- Pi Agent Harness 迁移后续补 `invoke_agent` 非阻塞调用；v3 agent 工具已收敛为 `create_agent`、`invoke_agent`、`get_agent(id?: number)`、`get_agent_profile`、`get_session`、`detach_agent`；`invoke_agent` 工具返回 sessionId、usage、finalMessage、report_result 摘要，不返回完整 history；`request_user_input`、`enter_plan_mode`、`exit_plan_mode` 的审批/回答恢复统一走 `continue + resolution`，由 harness 补齐 toolResult 后继续。独立 `skill` 工具已禁用，skill 正文通过 `read` 读取 SkillCatalog location。
- Pi Agent Harness 迁移后续评估文件/变量回溯：变量可通过 session custom state entry reduce，文件回溯需要专门的 `file_snapshot` / `file_patch` entry 或接入 Git/worktree snapshot，第一版不承诺文件内容回滚。
- 观察 `arch` source 模式快速同步脚本的稳定性，并决定是否要把远端部署目标做成可配置 preset。
- 修复 workspace-files API tests 的 Vitest mock API 兼容问题；当前 `server/workspace-files` 通过，`server/api/workspace-files` 的部分测试仍受 `vi.resetModules` / `vi.doUnmock` 不存在影响。

## Risks

- 文档和代码容易漂移，需要每次重大任务结束时更新仓库状态和任务 walkthrough。
- Agent prompt 背景信息过多时，模型可能过度迎合噪声，后续要控制信息注入。
- Markdown Studio 的 ProseMirror node / mark 与 Markdown 序列化如果不同步，容易产生源码模式和富文本模式行为漂移。
- Agent 前端已迁到新 session contract，但尚未做浏览器交互验收；多窗口同步、流式工具卡和审批恢复仍需要在真实开发服务器里走一遍。

## Recent Tasks

| Task | Status | Walkthrough |
| --- | --- | --- |
| Agent RP Mode Planning | Planning | [docs/tasks/01-agent-roleplay-mode/README.md](docs/tasks/01-agent-roleplay-mode/README.md) |
| Pi Agent Harness Migration | In Progress | [docs/tasks/02-pi-agent-harness-migration/README.md](docs/tasks/02-pi-agent-harness-migration/README.md) |
| Config System | Done | [docs/tasks/03-config-system/README.md](docs/tasks/03-config-system/README.md) |
| TSX Profile Workbench | Active | [docs/tasks/04-tsx-profile-workbench/README.md](docs/tasks/04-tsx-profile-workbench/README.md) |
| Leader Profile v2 Adaptation | Done | [docs/tasks/05-leader-profile-v2-adaptation/README.md](docs/tasks/05-leader-profile-v2-adaptation/README.md) |
| Leader Default Prompt Parity | Updated | [docs/tasks/06-leader-default-prompt-parity/README.md](docs/tasks/06-leader-default-prompt-parity/README.md) |
| Project Identity Migration | Planning | [docs/tasks/09-project-identity-migration/README.md](docs/tasks/09-project-identity-migration/README.md) |
| Portable Project Workspace | In Progress | [docs/tasks/11-portable-project-workspace/README.md](docs/tasks/11-portable-project-workspace/README.md) |
| Profile Variable Types | Implemented | [docs/tasks/12-profile-variable-types/README.md](docs/tasks/12-profile-variable-types/README.md) |
| Agent SSE Front-End Contract | Implemented | [docs/tasks/14-agent-sse-front-end-contract/README.md](docs/tasks/14-agent-sse-front-end-contract/README.md) |
| Full Site Auth | Done | [docs/tasks/archived/fullsite-auth/README.md](docs/tasks/archived/fullsite-auth/README.md) |
| Docker Compose Deployment | Updated | [docs/tasks/archived/docker-compose-deployment/README.md](docs/tasks/archived/docker-compose-deployment/README.md) |
| Provider Reasoning Replay | Done | [docs/tasks/archived/provider-reasoning-replay/README.md](docs/tasks/archived/provider-reasoning-replay/README.md) |
| TSX Profile Template Editor | Preview Debug Workbench | [docs/tasks/archived/tsx-profile-template-editor/README.md](docs/tasks/archived/tsx-profile-template-editor/README.md) |
| Agent TSX Prompt Context | Done | [docs/tasks/archived/agent-tsx-prompt-context/README.md](docs/tasks/archived/agent-tsx-prompt-context/README.md) |
| Agent Plan Mode | Done | [docs/tasks/archived/agent-plan-mode/README.md](docs/tasks/archived/agent-plan-mode/README.md) |
| 内容节点 retrieval / inject | Done | [docs/tasks/archived/content-node-retrieval/README.md](docs/tasks/archived/content-node-retrieval/README.md) |
| 内容节点状态与信息差 | Done | [docs/tasks/archived/content-node-state/README.md](docs/tasks/archived/content-node-state/README.md) |
| 番茄小说导入 Skill | Done | [docs/tasks/archived/tomato-novel-skill/README.md](docs/tasks/archived/tomato-novel-skill/README.md) |
| 文档体系重整 | Updated | [docs/tasks/archived/documentation-reorg/README.md](docs/tasks/archived/documentation-reorg/README.md) |
| Markdown Studio Notion-like 富文本 | Done | [docs/tasks/archived/markdown-studio-notion-rich-text/README.md](docs/tasks/archived/markdown-studio-notion-rich-text/README.md) |
| Workspace 文件实时同步与保存冲突 | Done | [docs/tasks/archived/workspace-file-sync/README.md](docs/tasks/archived/workspace-file-sync/README.md) |
| 用户 Assets 工作区 | Done | [docs/tasks/archived/user-assets-workspace/README.md](docs/tasks/archived/user-assets-workspace/README.md) |
