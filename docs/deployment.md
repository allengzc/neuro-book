# 部署方式

NeuroBook 默认面向本地或单机部署。正式 release 主线采用 Product-first：构建机生成 Product Payload，运行机通过 Platform Launcher、Bun 或 Docker 启动，不要求源码 checkout、根 `node_modules` 或本机 build。

## 发布模型

- Product Payload：预构建应用本体，包含 `package.json`、`.output/`、运行资产、SQLite migrations、产品脚本和 `.output/server/node_modules` Nitro vendor。`source/` 目录携带完整源码快照（git tracked 文件，不含 `node_modules` 和构建产物）；运行不依赖它，但后续排障时可以让 Agent 在 `source/` 内安装依赖并重新构建。
- Platform Launcher：平台启动壳，负责初始化运行状态、迁移数据库、创建管理员、启动服务和后续更新。Windows Launcher 是第一版落地。
- 运行状态：`workspace/`、`.env`、`config.yaml` 和 SQLite 数据库属于用户数据，升级时保留，不随 Product Payload 覆盖。

## 部署方式选择

| 方式 | 适合 | 特点 |
| --- | --- | --- |
| Windows Product Portable | Windows 本机普通用户 | 点击启动，内置 Bun 和 Product Payload，不需要 Git/build。 |
| Product Bun | 已有 Bun 的本机或服务器 | 解压 Product Payload 后用 Bun 启动，不要求源码和根 `node_modules`。 |
| Product Docker / ghcr | 低内存服务器 | 拉取预构建镜像，服务器不执行 Nuxt build。 |
| Source Dev | 开发者 | 源码 checkout、本机依赖安装、开发和测试。 |
| local-git | 高级/过渡源码部署 | 宿主机 clone/pull、build、运行，不作为普通用户 release 主线。 |
| source Docker | 开发服务器 | 容器运行 runtime，宿主机源码挂载进容器。 |

如果不确定，Windows 用户选 Windows Product Portable；服务器优先选 `ghcr` 或 Product Bun。

## Product Runtime

Product Runtime 是本地成品验证根，用来模拟未来 release zip 解压后的运行目录。它遵循 Nuxt/Nitro 生产模型：构建机生成 `.output`，运行机从 Product Root 执行标准入口。

生成：

```bash
bun run nuxt:build
bun run product:stage
```

启动：

```bash
bun run product:start
```

如果直接使用 Nuxt/Nitro 入口，需要自行加载 Product Root `.env`；常规运行应优先使用 `product-start.mjs`：

```bash
bun .output/server/scripts/deploy/product-start.mjs
```

边界：

- `product/` 是 Product Root，生产 `cwd` 必须指向这里。
- `product/.output/server/index.mjs` 是服务入口。
- `product/.output/server/node_modules` 是 Nitro 内置 vendor，不要求产品根有 `node_modules`。
- `product/.env` 由 `product:stage` 生成，包含 `NUXT_SESSION_PASSWORD` 和 SQLite 默认环境；`product:start` / `product-start.mjs` 会自动加载它。
- `product/` 保留必要运行资产、脚本、SQLite migrations、`assets/workspace` 和 TSX Profile Workbench 编译所需 runtime source 子集。
- 产品脚本入口使用 `product/.output/server/scripts/**`，从 Product Root 运行，依赖从 `.output/server/node_modules` 解析。
- 通用 `.output` runner 必须包含 `scripts/deploy/product-start.mjs`、`scripts/build/prepare-system-assets.ts`、SQLite migration 和 CLI 脚本；`nuxt:build` 的 Nitro 后处理会复制这些脚本并做缺失门禁。
- `product:stage` 会在 Product Root 内重新编译系统 profiles，使 `.compiled` artifact 绑定产品内 `.output/server/node_modules`，而不是开发机根 `node_modules`。
- Profile Workbench 后端 worker 的 `tsx/esm/api` 和 `tsx` loader 必须通过 `.output/server/index.mjs` 创建的 runtime require 解析到 `.output/server/node_modules`；Product Runtime 不允许从 Product Root 裸 import 或回退到仓库根 `node_modules`。
- TSX profile artifact 会 bundle 第三方包；用户 profile 在 product 内编译后运行时不需要产品根 `node_modules`。
- `product/assets/workspace/.nbook/agent/scripts/workspace.ts` 是 launcher，真实执行入口是 `product/.output/server/scripts/agent/workspace.ts`；`agent/bin/workspace(.cmd)`、`profile(.cmd)`、`variable(.cmd)` 也遵循同一 product/source 双入口解析。Product 分支使用 Bun 直接执行 `.output/server/scripts/**`。
- `.output/server/node_modules/nbook` 是产品内 runtime source 包，负责解析脚本和 worker 中的 `nbook/*` 导入，不回退到开发机源码或根 `node_modules`。
- `package.json.version` 是产品版本接口优先读取的版本真相源；通用 `.output` runner 无根 `node_modules` 时可回退到 `.output/server/package.json`。Windows portable 桥接版仍在 `app/release-meta.json` 放 deprecated 占位文件，只用于旧 Launcher 更新校验。

当前本地验收已覆盖 `product/` 隔离运行和 Windows Product Portable zip 解压运行：避开仓库父级源码和根 `node_modules` 后，通过了 profile status/compile、Profile Workbench HTTP `/api/agent/profiles/compile` dry-run、HTTP `/api/agent/profiles/compile-all`、workspace project create/validate、workspace node validate、SQLite migration、管理员创建、Windows Launcher 启动、Windows Launcher 自动更新 fake-release smoke、Product/zip 内 agent bin wrapper、`product:start` 启动、登录和 `/api/app/version` package version smoke。

## Windows Product Portable

Windows Product Portable 是 Windows x64 的 Product Payload + Windows Launcher 包。它自带 Bun runtime、预构建 `app/` 和用户可点击入口。

首次运行 `Start Neuro Book.cmd` 时会：

- 初始化 `data/.env`、`data/config.yaml` 和 `data/workspace/.nbook/config.json`。
- 将 `app/workspace` 映射到 `data/workspace`，让服务 cwd 保持 Product Root，同时把用户数据留在 `data/`。
- 执行 SQLite migration。
- 提示密码保护状态。Windows Portable 默认关闭密码保护，浏览器打开即可使用；运行 `Create Admin.cmd` 创建管理员后会自动开启密码保护。
- 启动本地网页。

目录边界：

- 解压目录是 Portable Root。
- `app/` 是可替换 Product Payload 和服务 cwd。
- `app/source/` 是随包分发的完整源码快照；运行不依赖它，排障时可让 Agent 在其中 `bun install` + 重新构建。
- `data/` 是升级保留的运行状态，保存 `workspace/`、`.env`、`config.yaml` 和 SQLite。
- `runtime/bun/` 是内置 Bun runtime。
- `launcher/` 是 Windows Launcher。

自动化 smoke 或服务器脚本可以设置 `NEURO_BOOK_NO_OPEN_BROWSER=1`，让 Windows Launcher 启动服务但不自动打开浏览器；普通用户双击启动仍会打开本地网页。

`Update Neuro Book.cmd` 不再执行 `git pull`。它会查询 GitHub Releases，列出带 `neuro-book-windows-x64.zip` 和 `SHA256SUMS` 的 stable / canary / alpha / beta / rc 版本供用户选择，校验 SHA256 后备份旧 `app/`、`launcher/`、根启动脚本和 `portable-release.json`，再切换新版并保留 `data/`。自动更新会保留当前 `runtime/bun/`，避免在 launcher 运行中替换正在使用的 `bun.exe`。

## Product Bun

Product Bun 适合已有 Bun 的本机或服务器。它使用与 Windows Product Portable 相同的 Product Payload，但不内置平台 launcher 或 Bun runtime。

构建机：

```bash
bun run nuxt:build
bun run product:stage
```

运行机：

```bash
cd product
bun .output/server/scripts/deploy/product-start.mjs
```

Product Bun 仍要求 Product Root 为服务 cwd；依赖由 `.output/server/node_modules` 承载。

## local-git

`local-git` 是源码部署过渡模式。它不使用 Docker，直接在宿主机运行生产服务。

初始化命令：

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```

或 clone 仓库后运行：

```bash
bun scripts/deploy/neuro-book-deploy.mjs --deploy-mode local-git
```

它会：

- clone 或复用项目源码。
- 检查 Git、Bun、ripgrep 等工具。
- 生成 `.env`、`config.yaml`、`workspace/.nbook/config.json` 和 `.deploy/README.md`。
- 安装依赖、构建应用、执行 SQLite migration。
- 打印启动命令；启动前会同步 user-assets，修复未手改系统 profile 覆盖层的 `.compiled` artifact。

local-git 不接管 systemd、pm2 或后台进程管理。需要长期运行时，可以按部署目录中的 `.deploy/README.md` 接入自己的进程管理方式。

## Product Docker / ghcr

`ghcr` 是低内存服务器推荐的 Docker 模式。

它使用预构建镜像：

```text
ghcr.io/notnotype/neuro-book:<release-tag>
```

交互部署会查询 GitHub Releases，列出 stable / canary / alpha / beta / rc 版本供选择。非交互部署默认使用当前安装器 package 版本对应的镜像 tag；例如 canary 安装器会默认使用同一个 canary tag，而不是旧的 `latest`。也可以显式传：

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy --deploy-mode ghcr --release v0.5.3-canary.20260701.030929Z.69581b3e
```

`--image <image>` 仍可覆盖完整镜像名，适合私有镜像或手工验证；它不能和 `--release` 同时使用。`latest` 只代表最新 stable。

适合：

- 服务器内存不足，不适合本地 Nuxt build。
- 只想运行服务，不想在服务器上构建应用。
- release 发布后的相对稳定部署。

`ghcr` 模式仍会把 `workspace/` 挂载为持久目录。Provider key、管理员用户、Project Workspace 和 SQLite 数据都保存在本机运行状态中。

GHCR app 镜像携带完整项目源码（含 `world-engine/`、`plugins/` 和全部构建配置），可在容器内直接排障或让 Agent 重新构建，但运行合同遵循 Product Docker：final runner 使用 Bun runtime，服务入口、启动前 user-assets 同步、SQLite migration 和管理员脚本都从预构建 `.output/server/scripts/**` 运行，依赖由 `.output/server/node_modules` Nitro vendor 承载。部署机和容器启动时不执行 `bun install`，也不要求根 `node_modules`。Product Runtime 判定会在无根 `node_modules` 时使用 `.output/server/package.json`，版本接口优先读取可用的 package manifest。

## Source Docker

`source` 是开发服务器模式。容器提供 runtime，宿主机项目目录挂载到容器内 `/app`。

适合：

- 开发服务器。
- 需要频繁 `git pull` 同步最新代码。
- GHCR 镜像尚未发布但服务器要先跑起来。

source 模式仍然需要宿主机执行依赖安装和 Nuxt build。如果服务器内存不足，优先改用 `ghcr`。

## 配置文件边界

NeuroBook 的运行状态默认不进 Git。

常见本机文件：

- `.env`：容器或本机运行环境变量。
- `config.yaml`：Boot Config，保存启动和部署期配置。
- `workspace/.nbook/config.json`：Global Config，保存 auth、models、agent、UI/editor 长期偏好。
- `workspace/{project}/.nbook/config.json`：Project Config，只覆盖当前 Project 允许的配置项。
- `workspace/.nbook/neuro-book.sqlite`：App SQLite。
- `workspace/{project}/.nbook/project.sqlite`：Project SQLite。

不要把密码、Provider API Key 或本机数据库提交到 Git。

## 管理员与鉴权

服务器部署默认开启全站鉴权；Windows Product Portable 默认关闭，运行 `Create Admin.cmd` 创建管理员后自动开启。

`neuro-book-deploy` 交互部署会询问是否开启密码保护，也可以用 `--auth enabled` / `--auth disabled` 显式指定（非交互默认开启）。redeploy 时显式选择会更新已有 `workspace/.nbook/config.json` 的 `auth.enabled`，未显式选择则保持原值。

开启鉴权的部署在首次使用前创建管理员。

local-git：

```powershell
bun run auth:create-admin admin
```

local-git 是源码运行模式，管理员脚本要求该目录已经执行过 `bun install --frozen-lockfile`。脚本可以自动补缺失的 Prisma Client；但如果本地 Nuxt CLI 依赖不存在，会直接提示先安装依赖，不会自动安装。

ghcr：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun .output/server/scripts/cli/create-admin.ts
```

ghcr 必须使用容器内 Product 脚本，不要在宿主机源码 checkout 中执行 `bun run auth:create-admin`。GHCR 运行机不会执行 `bun install`、`nuxt:prepare` 或 Prisma generate。

source Docker：

```bash
docker compose --env-file .env -f docker-compose.yml -f .deploy/docker-compose.generated.yml exec app bun run auth:create-admin
```

local-git / source 源码运行时如果缺少 `server/generated/prisma/client.ts`，管理员脚本会先自动执行 Prisma generate；Product / ghcr 运行时只使用已打包在 `.output/server/node_modules/nbook` 内的 Prisma Client，缺失时应拉取匹配 release 镜像或重新构建 Product Payload。

管理员后台在 `/admin/users`。管理员可以创建用户、调整角色、禁用账号和重置密码。

如果只在完全可信的本地环境调试，可以在 Global Config 中关闭鉴权：

```json
{
    "auth": {
        "enabled": false
    }
}
```

公开或远程部署不建议关闭鉴权。

## 更新与排障

Windows Product Portable 使用 `Update Neuro Book.cmd` 自动下载、校验并切换最新版 Product Payload。更新保留 `data/`，失败会尝试恢复备份。

local-git 部署通常在应用目录执行：

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run generate
bun run nuxt:build
bun run migrate:deploy
bun scripts/build/prepare-system-assets.ts --sync-user-assets
bun .output/server/index.mjs
```

如果要让其他 Agent 协助部署、更新或排障，优先把 [交付与运维桥梁](https://github.com/notnotype/neuro-book/blob/master/docs/operator-bridge.md) 发给它。那份文档更适合作为外部执行者的 checklist。

仓库当前状态和部署策略摘要见 [PROJECT-STATUS.md](https://github.com/notnotype/neuro-book/blob/master/PROJECT-STATUS.md)。
