# NeuroBook Windows Launcher

双击 `Start Neuro Book.cmd`，或在 PowerShell 中运行 `Start Neuro Book.ps1`。

这个包已经包含预构建 Product Payload 和内置 Node.js runtime。首次启动会初始化 `data/`、迁移 SQLite 数据库，并在没有用户时引导创建管理员；不会 clone 源码、安装 Bun、安装依赖或执行 Nuxt build。

常用入口：

- `Start Neuro Book.cmd` / `Start Neuro Book.ps1`：启动本地服务。
- `Create Admin.cmd` / `Create Admin.ps1`：后续创建或重置管理员。
- `Update Neuro Book.cmd` / `Update Neuro Book.ps1`：显示 Product Portable 更新说明；自动下载和切换新版 `app/` 会在后续版本补齐。

目录边界：

- `app/`：可替换的 Product Payload，请不要手改。
- `data/`：用户运行状态，包含 `workspace/`、`.env`、`config.yaml` 和 SQLite 数据库，升级时保留。
- `runtime/node/`：内置 Node.js runtime。
- `launcher/`：Windows Launcher。

升级前请备份 `data/`。v1 不再使用 `git pull` 更新。
