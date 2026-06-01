# NeuroBook Windows Bootstrap

双击 `Start Neuro Book.cmd`，或在 PowerShell 中运行 `Start Neuro Book.ps1`。

首次启动会联网安装缺失工具、拉取 `master` 源码到 `app/`、安装依赖、构建、迁移数据库，并在没有用户时引导创建管理员。

常用入口：

- `Start Neuro Book.cmd` / `Start Neuro Book.ps1`：启动本地服务。
- `Update Neuro Book.cmd` / `Update Neuro Book.ps1`：拉取 `master` 最新提交并重建。
- `Rebuild Neuro Book.cmd` / `Rebuild Neuro Book.ps1`：不拉取代码，只按当前源码重建。
- `Create Admin.cmd` / `Create Admin.ps1`：后续创建或重置管理员。

运行数据位于 `app/workspace/`。不要用新版 zip 直接覆盖已有目录，升级请优先运行 `Update Neuro Book.cmd`。
