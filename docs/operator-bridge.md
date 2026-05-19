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
2. 用户希望的模式：默认 `ghcr`，还是 `source` 源码挂载。
3. 是否已有 `.env` / `config.yaml`：已有时不要随意覆盖这两个私有配置文件。
4. 服务器内存是否足够执行 Nuxt build：低内存服务器优先使用 `ghcr`。
5. 用户是否允许 Agent 执行需要 sudo 的 Docker 命令。

不要把密码、Provider key、数据库密码写入聊天记录、命令参数、Git commit 或 issue。管理员密码不要作为命令参数传入。

## 关键文档索引

Agent 回答问题或执行任务时，应按问题类型读取这些文档：

- [../README.md](../README.md)：项目功能概览、常用命令、Docker Compose 部署入口、故障排查。
- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库当前状态、近期风险、部署策略的最新摘要。
- [../AGENTS.md](../AGENTS.md)：代码协作规则、文档维护规则、编码约束。
- [README.md](README.md)：文档体系入口，说明 `docs/`、`spec/`、`PROJECT-STATUS.md` 的分工。
- [tasks/docker-compose-deployment/README.md](tasks/docker-compose-deployment/README.md)：Docker Compose 部署任务 walkthrough，记录部署模式演进、关键决策和验证记录。
- [../spec/README.md](../spec/README.md)：稳定规范索引。
- [../spec/agent/system.md](../spec/agent/system.md)：Agent 系统稳定规格。
- [../spec/agent/profile-guide.md](../spec/agent/profile-guide.md)：Agent profile 实现和阅读指南。
- [../spec/agent/context.md](../spec/agent/context.md)：TSX prompt 上下文拼接规则。

如果用户问的是部署问题，优先读本文、README 的 Docker Compose 部分、`docs/tasks/docker-compose-deployment/README.md` 和 `PROJECT-STATUS.md`。

如果用户问的是 Agent 能力、提示词、工具或 workspace 文件语义，再继续读 `spec/agent/*` 和相关任务文档。

## 部署模型

NeuroBook 使用 Docker Compose 单机部署。基础模板由仓库提供，运行私有配置放在项目根目录 `.env` 和 `config.yaml`，部署生成物放在 `.deploy/`。

仓库跟踪的模板文件：

- `docker-compose.yml`：基础模板，默认包含 `app + postgres`。
- `docker-compose.external-db.yml`：外部数据库 override。
- `Dockerfile`：GHCR app 镜像构建文件，最终镜像包含完整项目源码、依赖和 Nuxt `.output`。
- `Dockerfile.source-runtime`：source 模式本地 runtime 镜像，只提供 Bun、Node.js、Python 3、ripgrep、git、bash 等工具，不复制源码。

部署脚本生成的本地状态：

- `.env`：容器运行环境变量，例如端口、session password、Postgres 密码、`DATABASE_URL`。
- `config.yaml`：应用业务配置真值源，例如 Provider key、模型、baseURL、代理、profile 模型覆盖。
- `.deploy/docker-compose.generated.yml`：根据 `ghcr` 或 `source` 模式生成的 compose override。
- `.deploy/README.md`：当前部署目录的本地操作说明。

`.env`、`config.yaml` 和 `.deploy/` 都不进 Git。`git pull` 不会更新这些本机部署状态。如果部署脚本或部署模式变化，需要重新生成或迁移 `.deploy/docker-compose.generated.yml`。

基础 `docker-compose.yml` 不挂载根目录 `config.yaml`。`ghcr` 模式会由 `.deploy/docker-compose.generated.yml` 把 `config.yaml` 挂载到容器内 `/app/config.yaml`。`source` 模式会把整个项目目录挂载到 `/app`，因此容器内自然能看到 `/app/config.yaml`。

## 部署模式

### ghcr 模式

这个模式建议在项目稳定后再使用，因为每次更新都要重新拉取镜像

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

这是默认推荐模式

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
sed -n '1,130p' docs/tasks/docker-compose-deployment/README.md
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

默认选择 `ghcr`，除非用户明确要求源码挂载或开发服务器快速同步。

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

不要恢复或引入旧的 `build` 部署模式。本项目不提供“纯生产 build 镜像部署”作为用户可选路径。

### Step 3: 首次部署

默认部署：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

source 模式：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy --deploy-mode source
```

如果已经 clone：

```bash
node scripts/neuro-book-deploy.mjs --deploy-mode source
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

### Step 6: 创建管理员

容器启动后执行：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

不要把管理员密码作为命令参数传入。使用交互输入，或只在一次性 secret 环境中设置：

```bash
AUTH_ADMIN_PASSWORD='<password>' docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

### Step 7: 检查运行状态

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml ps
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml logs --tail=120 app
```

如果 app 不可访问，先看容器是否反复重启，再看 app 日志和 Postgres 日志。

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

## 配置与敏感信息边界

`.env` 只保存容器运行环境：

- `NUXT_PORT`
- `NUXT_SESSION_PASSWORD`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`

`config.yaml` 保存业务配置：

- Provider API key
- Provider baseURL
- 默认模型
- profile 模型覆盖
- 代理配置
- `auth.enabled`

不要把 `.env`、`config.yaml` 或 `.deploy/` 加入 Git。`config.example.yaml` 可以包含公开 provider baseURL，但不能包含真实 key。

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

### `Cannot resolve environment variable: DATABASE_URL`

宿主机执行 Prisma 前没有加载 `.env`。

解决：

```bash
set -a
source .env
set +a
bun run generate
```

### `P1000: Authentication failed`

旧 Postgres 数据卷已经初始化过，但 `.env` 里的新密码和数据卷内旧密码不一致。

保留数据时，在 Postgres 容器内修改 `neuro_book` 用户密码为当前 `POSTGRES_PASSWORD`。

不保留数据时，可以清理数据卷后重建：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml down -v
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml up -d
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
- 改动了哪些文件，尤其是否改动 `.env` 或 `config.yaml`。
- 执行了哪些命令。
- 当前容器状态。
- 访问地址。
- 管理员是否已创建。
- 是否存在未解决风险，例如 OOM、旧数据卷密码不一致、GHCR 镜像未发布。

如果没有用户明确授权，不要删除数据卷，不要轮换数据库密码，不要覆盖 Provider key，不要提交 `.deploy/`。
