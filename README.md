# NeuroBook

[![GitHub Release](https://img.shields.io/github/v/release/notnotype/neuro-book?include_prereleases&label=release)](https://github.com/notnotype/neuro-book/releases)
[![GHCR App](https://img.shields.io/badge/GHCR-neuro--book-8957e5?logo=github&label=app)](https://github.com/notnotype/neuro-book/pkgs/container/neuro-book)
[![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

NeuroBook 是一个面向长篇小说创作的本地 AI 工作台，以作者为主导，集成文件化 workspace、Markdown Studio、剧情结构管理和多 Agent 写作流程。

它适合长期维护世界观、剧情线、章节草稿和 AI 写作流程的作者；后续也会继续探索 AI RP、世界模拟和 SillyTavern 角色卡迁移。

<div style="display: flex; justify-content: space-between;">
  <img src="./docs/images/主页.png" width="31%"/>
  <img src="./docs/images/剧本工作台.png" width="31%"/>
  <img src="./docs/images/TSX可视化编辑器.png" width="31%"/>
</div>
<br/>

> 测试网站：http://8.148.4.22:3001/

## 快速选择

| 方式 | 适合 | 特点 |
| --- | --- | --- |
| Windows Release Zip | Windows 本机普通用户 | 解压后点击启动，首次联网安装依赖并 clone 源码。 |
| local-git | 本机或常规服务器 | 默认推荐，免 Docker，宿主机 clone/pull、build、运行。 |
| ghcr | 低内存服务器 | Docker 拉取预构建镜像，服务器不执行 Nuxt build。 |
| source | 开发服务器 | Docker 提供 runtime，宿主机源码挂载进容器。 |

不确定时：Windows 用户选 Release Zip；其他环境优先选 `local-git`。

## Windows Release Zip

从 [GitHub Releases](https://github.com/notnotype/neuro-book/releases) 下载 Windows x64 zip，解压到新目录后运行：

```powershell
.\Start Neuro Book.cmd
```

首次启动会检查 Git、Bun、ripgrep，缺失时按提示安装，然后 clone 源码、安装依赖、构建应用、初始化 SQLite，并引导创建管理员。

更新时运行：

```powershell
.\Update Neuro Book.cmd
```

不要用新版 zip 直接覆盖旧目录。

## local-git

推荐给熟悉命令行的本机或服务器用户：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

脚本会询问部署目录、端口和部署模式。默认 `local-git` 会在宿主机 clone/pull 源码、安装依赖、构建应用、执行 SQLite migration，并在 `.deploy/README.md` 中生成启动说明。

也可以 clone 后运行：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
node scripts/deploy/neuro-book-deploy.mjs --deploy-mode local-git
```

## ghcr

推荐给不想在服务器上执行 Nuxt build 的 Docker 部署：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

部署模式选择 `ghcr`。脚本会使用预构建镜像：

```text
ghcr.io/notnotype/neuro-book:latest
```

数据、配置和 Project Workspace 仍保存在宿主机 `workspace/` 挂载目录中。

## source

推荐给开发服务器或需要源码挂载的 Docker 部署：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
node scripts/deploy/neuro-book-deploy.mjs --deploy-mode source
```

`source` 模式会构建 runtime 容器，并把宿主机项目目录挂载到容器 `/app`。宿主机仍需要安装依赖并构建应用。低内存服务器优先使用 `ghcr`。

## 管理员和模型配置

全站鉴权默认开启。首次部署后如果没有自动引导创建管理员，可以在应用目录运行：

```powershell
bun run auth:create-admin admin
```

脚本会隐藏输入密码。不要把密码作为命令参数传入。

模型 Provider、API Key、默认模型和 Agent Profile 模型覆盖在前端设置页配置。长期配置保存在：

```text
workspace/.nbook/config.json
```

这个文件属于本机运行状态，不要提交到 Git。

## 本地开发

```bash
bun install
bun run dev
```

常用命令：

```bash
bun run typecheck
bun run test
bun run docs:dev
bun run docs:build
```

## 文档

- [快速开始](docs/quick-start.md)
- [部署方式](docs/deployment.md)
- [基础教程](docs/tutorials/index.md)
- [NeuroBook Reference Bookshelf](reference/README.md)
- [PROJECT-STATUS.md](PROJECT-STATUS.md)

如果要让其他 Agent 协助部署、更新或排障，优先把 [docs/operator-bridge.md](docs/operator-bridge.md) 发给它。

## License

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify, and share the software for noncommercial purposes.

Commercial use requires prior written permission from the copyright holder. Personal authors may use NeuroBook to create, edit, and publish their own original works, including commercially published writing. The commercial restriction applies to commercial use of the software itself, not to the user's original creative output.
