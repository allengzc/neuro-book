# neuro-book

neuro-book 是一个面向长篇小说创作的本地工作台。

如果你是作者，它把设定、章节、剧情结构、正文编辑和 Agent 协作放在同一个工作区里，让你能一边写，一边整理世界观和剧情骨架。
如果你是使用者，它提供文件化 workspace、Markdown Studio、引用系统、剧情系统和多 Agent 工作流，适合做长篇小说的持续创作与维护。

<div style="display: flex; justify-content: space-between;">
  <img src="./docs/images/主页.png" width="31%"/>
  <img src="./docs/images/剧本工作台.png" width="31%"/>
  <img src="./docs/images/TSX可视化编辑器.png" width="31%"/>
</div>
<br/>

> 测试网站：http://8.148.4.22:3001/

## 这个项目能做什么

- 用文件化 workspace 管理小说内容，按 novel 隔离 `lorebook/`、`manuscript/`、`workspace/.agent/` 等目录。
- 用 Markdown Studio 编辑正文，支持富文本预览、源码模式、图片、引用和常见写作辅助能力。
- 用统一的内容节点系统管理角色、地点、物品、规则、卷章和笔记。
- 用 Plot System 组织剧情结构，把 Thread、Scene、Plot 分开表达。
- 用 Agent 系统做写作、检索、规划、协作和局部自动化。
- 用全站账号鉴权保护开发测试部署，并提供管理员后台进行用户管理。
- 用 Docker Compose 或免 Docker native 模式单机部署，配合 Boot Config + Workspace Root `.nbook/config.json` 管理部署与模型配置。

## 常用命令

```powershell
bun run dev
bun run typecheck
bun run test
bun run auth:create-admin <username>
```

## 全站鉴权与管理员后台

全站鉴权默认开启，适合把开发测试部署发布到互联网时先用账号密码保护整个站点。未登录用户会进入 `/login`，登录后可以访问主界面和已授权页面。

管理员后台在 `/admin/users`，管理员可以创建用户、调整角色、禁用/启用账号、重置密码，并在创建或重置时自动生成复杂密码。主界面右上角用户头像菜单可以退出登录，管理员菜单还会提供进入后台入口。

公开测试站点不直接暴露通用密码；需要访问时，联系 [notnotype@qq.com](mailto:notnotype@qq.com) 获取。

登录接口会统一失败提示，避免暴露用户名是否存在；同时对同 IP 和同账号连续失败做短时限流，降低爆破风险。

首次部署后先创建管理员：

```powershell
bun run auth:create-admin admin
```

脚本会隐藏输入密码，避免密码进入 shell history。不要把密码作为命令行参数传入。

非交互环境可以使用环境变量创建；只建议在 CI secret 或一次性 shell 会话中使用：

```powershell
$env:AUTH_ADMIN_USERNAME="admin"
$env:AUTH_ADMIN_PASSWORD="<从 secret 注入的密码>"
bun run auth:create-admin
Remove-Item Env:AUTH_ADMIN_PASSWORD
```

鉴权开关写在 Global Config：`workspace/.nbook/config.json`。

```json
{
    "auth": {
        "enabled": true
    }
}
```

`auth.enabled` 未配置时默认视为 `true`。如果只在完全可信的本地环境调试，可以改成 `false` 临时关闭登录页和管理员守卫。

## 单机部署

如果你要让自己的 Agent 协助部署、更新或排障，优先把 [docs/operator-bridge.md](docs/operator-bridge.md) 发给它。那份文档是连接开发者、用户和用户 Agent 的交付与运维桥梁，包含部署模式选择、执行步骤、敏感信息边界和关键项目文档索引。

### 常用部署入口

- `neuro-book-deploy`：首次部署或重新生成 `.deploy/` 本地配置，支持默认 `ghcr`、`source` 和免 Docker `native` 三种模式。
- `bun scripts/deploy.mjs`：开发服务器快速同步入口，默认登录 `arch`，面向已经初始化好的 source 模式部署。
- `node scripts/publish-ghcr-image.mjs`：本地构建并推送 GHCR runtime/app 两类镜像，适合低内存服务器使用预构建镜像。

推荐使用一键交互式部署脚本。它会按部署模式检查 Docker 或宿主机工具、拉取仓库，在项目根目录生成 `.env`、Boot Config `config.yaml`、Global Config `workspace/.nbook/config.json`，并在 `.deploy/` 下生成本地说明。默认使用 SQLite 文件库和 GHCR 预构建镜像启动，避免低内存服务器执行 Nuxt build。

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

脚本会询问这些信息：

- 部署目录，默认 `~/neuro-book`。
- Web 端口，默认 `3000`。
- 部署模式和数据库。模型 Provider 和 API Key 不在部署时询问，部署后进入前端设置页或编辑 `workspace/.nbook/config.json` 配置。
- 数据库：默认 SQLite 文件库；Docker 模式也可选择内置 Postgres 或外部 Postgres，native 模式只支持 SQLite 或外部 Postgres。
- 部署模式：默认 `ghcr`，使用 `ghcr.io/notnotype/neuro-book:latest`；也可以选择 `source`，本地构建 source runtime 镜像并把宿主机源码挂载到容器 `/app`；或选择 `native`，免 Docker 在宿主机 build 后用 Node 运行生产服务。

也可以 clone 仓库后手动运行 Node CLI：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
node scripts/neuro-book-deploy.mjs
```

如需使用源码挂载模式：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode source
```

如需使用免 Docker native 模式：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode native
```

native 模式会检查宿主机可执行文件：`node`、`npm`、`git`、`bun`、`rg`，Unix/macOS/Linux 还会检查 `bash`、`coreutils` 和基础 `findutils`，并建议安装 `python3` 以保持 Agent helper 脚本能力。缺少工具时，脚本会按平台给出安装命令，并在交互确认后使用 Windows `winget` / Scoop、macOS `brew` 或 Linux 主流包管理器安装；非交互环境只报错并打印命令。

Windows 下 `winget` 是 Windows 官方包管理器，适合普通用户；Scoop 更偏开发者工具链，默认安装到用户目录，命令行工具体验更轻。可用 `--windows-package-manager auto|winget|scoop` 指定；默认 `auto` 会优先使用已安装的 `winget`，其次尝试 Scoop。

如需预览部署动作，可以使用 `--dry-run --yes`。dry-run 会展示将写入的文件路径、清理动作和将执行的命令；native 模式仍会探测本机命令是否存在，用来展示缺失工具和安装建议，但不会安装、构建、迁移、启动服务或写入部署文件。

本项目不提供“纯生产 build 镜像部署”作为部署脚本选项。source 模式下，容器内部看到的是宿主机完整项目源码；宿主机更新后执行：

```bash
git pull --ff-only
bun install --frozen-lockfile
set -a
source .env
set +a
bun run nuxt:prepare
bun run generate
bun run nuxt:build
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d --build
```

native 模式不使用 Docker，也不生成 systemd/pm2 服务。构建完成后脚本退出，并打印启动命令。更新后执行：

```bash
git pull --ff-only
bun install --frozen-lockfile
set -a
source .env
set +a
bun run nuxt:prepare
bun run generate
bun run nuxt:build
bun run migrate:deploy
node .output/server/index.mjs
```

部署脚本还会在 `.deploy/` 下生成本机启动脚本：

```bash
.deploy/start-native.sh
```

Windows PowerShell 使用：

```powershell
.\.deploy\start-native.ps1
```

Windows PowerShell 下按 `.env` 内容设置当前进程环境变量后运行：

```powershell
node .output/server/index.mjs
```

如果是本项目的开发服务器，source 模式初始化成功后可直接从本地快速同步：

```bash
bun scripts/deploy.mjs
```

该脚本默认登录 `arch`，进入 `/home/notnotype/composes/neuro-book`，执行 `git pull --ff-only`、宿主机依赖安装、Prisma generate、Nuxt build，并用 sudo 重启 `app` 容器。脚本会在本地隐藏输入 sudo 密码，密码只通过 SSH stdin 传给远端做一次 `sudo -v` 校验，不会写入命令行或文件。可用 `--host`、`--dir` 修改目标，也可用 `--dry-run` 查看将执行的远端脚本。

SQLite 默认数据文件是 `workspace/.nbook/neuro-book.sqlite`。如果部署时选择 Postgres，脚本会把 `DATABASE_KIND=postgres` 和 `DATABASE_URL` 写入 `.env`；Docker 内置 Postgres 会追加 `docker-compose.postgres.yml`，外部 Postgres 会追加 `docker-compose.external-db.yml`。native 模式不负责安装或管理本机 Postgres，只允许填写外部 PostgreSQL URL。不会自动把旧 Postgres 数据导入 SQLite。

首次部署后在容器内创建管理员：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

不要把管理员密码作为命令行参数传入；使用交互输入，或在一次性 shell / secret 环境中设置 `AUTH_ADMIN_PASSWORD`。

native 模式下创建管理员：

```bash
set -a && source .env && set +a
bun run auth:create-admin
```

### GHCR 镜像发布

低内存服务器不要在目标机器上执行 Nuxt build。默认 `ghcr` 部署模式会拉取预构建 app 镜像；该镜像内部包含完整项目源码、运行依赖和 agent 常用 shell 工具，因此也可以在容器内执行 `bun run auth:create-admin` 等管理脚本。

项目发布两类 GHCR 镜像：

- `ghcr.io/notnotype/neuro-book-runtime`：基础 runtime 镜像，包含 Bun、Node.js、Python 3、ripgrep、git、bash 和常见 coreutils。
- `ghcr.io/notnotype/neuro-book`：开箱即用 app 镜像，基于同一 runtime 工具链，额外包含完整项目源码、`node_modules`、Prisma 和 Nuxt `.output`。

本地手动发布到 GHCR：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u notnotype --password-stdin
bun run docker:publish
```

`GHCR_TOKEN` 需要至少有 `write:packages` 权限。

默认会同时推送 runtime/app 两类镜像的 `latest` 和 `<package.json version>`。如需指定 tag：

```bash
bun run docker:publish -- --tag v1.0.0
```

仓库也提供 release-only GitHub Actions：只有发布 GitHub Release 时才会自动构建并推送 `ghcr.io/<owner>/neuro-book:<release tag>` 和 `ghcr.io/<owner>/neuro-book:latest`。

同一次 Release 也会推送 `ghcr.io/<owner>/neuro-book-runtime:<release tag>` 和 `ghcr.io/<owner>/neuro-book-runtime:latest`。

服务器使用预构建镜像时，部署脚本会在 `.deploy/docker-compose.generated.yml` 中覆盖 `app.image` 并移除 `build`。更新镜像后运行：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml pull app
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d
```

### 配置文件教程

- `.env` 只保存容器运行环境，例如 `NUXT_PORT`、`NUXT_SESSION_PASSWORD`、`DATABASE_KIND`、`DATABASE_URL`，以及 Postgres 模式下的用户名密码。不要把模型 Provider 密钥放在这里。
- `config.yaml` 是 Boot Config，只保存启动/部署期配置，例如 server host/port 和 database kind/url。数据库字段使用 `${DATABASE_KIND}` / `${DATABASE_URL}` 引用环境变量，不作为第二份真值源。
- `workspace/.nbook/config.json` 是 Global Config，保存模型 Provider 密钥、默认模型、Provider baseURL、代理、profile 模型覆盖、`auth.enabled` 和长期 UI/editor 偏好。部署脚本默认生成空模型配置，用户进入前端设置页后再选择 Provider 和默认模型。
- `workspace/{project}/.nbook/config.json` 是 Project Config，只保存当前 Project Workspace 对允许字段的覆盖。
- `models.default` 使用 `provider/model` 格式，例如 `deepseek/deepseek-v4-flash`，并且要指向 `models.providers` 下 `enabled: true` 的模型。
- Provider 不再配置项目自有 `adapter`。运行时统一解析 Pi `Model`：如果 `provider/model` 存在于 Pi 内置 registry，就继承 `api`、`baseUrl`、`input`、`reasoning`、`compat`、`contextWindow` 和 `maxTokens`；如果是自定义模型，则在模型项上显式配置这些 Pi Model 字段。
- 允许同一个 Pi Provider 添加多份本地连接，例如 `deepseek` 和 `deepseek-2`。此时模型 key 使用本地连接 ID，例如 `deepseek-2/deepseek-v4-flash`；模型项的 `provider: "deepseek"` 负责声明真实 Pi Provider，便于继续继承 Pi registry 与兼容性判断。
- 模型项里的 `input: ["text", "image"]` 才表示支持图片输入；留空表示继承 Pi registry，自定义未知模型留空时按 text-only 处理。比如 Pi registry 中 `xiaomi-token-plan-cn/mimo-v2.5` 支持图片，`xiaomi-token-plan-cn/mimo-v2.5-pro` 是纯文本。
- Provider 的 `requestOptions` 现在作为 Pi stream options 的 JSON 补充使用，只透传 `headers`、`maxRetries`、`maxRetryDelayMs`、`metadata`、`transport`、`cacheRetention`。`apiKey`、`timeoutMs`、`sessionId`、`reasoning`、`maxTokens` 由系统一等字段掌管，不从这里覆盖。
- `contextWindowTokens` 用于上下文预算估算；能确认模型窗口时填数字，不能确认时填 `null`。
- Docker 模式下 `./workspace` 会挂载到容器内 `/app/workspace`；native 模式直接使用宿主机项目目录下的 `workspace/`。部署脚本会创建 `workspace/` 和 `workspace/.nbook/config.json`；应用启动也会确保 `workspace/` 存在，但不会自动创建配置文件。
- 旧 `config.yaml` 可以通过 `bun run config:migrate` 迁移：业务配置会写入 `workspace/.nbook/config.json`，根 `config.yaml` 会收窄为 Boot Config。
- source 模式不依赖 GHCR，会使用 `Dockerfile.source-runtime` 本地构建 `neuro-book-source-runtime:latest`，再挂载宿主机源码。
- native 模式不依赖 Docker，也不接入 systemd/pm2；脚本只负责检查工具、build、迁移数据库并打印 Node 启动命令。
- `.deploy/` 是本机部署状态目录，已加入 `.gitignore`，后续 `git pull` 不会与部署私有配置冲突。
- 当前主线历史已移除曾提交过的真实 `config.yaml`，但已经暴露过的 Provider token 仍应视为泄露并立即轮换；旧 clone、fork、缓存或本地临时 worktree 仍可能保留旧对象。

### 部署故障排查

- `Cannot resolve environment variable: DATABASE_URL`：Postgres 模式下宿主机执行 `bun run generate` 前没有加载 `.env`。先执行 `set -a && source .env && set +a`。SQLite 模式缺省会使用 `file:./workspace/.nbook/neuro-book.sqlite`。
- `P1000: Authentication failed`：旧 Postgres 数据卷已经初始化过，但 `.env` 重新生成了新密码。保留数据时，在 Postgres 容器内把 `neuro_book` 用户密码改成当前 `POSTGRES_PASSWORD`；不保留数据时可 `docker compose down -v` 后重建。
- `Cannot find module '@clack/prompts'`：source 模式下容器看到的是宿主机 `node_modules`。在宿主机执行 `bun install --frozen-lockfile`，并确认 `node_modules` 不再是 root-only 权限。

## AGENT 系统

这个仓库里的 AGENT 系统不是单一聊天机器人，而是一套可组合的 session、profile、工具、skill 和提示词合同。当前主路径是 Pi-based `server/agent`，旧 v2 只作为归档参考。

核心概念：

- `session` 是对话与执行历史真相源，使用 JSONL append-only entry tree 保存 active branch、消息、状态和工具结果。
- `profile` 定义一个 agent 的身份、输入/输出 schema、可见工具和 TSX prompt。
- `linked agent` 是由当前 session 创建、关联和复用的专用 agent，不再使用旧 subagent/thread 心智。
- `SkillCatalog` 是可发现的能力索引；独立 `skill` 工具已禁用，Agent 需要使用 skill 时按 catalog 的 `location` 用 `read` 打开 `SKILL.md`。
- `Plan Mode` 是 session 级软规划模式，计划文件统一写到当前 Project Workspace 的 `.agent/plan/`，先规划、再审批、再执行。

这套系统的关键点是：

- `leader.default` 负责理解任务、查 skill、组织上下文、创建/调用 linked agent 并汇总结果。
- `writer`、`retrieval` 等专用 profile 可以通过 `create_agent` / `invoke_agent` 运行。
- 工具层负责真实执行，比如读写文件、检索、创建 agent、请求用户输入、报告结果、维护任务列表、读写 Plot 和安全 SQL。
- 前端 Agent 抽屉使用 `/api/agent/sessions/**` 的 snapshot、invocation、command、tree、abort 和 SSE event contract。

和 AGENT 相关的说明主要在这些地方：

- [spec/agent/system.md](spec/agent/system.md)：多 Agent 需求规格。
- [spec/agent/profile-guide.md](spec/agent/profile-guide.md)：profile 实现指南。
- [spec/agent/context.md](spec/agent/context.md)：TSX prompt 的上下文拼接规则。
- [docs/modules/agent/harness.md](docs/modules/agent/harness.md)：当前 Agent Harness 的 session、profile、ReAct loop、SSE 和消息持久化流程。
- [docs/tasks/02-pi-agent-harness-migration/README.md](docs/tasks/02-pi-agent-harness-migration/README.md)：Pi-based Agent 主路径迁移记录。
- [docs/tasks/04-tsx-profile-workbench/README.md](docs/tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前任务记录。
- [docs/tasks/05-leader-profile-v2-adaptation/README.md](docs/tasks/05-leader-profile-v2-adaptation/README.md)：leader.default v2 适配与 TSX DSL/harness 调整记录。
- [docs/tasks/06-leader-default-prompt-parity/README.md](docs/tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt parity、工具迁移和 skill 迁移记录。
- [docs/tasks/archived/agent-plan-mode/README.md](docs/tasks/archived/agent-plan-mode/README.md)：Plan Mode 任务报告。
- [docs/tasks/archived/agent-tsx-prompt-context/README.md](docs/tasks/archived/agent-tsx-prompt-context/README.md)：TSX prompt 合同调整报告。

## TSX Profile

neuro-book 的 Agent profile 不是纯字符串 prompt，而是用 TSX 组件树来描述上下文结构。

你会经常看到这几个层次：

- `HistorySet`：长期稳定上下文，比如身份、规则、首轮持久化的 skill catalog。
- `ModelContext`：本轮只给模型看的动态上下文，比如当前 workspace、任务状态、linked agents、SQL schema summary。
- `AppendingSet`：本轮写入 session 且贴近当前输入的上下文，比如 reminder、activated skills、当前任务状态提醒。

几个常见规则：

- profile 会显式声明 TypeBox `inputSchema` 和 `outputSchema`；`inputSchema` 是创建 agent/session 时的实例初始化参数，不是每轮用户 prompt。
- 普通 profile 推荐使用 `defineAgentProfile({ context })` + TSX DSL；高级 profile 可以直接返回 `ProfileTurnPlan`。
- `leader.default`、`leader.assets`、`writer`、`retrieval` 是最常见的内置 profile。
- 系统 profile 位于 `assets/workspace/.nbook/agent/profiles`，用户覆盖位于 `workspace/.nbook/agent/profiles`，系统更新通过 metadata 同步未手改的用户覆盖。
- Workbench 以 `.profile.tsx` 源码为真相源：保存源码不等于编译通过，创建 Session 需要最近一次编译通过且源码未改动。

TSX profile 相关文档：

- [spec/agent/profile-guide.md](spec/agent/profile-guide.md)
- [spec/agent/context.md](spec/agent/context.md)
- [docs/tasks/04-tsx-profile-workbench/README.md](docs/tasks/04-tsx-profile-workbench/README.md)
- [docs/tasks/05-leader-profile-v2-adaptation/README.md](docs/tasks/05-leader-profile-v2-adaptation/README.md)
- [docs/tasks/06-leader-default-prompt-parity/README.md](docs/tasks/06-leader-default-prompt-parity/README.md)
- [docs/tasks/archived/tsx-profile-template-editor/README.md](docs/tasks/archived/tsx-profile-template-editor/README.md)

## 文档入口

- [PROJECT-STATUS.md](PROJECT-STATUS.md)：仓库当前状态、重点任务和风险。
- [docs/README.md](docs/README.md)：文档索引、目录分工和任务记录规则。
- [spec/README.md](spec/README.md)：稳定规范索引。
- [architecture.md](architecture.md)：项目架构文档入口。

## 当前开发约定

- 重大任务需要同步更新 `PROJECT-STATUS.md` 和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。
- 稳定规范放在 `spec/<module>/`，调研与草案放在 `docs/` 下对应目录。
- 具体编码约束以 [AGENTS.md](AGENTS.md) 为准。
