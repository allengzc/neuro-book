# NeuroBook Windows Launcher

双击 `Start Neuro Book.cmd`，或在 PowerShell 中运行 `Start Neuro Book.ps1`。

这个包已经包含预构建 Product Payload 和内置 Bun runtime。首次启动会初始化 `data/`、迁移 SQLite 数据库；不会 clone 源码、安装依赖或执行 Nuxt build。

密码保护默认关闭，浏览器打开即可使用。如需设置密码，运行 `Create Admin.cmd` 创建管理员账号；命令会更新 `data/config.yaml`，重启 NeuroBook 后密码保护生效。

常用入口：

- `Start Neuro Book.cmd` / `Start Neuro Book.ps1`：启动本地服务。
- `Create Admin.cmd` / `Create Admin.ps1`：创建或重置管理员，开启密码保护；完成后需要重启 NeuroBook。
- `Update Neuro Book.cmd` / `Update Neuro Book.ps1`：列出 GitHub Releases 中带 Windows 包的 stable / canary 等版本，选择目标版本后下载并校验 `neuro-book-windows-x64.zip`，保留 `data/` 后切换新版 `app/`、`launcher/` 和根启动脚本。

目录边界：

- `app/`：可替换的 Product Payload，请不要手改。
- `app/source/`：随包分发的完整源码快照，运行不依赖它；排障时可以让 AI Agent 在其中安装依赖并重新构建。
- `data/`：用户运行状态，包含 `workspace/`、`.env`、`config.yaml`、SQLite 数据库和 `logs/`，升级时保留。
- `data/logs/`：错误报告日志目录。需要报告问题时，可直接压缩这个目录，或在登录后访问 `http://localhost:3000/api/app/logs/download` 下载日志包；如果你修改过端口，把 URL 里的 `3000` 换成当前端口。
- `runtime/bun/`：内置 Bun runtime。
- `launcher/`：Windows Launcher。

升级前建议备份 `data/`。更新不再使用 `git pull`；因为更新命令本身运行在内置 Bun 上，自动更新会保留当前 `runtime/bun/`，不会热替换正在运行的 `bun.exe`。
