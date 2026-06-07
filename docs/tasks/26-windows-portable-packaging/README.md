# Windows Portable Packaging

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.
> 当前状态：下方前半段保留旧 source bootstrap 设计作为历史记录。当前 release 主线已经迁移为 Windows Product Launcher：zip 包含预构建 `app/` Product Payload、`runtime/bun/`、`launcher/` 和升级保留的 `data/`；用户机器不再 clone 源码、安装依赖或执行 Nuxt build。

## User Request

- 考虑本项目的打包部署方式。
- 当前只考虑 Windows 平台。
- 最好是解压即用；如果必须安装依赖，可以通过 winget 安装。
- 第一阶段先做本地网页体验，后续再考虑桌面窗口。
- Windows release zip 带启动引导器和内置 Bun，但不携带源码或 `.git`。
- 首次启动必须联网：引导器统一安装依赖、clone 源码、创建 `.git`，并把目录转换成可跟随 `master` 更新的本机 Git 状态。
- 这条路径独立于 `neuro-book-deploy` 的部署模式，目标是 Windows 下点击即用。
- zip 自带 Bun；Git、ripgrep 等其他依赖在首次启动时通过 winget 引导安装。
- Workspace Root 第一版固定使用首次 clone 后的 `app/workspace/`；以后再改成可配置项。

## Goal

- 提供 Windows-first release zip：用户下载 zip，解压后点击启动脚本，本机服务启动并自动打开浏览器。
- Windows 包包含启动引导器和内置 Bun，但不包含源码或 `.git`；首次启动先 clone `master` 源码，再执行依赖安装、构建、迁移和启动。
- Windows zip 自带 Bun，减少 bootstrap 自身依赖；Git、ripgrep 等其他工具由启动引导器统一检查并通过 winget 引导安装。
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
- 启动目标仍是 `bun .output/server/index.mjs`。
- Nuxt/Nitro 生产产物中的 `file:///_entry.js` fallback 在 Windows 下不是合法绝对 file URL；Windows portable 不新增自定义 Nitro 启动器，而是在 `bun run nuxt:build` 后通过受控 build-output patch 把 fallback 指回 `.output/server/index.mjs`，并断言产物中不再残留该非法 fallback。Start/Rebuild 还会在启动或迁移前检查已有 `.output`，修复旧源码已经构建出的坏产物。
- 启动脚本和内置 runtime 留在 Portable Root；真实项目源码始终在 `app/` 子目录，避免往非空 Portable Root 里 clone。
- 桌面窗口作为第二阶段，等本地网页版 portable 包稳定后再评估。

### 2. 打包脚本

- 新增 Windows portable 打包脚本，例如 `scripts/deploy/windows-portable.mjs`，由 GitHub Actions release workflow 调用。
- 新增 package script，例如 `package:windows-portable`。
- 打包前默认执行：
    - 校验 bootstrap 源文件完整。
    - 从构建机 PATH 或 `--bun-runtime` 复制 Bun Windows x64 runtime。
    - 渲染 `portable-release.json`。
    - 生成 zip 和 SHA256SUMS。
- 打包输出默认写入 `dist/neuro-book-windows-portable.zip`，并作为 GitHub Release asset 发布。
- 支持参数：
    - `--output <zipPath>`：指定 zip 输出路径。
    - `--bun-runtime <path>`：调试用，复用已有 Bun runtime 文件或目录。
    - `--skip-git-check`：调试用，允许在非干净工作区打包。

### 3. 运行根目录内容

- portable 包是 bootstrap 包，不携带源码或 `.git`；首次启动时由引导器拉取源码并绑定到 `master`。
- 运行根至少包含：
    - portable 启动和配置辅助脚本
    - `runtime/bun/` 内置 Bun x64 runtime
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
    - 使用 `runtime/bun/bun.exe`，v1 只支持 Windows x64。
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
    - 启动 `bun .output/server/index.mjs`。
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
- 内置 Bun runtime 暂不通过 `Update` 自动升级；Bun runtime 随新版 release zip 更新。
- release zip 根目录包含 `portable-release.json`，记录：
    - release tag
    - build commit
    - bun version
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
- Windows zip 自带 Bun。
- v1 只发布 Windows x64 zip，Bun runtime 使用构建机 PATH 中的 Bun 或 `--bun-runtime` 指定的 Bun。
- Git、Bun、ripgrep 等依赖在手动启动时通过 clack 引导器统一检查和安装；安装后要求重新打开 PowerShell 或重新运行脚本。
- Start 普通启动也检查依赖。
- Start 每次启动前执行 SQLite migration。
- 首次无用户时由 Start 内联引导创建管理员；`Create Admin.cmd` / `Create Admin.ps1` 只作为后续重置入口。
- 首次启动和每次更新/重建都执行 `bun install --frozen-lockfile`；后续普通启动不重复 build。
- 更新走 `master` 最新 commit，用户可以跑到未 release 状态。
- Update 遇到 tracked dirty worktree 时停止，不自动 stash、不自动 reset。
- bootstrap 文件由 repo 维护，Update 后同步回 Portable Root；Bun runtime 只随 release zip 更新。
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
    - Bun import/smoke 覆盖 `scripts/deploy/windows-portable.mjs`
    - Bun import/smoke 覆盖 `scripts/deploy/windows-portable/bootstrap/bootstrap.mjs`
    - Bun import/smoke 覆盖 `scripts/build/patch-nitro-runtime-deps.mjs`
    - `bun scripts/build/patch-nitro-runtime-deps.mjs`
    - `rg -n "file:///_entry.js" .output/server/chunks` 无匹配，确认构建产物兼容检查已清理 Windows 非法 fallback。
    - 使用临时 SQLite 和端口短启动 `bun .output/server/index.mjs`，确认 Windows/Bun 下不再因 `file:///_entry.js` 抛 `ERR_INVALID_FILE_URL_PATH`，并能输出 `Listening on http://[::]:3988`。
    - `bun run package:windows-portable -- --skip-git-check --bun-runtime <local-bun-file-or-dir> --output .agent/workspace/windows-portable-smoke/neuro-book-windows-portable.zip`
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-portable-final/neuro-book-windows-portable.zip`
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-portable-nitro-fix/neuro-book-windows-portable.zip`
    - 读取 smoke zip，确认包含 `.cmd` / `.ps1` 启动入口、`bootstrap/bootstrap.mjs`、`runtime/bun/bun.exe`、`portable-release.json`。
    - 读取 smoke zip，确认未包含 root-level `app/`、`server/`、`shared/`、`scripts/`、`assets/`、`prisma/`、`.git/`、`.output/`、`node_modules/`。
    - 读取默认打包产物，确认 Bun Windows x64 runtime 复制和 zip 结构可用。
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

## Product Runtime Release v1

### User Request

- 在现有 Windows portable/source-based release 之外，先实现一个本地 `product/` 成品验证根。
- 目标是不再要求产品机拥有完整 Git checkout、根 `node_modules` 或本地 build 步骤。
- Product release 仍允许携带 `.output/server/node_modules` 作为 Nitro 内置 vendor，并保留可运行脚本、`assets/workspace`、SQLite migrations、TSX Profile Workbench 编译能力和必要的 runtime source 子集。
- 生产 `cwd` 合同必须明确：服务从 Product Root 启动，`process.cwd()` 指向 Product Root。

### Goal

- `bun run product:stage` 生成 `product/`，模拟 release zip 解压后的运行根。
- `bun run product:start` 从 Product Root 启动标准 Nuxt/Nitro 入口。
- `bun run product:create-admin` 在 Product Root 内运行管理员创建脚本。
- `/api/app/version` 在 product 环境优先读取 `release-meta.json`，不依赖 `.git` 或根 `package.json`。
- TSX Profile Workbench 在 product 环境继续可编译用户 profile 源码。

### Decisions

- Product Root 可以包含产品运行源码子集：`server/`、`shared/`、必要 `scripts/`、`assets/workspace/`、`reference/`、`docs/` 和 SQLite migrations；这些是脚本/Profile 编译运行资产，不代表服务从源码 dev server 启动。
- Product Root 不包含根 `node_modules`；依赖由 `.output/server/node_modules` 承载。
- Product Root 的 package scripts 和仓库根 `product:*` 包装命令都指向 `.output/server/scripts/**`，避免产品脚本从产品根 `scripts/**` 解析依赖后回落到开发机根 `node_modules`。
- `product:stage` 会生成 Product Root `.env`，包含 `NUXT_SESSION_PASSWORD` 和 SQLite 默认环境；`product:start` 自动加载该 `.env`，并通过 Bun 启动 Nitro 入口。
- `.output/server/node_modules` 使用 runtime package closure 复制运行依赖，包含 `tsx`、`typescript`、`esbuild`、`@esbuild/win32-x64`、`commander`、`yaml`、`zod`、`h3`、`@libsql/client` 等脚本和服务运行依赖。
- `.output/server/node_modules/nbook` 是产品内 runtime source 包，包含脚本和 worker 需要的 `server/`、`shared/`、`app/` 导入根；隔离 product smoke 已验证 `nbook/*` 不依赖仓库父级 `node_modules`。
- Profile compile worker 在 Product Runtime 中只从带 `release-meta.json` 的 Product Root 进入 product 分支，优先从 `.output/server/server/...` 读取运行源码，并通过 `.output/server/index.mjs` 创建 runtime require，把 `tsx/esm/api` 和 `tsx` loader 解析到 `.output/server/node_modules`；开发环境再回退到源码根 `server/...` 和仓库根依赖。
- Product Runtime 缺少 `tsx` vendor 时直接报清晰错误，指出缺少 `.output/server/node_modules/tsx`；worker 不再裸 `import("tsx/esm/api")`，Bun worker 也不再裸 `--import tsx`。
- Profile artifact compiler v4 不再把普通第三方包 external 出去，而是从 runtime 上下文显式解析并 bundle 到 profile artifact；只保留 Node builtin external，并为 artifact ESM 注入 `require` shim 以兼容仍会动态 require builtin 的 CJS 依赖。
- `product:stage` 会在 Product Root 内重新编译系统 profiles，避免系统 `.compiled` 继续携带源码根 dependency hash。
- `assets/workspace/.nbook/agent/scripts/profile.ts`、`variable.ts`、`workspace.ts` 和 `agent/bin/workspace(.cmd)` 都支持 product/source 双入口；product copy 下的 `workspace.ts` 是 launcher，真实入口为 `.output/server/scripts/agent/workspace.ts`。
- `release-meta.json` 的产品形态使用 `versionKind: "release"`；tag/commit/package 来源保存在 `sourceKind`；版本 API 只读 Product Root 的 `release-meta.json`，不再把 `.output/server/release-meta.json` 作为第二来源。
- Windows Release Zip 仍保持旧 bootstrap 形态；后续再把 zip 从“clone + build”迁移到“解压 product + 启动”。

### Files Changed

- `.gitignore`
- `package.json`
- `server/api/app/version.get.ts`
- `server/agent/profiles/profile-compile-worker.ts`
- `scripts/build/patch-nitro-runtime-deps.mjs`
- `scripts/build/profile.ts`
- `assets/workspace/.nbook/agent/bin/workspace`
- `assets/workspace/.nbook/agent/bin/workspace.cmd`
- `assets/workspace/.nbook/agent/scripts/profile.ts`
- `assets/workspace/.nbook/agent/scripts/variable.ts`
- `assets/workspace/.nbook/agent/scripts/workspace.ts`
- `scripts/cli/create-admin.ts`
- `scripts/db/prisma-migrate.mjs`
- `scripts/deploy/product-runtime.mjs`
- `scripts/deploy/product-start.mjs`
- `server/agent/profiles/profile-artifact-compiler.ts`
- `PROJECT-STATUS.md`
- `docs/deployment.md`
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`

### Verification

- 已执行：
    - Bun import/smoke 覆盖 `scripts/deploy/product-runtime.mjs`
    - Bun import/smoke 覆盖 `scripts/deploy/product-start.mjs`
    - Bun import/smoke 覆盖 `scripts/build/patch-nitro-runtime-deps.mjs`
    - Bun import/smoke 覆盖 `server/api/app/version.get.ts`
    - `bun run nuxt:build`
    - `bun run product:stage`
    - `product:stage` 内自动完成 `profile compile --all --system`，写入 9 个系统 profile artifact。
    - `product:stage` 内断言 Product Root 可从 `.output/server/node_modules` 解析并动态 import `tsx/esm/api`。
    - `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts`，9 个测试通过；覆盖 Product Root 无根 `node_modules` 时从 `.output/server/node_modules` 解析 `tsx/esm/api`。
    - 隔离复制 `product/` 到 `%TEMP%/neuro-book-product-isolated/`，避开仓库父级源码和根 `node_modules`。
    - 隔离 product 内执行 `bun .output/server/scripts/build/profile.ts status --system --all`，9 个 builtin profiles 全部 `loaded`。
    - 隔离 product 内执行 `bun .output/server/scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system`，确认 product 内可重新编译系统 profile。
    - 隔离 product 内执行 `bun assets/workspace/.nbook/agent/scripts/workspace.ts --help` 和 `assets\workspace\.nbook\agent\bin\workspace.cmd --help`，确认 direct script 与 bin wrapper 都可用。
    - 隔离 product 内执行 `workspace project create product-smoke ... --json`、`workspace project validate workspace/product-smoke`、`workspace node validate workspace/product-smoke/manuscript --recursive`，确认 `assets/workspace` 模板、agent scripts 和内容节点校验可用。
    - 隔离 product 内执行 `bun assets/workspace/.nbook/agent/scripts/variable.ts definition status --global`。
    - 隔离 product 内执行 `bun .output/server/scripts/db/prisma-migrate.mjs --deploy`
    - 隔离 product 内执行 `bun .output/server/scripts/cli/create-admin.ts`，使用 `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD` 非交互创建管理员
    - 隔离 product 内启动 `bun .output/server/scripts/deploy/product-start.mjs`，登录 `/api/auth/login` 返回 200。
    - 隔离 product 内 POST `/api/agent/profiles/compile`，用 builtin `leader.default` 源码执行 `dryRun: true`，返回 `ok: true` 且 0 个 error issue。
    - 隔离 product 内 POST `/api/agent/profiles/compile-all`，返回 `ok: true` 且 0 个 error issue，确认不再出现 `Cannot find package 'tsx'` 或 product 根 `node_modules` 依赖。
    - 隔离 product 内启动 `bun .output/server/scripts/deploy/product-start.mjs`，`/api/auth/me` 返回 200，确认 Product Root `.env` 加载后可用。
    - 隔离 product 内访问 `/api/app/version`，返回 `versionKind: "release"`，确认不依赖 `.git` 或根 `package.json`。

## Windows Product Launcher Migration

### User Request

- 将通用 release 抽象为 Product Payload + Platform Launcher。
- 把现有 Windows bootstrap 正式改名为 Windows Launcher。
- Windows release 包改为点击即用：不要求用户安装 Git、Bun、ripgrep，不 clone 源码，不在产品机执行 Nuxt build。

### Decisions

- Windows Product Portable zip 结构改为 `<root>/app` Product Payload、`<root>/data` 用户运行状态、`<root>/runtime/bun` 内置 Bun 和 `<root>/launcher` Windows Launcher。
- `app/` 是服务 cwd 和可替换产品 payload；`data/` 保存 `.env`、`config.yaml`、`workspace/`、SQLite 和 launcher 状态，升级时保留。
- 由于当前应用大量以 `process.cwd()/workspace` 作为 Workspace Root，Launcher v1 在启动时将 `app/workspace` 建成指向 `data/workspace` 的目录联接，先保持 Product Root cwd 合同，再把真实数据落到 `data/`。
- Windows Launcher 使用内置 Bun 直接运行 `.output/server/scripts/**` 下的 `create-admin.ts`、`has-users.ts`、system assets prepare 和 Nitro 入口，不要求产品根 `node_modules`。
- Windows portable release workflow 必须在 `windows-latest` 运行，确保 Windows native optional packages（例如 `@esbuild/win32-x64`、`@libsql/win32-x64-msvc`）真实进入 Windows Product Payload。
- `agent/bin/workspace(.cmd)`、`profile(.cmd)`、`variable(.cmd)` 在 Product Payload 内优先使用内置/系统 Bun 直接运行 `.output/server/scripts/**`；源码开发 fallback 也调用 Bun。
- Product Root 的 `tsconfig.json` 在 staging 时改写 `nbook/*` / `neuro_book/*` 到 `.output/server/node_modules/nbook/*`，避免 Product 脚本从 `app/server` 源码子集向上寻找根 `node_modules`。
- `.output/server/node_modules/nbook/server/agent/profiles/profile-dsl/` 会生成 `index.jsx` / `index.js` re-export，避免 Product package 子路径解析把同名 `profile-dsl/` 目录误判为缺失的 JSX index。
- 管理员密码哈希拆到 `server/utils/password.ts`，`create-admin.ts` 不再为了哈希拉入 `server/utils/auth.ts` 的 H3/session 请求层依赖。
- Profile artifact 在 Product Runtime 下使用 `.output/server/index.mjs` 创建 `require` shim；动态 artifact 里的 native/dynamic require 会从 `.output/server/node_modules` 解析，不再从 `.compiled` 临时目录或用户 workspace 向上找根 `node_modules`。
- Nitro runtime vendor seed 补入 `undici`，保证 Product Payload 直接启动 `.output/server/index.mjs` 时不缺服务端 fetch 依赖。
- Windows Nuxt build 优化采用 `nitro.externals.trace=false`，避免 Nitro/node-file-trace 在 Windows 上扫描重 provider SDK 依赖树；由于该模式会把 external import 写成构建机根 `node_modules` 的 file URL，`patch-nitro-runtime-deps.mjs` 会先把这些 URL 改为 `.output/server/node_modules` 相对 import，再从 Nitro 产物扫描 external package seed 并复制 runtime vendor。
- Product 内的 workspace agent script 会从 `.output/server/scripts/agent` 回到 Product Root 的 `assets/workspace/.nbook/templates` 定位系统 Project 模板。
- `Update Neuro Book.cmd` 不再 `git pull`；它会查询 GitHub latest release，下载 `neuro-book-windows-x64.zip` 和 `SHA256SUMS`，校验 SHA256 后备份旧 `app/`、`launcher/`、根启动脚本和 `portable-release.json`，再切换新版并保留 `data/`。
- Windows Launcher 自动更新保留当前 `runtime/bun/`，避免在 update 命令运行中替换正在使用的 `bun.exe`；`portable-release.json` 会记录 `runtimeKind: "bun"`、packaged Bun version 和当前保留的 runtime version。
- `Rebuild Neuro Book.*` 不再打包，因为 Product Portable 不支持本机 build。
- 正式部署模式重设为 Product Portable、Product Bun、Product Docker/ghcr、Source Dev；`local-git` 和 `source Docker` 降级为源码/过渡路径。
- Product Docker / ghcr 保留源码目录用于容器内排障，但 app final runner 使用 Bun runtime，运行时不再依赖根 `node_modules`：GHCR app 镜像启动时通过 `scripts/deploy/docker-product-entrypoint.sh` 执行 `bun .output/server/scripts/db/prisma-migrate.mjs --deploy`，再用 `bun .output/server/scripts/deploy/product-start.mjs` 启动服务；管理员脚本也通过 Bun 运行产品内入口。
- Bun runtime 统一结论：`package.json`、`local-git`、`source`、docs build、release build、开发服务器、Product Portable、Product Bun 和 GHCR app runner 均以 Bun 作为一方运行器；`node:*` import 仍通过 Bun 的 Node 兼容层使用，不代表产品运行时依赖 Node。

### Files Changed

- `.github/workflows/release-container.yml`
- `Dockerfile`
- `README.md`
- `docs/deployment.md`
- `docs/operator-bridge.md`
- `docs/tasks/26-windows-portable-packaging/README.md`
- `PROJECT-STATUS.md`
- `scripts/cli/create-admin.ts`
- `scripts/deploy/windows-portable.mjs`
- `scripts/deploy/windows-portable/launcher/`
- `assets/workspace/.nbook/agent/bin/workspace`
- `assets/workspace/.nbook/agent/bin/workspace.cmd`
- `assets/workspace/.nbook/agent/bin/profile`
- `assets/workspace/.nbook/agent/bin/profile.cmd`
- `assets/workspace/.nbook/agent/bin/variable`
- `assets/workspace/.nbook/agent/bin/variable.cmd`
- `scripts/build/profile.ts`
- `scripts/build/variable.ts`
- `scripts/deploy/docker-product-entrypoint.sh`
- `scripts/deploy/ghcr.mjs`
- `scripts/deploy/product-runtime.mjs`
- `scripts/deploy/product-start.mjs`
- `scripts/deploy/shared.mjs`
- `scripts/deploy/local-git.mjs`
- `scripts/deploy/native-deps.mjs`
- `Dockerfile.source-runtime`

### Verification

- 已执行：
    - Bun import/smoke 覆盖 `scripts/deploy/publish-ghcr-image.mjs`
    - Bun import/smoke 覆盖 `scripts/deploy/neuro-book-deploy.mjs`
    - `bun scripts/cli/create-admin.ts admin password123` 返回预期错误，确认禁止位置参数密码的提示不再写死 `bun run auth:create-admin`。
    - `bash -n scripts/deploy/docker-product-entrypoint.sh`
    - `bun scripts/deploy/publish-ghcr-image.mjs --dry-run`
    - `bun scripts/deploy/neuro-book-deploy.mjs --yes --deploy-mode ghcr --dry-run --dir .agent/workspace/deploy-ghcr-dry-run`
    - Bun import/smoke 覆盖 `scripts/deploy/windows-portable.mjs`
    - Bun import/smoke 覆盖 `scripts/deploy/windows-portable/launcher/launcher.mjs`
    - Bun import/smoke 覆盖 `scripts/deploy/product-runtime.mjs`
    - Bun import/smoke 覆盖 `scripts/build/patch-nitro-runtime-deps.mjs`
    - `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts server/utils/auth.test.ts server/api/auth/login.post.test.ts`，18 个测试通过。
    - `bun run nuxt:build`
    - `bun scripts/build/patch-nitro-runtime-deps.mjs`
    - `bun run product:stage`
    - Windows build 优化验证：关闭 `nitro.externals.trace` 后，`bun run nuxt:build` 从约 416 秒降到约 113 秒；`.output/server` 总 size 从约 42.5 MB 降到约 1.78 MB。后处理会输出 `patched external node_modules file URLs` 和 `Nitro runtime package copy` 计时。
    - 启动 smoke：设置临时 `PORT` / `NITRO_PORT` / `NUXT_SESSION_PASSWORD`，运行 `bun .output/server/index.mjs`，请求 `/api/app/version` 返回 200；确认 `.output/server` 不再残留构建机根 `node_modules` file URL。
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-product-launcher/neuro-book-windows-x64.zip`
    - 确认 `.github/workflows/release-container.yml` 的 `windows-portable` job 使用 `windows-latest`，避免 Linux runner 打出缺 Windows native optional packages 的包。
    - 读取 zip 条目，确认包含 `app/.output/server/index.mjs`、`app/.output/server/node_modules`、`runtime/bun/bun.exe`、`launcher/launcher.mjs`、root `Start/Create Admin/Update` `.cmd/.ps1` 和 `portable-release.json`。
    - 读取 zip 条目，确认不包含 root `.git/`、root `node_modules/`、旧 `bootstrap/`、`Rebuild Neuro Book.*`、`app/.env` 或 `app/workspace/`。
    - 隔离解压 zip 到 `%TEMP%/neuro-book-windows-product-launcher-smoke/neuro-book-windows-x64`，根目录无 `.git`、无 `node_modules`、无 Bun 依赖。
    - 使用内置 Bun 运行 `runtime/bun/bun.exe launcher/launcher.mjs admin`，确认创建 `data/.env`、`data/config.yaml`、`data/workspace/.nbook/config.json`、`data/workspace/.nbook/neuro-book.sqlite` 和 `app/workspace` 目录联接，并成功创建管理员。
    - 使用 Windows Launcher 启动服务，设置 `NEURO_BOOK_NO_OPEN_BROWSER=1` 做自动化 smoke；通过内置 Bun fetch 登录 `/api/auth/login`，`/api/app/version` 返回 `versionKind: "release"`。
    - POST `/api/agent/profiles/compile`，使用 builtin `writer.profile.tsx` 源码执行 `dryRun: true`，返回 `ok: true` 且 0 个 issue。
    - POST `/api/agent/profiles/compile-all`，返回 `ok: true`，空用户 profile root 下 `compiledCount: 0`，确认不再出现 `Cannot find package 'tsx'`、`@prisma/adapter-libsql` 或 `@libsql/win32-x64-msvc`。
    - 在隔离 zip 的 `app/workspace` cwd 下用内置 Bun 运行 `app/assets/workspace/.nbook/agent/scripts/workspace.ts project create launcher-smoke ... --json`，确认使用 Product Payload 的 `app/assets/workspace/.nbook/templates/project-directory-templates` 创建 Project Workspace 和 Project SQLite。
    - 继续运行 `workspace.ts project validate launcher-smoke`，返回 `ok: true`，`schemaVersion: "1"`。
    - 在 Product Root 内只保留 Bun 和 Windows 系统目录，执行 `assets\workspace\.nbook\agent\bin\workspace.cmd project create/validate`、`profile.cmd --help`、`variable.cmd --help`，确认 agent bin wrapper 可通过 Bun 运行。
    - 解压新 zip 到 `%TEMP%`，确认根目录无 `.git`、无根 `node_modules`；PATH 只保留 zip 内 `runtime/bun` 和 Windows 系统目录后，执行 `app\assets\workspace\.nbook\agent\bin\workspace.cmd project create/validate`、`profile.cmd --help`、`variable.cmd --help`，确认 zip 内 wrapper 可用。
    - 使用本地 `HttpListener` fake GitHub latest release，运行隔离 zip 内 `runtime\bun\bun.exe launcher\launcher.mjs update`；确认 launcher 下载 `neuro-book-windows-x64.zip` / `SHA256SUMS`、完成 SHA256 校验、备份旧 `app/` / `launcher/` / root scripts、切换新 payload，`data/.deploy/windows-launcher.json` 写入 `stage: "updated"`。
    - `bun scripts/deploy/publish-ghcr-image.mjs --dry-run`
    - `bun scripts/deploy/neuro-book-deploy.mjs --yes --deploy-mode ghcr --dry-run --dir .agent/workspace/deploy-ghcr-dry-run`
    - `bash -n scripts/deploy/docker-product-entrypoint.sh`
    - `bun scripts/cli/create-admin.ts admin password123` 返回预期错误，确认禁止位置参数密码。
    - `bun run nuxt:build`
    - `bun run product:stage`
    - Product local smoke：使用 `bun .output/server/scripts/deploy/product-start.mjs` 启动，登录后 `/api/app/version` 返回 `versionKind: "release"`。
    - `bun run package:windows-portable -- --skip-git-check --output .agent/workspace/windows-bun-portable/neuro-book-windows-x64.zip`
    - 读取 zip 条目，确认包含 `runtime/bun/bun.exe`，不包含 `runtime/node/node.exe` 或根 `node_modules`，且包含 `app/.output/server/node_modules`。
    - 读取 `portable-release.json`，确认 `runtimeKind: "bun"`、`bunVersion` 和 `runtimePath: "runtime/bun/bun.exe"`。
    - 使用内置 Bun 运行 `runtime\bun\bun.exe launcher\launcher.mjs admin`，确认 SQLite migration 和管理员创建成功。
    - Docker smoke 未执行：当前环境没有 `docker` 命令。

### TODO / Follow-ups

- 后续如确实需要，增加跨进程替换 `runtime/bun/` 的二阶段 updater。
- 后续把 Workspace Root 可配置化后，移除 `app/workspace -> data/workspace` 目录联接策略。
- 在干净 Windows 机器上完整跑双击启动验收。
