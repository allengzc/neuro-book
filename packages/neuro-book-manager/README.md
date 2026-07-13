# NeuroBook Manager

NeuroBook 的安装、更新、实例、Runtime 与工具链管理器。

直接运行且不传参数，会进入面向首次用户的 Clack 安装向导：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

向导会说明部署方式并依次选择安装目录、实例名称、更新通道、端口和鉴权。自动化安装仍可显式传参：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

安装成功后，实例会注册到 `~/.neuro-book-manager/config.json`。该文件只保存用户偏好、默认实例和实例目录索引；每个实例的真实部署状态仍由其 `.deploy/installation.json` 管理。

```bash
neuro-book manage
neuro-book instances list
neuro-book --instance <name> status
neuro-book --root <path> doctor
```

`neuro-book manage` 使用 blessed 提供多实例 TUI，可查看状态、执行诊断、启动、更新、注册、设置默认实例或忘记索引。忘记实例不会删除 Installation Root 或用户数据。

不要使用 `bunx run @notnotype/neuro-book-manager`；`bunx run` 会把包名按本地脚本或路径解析，Manager 不会被启动。

公开命令为 `neuro-book`。应用源码、Product、Runtime、Toolchain、Deployment State 与用户状态使用独立组件合同。
