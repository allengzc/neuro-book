# NeuroBook Windows Launcher

双击 `Start Neuro Book.cmd`，或在 PowerShell 中运行 `Start Neuro Book.ps1`。

这个包已经包含预构建 Product Payload 和内置 Bun runtime。首次启动会初始化 `data/`、迁移 SQLite 数据库，并在没有用户时引导创建管理员；不会 clone 源码、安装依赖或执行 Nuxt build。

常用入口：

- `Start Neuro Book.cmd` / `Start Neuro Book.ps1`：启动本地服务。
- `Create Admin.cmd` / `Create Admin.ps1`：后续创建或重置管理员。
- `Update Neuro Book.cmd` / `Update Neuro Book.ps1`：列出 GitHub Releases 中带 Windows 包的 stable / canary 等版本，选择目标版本后下载并校验 `neuro-book-windows-x64.zip`，保留 `data/` 后切换新版 `app/`、`launcher/` 和根启动脚本。

目录边界：

- `app/`：可替换的 Product Payload，请不要手改。
- `data/`：用户运行状态，包含 `workspace/`、`.env`、`config.yaml`、SQLite 数据库和 `logs/`，升级时保留。
- `data/logs/`：错误报告日志目录。需要报告问题时，可直接压缩这个目录，或在登录后访问 `http://localhost:3000/api/app/logs/download` 下载日志包；如果你修改过端口，把 URL 里的 `3000` 换成当前端口。
- `runtime/bun/`：内置 Bun runtime。
- `launcher/`：Windows Launcher。

升级前建议备份 `data/`。更新不再使用 `git pull`；因为更新命令本身运行在内置 Bun 上，自动更新会保留当前 `runtime/bun/`，不会热替换正在运行的 `bun.exe`。
