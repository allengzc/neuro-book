# neuro-book

neuro-book 是一个面向长篇小说创作的本地工作台。

如果你是作者，它把设定、章节、剧情结构、正文编辑和 Agent 协作放在同一个工作区里，让你能一边写，一边整理世界观和剧情骨架。
如果你是使用者，它提供文件化 workspace、Markdown Studio、引用系统、剧情系统和多 Agent 工作流，适合做长篇小说的持续创作与维护。

## 这个项目能做什么

- 用文件化 workspace 管理小说内容，按 novel 隔离 `lorebook/`、`manuscript/`、`workspace/.agent/` 等目录。
- 用 Markdown Studio 编辑正文，支持富文本预览、源码模式、图片、引用和常见写作辅助能力。
- 用统一的内容节点系统管理角色、地点、物品、规则、卷章和笔记。
- 用 Plot System 组织剧情结构，把 Thread、Scene、Plot 分开表达。
- 用 Agent 系统做写作、检索、规划、协作和局部自动化。
- 用 Docker Compose 直接单机部署，配合 `config.yaml` 管理 Provider 配置。

## 常用命令

```powershell
bun run dev
bun run typecheck
bun run test
```

## Docker Compose 单机部署

推荐使用一键交互式部署脚本。它会检查 Docker、拉取仓库、生成 `.env.docker` 和 `config.yaml`，然后执行 Compose 构建与启动。

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

脚本会询问这些信息：

- 部署目录，默认 `~/neuro-book`。
- Web 端口，默认 `3000`。
- 模型 Provider 和 API Key。
- 使用内置 Postgres，或填写外部 `DATABASE_URL`。

也可以 clone 仓库后手动运行 Node CLI：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
node scripts/neuro-book-deploy.mjs
```

如果想完全手动部署：

```bash
cp .env.docker.example .env.docker
cp config.example.yaml config.yaml
docker compose --env-file .env.docker up -d --build
```

使用外部数据库时，把 `.env.docker` 中的 `DATABASE_URL` 改成外部连接串，并运行：

```bash
docker compose -f docker-compose.yml -f docker-compose.external-db.yml --env-file .env.docker up -d --build
```

### 配置文件教程

- `.env.docker` 只保存容器运行环境，例如 `NUXT_PORT`、`NUXT_SESSION_PASSWORD`、Postgres 用户名密码和 `DATABASE_URL`。不要把模型 Provider 密钥放在这里。
- `config.yaml` 是应用可写的业务配置真值源，会挂载到容器内 `/app/config.yaml`。模型 Provider 密钥、默认模型、Provider baseURL、代理和 profile 模型覆盖都放在这里。
- `models.default` 使用 `provider/model` 格式，例如 `deepseek/deepseek-v4-flash`，并且要指向 `models.providers` 下 `enabled: true` 的模型。
- `adapter` 决定 Provider 协议：DeepSeek 官方接口使用 `deepseek-official`，OpenAI 兼容网关使用 `openai-compatible`，Gemini 使用 `gemini-compatible`。
- `contextWindowTokens` 用于上下文预算估算；能确认模型窗口时填数字，不能确认时填 `null`。
- `./workspace` 会挂载到容器内 `/app/workspace`，`./config.yaml` 会挂载到 `/app/config.yaml`。
- 当前仓库历史里曾提交过真实 `config.yaml`，其中的 token 应视为已泄露并立即轮换；本次只阻止后续继续提交，未清理 Git 历史。

## AGENT 系统

这个仓库里的 AGENT 系统不是单一聊天机器人，而是一套可组合的线程、角色、工具和提示词合同。

核心概念：

- `leader thread` 是主入口，用户主要在这里发起任务。
- `subagent thread` 是独立的专业线程，可以被 leader 创建、关联和复用。
- `skill` 是可读取的能力单元，`workflow` 在当前阶段按 skill 统一处理。
- `walkthrough` 是 subagent 执行后的可见总结，用户和 leader 都能看到。
- `Plan Mode` 是线程级软规划模式，先规划、再审批、再执行。

这套系统的关键点是：

- leader 负责理解任务、查 skill、组织上下文、调用 subagent 和汇总结果。
- subagent 负责执行具体工作，并且可以在过程中提问用户。
- 工具层负责真实执行，比如读写文件、检索、创建 subagent、请求用户输入、报告结果。
- 前端会把 subagent 的执行过程、状态和 walkthrough 显示成可感知的执行气泡。

和 AGENT 相关的说明主要在这些地方：

- [spec/agent/system.md](spec/agent/system.md)：多 Agent 需求规格。
- [spec/agent/profile-guide.md](spec/agent/profile-guide.md)：profile 实现指南。
- [spec/agent/context.md](spec/agent/context.md)：TSX prompt 的上下文拼接规则。
- [docs/tasks/agent-plan-mode/README.md](docs/tasks/agent-plan-mode/README.md)：Plan Mode 任务报告。
- [docs/tasks/agent-tsx-prompt-context/README.md](docs/tasks/agent-tsx-prompt-context/README.md)：TSX prompt 合同调整报告。

## TSX Profile

neuro-book 的 Agent profile 不是纯字符串 prompt，而是用 TSX 组件树来描述上下文结构。

你会经常看到这几个层次：

- `HistorySet`：长期稳定上下文，比如身份、规则、首轮持久化的 skill catalog。
- `DynamicSet`：本轮动态信息，比如当前 workspace、任务状态、临时变量。
- `AppendingSet`：贴近当前输入的上下文，比如 reminder、activated skills、当前用户输入。

几个常见规则：

- profile 会显式声明 `inputSchema`，需要结构化输出时也会声明 `outputSchema`。
- `SimpleProfile` 是当前推荐基类。
- `leader-default`、`writer`、`retrieval` 是最常见的内置 profile。
- `leader-runtime.tsx` 是 TSX profile 模板编辑器使用的预览模板，不直接等同于生产运行时。

TSX profile 相关文档：

- [spec/agent/profile-guide.md](spec/agent/profile-guide.md)
- [spec/agent/context.md](spec/agent/context.md)
- [docs/tasks/tsx-profile-template-editor/README.md](docs/tasks/tsx-profile-template-editor/README.md)

## 文档入口

- [PROJECT-STATUS.md](PROJECT-STATUS.md)：仓库当前状态、重点任务和风险。
- [docs/README.md](docs/README.md)：文档索引、目录分工和任务记录规则。
- [spec/README.md](spec/README.md)：稳定规范索引。
- [architecture.md](architecture.md)：项目架构文档入口。

## 当前开发约定

- 重大任务需要同步更新 `PROJECT-STATUS.md` 和对应 `docs/tasks/<task-slug>/README.md`。
- 稳定规范放在 `spec/<module>/`，调研与草案放在 `docs/` 下对应目录。
- 具体编码约束以 [AGENTS.md](AGENTS.md) 为准。
