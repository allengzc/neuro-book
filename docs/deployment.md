# 部署方式

NeuroBook 默认面向本地或单机部署。当前推荐路径是 Windows Release Zip 或免 Docker 的 `local-git`，Docker 模式保留给服务器和低内存场景。

## 部署方式选择

| 方式 | 适合 | 特点 |
| --- | --- | --- |
| Windows Release Zip | Windows 本机普通用户 | 点击启动，首次联网安装依赖并 clone 源码。 |
| local-git | 本机或常规服务器 | 默认推荐，宿主机 clone/pull、build、运行。 |
| ghcr | 低内存服务器 | 拉取预构建镜像，服务器不执行 Nuxt build。 |
| source | 开发服务器 | 容器运行 runtime，源码和 build 产物来自宿主机。 |

如果不确定，Windows 用户选 Windows Release Zip；其他环境先选 `local-git`。

## Windows Release Zip

Windows Release Zip 是 Windows x64 的 bootstrap 包。它自带 Node.js runtime 和启动脚本，但不携带完整源码、`.git`、`.output` 或 `node_modules`。

首次运行 `Start Neuro Book.cmd` 时会：

- 检查 Git、Bun、ripgrep。
- 缺失工具时通过交互确认后安装。
- clone `master` 到 `app/`。
- 在 `app/` 中安装依赖、构建、迁移 SQLite。
- 引导创建管理员。
- 启动本地网页。

目录边界：

- 解压目录是 Portable Root。
- `app/` 是真实 Git checkout 和服务 cwd。
- `app/workspace/` 是 Workspace Root，保存应用数据库、Global Config 和 Project Workspace。

更新时使用 `Update Neuro Book.cmd`。不要直接用新版 zip 覆盖旧目录。

## local-git

`local-git` 是默认推荐部署模式。它不使用 Docker，直接在宿主机运行生产服务。

初始化命令：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

或 clone 仓库后运行：

```bash
node scripts/deploy/neuro-book-deploy.mjs --deploy-mode local-git
```

它会：

- clone 或复用项目源码。
- 检查 Node、npm、git、bun、rg 等工具。
- 生成 `.env`、`config.yaml`、`workspace/.nbook/config.json` 和 `.deploy/README.md`。
- 安装依赖、构建应用、执行 SQLite migration。
- 打印启动命令。

local-git 不接管 systemd、pm2 或后台进程管理。需要长期运行时，可以按部署目录中的 `.deploy/README.md` 接入自己的进程管理方式。

## ghcr

`ghcr` 是低内存服务器推荐的 Docker 模式。

它使用预构建镜像：

```text
ghcr.io/notnotype/neuro-book:latest
```

适合：

- 服务器内存不足，不适合本地 Nuxt build。
- 只想运行服务，不想在服务器上构建应用。
- release 发布后的相对稳定部署。

`ghcr` 模式仍会把 `workspace/` 挂载为持久目录。Provider key、管理员用户、Project Workspace 和 SQLite 数据都保存在本机运行状态中。

## source

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

全站鉴权默认开启。首次部署后创建管理员：

```powershell
bun run auth:create-admin admin
```

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

Windows Release Zip 使用 `Update Neuro Book.cmd`。

local-git 部署通常在应用目录执行：

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run nuxt:build
bun run migrate:deploy
```

如果要让其他 Agent 协助部署、更新或排障，优先把 [交付与运维桥梁](https://github.com/notnotype/neuro-book/blob/master/docs/operator-bridge.md) 发给它。那份文档更适合作为外部执行者的 checklist。

仓库当前状态和部署策略摘要见 [PROJECT-STATUS.md](https://github.com/notnotype/neuro-book/blob/master/PROJECT-STATUS.md)。
