# 快速开始

这页只保留最快路径。更完整的部署取舍见 [部署方式](/deployment)。

## 方式一：Windows Release Zip

Windows 普通用户优先使用 Release Zip。它适合本机点击启动，不要求你先理解 Docker 或服务部署。

基本流程：

1. 从 GitHub Release 下载 Windows x64 zip。
2. 解压到一个新目录。
3. 运行 `Start Neuro Book.cmd`。
4. 按提示安装缺失的 Git、Bun、ripgrep。
5. 首次启动时按提示创建管理员。
6. 打开本地网页并登录。

Release Zip 不是离线包。首次启动会联网安装依赖、clone 源码、构建应用并初始化 SQLite 数据库。

不要用新版 zip 直接覆盖旧目录。更新时优先使用解压目录里的 `Update Neuro Book.cmd`。

## 方式二：local-git

如果你熟悉命令行，或者要部署到自己的机器，默认推荐 `local-git`。

在目标机器运行：

```bash
npx --yes --package github:notnotype/neuro-book neuro-book-deploy
```

脚本会询问部署目录、端口和部署模式。默认模式是 `local-git`：在宿主机 clone/pull 源码，安装依赖，构建应用，迁移 SQLite，然后生成本地启动说明。

部署完成后，按 `.deploy/README.md` 中的命令启动服务。

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
- 想了解 Windows、Docker、local-git 的差异：读 [部署方式](/deployment)。
- 想理解项目文件放在哪里：读 [Agent 项目指南](https://github.com/notnotype/neuro-book/blob/master/reference/agent/neurobook-project-guide.md)。
- 想让 Agent 协助部署或排障：把 [交付与运维桥梁](https://github.com/notnotype/neuro-book/blob/master/docs/operator-bridge.md) 发给它。
