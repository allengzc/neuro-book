# Project Status

## Summary

neuro-book 当前处于快速开发阶段。项目主线正在从数据库中心逐步转向文件化 workspace，并围绕 Markdown Studio、引用系统、剧情结构、多 Agent 协作，以及现在这轮全站鉴权、管理员后台和主界面账户入口补齐核心体验。

部署侧已补充 Docker Compose 单机生产方案：默认 `app + postgres`，运行时挂载 `workspace/` 与 `.deploy/config.yaml`。`config.yaml` 是应用可写的 Provider 配置真值源，真实文件不再作为仓库文件维护，主线历史已移除曾提交过的真实 `config.yaml`，已暴露过的模型 Provider token 仍应视为泄露并轮换。本轮进一步把部署入口收敛成 Node CLI + 远程 `npx` 交互脚本，并补齐 `config.example.yaml` 的注释化说明；针对低内存服务器 Nuxt build OOM，已补充本地 GHCR 发布脚本和 release-only GitHub Actions 镜像发布路径，且 `neuro-book-deploy` 只保留 `ghcr` 与 `source` 两种模式，部署生成物统一落 `.deploy/` 避免 `git pull` 冲突；`scripts/deploy.mjs` 已改为 `arch` 开发服务器 source 模式快速同步入口，通过 SSH 拉取最新代码、宿主机构建并用一次性 sudo 校验重启 app 容器；release-only 镜像工作流已补充 OCI metadata 和 buildx cache；同时加入 `auth.enabled` 全站鉴权开关，默认开启，关闭时整站与管理员接口都退化为无遮罩访问。

模型 Provider 侧已把 `openai-compatible` 收敛为增强版 OpenAI 兼容 adapter，默认接收、标准化并回放 `reasoning_content`，覆盖 MiMo、DeepSeek 网关等 Agent thinking 场景；严格 OpenAI 官方接口使用 `openai-official`，避免把 provider extension 字段发给官方 OpenAI。

本文档记录仓库级现状。每次重大任务完成后，需要同步更新本文档和对应 `docs/tasks/<task-slug>/README.md`。

## Current Focus

- 文件化 workspace：按 novel 隔离 workspace，保持 `workspace/<slug>/workspace.yaml` 作为显式元数据；前端通过 SSE 订阅真实文件变化，保存时使用 `mtimeMs` 做冲突检测。
- Markdown Studio：收敛为 Notion-like 富文本模式 + 源码模式；Markdown 原文仍是唯一真相，TipTap 负责运行时 ProseMirror 富文本表面，表单 Markdown 编辑器也复用同一底层能力并只做工具栏包装。
- 引用与内容节点：统一 inline ref、structured refs、content node 校验、warning 策略、`state.md` 当前状态，以及 `retrieval` / `inject` 上下文策略；`knowledge[]` 使用自然语言字符串并校验其中的 Markdown 内容节点链接；内容节点不再生成通用 `writingTip` frontmatter。
- Agent 系统：继续推进 v2 可用体验；v2 已加入 thread 级软 Plan Mode、无参数 enter/exit 工具、模型主动切换审批和前端快捷切换；TSX profile prompt 在 leader UI continue 主路径下会把当前用户输入保持为最后一条，`Reminder` / SkillCatalog 等运行时上下文贴近其前；TSX profile 模板可视化编辑器已升级为复用主 IDE 主题的低代码三栏工作台，左侧组件库可直接拖入画布，画布节点支持 dnd-kit 跨父级明确落点移动、拖拽中实时位置预览和本地撤销/重做；`leader-runtime` 已从演示模板变为接近生产 leader prompt 的模板副本，编辑器支持表达式属性和 Message TSX 片段保真，右侧预览展示纯 `<ProfilePrompt>...</ProfilePrompt>` 片段，预览调试弹窗可选择真实 leader 线程、查看 scope 变量当前值、编辑 `input.prompt` 并以 Markdown/源码双模式查看消息列表；当前仍用于模板预览和验证，尚不接入真实 Agent 运行；同时在 `server/agent-v3` 中验证新的 NeuroAgent 内核。
- 外部小说素材：新增番茄小说导入 skill，第一版支持免费小说 epub 与 Tomato Novel Downloader 本地结果导入到当前小说 workspace 的 `reference/tomato/`，用于后续拆书和结构分析。
- 文档治理：把稳定规范、调研资料、任务 walkthrough 分开维护。
- 全站鉴权：默认启用的 cookie session 登录、管理员用户管理页、主界面右上角头像菜单、登录失败限流、复杂密码生成、`config.yaml` 开关和初始管理员创建脚本已经接入。

## Module Status

| Module | Status | Notes |
| --- | --- | --- |
| Workspace | Active | 已转向按 novel 隔离；root-external content node 以 warning 表达策略越界；内容节点支持可选 `state.md` 当前状态，CLI 可创建或补建 state 文件；frontmatter 区分 `inject` 与 `retrieval`；文件树和干净编辑器会响应真实文件变化，网页/磁盘同时修改时走保存冲突对话框。 |
| Markdown Studio | Active | 主编辑器只保留富文本和源码两种模式；图片、inline code、workspace/domain reference 和表格在富文本侧使用真实 ProseMirror node / mark，并序列化回 Markdown；`StructuredTextEditor` 不再维护独立 schema，只作为表单工具栏包装层。 |
| Auth | Active | 默认开启的全站 cookie session 鉴权已接入；`config.yaml` 可通过 `auth.enabled` 关闭整站守卫；包含登录页、管理员用户管理页、主界面账户菜单、登录失败限流、复杂密码生成、用户状态/角色/密码重置和初始管理员脚本。 |
| Reference | Active | 文件化内容节点 refs 不再承载 visibility；Agent prompt 已收敛为 inline ref 表达自然提及、structured refs 表达稳定系统关系；Plot refs 已迁到内容节点路径，不再依赖数据库 Lorebook。 |
| Plot / Story | Active | 剧情系统规范较完整；refs 指向设定/角色/地点时使用 `lorebook/.../` 内容节点路径，剧情内部对象仍使用 thread/scene/plot URI；数据库不再维护 `Volume` / `Chapter` 表，Scene 挂章使用 `chapterPath` 指向 `manuscript/.../` content-node 目录。 |
| Agent v2 | Active | 仍是当前生产链路；支持软 Plan Mode reminder、需用户审批的 `enter_plan_mode` / `exit_plan_mode` 模型工具和前端 `Shift + Tab` 切换；Plan Mode 计划写入 `workspace/.agent/plan`；profile prompt 已按 TSX `HistorySet -> DynamicSet -> AppendingSet` 合同固化，`AppendingSet` 产物会追加进历史，并在 continue 主路径保证当前用户输入为最后一条；TSX profile 模板编辑器 preview 可读写 `server/agent/profiles/templates/*.tsx` 并验证/预览受限 DSL，UI 已对齐主 IDE 主题工作台，支持组件库拖入、跨父级节点移动、真实树/视觉树分离的实时 drop 预览、本地撤销/重做、纯 ProfilePrompt 片段预览、表达式属性保真、真实线程 scope 变量调试和 Markdown/源码消息列表预览；`subagent.retrieval` 通过 `report_result.data: string[]` 返回内容节点路径清单，writer 根据参数自动读取 `index.md` / `state.md` 注入 prompt；OpenAI-compatible provider 默认保留并回放 `reasoning_content`，用于 MiMo/DeepSeek 等 thinking + tool call 多轮场景。 |
| Agent v3 | Prototype | v3 是从零重建，不替换 v2；局部状态继续记录在 `server/agent-v3/PARITY.md`。 |
| Skills | Active | 写作流程 skill 继续通过 `assets/agent/skills/*/SKILL.md` 渐进式披露；新增番茄小说导入 skill，CLI 先支持本地 epub / 下载器结果转 Markdown，搜索、评论和段评抓取仍是后续 TODO。 |
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
- 建立 token statistics、写作历史 statistics 和缓存命中统计。
- 扩展番茄小说导入：补基础数据、评论、全站搜索、正文下载含段评和图片等能力。
- 将 workspace 保存冲突视图与后续 Git 版本控制能力整合。
- 将 TSX profile 模板选择接入真实 Agent runtime，并决定全局/线程级模板覆盖策略。
- 观察 `arch` source 模式快速同步脚本的稳定性，并决定是否要把远端部署目标做成可配置 preset。
- 把 auth 设置做成 settings 页面可视化开关，减少直接手改 `config.yaml` 的频率。

## Risks

- 文档和代码容易漂移，需要每次重大任务结束时更新仓库状态和任务 walkthrough。
- Agent prompt 背景信息过多时，模型可能过度迎合噪声，后续要控制信息注入。
- Markdown Studio 的 ProseMirror node / mark 与 Markdown 序列化如果不同步，容易产生源码模式和富文本模式行为漂移。
- Agent v2/v3 并行期间，能力边界需要持续记录，避免误把原型能力当成生产链路。

## Recent Tasks

| Task | Status | Walkthrough |
| --- | --- | --- |
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
