# 快速开始

这页只保留最快路径。更完整的部署取舍见 [部署方式](/deployment)。

## 方式一：Windows Release Zip

Windows 普通用户优先使用 Release Zip。它适合本机点击启动，不要求你先理解 Docker 或服务部署。

基本流程：

1. 从 GitHub Release 下载 Windows x64 zip。
2. 解压到一个新目录。
3. 运行 `Start Neuro Book.cmd`。
4. 首次启动自动初始化 `data/`。
5. 打开本地网页；需要鉴权时运行 `Create Admin.cmd`。

Release Zip 已包含源码、预构建 Product、Bun、rg 和 PortableGit/bash；首次启动不安装应用依赖、不 clone、不构建。

不要用新版 zip 直接覆盖旧目录。更新时优先使用解压目录里的 `Update Neuro Book.cmd`。

## 方式二：NeuroBook Manager

服务器优先使用 GHCR；已有 Bun 的机器也可以选择 Product Bun 或 Source Profile。

在目标机器运行：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr
```

安装完成后进入 Installation Root，运行 `.runtime/bin/neuro-book start`。更新、状态和诊断统一使用 `neuro-book update/status/doctor`。

## 创建管理员

全站鉴权默认开启。首次部署后需要创建管理员账号。

如果部署流程没有自动引导创建，可以在应用目录运行：

```powershell
bun run auth:create-admin admin
```

脚本会隐藏输入密码。不要把管理员密码作为命令参数传入。

## 配置模型 Provider

部署脚本不会在开局询问 Provider API Key。启动后进入前端设置页配置模型 Provider、API Key、默认模型和 Agent Profile 模型覆盖。

长期配置保存在 Global Config：

```text
workspace/.nbook/config.json
```

这个文件属于本机运行状态，不进 Git。

## 常见下一步

- 应用已经跑起来，想开始第一本书：读 [从第一本书到第一次 RP](/tutorials/)。
- 想了解 Windows、Docker、Product Bun 和 Source Profile 的差异：读 [部署方式](/deployment)。
- 想理解项目文件放在哪里：读 [Agent 项目指南](https://github.com/notnotype/neuro-book/blob/master/reference/agent/project-workspace-guide.md)。
- 想让 Agent 协助部署或排障：把 [交付与运维桥梁](https://github.com/notnotype/neuro-book/blob/master/docs/operator-bridge.md) 发给它。
