# NeuroBook

[![GitHub Release](https://img.shields.io/github/v/release/notnotype/neuro-book?include_prereleases&label=release)](https://github.com/notnotype/neuro-book/releases)
[![GHCR App](https://img.shields.io/badge/GHCR-neuro--book-8957e5?logo=github&label=app)](https://github.com/notnotype/neuro-book/pkgs/container/neuro-book)
[![Bun](https://img.shields.io/badge/runtime%20%2B%20build-Bun-000000?logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

NeuroBook 是一个基于 Nuxt 构建的长篇小说创作与 AI 角色扮演 IDE。它以作者为主导，集成文件化 Project Workspace、Markdown Studio、剧情结构管理和领域化 Agent 系统，面向长篇写作、世界模拟、AI RP 和 SillyTavern 角色卡迁移等场景。

项目底层运行时基于 Pi 框架扩展，复用了 multi-provider、tool calling、append-only session tree 等基础抽象，并在此之上构建了 NeuroAgentHarness。NeuroBook 进一步引入 Profile、TSX Profile 和 Sidecar Context，让 Agent 能围绕小说创作和角色扮演建立可检索、可审查、可记忆、可长期维护的工作流。

<div style="display: flex; justify-content: space-between;">
  <img src="./docs/images/主页.png" width="31%"/>
  <img src="./docs/images/剧本工作台.png" width="31%"/>
  <img src="./docs/images/TSX可视化编辑器.png" width="31%"/>
</div>
<br/>

> 测试网站：http://8.148.4.22:3001/

## 核心特点

- **长篇小说 IDE**：用 Project Workspace 统一管理 `lorebook/`、`manuscript/`、`simulation/`、`reference/` 和项目配置，让设定、正文、状态和外部素材都能被人和 Agent 共同维护。
- **领域化 Agent 设计**：围绕写作和 RP 拆分 leader、writer、retrieval、researcher、simulator leader、actor、rp.writer 等职责，避免把检索、裁决、写作和记忆维护都压进一次模型调用。
- **NeuroAgentHarness**：在 Pi 风格 multi-provider、tool calling、append-only session tree 之上，支持 Multi-Agent 协作、HITL（Human-in-the-Loop）、运行时 Profile / Tool Catalog、上下文压缩、会话摘要、生命周期管理与 Runtime Hooks。
- **Profile**：定义 Agent 的行为边界，包括工具白名单、输入 / 输出 Schema、系统提示词、动态上下文、压缩策略、摘要策略和 Runtime Hooks。
- **TSX Profile**：使用 TSX 作为上下文模板语言，通过 System、History、Dynamic Context、Reminder、Import、SkillCatalog 等节点描述上下文结构，兼顾类型安全、可预览和低代码辅助编辑。
- **Sidecar Context**：在 Agent 主运行前或运行后 fork runtime-only 分支，用于检索、反思、记忆维护或状态整理；sidecar transcript 不进入主 history，只把整理后的结果合并回主线，保持主任务上下文纯净。
- **SillyTavern 角色卡迁移**：支持 `inspect -> unpack -> import` 三段式流程，保留原始卡片和 worldbook 归档，把稳定设定迁入 lorebook，并为后续 RP / simulation 迁移保留动态机制材料。

## 快速选择

| 方式 | 适合 | 特点 |
| --- | --- | --- |
| Windows Product Portable | Windows 本机普通用户 | 解压后点击启动，内置 Bun 和预构建 Product Payload。 |
| Product Bun | 已有 Bun 的本机或服务器 | 解压 Product Payload 后用 Bun 启动，不需要源码和根 `node_modules`。 |
| ghcr | 低内存服务器 | Docker 拉取预构建镜像，服务器不执行 Nuxt build。 |
| Source Dev | 开发者 | 源码 checkout、本机依赖安装、开发和测试。 |

不确定时：Windows 用户选 Product Portable；服务器优先选 `ghcr` 或 Product Bun。

## Windows Product Portable

从 [GitHub Releases](https://github.com/notnotype/neuro-book/releases) 下载 Windows x64 zip，解压到新目录后运行：

```powershell
.\Start Neuro Book.cmd
```

包内已经包含预构建 `app/` Product Payload 和 `runtime/bun/`。首次启动会初始化 `data/`、迁移 SQLite，并在没有用户时引导创建管理员；不会 clone 源码、安装依赖或执行 Nuxt build。

更新时运行：

```powershell
.\Update Neuro Book.cmd
```

更新入口会下载 GitHub Release 最新 Windows 包，校验 `SHA256SUMS`，保留 `data/` 后切换新版 `app/`、`launcher/` 和根启动脚本。内置 `runtime/bun/` 会保留当前版本，避免替换正在运行的 `bun.exe`。

目录边界：

- `app/`：可替换的 Product Payload。
- `data/`：升级时保留的运行状态，包含 `workspace/`、`.env`、`config.yaml` 和 SQLite 数据库。
- `launcher/`：Windows Launcher。
- `runtime/bun/`：内置 Bun runtime。

## Product Bun

Product Bun 适合已有 Bun 的本机或服务器。构建机生成 Product Payload：

```bash
bun run nuxt:build
bun run product:stage
```

运行机从 Product Root 启动：

```bash
cd product
bun .output/server/scripts/deploy/product-start.mjs
```

## local-git

`local-git` 保留为源码部署过渡方案，适合熟悉命令行并希望跟随源码更新的用户：

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```

脚本会询问部署目录、端口和部署模式。`local-git` 会在宿主机 clone/pull 源码、安装依赖、构建应用、执行 SQLite migration，并在 `.deploy/README.md` 中生成启动说明。

也可以 clone 后运行：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
bun scripts/deploy/neuro-book-deploy.mjs --deploy-mode local-git
```

## ghcr

推荐给不想在服务器上执行 Nuxt build 的 Docker 部署：

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```

部署模式选择 `ghcr`。脚本会使用预构建镜像：

```text
ghcr.io/notnotype/neuro-book:latest
```

数据、配置和 Project Workspace 仍保存在宿主机 `workspace/` 挂载目录中。
GHCR 镜像保留源码目录用于排障，但 app runner 使用 Bun runtime，服务启动、SQLite migration 和管理员脚本都使用镜像内预构建的 `.output/server/scripts/**`；服务器和容器启动时不执行依赖安装，也不要求根 `node_modules`。

## Source Dev

推荐给开发服务器或需要源码挂载的 Docker 部署：

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
bun scripts/deploy/neuro-book-deploy.mjs --deploy-mode source
```

`source` 模式会构建 runtime 容器，并把宿主机项目目录挂载到容器 `/app`。宿主机仍需要安装依赖并构建应用。低内存服务器优先使用 `ghcr`。

## 管理员和模型配置

全站鉴权默认开启。Windows Product Portable 首次启动会自动引导创建管理员；源码部署中如果需要手工创建，可以在应用目录运行：

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

- [官网文档首页](docs/index.md)
- [快速开始](docs/quick-start.md)
- [部署方式](docs/deployment.md)
- [基础教程](docs/tutorials/index.md)
- [Agent 心智模型](docs/agent/index.md)
- [Profile 介绍](docs/profile/index.md)
- [Profile TSX 介绍](docs/profile-tsx/index.md)
- [Sidecar Context](docs/agent/sidecar.md)
- [NeuroBook Reference Bookshelf](reference/README.md)
- [PROJECT-STATUS.md](PROJECT-STATUS.md)

如果要让其他 Agent 协助部署、更新或排障，优先把 [docs/operator-bridge.md](docs/operator-bridge.md) 发给它。

## License

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify, and share the software for noncommercial purposes.

Commercial use requires prior written permission from the copyright holder. Personal authors may use NeuroBook to create, edit, and publish their own original works, including commercially published writing. The commercial restriction applies to commercial use of the software itself, not to the user's original creative output.

## Star History

<a href="https://www.star-history.com/?repos=notnotype%2Fneuro-book&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
 </picture>
</a>
