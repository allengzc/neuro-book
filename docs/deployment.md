# 部署方式

NeuroBook 的所有安装形式由独立包 `@notnotype/neuro-book-manager` 管理，公开命令为 `neuro-book`。旧 `neuro-book-deploy`、`local-git` 和宿主 build + runtime container 的混合模式已删除。

## 推荐顺序

| Profile | 适合场景 | Source | Product | Runtime / Tool |
| --- | --- | --- | --- | --- |
| `windows-portable` | Windows x64 普通用户 | Release 源码 | Windows `.output` | 托管 Bun、rg、PortableGit/bash |
| `ghcr` | 服务器 Docker | 镜像 `/app` | 镜像 `.output` | container |
| `product-bun` | 已有 Bun 的 Windows/Linux | Release 源码 | 平台 `.output` | system Bun/Tool |
| `source-dev` | 本机开发 | Git | 无 | system Bun/Tool |
| `source-product` | 从 Git 构建生产 Product | Git | 本机 staging build | system Bun/Tool |
| `source-docker` | 需要从源码构建镜像 | Git build context | 容器内 build | container |

初版正式支持 Windows x64 与 Linux x64 glibc。macOS、arm64 和 musl 尚未进入 Product/managed runtime 发布矩阵。

## Stage 0

机器已经安装 Bun 时，可以直接运行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

不传参数会进入 Clack 安装向导，逐步解释并选择 Profile、Installation Root、实例名称、更新通道、端口和鉴权。CI 或自动化部署使用显式命令：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

Canary Manager 使用 `@canary`。没有 Bun 时，使用仓库提供的平台 Stage 0：

不要使用`bunx run @notnotype/neuro-book-manager`；该命令会让Bun把包名按本地脚本或路径解析，Manager不会启动。稳定Manager和正确npm `latest`建立前，公开文档继续使用`@canary`。

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

Stage 0 只把固定版本 Bun 下载到用户 cache、校验官方 SHA256，然后调用 Manager。它不会先向目标 Installation Root 写 `.runtime`，因此不会破坏 Git materialize。

Manager只安装已经发布正式`release-manifest.json`的完整GitHub Release。候选资产在Actions内完成校验后才公开Manifest；仍在构建、验证失败或已取消的Release会被Resolver跳过。

## Installation Root 与 State Root

```text
neuro-book/
├─ Git tracked source
├─ .output/
├─ .runtime/
│  ├─ manager/<version>/
│  ├─ bun/<version>/
│  ├─ tools/<name>/<version>/
│  └─ bin/
├─ .deploy/
│  ├─ installation.json
│  ├─ install.lock
│  ├─ staging/
│  ├─ backups/
│  └─ docker-compose.generated.yml
├─ workspace/
├─ config.yaml
└─ .env
```

`NEURO_BOOK_STATE_ROOT` 决定用户状态物理根。未设置时等于 Installation Root；Windows Portable 设置为 `<root>/data`，因此物理文件位于 `data/workspace`、`data/config.yaml`、`data/.env` 和 `data/logs`。公开 Project Path 始终保持 `workspace/<project>`。

Release 更新只替换组件拥有的路径，不覆盖 State Root。

## 常用命令

```text
neuro-book                              # 交互式安装向导
neuro-book manage                       # 多实例 TUI
neuro-book install --profile <profile> [--dir <path>] [--version <version>]
    [--channel <stable|canary>] [--port <port>]
    [--auth <enabled|disabled>] [--yes] [--dry-run]

neuro-book instances list [--json]
neuro-book instances add <path> [--name <name>] [--default]
neuro-book instances forget <name-or-id>
neuro-book instances default <name-or-id>
neuro-book instances config

neuro-book update [--component <source|product|runtime|tools>...] [--dry-run]
neuro-book start
neuro-book status [--json]
neuro-book doctor [--json]

neuro-book runtime list
neuro-book runtime install bun [--version <version>]
neuro-book runtime update bun

neuro-book tools list
neuro-book tools install <rg|git>
neuro-book tools update [rg|git]
neuro-book tools path <rg|git>
neuro-book admin create [username]
```

`update/start/status/doctor/runtime/tools/admin` 支持全局 `--root <path>` 或 `--instance <name-or-id>`。未显式指定时，Manager 优先使用当前目录所属实例；目录外执行时使用用户配置中的默认实例。

## 用户级 Manager 配置

Manager 配置默认位于 `~/.neuro-book-manager/config.json`。它只保存：

- 安装向导偏好，例如 channel 和上次安装目录。
- 已注册实例的名称、绝对 Installation Root 和默认实例。

配置不复制应用版本、组件 checksum、Runtime 或 Product 状态；这些信息仍只存在于实例的 `.deploy/installation.json`。因此用户级配置损坏或删除不会破坏实例，重新执行 `neuro-book instances add <path>` 即可恢复索引。

`neuro-book manage` 的 blessed TUI 支持多实例查看、状态、诊断、启动、事务更新、注册、设为默认和忘记记录。安装、启动和更新等长操作会退出 TUI 后在正常终端中继续，避免子进程输出破坏界面。

安装完成后优先使用 Installation Root 下的稳定 wrapper：Windows 为 `.runtime\bin\neuro-book.cmd`，POSIX 为 `.runtime/bin/neuro-book`。Manager 只修改自己启动的子进程 PATH，不修改系统 PATH。

## Windows Portable

从 GitHub Release 下载 `neuro-book-windows-x64.zip`，解压到新目录后运行：

```powershell
.\Start Neuro Book.cmd
```

包内已经包含源码、Windows Product、Bun、rg、PortableGit/bash 和 Manager。`Update Neuro Book.cmd` 调用统一 Manager；`Create Admin.cmd` 调用 `neuro-book admin create`。更新保留整个 `data/`。

旧版 `app/data/runtime/launcher` Portable 不承诺原地覆盖升级。首次迁移请重新解压新包，再把旧 `data/` 复制到新 Installation Root。

## GHCR

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile ghcr --dir /opt/neuro-book --port 3000 --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

Manager 不 clone 宿主源码；它根据 Release Manifest 生成 Compose，镜像使用 `ref@sha256:digest`，并挂载 State Root 的 Workspace Root、Boot Config 和日志。镜像 `/app` 内含完整源码和 `.output`。

## Product Bun

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile product-bun --dir "$HOME/neuro-book" --yes
cd "$HOME/neuro-book"
.runtime/bin/neuro-book start
```

Manager 下载同一 Release 的 Source archive 和当前平台 Product overlay，并校验二者 `sourceRevision` 相同。运行只依赖 `.output` 中的 Product runtime，不依赖根 `node_modules`；根源码用于审计、Agent 协作和后续重建。

## Source Profile

开发运行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-dev --dir "$HOME/neuro-book" --yes
```

本机生产构建：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-product --dir "$HOME/neuro-book" --yes
```

Manager 使用 `git init/fetch/switch` 物化仓库，支持空目录、只含 `.runtime/.deploy/data` 的目录和已有 checkout。dirty worktree、未知文件、非 fast-forward 都会停止；不会自动 restore、stash 或 reset。

`source-product` 先把 Nuxt build 写入 `.deploy/staging/<operation>/.output`，校验完成后才切换根 `.output`。构建失败时旧 Product 保持可运行。

## Source Docker

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-docker --dir /opt/neuro-book --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

Git 源码是 Docker build context。完整多阶段 Dockerfile 在容器内执行 `bun install --frozen-lockfile` 和 Nuxt build；宿主机不再先 build `.output` 再挂入 runtime 容器。

## 更新与回滚边界

更新顺序为：安装锁、staging 下载/build、checksum/manifest/platform 校验、运行状态检查、组件备份、切换、migration/最小检查、最后提交 `installation.json`。Release Source 与 Product 更新失败会恢复旧组件。

Manager v1 不接管 systemd、pm2 或通用后台进程。原生 Product 正在运行或 Windows 文件被占用时，更新会停止并要求用户先退出服务。Runtime 和 Manager 使用版本目录，wrapper 在下一次启动时指向新版本。

## Release 资产

每个应用 Release 包含：

```text
release-manifest.json
SHA256SUMS
neuro-book-source.zip
neuro-book-product-windows-x64.zip
neuro-book-product-linux-x64-glibc.tar.gz
neuro-book-windows-x64.zip
ghcr.io/notnotype/neuro-book:<tag>
```

Release Manifest 记录应用版本、Git revision、channel、最低 Manager 版本、各资产 URL/SHA256、Product 平台与 source revision、Windows Portable 资产以及 GHCR digest。Manager 过旧时会拒绝继续并提示重新运行 Stage 0 或 bunx。

## 验收建议

自动化 CLI/HTTP smoke 通过后，仍建议手动验证首次启动、登录、创建项目、更新提示和更新后数据保留。本项目不会自动执行浏览器验收。
