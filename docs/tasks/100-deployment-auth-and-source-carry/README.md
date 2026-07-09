# 100 - 部署鉴权引导与源码携带

## 用户需求

1. Windows Product Portable 默认关闭密码保护，引导用户主动创建密码。
2. `bunx --bun --package github:notnotype/neuro-book neuro-book-deploy` 部署时引导用户选择是否开启鉴权。
3. 在 ssh arch 上验证 Docker 部署方式的可行性（已有部署：`/home/notnotype/composes/neuro-book`）。
4. 所有部署方式携带完整源码（不 install）；后续小问题可以让 Agent 在部署机上安装依赖并重新构建。

## 变更

### 1. Windows Portable 密码保护默认关闭

- `scripts/deploy/windows-portable/launcher/launcher.mjs`
  - `renderGlobalConfig()` 初始 `auth.enabled: false`。
  - `ensureAdminUser()`：鉴权关闭时不再强制创建管理员，改为提示"运行 Create Admin.cmd 可开启密码保护"；鉴权开启且无用户时仍强制创建（避免锁死）。
  - `createAdmin()`（Create Admin 命令）：创建成功后自动把 `auth.enabled` 翻回 `true`。
  - 新增 `readAuthEnabled()` / `writeAuthEnabled()`；config 缺失或损坏时按服务端默认 `true` 处理，避免误把已上锁部署当成未开启。
- 已有 portable 安装（config 里 `enabled: true`）行为不变。

### 2. neuro-book-deploy 鉴权引导

- `scripts/deploy/neuro-book-deploy.mjs`：新增 `--auth <enabled|disabled>`（env `NEURO_BOOK_AUTH`）；部署完成后按选择输出"创建管理员命令"或"如何再开启"提示。
- `scripts/deploy/shared.mjs`：
  - `readConfig()` 交互询问「密码保护（全站登录）」，initialValue 读取部署目录已有 Global Config；非交互默认开启。
  - `config.authExplicit`（交互确认或 `--auth` 传参）为真时，redeploy 会用 `patchGlobalConfigAuth()` 更新已有 `workspace/.nbook/config.json` 的 `auth.enabled`，其余字段不动；非显式选择保持原值。
  - `adminCommand()` 导出供部署入口复用。
- `scripts/deploy/config-render.mjs`：`renderGlobalConfig()` 显式选择优先于旧配置迁移值。

### 3. arch Docker 部署验证

- 现有 source 模式部署：容器 `neuro-book-app-1` 运行 10 天，HTTP 302 正常，版本 v0.4.2-canary（落后本地 v0.5.7 约 20 个 canary）。
- 全新 ghcr 部署端到端验证通过：arch 上 `bunx neuro-book-deploy --deploy-mode ghcr --release v0.5.7-canary... --port 3002`，clone → 写部署文件 → pull 镜像 → 容器启动 → migration/profiles 正常。验证后已清理（compose down + 删目录 + 删镜像）。
- **发现并修复 bug**：`docker-compose.yml` 端口映射 `${NUXT_PORT:-3000}:3000`，但容器内按 Boot Config 监听 `NUXT_PORT`；非 3000 端口部署宿主机完全不通。修复为 `${NUXT_PORT:-3000}:${NUXT_PORT:-3000}`，已在 arch 测试部署上实测生效。
- 阻塞项：现有部署的 `.output` 为 root 属主，`scripts/deploy/deploy.mjs` 同步更新需要 sudo；`arch_pass` 环境变量在本地与远端均未找到，本次未更新旧部署。

### 4. 部署产物携带源码

- `scripts/deploy/product-runtime.mjs`：`product:stage` 新增 `stageSourceSnapshot()`，把 `git ls-files` 快照复制到 `product/source/`（本次 2300 文件，约 39MB）；worktree 中已删除但未 `git rm` 的 index 条目按 worktree 实际内容跳过并告警。
- Windows portable zip 经 `app/` 自动携带 `app/source/`（zip 实测 2300 文件，总包 326MB）；Product Bun 同样受益。
- `Dockerfile` runner 阶段补齐 `world-engine/`、`plugins/`、`datasets/`、`uno.config.ts`、`vitest.config.ts` 和 4 个 `.d.ts` shim——此前镜像缺这些文件，无法在容器内重新构建（已在 v0.5.7 镜像中实测确认缺失）。
- local-git / source 模式本身是完整 checkout，无需改动。

## 文档同步

- `docs/deployment.md`：发布模型 source/ 说明、Portable 首启流程、目录边界、GHCR 源码携带、管理员与鉴权章节重写。
- `README.md` / `README.en.md`：快速开始段落。
- `scripts/deploy/windows-portable/launcher/README-Windows.md`：默认免密说明 + `app/source/` 边界。

## 验证结果

- `neuro-book-deploy --dry-run --yes`：默认开启鉴权 + 管理员提示；`--auth disabled` 输出关闭提示；`--auth bogus` 报错。
- `bun run product:stage` 全流程通过（含 tsx/sqlite-vec vendor 断言）。
- `bun run package:windows-portable --skip-git-check` 打包通过，zip 内含 `app/source/`（含 `package.json`、`app/` 前端源码）。
- arch ghcr 全新部署 + 端口修复实测通过。

## 后续 TODO

- 用 `arch_pass` 可用后同步 arch 旧部署到最新版（`bun run deploy`，需 sudo）。
- ghcr 容器以 root 运行，会把 root 属主文件写进宿主机 `workspace/`；宿主机普通用户删不掉，可考虑 ghcr compose override 也加 `user: "${HOST_UID}:${HOST_GID}"`。
- Portable 首启提示目前只在启动终端输出；可考虑在前端设置页加"开启密码保护"入口。
