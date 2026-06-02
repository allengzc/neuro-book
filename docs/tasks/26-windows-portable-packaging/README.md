# Windows Portable Packaging

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## User Request

- 考虑本项目的打包部署方式。
- 当前只考虑 Windows 平台。
- 最好是解压即用；如果必须安装依赖，可以通过 winget 安装。
- 第一阶段先做本地网页体验，后续再考虑桌面窗口。
- Windows release zip 带启动引导器和内置 Node.js，但不携带源码或 `.git`。
- 首次启动必须联网：引导器统一安装依赖、clone 源码、创建 `.git`，并把目录转换成可跟随 `master` 更新的本机 Git 状态。
- 这条路径独立于 `neuro-book-deploy` 的部署模式，目标是 Windows 下点击即用。
- zip 自带 Node.js；Bun、Git、ripgrep 等其他依赖在首次启动时通过 winget 引导安装。
- Workspace Root 第一版固定使用首次 clone 后的 `app/workspace/`；以后再改成可配置项。

## Goal

- 提供 Windows-first release zip：用户下载 zip，解压后点击启动脚本，本机服务启动并自动打开浏览器。
- Windows 包包含启动引导器和内置 Node.js，但不包含源码或 `.git`；首次启动先 clone `master` 源码，再执行依赖安装、构建、迁移和启动。
- Windows zip 自带 Node.js，减少 bootstrap 自身依赖；Git、Bun、ripgrep 等其他工具由启动引导器统一检查并通过 winget 引导安装。
- 第一版源码 checkout 固定在 `<Portable Root>/app/`，服务 cwd 也是 `app/`，因此 Workspace Root 固定为 `<Portable Root>/app/workspace/`。
- 保留本机更新/重建入口，便于用户跟随 `master` 更新后重新生成 `.output`。
- 不把该能力塞进 `neuro-book-deploy` 的 `local-git` / `ghcr` / `source` 部署模式。

## Current State

- 当前默认部署入口是 `local-git`：`neuro-book-deploy` 负责 clone/pull、依赖探测、`bun install`、Nuxt build、SQLite migration，并生成 `.deploy/start-local-git.*`；Windows release zip 不应只是该模式的另一个参数。
- 部署已经硬切 SQLite-only：App SQLite 默认位于 `workspace/.nbook/neuro-book.sqlite`，Project SQLite 位于各 Project Workspace 的 `.nbook/project.sqlite`。
- Nuxt build 后的 `.output` 体积较小，但运行时仍依赖项目根下的系统 assets、Prisma 产物、SQLite migrations、workspace 模板和部分管理脚本。
- 当前项目不是天然桌面客户端；更贴合现状的第一阶段是启动本地服务并打开浏览器。
- 当前代码大量以 `process.cwd()/workspace` 作为 Workspace Root，外部数据目录需要先做 Workspace Root 可配置化，不应混进 Windows packaging v1。

## Walkthrough

### 1. 明确发布形态

- 第一阶段新增 Windows release zip，而不是 Electron / Tauri 桌面壳。
- 这里的 portable 是“解压后点击启动；缺运行时会引导安装并拉取源码”的 bootstrap 包，不是严格免安装离线包。
- zip 由 GitHub Actions 在 release 时构建，不携带源码或 `.git`，但包含将 Portable Root 物化为 `master` Git checkout 的启动/更新引导能力。
- zip 解压后的用户入口：
    - `Start Neuro Book.cmd` / `Start Neuro Book.ps1`：首次运行时安装依赖、clone 源码、`bun install`、构建、迁移，然后启动本机服务并打开浏览器。
    - `Create Admin.cmd` / `Create Admin.ps1`：后续创建或重置管理员；首次无用户时由 `Start` 内联引导创建管理员。
    - `Update Neuro Book.cmd` / `Update Neuro Book.ps1`：拉取或更新 `master` 源码后重建。
    - `Rebuild Neuro Book.cmd` / `Rebuild Neuro Book.ps1`：不拉取代码，只重新安装依赖并构建当前源码；如果源码尚未物化，提示先运行更新脚本。
- 启动目标仍是 `node .output/server/index.mjs`。
- Nuxt/Nitro 生产产物中的 `file:///_entry.js` fallback 在 Windows 下不是合法绝对 file URL；Windows portable 不新增自定义 Nitro 启动器，而是在 `bun run nuxt:build` 后通过受控 build-output patch 把 fallback 指回 `.output/server/index.mjs`，并断言产物中不再残留该非法 fallback。Start/Rebuild 还会在启动或迁移前检查已有 `.output`，修复旧源码已经构建出的坏产物。
- 启动脚本和内置 runtime 留在 Portable Root；真实项目源码始终在 `app/` 子目录，避免往非空 Portable Root 里 clone。
- 桌面窗口作为第二阶段，等本地网页版 portable 包稳定后再评估。

### 2. 打包脚本

- 新增 Windows portable 打包脚本，例如 `scripts/deploy/windows-portable.mjs`，由 GitHub Actions release workflow 调用。
- 新增 npm/bun script，例如 `package:windows-portable`。
- 打包前默认执行：
    - 校验 bootstrap 源文件完整。
    - 下载并校验 Node.js 24 Windows x64 runtime。
    - 渲染 `portable-release.json`。
    - 生成 zip 和 SHA256SUMS。
- 打包输出默认写入 `dist/neuro-book-windows-portable.zip`，并作为 GitHub Release asset 发布。
- 支持参数：
    - `--output <zipPath>`：指定 zip 输出路径。
    - `--node-runtime <path>`：调试用，复用已有 Node.js runtime 目录。
    - `--skip-git-check`：调试用，允许在非干净工作区打包。

### 3. 运行根目录内容

- portable 包是 bootstrap 包，不携带源码或 `.git`；首次启动时由引导器拉取源码并绑定到 `master`。
- 运行根至少包含：
    - portable 启动和配置辅助脚本
    - `runtime/node/` 内置 Node.js 24 x64 runtime
    - 配置模板或配置生成逻辑
- portable 包必须排除：
    - `.git/`
    - `app/`、`server/`、`shared/`、`scripts/`、`assets/`、`prisma/` 等源码目录
    - `.output/` 和根 `node_modules/`；这些由 clone 后本机构建生成
    - 真实 `.env`
    - 真实 `config.yaml`
    - 当前开发机已有 `workspace/` 用户数据
    - `.agent/`、`.traces/`、coverage 等开发产物

### 4. Windows 启动流程

- `Start Neuro Book.cmd` 是普通 Windows 用户的双击入口，内部以 `ExecutionPolicy Bypass` 调用 `Start Neuro Book.ps1`；`.ps1` 负责：
    - 设置 PowerShell UTF-8 输出。
    - 使用 `runtime/node/node.exe`，v1 只支持 Windows x64。
    - 每次启动都检查 Git、Bun、ripgrep 等依赖。
    - 缺少必需工具时用 clack 展示 winget 安装命令，用户确认后执行；执行安装后提示用户重新打开 PowerShell 或重新运行脚本，不假定当前进程 PATH 已刷新。
    - 如果源码 / `.git` 尚未物化，clone `master` 源码到 `<Portable Root>/app/`；clone 是首次启动继续执行的前置条件。
    - 初始化 `.deploy/windows-portable.json`。
    - `Set-Location <Portable Root>/app`，固定使用 `app/workspace/` 作为 Workspace Root。
    - 生成或保留 `.env`、`config.yaml`、Global Config。
    - 设置 `DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite`。
    - 首次启动执行 `bun install --frozen-lockfile`，避免预构建产物与源码结构漂移。
    - 首次启动执行 `bun run nuxt:prepare`、`bun run generate`（Prisma generate）、`bun run nuxt:build`。
    - 每次启动前执行 SQLite migration。
    - migration 后检测 App SQLite 是否已有用户；没有用户时直接进入管理员创建交互，创建成功后继续启动网页。
    - 启动 `node .output/server/index.mjs`。
    - 打开 `http://localhost:<port>`。
- 如果端口被占用，脚本应提示用户换端口并写回 portable 状态。
- `Create Admin.cmd` / `Create Admin.ps1` 复用同一份 portable 配置，不把密码作为命令行参数传入。
- Start 会用真实文件状态恢复首次启动或失败构建；如果状态已经到过 `build-ready` / `migrated` 但 `app/.output/server/index.mjs` 缺失，则提示运行 `Rebuild Neuro Book.cmd` / `Rebuild Neuro Book.ps1`。

### 5. Workspace Root 策略

- Windows portable v1 固定使用 `<Portable Root>/app/workspace` 作为 Workspace Root。
- App SQLite 固定为 `<Portable Root>/app/workspace/.nbook/neuro-book.sqlite`。
- Project SQLite 仍在各 Project Workspace 的 `.nbook/project.sqlite`。
- 升级优先通过 `Update Neuro Book.cmd` / `Update Neuro Book.ps1` 跟随 `master` 做受控 Git 更新，不要用新版 zip 直接覆盖旧目录。
- 如果后续需要 `%LOCALAPPDATA%` 或自定义数据目录，应先完成 Workspace Root 可配置化，再接入 Windows 启动脚本。

### 6. 更新与重建入口

- `Update Neuro Book.cmd` / `Update Neuro Book.ps1` 执行：
    - 如果源码尚未物化，clone `master` 到 `<Portable Root>/app/`。
    - 如果源码已物化，确认 `.git` 已绑定 origin/master。
    - 检查 tracked worktree 必须干净；允许 `workspace/`、`.env`、`config.yaml`、`.deploy/` 等运行时私有文件存在。
    - tracked dirty 时停止并打印 `git status --short` 和处理建议；不自动 stash、reset 或覆盖用户改动。
    - 拉取 `master` 最新 commit。
    - `bun install --frozen-lockfile`
    - `bun run nuxt:prepare`
    - `bun run generate`（Prisma generate）
    - `bun run nuxt:build`
    - `bun run migrate:deploy`
    - 从更新后的 `app/scripts/deploy/windows-portable/bootstrap/` 同步 root-level bootstrap 入口和 bundled `bootstrap/bootstrap.mjs`。
- `Rebuild Neuro Book.cmd` / `Rebuild Neuro Book.ps1` 执行：
    - `bun install --frozen-lockfile`
    - `bun run nuxt:prepare`
    - `bun run generate`（Prisma generate）
    - `bun run nuxt:build`
    - `bun run migrate:deploy`
- 默认启动路径不调用重建入口，避免首次启动慢和环境不稳定。
- 重建入口主要服务开发调试、紧急修复和用户自行拉源码更新场景。

### 7. 恢复与状态

- portable 状态文件使用 `<Portable Root>/.deploy/windows-portable.json`。
- 状态文件只作为恢复提示，不作为唯一真相；脚本优先检查真实文件状态：
    - `app/.git` 判断源码是否已 clone。
    - `app/node_modules` 和 lockfile hash 判断依赖是否可能可用。
    - `app/.output/server/index.mjs` 判断是否已构建。
    - SQLite migration runner 判断数据库是否需要迁移。
    - 端口变更写回 `.env`、`config.yaml` 和 portable 状态。
- 建议记录阶段：
    - `dependencies-ready`
    - `source-ready`
    - `install-ready`
    - `build-ready`
    - `migrated`
- 任意阶段失败后，下次启动应从真实文件状态继续，不要求用户删除目录重来。

### 8. Bootstrap 同步与发布元数据

- bootstrap 脚本源码保存在 repo 内的 `scripts/deploy/windows-portable/bootstrap/`，不在项目根目录新建 `bootstrap/`，避免和应用 runtime / Nuxt / Agent bootstrap 语义混淆。
- GitHub Actions release 打包时，把 bootstrap 脚本复制到 Portable Root。
- `Update Neuro Book.cmd` / `Update Neuro Book.ps1` 更新 `app/` 后，从 `app/scripts/deploy/windows-portable/bootstrap/` 同步最新 bootstrap 文件回 Portable Root。
- 内置 Node.js runtime 暂不通过 `Update` 自动升级；Node runtime 随新版 release zip 更新。
- release zip 根目录包含 `portable-release.json`，记录：
    - release tag
    - build commit
    - node version
    - createdAt
    - zip schema version
- v1 不做代码签名；GitHub Release 同时发布 SHA256SUMS，README 说明 PowerShell 执行策略和校验方式。

### 9. 文档同步

- README 增加 Windows portable 部署章节。
- `docs/operator-bridge.md` 增加 Windows 用户安装、启动、升级、数据迁移和常见问题。
- `PROJECT-STATUS.md` 的 Recent Tasks 增加本任务索引。

## Decisions

- 只考虑 Windows 平台。
- 第一阶段做本地网页 portable，不做桌面壳。
- 该能力是独立 Windows release zip，不作为 `neuro-book-deploy` 的新部署模式。
- 对外口径使用“解压后点击启动；首次启动会联网安装依赖并拉取源码”，不称为离线包。
- zip 不携带源码或 `.git`；首次启动必须 clone 源码并创建 `.git`，后续转换成可跟随 `master` 的 Git local 状态。
- Windows zip 自带 Node.js。
- v1 只发布 Windows x64 zip，Node runtime 使用 Node.js 24 x64。
- Git、Bun、ripgrep 等依赖在手动启动时通过 clack 引导器统一检查和安装；安装后要求重新打开 PowerShell 或重新运行脚本。
- Start 普通启动也检查依赖。
- Start 每次启动前执行 SQLite migration。
- 首次无用户时由 Start 内联引导创建管理员；`Create Admin.cmd` / `Create Admin.ps1` 只作为后续重置入口。
- 首次启动和每次更新/重建都执行 `bun install --frozen-lockfile`；后续普通启动不重复 build。
- 更新走 `master` 最新 commit，用户可以跑到未 release 状态。
- Update 遇到 tracked dirty worktree 时停止，不自动 stash、不自动 reset。
- bootstrap 文件由 repo 维护，Update 后同步回 Portable Root；Node runtime 只随 release zip 更新。
- repo 内 bootstrap 源码固定在 `scripts/deploy/windows-portable/bootstrap/`；zip 内再提升到 Portable Root，方便用户点击启动。
- v1 不做代码签名，但 release 发布 SHA256SUMS 和 `portable-release.json`。
- Workspace Root 第一版固定为 `<Portable Root>/app/workspace/`；外部数据目录以后作为可配置 Workspace Root 任务处理。
- Windows portable v1 不承诺所有 bash-heavy skill 在 Windows 下完整等价。
- v1 使用前台 PowerShell 窗口运行服务；窗口关闭即停止服务。
- 启动前检测 App SQLite 是否已有用户；没有用户时先引导创建管理员。
- 不改变现有 `local-git`、`ghcr`、`source` 部署模式。

## Files Changed

- `.github/workflows/release-container.yml`
- `README.md`
- `docs/operator-bridge.md`
- `docs/tasks/26-windows-portable-packaging/README.md`
- `CONTEXT.md`
- `reference/workspace/TERMS.md`
- `PROJECT-STATUS.md`
- `package.json`
- `scripts/cli/has-users.ts`
- `scripts/deploy/windows-portable.mjs`
- `scripts/deploy/windows-portable/bootstrap/`

## Verification

- 已执行：
    - `node --check scripts/deploy/windows-portable.mjs`
    - `node --check scripts/deploy/windows-portable/bootstrap/bootstrap.mjs`
    - `node --check scripts/build/patch-nitro-runtime-deps.mjs`
    - `node scripts/build/patch-nitro-runtime-deps.mjs`
    - `rg -n "file:///_entry.js" .output/server/chunks` 无匹配，确认构建产物兼容检查已清理 Windows 非法 fallback。
    - 使用临时 SQLite 和端口短启动 `node .output/server/index.mjs`，确认 Windows/Node 24 下不再因 `file:///_entry.js` 抛 `ERR_INVALID_FILE_URL_PATH`，并能输出 `Listening on http://[::]:3988`。
    - `bun run package:windows-portable -- --skip-git-check --node-runtime <local-node-dir> --output .agent/workspace/windows-portable-smoke/neuro-book-windows-portable.zip`
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-portable-final/neuro-book-windows-portable.zip`
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-portable-nitro-fix/neuro-book-windows-portable.zip`
    - 读取 smoke zip，确认包含 `.cmd` / `.ps1` 启动入口、`bootstrap/bootstrap.mjs`、`runtime/node/node.exe`、`portable-release.json`。
    - 读取 smoke zip，确认未包含 root-level `app/`、`server/`、`shared/`、`scripts/`、`assets/`、`prisma/`、`.git/`、`.output/`、`node_modules/`。
    - 读取默认下载打包产物，确认 Node.js 24 Windows x64 runtime 下载、SHA 校验和 zip 结构可用。
    - `winget search --id Git.Git --exact --source winget`
    - `winget search --id Oven-sh.Bun --exact --source winget`
    - `winget search --id BurntSushi.ripgrep.MSVC --exact --source winget`
- 未执行：
    - 未在 GitHub Actions release 环境实际发布 asset。
    - 未在干净 Windows 机器上完整跑首次启动、winget 安装、clone `master`、build、migrate、管理员初始化和浏览器打开。
    - 未真实执行 `Update Neuro Book.cmd` / `Update Neuro Book.ps1` 后的 bootstrap 回写同步。

## TODO / Follow-ups

- 在干净 Windows 环境做一次完整解压启动验收。
- 后续把 Workspace Root 改成可配置项，再支持 `%LOCALAPPDATA%` 或自定义数据目录。
- 抽取最小 Nuxt/Nitro Windows 复现，上游跟进 `file:///_entry.js` fallback；升级到修复版本后移除本地 build-output patch。
