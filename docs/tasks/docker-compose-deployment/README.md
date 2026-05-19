# Docker Compose Deployment

## User Request

- 为项目设计并实现 Docker Compose 单机生产部署方案。
- 真实 `config.yaml` 已包含模型 Provider token，需要从 Git 跟踪中移除并改成模板化配置。
- 更新部署说明：改成 Node CLI 入口，补充 `config.yaml` 配置教程，为 `config.example.yaml` 添加注释，并提供远程一键交互式 `npx` 部署脚本。
- Nuxt build 会在低内存服务器上 OOM，需要提供本地发布 GHCR 镜像和 release-only GitHub Actions 自动发布两条路径。
- source 模式已在 `arch` 开发服务器跑通，需要把旧 `scripts/deploy.mjs` 收敛为远端同步脚本，便于频繁快速同步最新开发成果。
- agent 在容器内需要 `node`、`python3`、`rg`、`git`、`bash` 等常用工具；GHCR app 镜像和 source runtime 都应携带同一套工具链。

## Goal

- 提供默认 `app + postgres` 的单机生产 Compose 部署。
- 保持 workspace、Postgres 数据、运行配置可持久化。
- 保持 `config.yaml` 作为应用可写的 Provider 配置真值源。
- 阻止真实 `config.yaml` 后续继续提交。
- 提供可从 GitHub 远程调用的 `npx` 部署入口，降低首次部署门槛。
- 支持把 Nuxt build 从低内存服务器迁移到本地高配机器或 GitHub Actions。

## Current State

- 项目是 Nuxt/Bun + Prisma/Postgres 应用，运行时需要 `DATABASE_URL`。
- 文件化小说 workspace 位于 `workspace/`，应作为运行数据挂载。
- Redis 只在示例环境变量和依赖中出现，当前不作为部署硬依赖。

## Walkthrough

- 新增生产 `Dockerfile`，多阶段安装依赖、生成 Prisma client、构建 Nuxt，并在运行阶段启动 Nitro。
- 新增 `docker-compose.yml`，默认启动 app 与 Postgres，Postgres 使用健康检查和数据卷。
- 新增 `docker-compose.external-db.yml`，用于外部数据库部署时关闭 app 对内置 Postgres 的依赖。
- 新增 `.env.docker.example` 和 `config.example.yaml`，`.env.docker` 只承载端口和数据库配置，真实模型 Provider 密钥由挂载的 `config.yaml` 承载。
- 增加配置文本环境变量展开工具，并接入 v2 `loadAppConfig` 和 v3 `readRawAgentConfig`。
- 执行 `git rm --cached config.yaml`，本地文件保留，仓库只跟踪模板。
- 运行镜像显式携带 Prisma 生成客户端，并使用 POSIX `sh` 启动脚本，降低基础镜像 shell 差异风险。
- 新增 `scripts/neuro-book-deploy.mjs` 作为 Node 交互部署 CLI：使用 `commander` 处理参数、`@clack/prompts` 处理交互，检查 Docker/Git，询问部署目录、端口、Provider、数据库模式，生成 `.env.docker` / `config.yaml` 并执行 Compose。
- 更新 `package.json` 的 `bin` / `files` 配置，让 `npx --package github:notnotype/neuro-book neuro-book-deploy` 只安装部署入口文件，再由脚本 clone 真实应用仓库。
- README 的 Docker 部署章节改为 `npx` 优先、手动 Node CLI 和纯手动 Compose 作为备选，并补充配置文件教程。
- `config.example.yaml` 增加注释，解释 Provider key、adapter、baseURL、proxy、默认模型、profile 覆盖和 context window 配置。
- `.env.docker.example` 补充 `NUXT_SESSION_PASSWORD`，匹配当前 Compose 运行时要求。
- 新增 `scripts/publish-ghcr-image.mjs` 和 `docker:publish`，用于本地执行 `docker buildx build --push` 推送 `latest` 与版本 tag 到 GHCR。
- 新增 `.github/workflows/release-container.yml`，只在 GitHub Release `published` 时构建并推送 release tag 与 `latest`。
- README 增加低内存服务器说明：目标服务器优先使用预构建镜像，避免在服务器上执行 Nuxt build。
- `scripts/neuro-book-deploy.mjs` 部署模式收敛为 `ghcr` 和 `source`：默认 GHCR 镜像部署，source 模式挂载宿主机源码到容器 `/app`，不再提供 `--deploy-mode build`。
- 部署生成物统一写入 `.deploy/`：`.env.docker`、`config.yaml`、`docker-compose.generated.yml` 和本地说明文档，避免后续 `git pull` 与部署私有文件冲突。
- GHCR runner 镜像改为保留完整项目源码和运行所需文件，使容器内 `bun run auth:create-admin` 可用。
- `scripts/deploy.mjs` 改为开发服务器 source 模式快速同步入口：默认 SSH 到 `arch` 的 `/home/notnotype/composes/neuro-book`，检查 tracked worktree 干净后执行 `git pull --ff-only`、`bun install --frozen-lockfile`、加载 `.deploy/.env.docker`、Prisma generate、Nuxt build，并通过本地隐藏输入的 sudo 密码在远端做一次 `sudo -v` 校验后重启 `app` 容器。
- release-only GitHub Actions 改用 `docker/metadata-action` 生成 GHCR tag / OCI labels，并启用 GitHub Actions buildx cache。
- README 增加常用部署入口说明，区分 `neuro-book-deploy`、`bun scripts/deploy.mjs` 和 `node scripts/publish-ghcr-image.mjs` 的职责，并补充 source 模式常见故障排查。
- `Dockerfile` 增加 `runtime-base` stage，基于 `oven/bun:1-debian` 安装 Bun、Node.js、Python 3、ripgrep、git、bash 和常见 coreutils；GHCR app 镜像基于该 stage，确保开箱即用容器内 agent 工具齐全。
- 新增 `Dockerfile.source-runtime`，source 模式使用本地 build 的 `neuro-book-source-runtime:latest`，不依赖 GHCR，只负责提供同一套 agent 工具链，源码仍由宿主机挂载到 `/app`。
- `scripts/publish-ghcr-image.mjs` 和 release-only GitHub Actions 改为发布两类 GHCR 镜像：`neuro-book-runtime` 基础 runtime 镜像，以及基于同一工具链的 `neuro-book` app 镜像。
- 新增 `docs/operator-bridge.md`，作为连接开发者、用户和用户 Agent 的交付与运维桥梁，集中说明部署模型、执行步骤、敏感信息边界、常见问题和关键项目文档索引。

## Decisions

- Redis 暂不加入 Compose 默认服务。
- `config.yaml` 是运行时可写配置文件；设置页可以动态添加或更新 Provider，真实 key 直接写入该文件。
- 当前主线历史已移除曾提交过的真实 `config.yaml`；已暴露过的 token 仍需要用户轮换，旧 clone、fork、缓存或本地临时 worktree 仍可能保留旧对象。

## Files Changed

- `Dockerfile`
- `Dockerfile.source-runtime`
- `docker-compose.yml`
- `docker-compose.external-db.yml`
- `.dockerignore`
- `.env.docker.example`
- `config.example.yaml`
- `.gitignore`
- `package.json`
- `scripts/publish-ghcr-image.mjs`
- `docs/operator-bridge.md`
- `.github/workflows/release-container.yml`
- `scripts/deploy.mjs`
- `scripts/docker-entrypoint.sh`
- `scripts/neuro-book-deploy.mjs`
- `server/utils/env-template.ts`
- `server/utils/env-template.test.ts`
- `server/utils/app-config.ts`
- `server/utils/app-config.test.ts`
- `server/agent-v3/model-provider/config.ts`
- `README.md`
- `PROJECT-STATUS.md`

## Verification

- `bun run test server/utils/env-template.test.ts server/utils/app-config.test.ts`
- `bun run typecheck`
- `docker compose --env-file .env.docker.example config` 未执行成功：当前环境没有 Docker CLI。
- `node --check scripts/neuro-book-deploy.mjs`
- `NEURO_BOOK_DEPLOY_DRY_RUN=1 node scripts/neuro-book-deploy.mjs --yes --deploy-mode ghcr --dir .agent/deploy-ghcr-test`
- `NEURO_BOOK_DEPLOY_DRY_RUN=1 node scripts/neuro-book-deploy.mjs --yes --deploy-mode source --dir .agent/deploy-source-test`
- `node --check scripts/publish-ghcr-image.mjs`
- `node scripts/publish-ghcr-image.mjs --dry-run`
- `bun scripts/deploy.mjs --dry-run`
- `NEURO_BOOK_DEPLOY_DRY_RUN=1 node scripts/neuro-book-deploy.mjs --yes --deploy-mode source --dir .agent/deploy-source-runtime-test`
- `npm pack --dry-run --json`：tarball 只包含 README、package.json 和 Node 部署脚本。
- 使用 `NEURO_BOOK_DEPLOY_DRY_RUN=1 node scripts/neuro-book-deploy.mjs --yes` 跑通脚本生成 `.deploy/.env.docker` / `.deploy/config.yaml` / `.deploy/docker-compose.generated.yml`，并用 `yaml` 解析生成配置。
- 当前环境仍没有 Docker CLI，`docker --version` 与 `docker compose --env-file .env.docker.example config` 均无法执行。

## TODO / Follow-ups

- 在有 Docker 的机器上执行 Compose config/build/up 验证。
- 轮换所有曾出现在历史 `config.yaml` 中的模型 Provider token。
- 如需让远端公开仓库也完成清理，需要把重写后的 `master` 用 `git push --force-with-lease origin master` 推送到 GitHub，并让其他 clone 重新同步。
