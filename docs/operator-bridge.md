# NeuroBook 交付与运维桥梁

这份文档不是普通部署教程，而是连接 NeuroBook 开发者、使用者和使用者 Agent 的交接层。

它的目标是让用户可以把本文直接发给自己的 Agent，然后让 Agent 根据用户目标完成部署、更新、排障或解释。Agent 执行时应优先遵守本文，再按本文索引读取项目关键文档。

## 适用对象

- 用户：想把 NeuroBook 部署到一台服务器，或让 Agent 帮自己部署。
- 用户的 Agent：需要理解本项目部署模型、配置文件边界、敏感信息边界和排障路径。
- 项目维护者：需要把部署语义稳定地传递给外部执行者。

## Agent 执行原则

用户的 Agent 在执行部署前，必须先确认这些信息：

1. 用户要部署到哪里：本机、远程服务器、还是已有的 `arch` 开发服务器。
2. 用户希望的模式：默认“本机 + Git” `local-git`，还是高级 Docker 模式 `ghcr` / `source`。
3. 是否已有 `.env` / `config.yaml` / `workspace/.nbook/config.json`：已有时不要随意覆盖这些私有配置文件。
4. 服务器内存是否足够执行 Nuxt build：低内存服务器优先使用 `ghcr`。
5. 用户是否允许 Agent 执行需要 sudo 的 Docker 或系统包管理器命令。

不要把密码、Provider key、数据库密码写入聊天记录、命令参数、Git commit 或 issue。管理员密码不要作为命令参数传入。

## 关键文档索引

Agent 回答问题或执行任务时，应按问题类型读取这些文档：

- [../README.md](../README.md)：项目功能概览、常用命令、Docker Compose 部署入口、故障排查。
- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库当前状态、近期风险、部署策略的最新摘要。
- [../AGENTS.md](../AGENTS.md)：代码协作规则、文档维护规则、编码约束。
- [README.md](README.md)：文档体系入口，说明 `docs/`、`spec/`、`PROJECT-STATUS.md` 的分工。
- [tasks/README.md](tasks/README.md)：active 编号任务与 archived 任务的维护规则。
- [tasks/archived/docker-compose-deployment/README.md](tasks/archived/docker-compose-deployment/README.md)：Docker Compose 部署任务 walkthrough，记录部署模式演进、关键决策和验证记录。
- [tasks/02-pi-agent-harness-migration/README.md](tasks/02-pi-agent-harness-migration/README.md)：当前 Pi-based Agent session / event / tool / profile 主路径迁移记录。
- [tasks/04-tsx-profile-workbench/README.md](tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前实现边界。
- [tasks/06-leader-default-prompt-parity/README.md](tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt parity、task/plot/SQL 工具、writer/retrieval profile 和 skill 迁移记录。
- [../spec/README.md](../spec/README.md)：稳定规范索引。
- [../spec/agent/system.md](../spec/agent/system.md)：Agent 系统稳定规格。
- [../spec/agent/profile-guide.md](../spec/agent/profile-guide.md)：Agent profile 实现和阅读指南。
- [../spec/agent/context.md](../spec/agent/context.md)：TSX prompt 上下文拼接规则。

如果用户问的是部署问题，优先读本文、README 的 Docker Compose 部分、`docs/tasks/archived/docker-compose-deployment/README.md` 和 `PROJECT-STATUS.md`。Archived walkthrough 记录了部署方案的演进过程，当前执行真相以本文、README 和 `PROJECT-STATUS.md` 为准。

如果用户问的是 Agent 能力、提示词、工具或 workspace 文件语义，再继续读 `docs/tasks/02-pi-agent-harness-migration/README.md`、`docs/tasks/04-tsx-profile-workbench/README.md`、`docs/tasks/06-leader-default-prompt-parity/README.md`、`docs/modules/agent/harness.md` 和 `spec/agent/*`。

当前 Agent 文档阅读时应使用 session / linked agent 心智：正式 HTTP 是 `/api/agent/sessions/**`，前端历史真相来自 session snapshot + JSONL entry tree，SSE 只是增量事件通道。旧 `thread` / `subagent` / `/api/agent/threads/**` / `/api/agent-v3/**` 只在归档文档或迁移说明中出现。

SkillCatalog 只展示可发现 skill。独立 `skill` 工具已经禁用；当用户要求 Agent 使用某个 skill 时，应先从 catalog 找到 `location`，再用 `read` 打开对应 `SKILL.md`，并按入口文档继续读取 reference/scripts/templates/examples。

## 部署模型

NeuroBook 默认支持免 Docker 的“本机 + Git” `local-git` 部署，也保留 Docker Compose 单机部署。运行私有配置放在项目根目录 `.env`、Boot Config `config.yaml` 和 Global Config `workspace/.nbook/config.json`，部署生成物放在 `.deploy/`。

仓库跟踪的模板文件：

- `docker-compose.yml`：基础模板，默认只启动 `app`，数据库为 SQLite 文件库。
- `Dockerfile`：GHCR app 镜像构建文件，最终镜像包含完整项目源码、依赖和 Nuxt `.output`。
- `Dockerfile.source-runtime`：source 模式本地 runtime 镜像，只提供 Bun、Node.js、Python 3、ripgrep、git、bash 等工具，不复制源码。

部署脚本生成的本地状态：

- `.env`：容器运行环境变量，例如端口、session password、`DATABASE_KIND=sqlite`、`DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite`。
- `config.yaml`：Boot Config，只保存启动/部署期配置，例如 server host/port 和 database kind/url；数据库字段通过 `${DATABASE_KIND}` / `${DATABASE_URL}` 镜像 `.env`。
- `workspace/.nbook/config.json`：Global Config，保存 Provider key、模型白名单、baseURL、代理、profile 模型覆盖、`auth.enabled` 和长期 UI/editor 偏好。
- `.deploy/docker-compose.generated.yml`：根据 `ghcr` 或 `source` 模式生成的 compose override；local-git 模式不使用该文件。
- `.deploy/README.md`：当前部署目录的本地操作说明。

`.env`、`config.yaml`、`workspace/` 和 `.deploy/` 都不进 Git。`git pull` 不会更新这些本机部署状态。如果部署脚本或部署模式变化，需要重新生成或迁移 `.deploy/` 本地说明和 compose override。部署脚本默认生成空模型配置，不预置 DeepSeek 或其他 Provider；用户进入前端设置页后再选择 Provider、API Key 和默认模型。

基础 `docker-compose.yml` 不挂载根目录 `config.yaml`。`ghcr` 模式会由 `.deploy/docker-compose.generated.yml` 把 `config.yaml` 挂载到容器内 `/app/config.yaml`，并把 `workspace/` 挂载到 `/app/workspace`。`source` 模式会把整个项目目录挂载到 `/app`，因此容器内自然能看到 `/app/config.yaml` 和 `/app/workspace`。

local-git 模式不使用 Docker。应用直接在宿主机项目目录中运行，读取同一份 `.env`、`config.yaml` 和 `workspace/.nbook/config.json`。旧 `native` 参数只作为兼容别名保留。

## 部署模式

### local-git 模式

这是默认推荐模式，适合本机或不想安装 Docker 的机器。

特点：

- 宿主机 git clone/pull 项目源码。
- 宿主机安装依赖、Nuxt prepare/generate/build 和 SQLite 迁移。
- 服务用 `node .output/server/index.mjs` 启动。
- 部署脚本生成 `.deploy/start-local-git.sh` 或 `.deploy/start-local-git.ps1` 便于启动服务，但不生成 systemd/pm2 服务，不接管后台进程管理。
- 数据库固定 SQLite-only。App SQLite 位于 `workspace/.nbook/neuro-book.sqlite`；Project SQLite 位于 `workspace/<project>/.nbook/project.sqlite`。

宿主机工具：

- 必需：`node`、`npm`、`git`、`bun`、`rg`。
- Unix/macOS/Linux 还需要 `bash`、`coreutils` 和基础 `findutils`。
- 建议安装 `python3`，用于保持 Agent helper 脚本能力。
- 部署脚本会按平台给出 Windows `winget` / Scoop、macOS `brew` 或 Linux 主流包管理器安装命令，交互确认后才执行；非交互环境缺工具会停止并打印命令。Windows 下 `winget` 是官方包管理器，适合普通用户；Scoop 更偏开发者工具链，默认安装到用户目录。可用 `--windows-package-manager auto|winget|scoop` 指定，默认 `auto` 优先使用已安装的 `winget`，其次尝试 Scoop。
- 模型 Provider 和 API Key 不在部署开局询问；部署后进入前端设置页或编辑 `workspace/.nbook/config.json` 配置。
- `--dry-run --yes` 会展示将写入的文件路径、清理动作和将执行的命令；local-git 模式仍会探测本机命令是否存在，用来展示缺失工具和安装建议，但不会安装、构建、迁移、启动服务或写入部署文件。

### ghcr 模式

这是低内存服务器的推荐 Docker 模式。

特点：

- 服务器拉取 `ghcr.io/notnotype/neuro-book:latest`。
- 服务器不执行 Nuxt build，避免 OOM。
- app 镜像内部包含完整项目源码、`node_modules`、Prisma、`.output` 和 agent 常用工具。
- 可以在容器内执行 `bun run auth:create-admin`。

适合：

- 低内存 VPS。
- 用户只想运行服务，不想在服务器上 build。
- release 发布后的稳定部署。

### source 模式

source 模式适合开发服务器或需要频繁 `git pull` 同步最新代码的服务器。

特点：

- 宿主机 git clone 项目源码。
- 容器内 `/app` 挂载宿主机项目目录。
- source runtime 镜像由服务器本地构建，使用 `Dockerfile.source-runtime`，不依赖 GHCR。
- 宿主机需要执行 `bun install`、Prisma generate、Nuxt build。
- 宿主机代码更新后，容器重启即可使用新的 `.output`。

适合：

- 开发服务器。
- 需要快速验证最新 commit。
- GHCR 镜像尚未发布，但服务器需要先跑起来。

注意：source 模式仍然需要 Nuxt build。如果服务器内存不足，可能出现 `JavaScript heap out of memory`。这时应优先改用 `ghcr`，或给服务器增加 swap。

## 常用入口

首次部署或重新生成 `.deploy/`：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

clone 后在仓库内运行：

```bash
node scripts/neuro-book-deploy.mjs
```

source 模式初始化：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode source
```

local-git 模式初始化：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode local-git
```

保留已有敏感配置，只刷新 `.deploy/docker-compose.generated.yml` 和 `.deploy/README.md`：

```bash
node scripts/neuro-book-deploy.mjs --redeploy --deploy-mode source
```

本项目开发服务器快速同步：

```bash
bun scripts/deploy.mjs
```

本地发布 GHCR runtime/app 镜像：

```bash
node scripts/publish-ghcr-image.mjs
```

## Agent 执行步骤

这一节可以直接作为用户 Agent 的执行 checklist。

### Step 1: 读取上下文

先读：

```bash
sed -n '1,260p' docs/operator-bridge.md
sed -n '63,190p' README.md
sed -n '1,130p' docs/tasks/archived/docker-compose-deployment/README.md
```

确认当前仓库状态：

```bash
git status --short
git rev-parse --short HEAD
```

如果是远程服务器，确认目标目录：

```bash
pwd
ls -la
test -d .git && git status --short
```

### Step 2: 选择部署模式

默认选择 `ghcr`，除非用户明确要求源码挂载、开发服务器快速同步，或机器不能使用 Docker。

选择 `ghcr` 的判断：

- 用户希望稳定运行。
- 服务器内存低。
- 用户不需要在服务器上 build。
- GHCR 镜像已经发布。

选择 `source` 的判断：

- 用户明确需要 `git pull` 后快速更新。
- 用户接受服务器执行 `bun install` 和 `bun run nuxt:build`。
- 用户希望容器内看到宿主机完整源码。
- GHCR 可能还没有发布。

选择 `local-git` 的判断：

- 用户明确要求免 Docker。
- 用户只安装了 npm 来启动部署脚本，但允许脚本引导安装 Git、Bun、ripgrep 等工具。
- 用户接受宿主机执行 `bun install`、`bun run nuxt:build` 和 `bun run migrate:deploy`。
- 用户接受 SQLite-only 数据库边界。

不要恢复或引入旧的 `build` 部署模式。本项目不提供“纯生产 build 镜像部署”作为用户可选路径。

### Step 3: 首次部署

默认部署：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

local-git 模式：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy --deploy-mode local-git
```

source 模式：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy --deploy-mode source
```

旧 native 别名：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy --deploy-mode native
```

如果已经 clone 后使用 local-git：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode local-git
```

如果已经 clone 后使用 source：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode source
```

旧 native 别名已经 clone：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode native
```

部署脚本会生成 `.deploy/`。如果用户已有 `.deploy/` 并且只想刷新 compose override，用：

```bash
node scripts/neuro-book-deploy.mjs --redeploy --deploy-mode source
```

### Step 4: source 模式手动更新

在服务器项目目录执行：

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

如果 sudo 必须使用：

```bash
sudo docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d --build
```

### Step 5: ghcr 模式更新

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml pull app
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d
```

如果用 sudo：

```bash
sudo docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml pull app
sudo docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d
```

### Step 6: local-git 模式手动更新

在服务器项目目录执行：

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

PowerShell 下先按 `.env` 内容设置当前进程环境变量，再运行：

```powershell
node .output/server/index.mjs
```

也可以直接运行部署脚本生成的启动脚本：

```bash
.deploy/start-local-git.sh
```

Windows PowerShell：

```powershell
.\.deploy\start-local-git.ps1
```

### Step 7: 创建管理员

Docker 模式容器启动后执行：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

不要把管理员密码作为命令参数传入。使用交互输入，或只在一次性 secret 环境中设置：

```bash
AUTH_ADMIN_PASSWORD='<password>' docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

local-git 模式执行：

```bash
set -a
source .env
set +a
bun run auth:create-admin
```

### Step 8: 检查运行状态

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml ps
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml logs --tail=120 app
```

如果 app 不可访问，Docker 模式先看容器是否反复重启，再看 app 日志；local-git 模式直接查看运行 `node .output/server/index.mjs` 的终端输出。

## arch 开发服务器

本项目维护者使用 `arch` 作为 source 模式开发服务器。

默认目标：

```text
host: arch
dir: /home/notnotype/composes/neuro-book
```

快速同步命令：

```bash
bun scripts/deploy.mjs
```

脚本会：

1. SSH 到 `arch`。
2. 进入 `/home/notnotype/composes/neuro-book`。
3. 检查 tracked worktree 是否干净。
4. `git pull --ff-only`。
5. 刷新 source compose override。
6. `bun install --frozen-lockfile`。
7. 加载 `.env`。
8. `bun run nuxt:prepare`。
9. `bun run generate`。
10. `bun run nuxt:build`。
11. 使用 sudo 重启 app 容器。
12. 输出 compose 状态和 app 最近日志。

脚本会本地隐藏输入 sudo 密码。密码只通过 SSH stdin 传给远端 `sudo -v`，不写入命令行或文件。

## GHCR 发布

项目发布两类 GHCR 镜像：

- `ghcr.io/notnotype/neuro-book-runtime`：基础 runtime 镜像。
- `ghcr.io/notnotype/neuro-book`：开箱即用 app 镜像。

本地发布：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u notnotype --password-stdin
node scripts/publish-ghcr-image.mjs
```

默认 tag：

- `latest`
- `package.json` 中的 version

指定 tag：

```bash
node scripts/publish-ghcr-image.mjs --tag v1.0.0
```

GitHub Actions 只在 GitHub Release `published` 时发布镜像，不在普通 push 或 pull request 时发布。

Canary 发布使用 GitHub prerelease，tag 建议使用 `v<package-version>-canary.<YYYYMMDD>.<short-sha>`。执行顺序：

```bash
git push origin master
git tag -a v1.0.0-canary.YYYYMMDD.<short-sha> -m "Canary release v1.0.0-canary.YYYYMMDD.<short-sha>"
git push origin v1.0.0-canary.YYYYMMDD.<short-sha>
gh release create v1.0.0-canary.YYYYMMDD.<short-sha> --prerelease --title "Canary v1.0.0-canary.YYYYMMDD.<short-sha>"
gh run watch <release-container-run-id> --exit-status
```

Release Container workflow 会推送 runtime/app 两类镜像的 release tag 和 `latest`。该 workflow 显式设置 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`，让 GitHub Actions JavaScript action 使用 Node 24 runtime，避免 Node 20 runtime 退役 warning。

## 配置与敏感信息边界

`.env` 只保存容器运行环境：

- `NUXT_PORT`
- `NUXT_SESSION_PASSWORD`
- `DATABASE_KIND`
- `DATABASE_URL`

`config.yaml` 保存 Boot Config：

- `server.host`
- `server.port`
- `database.kind`
- `database.url`

`workspace/.nbook/config.json` 保存业务配置：

- Provider API key
- Provider baseURL
- 默认模型
- Pi Model 字段覆盖，例如模型级 `api`、`input`、`reasoning`、`maxTokens`、`compat`
- profile 模型覆盖
- 代理配置
- `auth.enabled`

模型连接不再使用项目自有 provider adapter。运行时会把 `provider/model` 解析为 Pi `Model`：Pi 内置目录已有的模型继承 Pi registry 元数据；自定义模型需要在模型项上显式声明 Pi Model 字段。图片输入能力也来自 Pi `Model.input`，不要仅凭模型名称判断。

同一个 Pi Provider 可以添加多份本地连接。Global Config 的 provider `id` 是本地连接实例 ID，用于模型 key 和 API key；模型项的 `provider` 字段是 Pi Provider ID，用于继承 Pi registry 与 provider 兼容性。`requestOptions` 不是旧 adapter 参数，它只作为 Pi stream options 的 JSON 补充入口，目前只透传 `headers`、`maxRetries`、`maxRetryDelayMs`、`metadata`、`transport`、`cacheRetention`。

不要把 `.env`、`config.yaml`、`workspace/` 或 `.deploy/` 加入 Git。`assets/workspace/*.example.json` 可以包含公开 provider baseURL，但不能包含真实 key。

旧版本如果把业务配置写在根 `config.yaml`，在仓库内执行：

```bash
bun run config:migrate
```

脚本会把 Provider/API key、模型和 Agent profile 配置迁移到 `workspace/.nbook/config.json`，并把根 `config.yaml` 收窄为 Boot Config。新的 database 字段会写成 `${DATABASE_KIND}` / `${DATABASE_URL}` 引用，不覆盖 `.env`。脚本不会把 secret 打印到终端。

如果历史中曾提交过真实 key，应视为泄露并轮换。即使主线历史已清理，旧 clone、fork、缓存、本地 worktree 仍可能保留旧对象。

## 常见问题

### `.deploy/docker-compose.generated.yml` 没有跟着 git pull 更新

这是正常现象。`.deploy/` 是部署本地状态，不进 Git。

解决：

```bash
node scripts/neuro-book-deploy.mjs --redeploy --deploy-mode source
```

或者对 `arch` 开发服务器运行：

```bash
bun scripts/deploy.mjs
```

### `DATABASE_URL 只支持 SQLite file: URL`

当前版本已移除 PostgreSQL 支持，App SQLite 缺省使用 `file:./workspace/.nbook/neuro-book.sqlite`。

解决：

```bash
set -a
source .env
set +a
bun run generate
```

### `Cannot find module '@clack/prompts'`

source 模式下容器看到的是宿主机源码和宿主机 `node_modules`。

解决：

```bash
bun install --frozen-lockfile
```

同时确认 `node_modules` 权限不是 root-only。

### Nuxt build OOM

典型日志：

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
error: script "nuxt:build" was terminated by signal SIGABRT
```

优先方案：改用 `ghcr` 模式，不在服务器 build。

source 模式必须 build 时，可以增加 swap：

```bash
sudo fallocate -l 6G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
```

也可以临时提高 Node heap：

```bash
export NODE_OPTIONS="--max-old-space-size=4096"
bun run nuxt:build
```

### source 模式意外构建了完整 Dockerfile

如果日志出现：

```text
The command '/bin/sh -c bun run nuxt:build' returned a non-zero code
```

说明 Docker build 正在使用完整 `Dockerfile`，而不是 `Dockerfile.source-runtime`。

检查：

```bash
cat .deploy/docker-compose.generated.yml
```

source 模式应包含：

```yaml
build:
    context: .
    dockerfile: Dockerfile.source-runtime
```

如果不是，运行：

```bash
node scripts/neuro-book-deploy.mjs --redeploy --deploy-mode source
```

## Agent 提交结果格式

用户的 Agent 完成部署或排障后，应向用户报告：

- 选择了哪种部署模式，以及原因。
- 改动了哪些文件，尤其是否改动 `.env`、`config.yaml` 或 `workspace/.nbook/config.json`。
- 执行了哪些命令。
- 当前容器状态。
- 访问地址。
- 管理员是否已创建。
- 是否存在未解决风险，例如 OOM、旧数据卷密码不一致、GHCR 镜像未发布。

如果没有用户明确授权，不要删除数据卷，不要轮换数据库密码，不要覆盖 Provider key，不要提交 `.deploy/` 或 `workspace/`。
