# Project Status

## Summary

neuro-book 当前处于快速开发阶段。项目主线正在从数据库中心逐步转向文件化 workspace，并围绕 Markdown Studio、引用系统、剧情结构、多 Agent 协作，以及现在这轮全站鉴权、管理员后台和主界面账户入口补齐核心体验。

部署侧已补充 Docker Compose 单机生产方案：默认 `app + postgres`，运行时挂载 `workspace/`，根目录 `.env` 保存容器环境变量，根目录 `config.yaml` 是应用可写的 Provider 配置真值源；两者都不进 Git，真实文件不再作为仓库文件维护，主线历史已移除曾提交过的真实 `config.yaml`，已暴露过的模型 Provider token 仍应视为泄露并轮换。本轮进一步把部署入口收敛成 Node CLI + 远程 `npx` 交互脚本，并补齐 `config.example.yaml` 的注释化说明；针对低内存服务器 Nuxt build OOM，已补充本地 GHCR 发布脚本和 release-only GitHub Actions 镜像发布路径，且 `neuro-book-deploy` 只保留 `ghcr` 与 `source` 两种模式，`.deploy/` 只保留 compose override 和本地说明文档；GHCR 现在发布 `neuro-book-runtime` 基础工具镜像和 `neuro-book` 开箱即用 app 镜像，两者都携带 Node.js、Python 3、ripgrep、git、bash 等 agent 常用工具；source 模式使用本地 `Dockerfile.source-runtime` 构建同规格 runtime，不依赖 GHCR；`scripts/deploy.mjs` 已改为 `arch` 开发服务器 source 模式快速同步入口，通过 SSH 拉取最新代码、宿主机构建并用一次性 sudo 校验重启 app 容器；`docs/operator-bridge.md` 已作为连接开发者、用户和用户 Agent 的交付与运维桥梁，集中索引部署执行步骤、敏感信息边界和关键项目文档；release-only 镜像工作流已补充 OCI metadata 和 buildx cache；同时加入 `auth.enabled` 全站鉴权开关，默认开启，关闭时整站与管理员接口都退化为无遮罩访问。

模型 Provider 侧已把 `openai-compatible` 收敛为增强版 OpenAI 兼容 adapter，默认接收、标准化并回放 `reasoning_content`，覆盖 MiMo、DeepSeek 网关等 Agent thinking 场景；严格 OpenAI 官方接口使用 `openai-official`，避免把 provider extension 字段发给官方 OpenAI。

本文档记录仓库级现状。每次重大任务完成后，需要同步更新本文档和对应 `docs/tasks/<task-slug>/README.md`。

## Current Focus

- 文件化 workspace：按 novel 隔离 workspace，保持 `workspace/<slug>/workspace.yaml` 作为显式元数据；前端通过 SSE 订阅真实文件变化，保存时使用 `mtimeMs` 做冲突检测。
- Markdown Studio：收敛为 Notion-like 富文本模式 + 源码模式；Markdown 原文仍是唯一真相，TipTap 负责运行时 ProseMirror 富文本表面，表单 Markdown 编辑器也复用同一底层能力并只做工具栏包装。
- 引用与内容节点：统一 inline ref、structured refs、content node 校验、warning 策略、`state.md` 当前状态，以及 `retrieval` / `inject` 上下文策略；`knowledge[]` 使用自然语言字符串并校验其中的 Markdown 内容节点链接；内容节点不再生成通用 `writingTip` frontmatter。
- Agent 系统：主路径已硬切到 Pi-based `server/agent`。旧 v2 已归档到 `server/agent-v2` 与 `assets/agent-v2`，不再进入 typecheck、测试或运行时；旧 Prisma `AgentThread` / `AgentMessage` 数据模型已删除。新主路径使用 TypeBox profile contract、Pi-compatible message/event/tool 语义、JSONL append-only session、动态 `.nbook/agent/profiles` catalog、`.nbook/agent/skills` SkillCatalog、`read/write/edit/apply_patch/bash` 基础工具和 `create_agent/invoke_agent/get_agent/detach_agent` agent 工具。正式 HTTP 和前端抽屉已迁到 `/api/agent/sessions/**` 的 session/invocation/event contract，旧 thread/subagent 前端心智已替换为 session/linked agent；临时 `/api/agent-v3/**` 和旧 `/api/agent/threads/**` 已删除。
- 外部小说素材：新增番茄小说导入 skill，第一版支持免费小说 epub 与 Tomato Novel Downloader 本地结果导入到当前小说 workspace 的 `reference/tomato/`，用于后续拆书和结构分析。
- 文档治理：把稳定规范、调研资料、任务 walkthrough 分开维护。
- 全站鉴权：默认启用的 cookie session 登录、管理员用户管理页、主界面右上角头像菜单、登录失败限流、复杂密码生成、`config.yaml` 开关和初始管理员创建脚本已经接入。

## Module Status

| Module | Status | Notes |
| --- | --- | --- |
| Workspace | Active | 已转向按 novel 隔离；root-external content node 以 warning 表达策略越界；内容节点支持可选 `state.md` 当前状态，active CLI 为 `scripts/workspace.ts`，可创建或补建 state 文件；frontmatter 区分 `inject` 与 `retrieval`；内容节点模板和新小说目录模板暂仍支持旧 `workspace/.nbook/assets/server/workspace/...` 用户覆盖，后续再硬切到 `.nbook/assets/templates`；文件树和干净编辑器会响应真实文件变化，网页/磁盘同时修改时走保存冲突对话框。 |
| Markdown Studio | Active | 主编辑器只保留富文本和源码两种模式；图片、inline code、workspace/domain reference 和表格在富文本侧使用真实 ProseMirror node / mark，并序列化回 Markdown；`StructuredTextEditor` 不再维护独立 schema，只作为表单工具栏包装层。 |
| Auth | Active | 默认开启的全站 cookie session 鉴权已接入；`config.yaml` 可通过 `auth.enabled` 关闭整站守卫；包含登录页、管理员用户管理页、主界面账户菜单、登录失败限流、复杂密码生成、用户状态/角色/密码重置和初始管理员脚本。 |
| Reference | Active | 文件化内容节点 refs 不再承载 visibility；Agent prompt 已收敛为 inline ref 表达自然提及、structured refs 表达稳定系统关系；Plot refs 已迁到内容节点路径，不再依赖数据库 Lorebook。 |
| Plot / Story | Active | 剧情系统规范较完整；refs 指向设定/角色/地点时使用 `lorebook/.../` 内容节点路径，剧情内部对象仍使用 thread/scene/plot URI；数据库不再维护 `Volume` / `Chapter` 表，Scene 挂章使用 `chapterPath` 指向 `manuscript/.../` content-node 目录。 |
| Agent v2 | Archived | 旧实现已移动到 `server/agent-v2` 与 `assets/agent-v2`，只作为迁移参考，不进入 active typecheck、测试或运行时。旧 `AgentThread` / `AgentMessage` Prisma 模型已删除。 |
| Agent | Active | Pi-based harness 已成为 `server/agent` 主实现：TypeBox profile、动态 `.nbook` profile/skill catalog、JSONL session、slash command、approval resume、profile ingest、linked agents、compaction、Pi 风格基础文件工具、agent 工具和真实 provider smoke 均已跑通。正式 HTTP 入口是 `/api/agent/sessions/**`；前端 Agent 抽屉已迁到 session snapshot + event hub + command/tree/invocation contract，保留聊天、停止、审批恢复、模型选择、Plan Mode、compact、linked agents、edit/retry/rollback/fallback 的核心入口。 |
| Skills | Active | 新 Agent 后端只扫描 `assets/.nbook/agent/skills` 与 `workspace/.nbook/agent/skills`；旧写作流程 skill 已归档到 `assets/agent-v2/skills`。前端用户资产工作区的 profile 工作台已能读 v3 catalog/detail 并做 prepare 预览，skill/profile 写入体验仍等待按新 `.nbook` 结构重接。 |
| Docs | Active | 本轮完成目录重排、状态报告和任务 walkthrough 约定。 |

## TODO

- 跑通剧情系统的核心写作链路。
- 跑通 Lore / mention / reference 的端到端体验。
- 补齐 Writer / Planner / Critic / Editor 的多 Agent 工作流。
- 简化 story 工具和 content node schema 的重复定义。
- 继续把旧章节面板和预览页从 DB Chapter 心智收敛到 manuscript content-node。
- 继续清理非 Plot 链路中的旧 `lorebook://` 引用入口。
- 继续稳定 Markdown Studio/表单包装层的标题、inline code、引用、图片和表格编辑体验。
- 优化 request_user_input 的自由输入、收起、切换和取消状态。
- 设计泛用自然语言编辑工具：输入目标文件、自然语言操作说明和可选上下文消息数量，由轻量模型辅助修改文件；后续可用于 Agent 记忆系统、RP 状态维护和常规文件编辑减负。
- 建立 token statistics、写作历史 statistics 和缓存命中统计。
- 扩展番茄小说导入：补基础数据、评论、全站搜索、正文下载含段评和图片等能力。
- 将 workspace 保存冲突视图与后续 Git 版本控制能力整合。
- 后续补用户 assets 与系统 assets 的更新冲突提示；当前同步只补缺失文件，不覆盖用户文件。Agent 资源从 `assets/.nbook` 同步到 `workspace/.nbook`，旧 workspace 模板暂仍走 `assets/server/workspace` 到 `workspace/.nbook/assets/server/workspace`。
- 将 workspace 模板覆盖从旧 `assets/server/workspace` / `workspace/.nbook/assets/server/workspace` 硬切到 `assets/.nbook/assets/templates` / `workspace/.nbook/assets/templates`，并同步 resolver、同步系统 assets 和测试 fixture。
- 清理动态 profile 渐进迁移 fallback：生产注册路径已切到 assets profile + builtin contract，系统 assets profile 也已改成 `defineAgentProfile`；后续删除旧源码 builtin class，或把仍被复用的 prompt helper 迁成稳定公共 helper。
- 继续扩展 TSX profile 的 schema builder：当前 Profile 工作台已支持简单对象字段低代码编辑与局部替换 `InputSchema` / `OutputSchema` 声明，后续补 nested object 的完整 UI、复杂 Zod 识别和更好的错误定位。
- 为 skill catalog 增加类似 tool 的白名单或启用控制，避免所有可发现 skill 默认进入模型可见 catalog。
- 后续如果支持加载第三方 profile，新增 profile 审查 skill，用于检查陌生 `.profile.tsx` 的危险代码、工具权限、schema contract 和提示词行为；当前动态 profile 不做 sandbox，按用户可信本地代码处理。
- 后续如有需要，再把系统默认 profile 暴露到系统设置；当前 workspace 默认 Agent Profile 写入 `.nbook/settings.json` 的 `agent.defaultProfileKey`，system default 仍写死为小说 `leader.default`、用户 assets `leader.assets`。
- 让 workspace 默认 Profile 设置页复用 profile catalog 的 loadStatus / issue 信息，避免 contract-only 或 missing profile 在设置列表中被当作普通可运行项展示；当前运行路径已阻止 contract-only profile 执行。
- Agent 前端迁移后补一次浏览器交互验收：重点验证多窗口事件同步、followUp queue、approval resume、Plan Mode、model command、compact、edit/retry/rollback/fallback 和流式工具卡片。
- Agent session event hub 后续支持跨进程/多实例广播；第一版是单进程内存 replay，重启或多 worker 场景通过 snapshot 恢复，不保证实时 fan-out。
- Agent profile 工作台后续重接写入链路：当前 Agent 抽屉已迁移，profile template visual editor 已能读取 v3 profile catalog/detail 并调用真实 `profile.prepare()` 预览；保存、新建、restore 和 schema builder 仍需要按 TSX profile runtime 重新设计。
- Pi Agent Harness 迁移后续补 `invoke_agent` 非阻塞调用；v3 agent 工具已收敛为 `create_agent`、`invoke_agent`、`get_agent(id?: number)`、`detach_agent`；`invoke_agent` 工具返回 sessionId、usage、finalMessage、report_result 摘要，不返回完整 history；`request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`skill` 的审批/回答恢复统一走 `continue + resolution`，由 harness 补齐 toolResult 后继续。
- Pi Agent Harness 迁移后续评估文件/变量回溯：变量可通过 session custom state entry reduce，文件回溯需要专门的 `file_snapshot` / `file_patch` entry 或接入 Git/worktree snapshot，第一版不承诺文件内容回滚。
- 观察 `arch` source 模式快速同步脚本的稳定性，并决定是否要把远端部署目标做成可配置 preset。
- 把 auth 设置做成 settings 页面可视化开关，减少直接手改 `config.yaml` 的频率。

## Risks

- 文档和代码容易漂移，需要每次重大任务结束时更新仓库状态和任务 walkthrough。
- Agent prompt 背景信息过多时，模型可能过度迎合噪声，后续要控制信息注入。
- Markdown Studio 的 ProseMirror node / mark 与 Markdown 序列化如果不同步，容易产生源码模式和富文本模式行为漂移。
- Agent 前端已迁到新 session contract，但尚未做浏览器交互验收；多窗口同步、流式工具卡和审批恢复仍需要在真实开发服务器里走一遍。

## Recent Tasks

| Task | Status | Walkthrough |
| --- | --- | --- |
| Agent RP Mode Planning | Planning | [docs/tasks/agent-roleplay-mode/README.md](docs/tasks/agent-roleplay-mode/README.md) |
| Full Site Auth | Done | [docs/tasks/fullsite-auth/README.md](docs/tasks/fullsite-auth/README.md) |
| Docker Compose Deployment | Updated | [docs/tasks/docker-compose-deployment/README.md](docs/tasks/docker-compose-deployment/README.md) |
| Provider Reasoning Replay | Done | [docs/tasks/provider-reasoning-replay/README.md](docs/tasks/provider-reasoning-replay/README.md) |
| TSX Profile Template Editor | Preview Debug Workbench | [docs/tasks/tsx-profile-template-editor/README.md](docs/tasks/tsx-profile-template-editor/README.md) |
| Agent TSX Prompt Context | Done | [docs/tasks/agent-tsx-prompt-context/README.md](docs/tasks/agent-tsx-prompt-context/README.md) |
| Agent Plan Mode | Done | [docs/tasks/agent-plan-mode/README.md](docs/tasks/agent-plan-mode/README.md) |
| 内容节点 retrieval / inject | Done | [docs/tasks/content-node-retrieval/README.md](docs/tasks/content-node-retrieval/README.md) |
| 内容节点状态与信息差 | Done | [docs/tasks/content-node-state/README.md](docs/tasks/content-node-state/README.md) |
| 番茄小说导入 Skill | Done | [docs/tasks/tomato-novel-skill/README.md](docs/tasks/tomato-novel-skill/README.md) |
| 文档体系重整 | Updated | [docs/tasks/documentation-reorg/README.md](docs/tasks/documentation-reorg/README.md) |
| Markdown Studio Notion-like 富文本 | Done | [docs/tasks/markdown-studio-notion-rich-text/README.md](docs/tasks/markdown-studio-notion-rich-text/README.md) |
| Workspace 文件实时同步与保存冲突 | Done | [docs/tasks/workspace-file-sync/README.md](docs/tasks/workspace-file-sync/README.md) |
| 用户 Assets 工作区 | Done | [docs/tasks/user-assets-workspace/README.md](docs/tasks/user-assets-workspace/README.md) |
| Pi Agent Harness Migration | In Progress | [docs/tasks/pi-agent-harness-migration/README.md](docs/tasks/pi-agent-harness-migration/README.md) |
