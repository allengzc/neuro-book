# 105 - 统一安装目录与 NeuroBook Manager

> 当前状态：实现中。Manager [`0.1.0-canary.13`](https://github.com/notnotype/neuro-book/actions/runs/29252645123)已通过Trusted Publisher公开，npm `canary`与真实bunx均已验证。[`v0.7.9-canary.20260713.131204Z.3b064b83`](https://github.com/notnotype/neuro-book/releases/tag/v0.7.9-canary.20260713.131204Z.3b064b83)的Release workflow `29252852294`全绿，九个资产已公开，Windows Portable与Linux Product真实浏览器门禁通过。公开Portable/Product Bun与GHCR A→B终验仍未完成，因此Task 105不归档。

## Relative documents refs

- `PROJECT-STATUS.md`
- `docs/deployment.md`
- `docs/operator-bridge.md`
- `reference/workspace/TERMS.md`
- `docs/tasks/26-windows-portable-packaging/README.md`
- `docs/tasks/100-deployment-auth-and-source-carry/README.md`
- `packages/neuro-book-manager/`
- `server/runtime/installation-paths.ts`
- `scripts/deploy/windows-portable-manager.ts`
- `scripts/release/release-assets.ts`
- `.github/workflows/release-container.yml`

## User Request / Topic

- 将当时的一次性部署脚本升级为统一安装、更新、运行时和工具链管理器。
- 使用方案 A：发布独立轻量 npm 包。
- npm 包暂定 `@notnotype/neuro-book-manager`，用户命令使用 `neuro-book`。
- Git 仓库根是所有安装形式的目录底座；Product、Runtime、工具链和部署状态作为可组合组件叠加到仓库根，不再以额外 `source/` 目录包裹源码。
- 所有交付形式携带完整源码；Product 形式额外携带预构建 `.output`，但正式运行不能依赖源码根 `node_modules`。
- Windows Portable 在 Product Bun 基础上增加内置 Bun Runtime、平台 Launcher 和可选托管工具。
- GHCR 是 OCI 交付外壳与分发渠道，镜像内部仍由 Source、Product、Runtime 和 Toolchain 组件组成。
- 不同平台提供各自 Stage 0，Stage 0 只负责确保 Bun 可用，之后统一调用 NeuroBook Manager。
- Manager 后续负责 Bun、ripgrep、Git 等组件的检测、下载、版本记录和更新。

## Goal

建立一个以 NeuroBook 仓库根为统一 Installation Root 的组件化安装体系，并实现独立发布的 `@notnotype/neuro-book-manager`：

- Git clone、Source build、Product Bun、Windows Portable、Source Docker 和 GHCR 在逻辑上使用同一目录与组件所有权协议。
- `neuro-book` 命令统一管理安装、更新、启动、状态、诊断、Runtime 和 Toolchain。
- Source、Product、Runtime、Toolchain、Deployment State 与 User State 有明确边界，更新只能替换对应组件拥有的文件。
- Stage 0、Manager、应用 Release 和 GHCR 镜像之间有明确、可校验的版本兼容协议。
- Product 更新使用 staging、checksum、安装锁和失败回滚，不能破坏用户数据或已有可运行 Product。
- Git worktree 有未提交修改时，源码更新必须停止并报告，不能自动 restore、reset 或覆盖用户改动。
- 用组件解析测试、目录所有权测试、更新/回滚测试、npm pack 依赖审计和跨平台 dry-run 证明安装协议成立。

如果某个平台无法在不引入特殊目录分叉的前提下满足相同合同，应先记录实际平台限制、逻辑映射和用户可见差异，再由用户决定是否接受该差异；不得用隐式 fallback 或路径 hack 绕过。

## Current State

### 现有部署模式

- 旧部署 CLI 曾是仓库根 `package.json` 的 bin，默认选择 `local-git`。
- `local-git` 会 clone/pull、`bun install --frozen-lockfile`、Nuxt prepare/generate/build 和 SQLite migration，再生成本机启动脚本。
- `source` 是“宿主机 Bun 安装和构建 + Docker runtime 容器运行”的混合模式，不是完全容器内源码构建。
- `ghcr` 使用预构建 Product 镜像，运行机不执行 `bun install` 或 Nuxt build，但现有安装器仍会 clone 完整仓库。
- `Product Bun` 已有 `product:stage` / `product:start` 实现，但 Release workflow 尚未发布通用 Product Bun 压缩包。
- Windows Product Portable 当前结构为 `app/` Product Root、`data/` 用户状态、`runtime/bun/`、`launcher/`，并在 `app/source/` 再携带一份完整源码快照。

### 现有包与发布边界

- 根 `package.json` 同时承担完整应用依赖和部署 CLI bin。
- 旧 GitHub 包部署入口通常不会安装目标包的普通 `devDependencies`，但会解析根包声明的全部 `dependencies`；当时根依赖包含 Nuxt、Vue、Prisma、编辑器等完整应用依赖树，远超部署 CLI 所需。
- 根 `files` 能约束 pack 产物，但不能作为 GitHub Git dependency 一定只获取这些文件的长期合同。
- 当前 Release workflow 发布 Windows portable zip 和 GHCR 镜像，没有独立 Manager npm 包和通用 Product Bun artifact。

### 已有目录基础

- `.gitignore` 已忽略 `.output`、`.runtime`、`.deploy`、`workspace`、`.env`、`config.yaml` 和 `product/`，适合作为组件化根目录的基础。
- 当前 `.runtime` 仅有 ignore 约定，正式产品仍使用 `runtime/bun/`。
- 当前 Product staging 会复制 Git tracked 文件到 `product/source/`，与“仓库根即源码底座”的新方向冲突。
- `CONTEXT.md` 和 `reference/workspace/TERMS.md` 仍包含旧版 Windows Source Binding、Node runtime、首次 clone 到 `app/` 等过期术语；部分内容已经和当前 Bun Product Launcher 实现不一致。

## Decisions / Discussion

### D1：仓库根是统一 Installation Root

推荐目标结构：

```text
neuro-book/
├─ .git/                    # Git 安装存在；Release 安装可不存在
├─ app/
├─ server/
├─ shared/
├─ scripts/
├─ assets/
├─ package.json
├─ bun.lock
├─ .output/                 # Product 组件
├─ .runtime/                # Manager 托管的 Bun / tools
├─ .deploy/                 # Manager 状态、锁、staging、生成入口
├─ workspace/               # Workspace Root
├─ config.yaml              # Boot Config
└─ .env
```

逻辑上所有安装形式使用这些路径。容器可以把系统 Runtime 映射为 `provider: container`，不强制为了路径表面一致而复制 Docker 基础镜像中的 Bun、Git 或 Python。

### D2：组件所有权

| 组件 | 主要内容 | 更新权限 |
| --- | --- | --- |
| Source | Git tracked 源码或同版本 Release 源码快照 | Git 或 Release Source installer |
| Product | `.output/` 及 Product 运行 manifest | Product installer |
| Runtime | `.runtime/bun/**` | Runtime manager |
| Toolchain | `.runtime/tools/**`、`.runtime/bin/**` | Tool manager |
| Deployment State | `.deploy/**` | NeuroBook Manager |
| User State | `workspace/**`、`.env`、`config.yaml`、日志 | 用户与应用；Release 更新不得覆盖 |

Product 可以携带完整源码，但必须通过隔离测试证明服务和产品脚本不依赖源码根 `node_modules`。

### D3：独立 npm 包与命令名

- npm package：`@notnotype/neuro-book-manager`。
- executable：`neuro-book`。
- 标准入口：`bunx --bun @notnotype/neuro-book-manager <command>`。
- 安装后由 `.runtime/bin/neuro-book(.cmd)` 提供稳定入口。
- 不保留旧部署 CLI 作为长期兼容层；实施时直接同步 README、部署文档、operator bridge、release 文档和脚本入口。
- Manager package 必须独立声明最小依赖，不能依赖 NeuroBook 应用根包。

### D4：Manager 版本与应用版本解耦

- Manager 使用自己的 semver 和 npm dist-tag：`latest`、`canary`。
- NeuroBook Release manifest 声明 `minManagerVersion`，必要时声明 `maxManagerVersion` 或 manifest schema version。
- 应用版本、Manager 版本、GHCR tag 和 Bun 版本不得假定相同。
- 安装记录必须分别保存这些版本。

### D5：Stage 0

Stage 0 只负责：

1. 检测可用 Bun。
2. 缺失时下载匹配平台/架构的 Bun。
3. 校验 checksum。
4. 调用固定版本或固定 dist-tag 的 Manager。

计划入口：

- Windows PowerShell / CMD 或小型独立启动程序。
- Linux/macOS POSIX shell。
- 已有 Bun：直接使用 `bunx`。
- Windows Portable：包内 Launcher 调用同一个 Manager core，不复制第二套安装逻辑。

### D6：Stage 0 与 Git clone 的非空目录冲突

如果 Stage 0 先把 Bun 写入目标根 `.runtime/`，普通 `git clone <repo> <target>` 会因为目标目录非空失败。这是统一目录设计的第一项实现门禁。

候选方案：

1. Stage 0 先把 Bun 放在系统临时目录或用户级 Manager cache，Source 物化完成后再迁入 Installation Root。
2. Manager 在非空目标根执行 `git init`、设置 remote、fetch 和 checkout，而不是调用 `git clone <target>`。
3. clone 到 sibling staging 目录，再原子迁移 `.git` 和 tracked 文件到 Installation Root。

当前建议采用方案 1 + 2：Stage 0 Runtime 先位于用户级 cache；Installation Root 确定后，Manager 使用可审计的 repository materialize 流程，并按 Profile 决定是否复制为托管 Runtime。最终方案由实现 spike 验证 Windows 文件占用和 Unix rename 行为后确认。

### D7：安装 Profile 是组件来源组合

| Profile | Source | Product | Runtime | Toolchain | Envelope |
| --- | --- | --- | --- | --- | --- |
| source-dev | Git | 无或本地 build | external/managed | system/managed | directory |
| source-product | Git | local build | external/managed | system/managed | directory |
| product-bun | Release | Release | external | optional | archive |
| windows-portable | Release | Release | managed | managed/optional | Windows zip |
| source-docker | Git | local/container build | container | container | directory + OCI runtime |
| ghcr | image 内源码 | image 内 Product | container | container | OCI image |

Profile 只声明需求与来源，下载、校验、安装和状态记录复用统一 component installer。

### D8：Product 是平台/架构相关组件

`.output/server/node_modules` 可能包含 `@libsql`、esbuild、sqlite 扩展等 native optional package。Product artifact 不能默认宣称完全跨平台，应至少按以下维度发布和解析：

- OS：Windows、Linux，后续 macOS。
- architecture：x64，后续 arm64。
- libc：Linux glibc；如支持 Alpine/musl，需要独立 artifact 或明确不支持。

Windows Product 必须继续在 Windows runner 构建；Linux Product/GHCR 在 Linux runner 构建。

### D9：Runtime 与 Toolchain Provider

每个 Runtime/Tool 记录来源：

- `system`：来自宿主 PATH。
- `managed`：由 Manager 下载到 `.runtime`。
- `container`：由 OCI 镜像提供。

第一阶段托管范围建议：

- Bun：必须支持 managed。
- ripgrep：支持 Windows/Linux managed。
- Git：Windows 优先评估 MinGit；Linux/macOS 优先系统包管理器。
- bash：Windows 可随 MinGit 提供，Linux/macOS 使用 system/container。
- Python：第一阶段只检测与给出安装建议，不承诺全平台 managed Python；Windows embeddable Python、pip/venv 和 Linux libc 差异单独评估。

所有第三方 Runtime/Tool 下载必须记录上游 URL、版本、SHA256、许可证和再分发边界。

### D10：统一安装记录

`.deploy/installation.json` 至少记录：

```json
{
    "schemaVersion": 1,
    "profile": "product-bun",
    "managerVersion": "1.0.0",
    "appVersion": "0.8.0",
    "releaseChannel": "stable",
    "components": {
        "source": {"provider": "release", "version": "0.8.0"},
        "product": {"provider": "release", "version": "0.8.0", "platform": "windows-x64"},
        "bun": {"provider": "system", "version": "1.x"}
    }
}
```

具体 schema 在实现前使用 TypeBox 或 Zod 建立严格类型，不能使用 `Record<string, unknown>` 作为组件状态模型。

### D11：事务更新与回滚

Manager 更新必须：

1. 获取 Installation Root 级安装锁。
2. 下载到 `.deploy/staging/<operation-id>`。
3. 校验 manifest、platform、version 和 checksum。
4. 检查 Git dirty state 和运行进程。
5. 只备份本次组件拥有的路径。
6. 切换组件。
7. 执行 migration 和最小启动检查。
8. 成功后提交 installation state；失败则恢复旧组件。

Windows 下不能覆盖正在执行的 Bun 或 Manager 文件。Runtime/Manager 使用版本目录 + 稳定 wrapper，更新只切换 current 指针或下次启动目标。

### D12：Workspace Root 与 Portable 物理数据目录

仓库根底座要求应用可见路径继续是根 `workspace/`、`.env` 和 `config.yaml`。Windows Portable 当前真实状态位于 `data/`，再把 `app/workspace` 映射到 `data/workspace`。

需要在实现前拍板：

- 方案 A：Windows Portable 也把真实用户状态直接放在根 `workspace/`、`.env`、`config.yaml`，通过组件所有权保护更新。
- 方案 B：保留 `data/` 作为物理持久层，根路径通过 junction/wrapper 映射，并在安装 manifest 中声明 physical state root。

当前建议方案 B：保留明确的可备份 `data/` 物理边界，但把它定义为平台存储映射，不改变应用看到的统一逻辑路径。这样升级安全性更高，但目录并非物理完全一致；最终由用户决定。

### D13：Git Source 更新边界

- Manager 不允许对 dirty worktree 自动执行 `git restore`、`reset` 或 stash。
- Git 更新默认使用 `fetch` + fast-forward 检查，确认可前进后再更新。
- `.output`、`.runtime`、`.deploy`、Workspace Root 和本机配置不参与 Git dirty 判断。
- Source update 和 Product update 是两个独立组件操作；源码更新成功但 Product build 失败时，旧 Product 应继续可运行。

### D14：命令范围

第一阶段命令：

```text
neuro-book install
neuro-book update
neuro-book start
neuro-book status
neuro-book doctor
neuro-book runtime list|install|update
neuro-book tools list|install|update|path
```

后续再评估：

```text
stop / restart
rebuild
rollback
admin
self update
uninstall
```

`stop/restart` 必须等进程所有权模型确定后实现，不能假设 Manager 总是拥有用户通过 systemd、Docker、终端或 Windows Launcher 启动的进程。

## Overall Review

### 审查结论

方向成立，而且比继续扩展旧部署 CLI 的 mode 分支更系统。仓库当前 `.gitignore`、Bun-only 产品运行方向和 Product-first 构建已经提供了大部分基础，但不能直接重命名现有 CLI 后继续堆功能；必须先建立组件所有权、Release manifest、版本兼容和事务更新协议。

### 主要风险

1. **Stage 0 非空目录**：先写 `.runtime` 会破坏普通 clone 流程，必须先做 repository materialize spike。
2. **Windows 目录迁移**：现有 `app/data/runtime/launcher` 与新仓库根底座不同，Launcher 更新和 junction 逻辑需要重写，不能局部改路径。
3. **Product 构建平台**：native dependency 使通用 Product Bun artifact 必须按平台/架构发布。
4. **Manager 自更新**：Windows 不能替换当前正在执行的 Bun/Manager，需要版本目录和延迟切换。
5. **版本耦合**：Manager、应用、manifest schema 和 GHCR tag 必须分开记录和验证。
6. **Git 用户改动**：现有部署入口会 restore 某些 generated artifact；新 Manager 必须停止自动修复 tracked 文件，避免覆盖用户修改。
7. **工具再分发**：MinGit、ripgrep、Bun、Python 的许可证、checksum、上游更新和平台差异需要进入组件 metadata。
8. **逻辑统一与物理统一**：Docker system tools、Windows `data/` 和宿主 system Bun 不应为了目录外观一致而重复复制；应统一逻辑合同并显式记录 provider。
9. **现有术语漂移**：`CONTEXT.md`、`reference/workspace/TERMS.md` 和 Task 26 历史段落混合旧 Source Bootstrap 与新 Product Launcher，需要在实施时明确历史记录与当前合同。

### 推荐实施顺序

1. 冻结 Installation Root、component ownership、installation manifest 和 release manifest schema。
2. 新建独立 Manager package，只实现 `status`、`doctor`、root discovery 和 dry-run component resolver。
3. 完成 npm pack / publish canary，验证不会安装 NeuroBook 完整应用依赖树。
4. 实现 Stage 0 + repository materialize spike，覆盖空目录、非空 `.runtime`、已有 Git checkout 和 dirty worktree。
5. 实现 Source + local Product build，先替换 `local-git`。
6. 发布平台化 Product Bun artifact，并接入 Product install/update/rollback。
7. 把 Windows Portable Launcher 改为 Manager frontend，迁移 Runtime 和数据映射。
8. 收敛 Source Docker / GHCR，消除 GHCR 安装时无意义的完整 checkout，或明确 checkout 是用户选择的 Source 组件。
9. 更新稳定文档、标准术语、PROJECT-STATUS 和 Release 流程，删除旧部署入口。

## Verification / Test

已完成：

- `bun run manager:typecheck` 通过。
- `bun run typecheck` 完整应用类型检查通过。
- `bun run manager:test` 通过：8 个测试文件、23 项测试，新增覆盖 Manifest v2、Stage 0 checksum/接管、Operation Journal 恢复、损坏 journal 拒绝和 Release resolver 跳过未装配版本。
- `bun run manager:pack` 通过：npm 包只有 5 个文件，约 249 KB；在空临时目录安装 tarball 后可执行 `neuro-book --version`，依赖声明不包含 Nuxt、Vue、Prisma、TipTap。
- `bun run typecheck` 与 `bun run manager:typecheck` 通过。
- Source archive smoke 通过：只打包当前存在的 Git tracked 文件，不含 `.git`、`node_modules`、`.output` 和用户状态。
- Windows Portable 使用本轮新 `.output` 完成真实组装：Manifest v2、managed Bun、rg、PortableGit、bash 和 Manager wrapper 均通过版本执行检查，生成 `dist/neuro-book-windows-x64.zip`。
- Portable 打包会显式跳过“已从 worktree 删除但仍在索引中”的文件，避免 dirty 重构期间重新混入旧部署实现。
- Release workflow YAML解析通过；`release-assets.ts`与Portable packager bundle通过。候选Source/Product/Portable/Manifest先作为Actions artifact进入verify，只有Linux/Windows验证成功后才由最终publish job上传正式Manifest和SHA256；失败或取消的Release不会被Resolver当作完整版本。
- 全新 `bun run nuxt:build` 通过。无根 `node_modules` 的 Product 隔离 smoke 已覆盖 migration、管理员、system profile、variable CLI、workspace project create、State Root 映射与 HTTP 版本接口。
- Product system profiles 改为 Nitro vendor 完成后以 Product 模式重新编译，避免源码环境 artifact 在无根 `node_modules` 下出现 `compile_stale`。
- Task 105 收口聚焦回归通过：`workspace-assets-product-root`、Profile Catalog、Profile CLI path 与 installation paths 共 4 个测试文件、51 项测试。期间发现 Profile Catalog 测试仍写死 compiler version 6；实现实际已使用公开常量 version 7，现已让测试直接消费 `PROFILE_ARTIFACT_COMPILER_VERSION`，避免后续 compiler contract 升级再次产生同类假失败。
- 首次 Manager canary CI 暴露 `paths.test.ts` 写死 Windows 盘符，Linux runner 会把它解析为相对路径；测试已改用当前平台的 `resolve/join` 表达同一目录合同，本地 Manager 23 项测试复跑通过。
- 第二次 Manager canary CI 的验证已全绿，但 `bun publish` 未消费 `actions/setup-node` 生成的 npm 认证配置；workflow 已切换到标准 `npm publish --workspace`，继续复用 `NODE_AUTH_TOKEN` 和 npm registry 配置。
- 第三次 Manager canary CI 已进入 npm publish，registry 因 token 未启用 bypass 2FA 返回 403；同时 npm 严格校验会移除带 `./` 前缀的 bin 路径，包元数据已改为 `dist/neuro-book.mjs`。继续发布前需要更新具备 package write 权限且允许绕过 2FA 的 granular token。
- Manager `0.1.0-canary.5` 已公开发布并可从npm `canary`安装；typecheck、8个测试文件/23项测试和空目录pack审计通过。npm首次发布遗留的`latest → 0.1.0-canary.4`仍需带OTP删除；canary文档继续使用`@canary`，stable发布前不推荐`@latest`。
- 应用 canary run `29185683743` 的 GHCR 与 Source job 成功，但 Windows/Linux Product 都因源码直接导入却未声明 `h3` 而失败，assemble/verify 随后跳过。根依赖已补 `h3 ^1.15.5`，Product CI 明确统一 hoisted linker；Nitro vendor 复制会解引用 Bun package symlink，并补齐 Product 动态源码所需的 `proper-lockfile`、`pinyin-pro` seeds。
- SSH Arch 实机验证通过：Bun 1.3.14 hoisted 干净安装与 Linux Product build、移走根 `node_modules` 后 migration/start/HTTP、Source Docker 容器内 build/start、公开 GHCR digest pull/revision label/migration/HTTP。Prisma CLI 相对 SQLite URL 曾错误落到 Application Root，现已规范化为 State Root 绝对 URL并增加聚焦测试。
- Manager `0.1.0-canary.5`的Stage 0实机安装使用managed Bun 1.3.14完成Source Dev依赖安装和Nuxt启动；Source Docker也从公开Manager完成容器内frozen install、Product build和容器启动。
- 应用`0.7.4`的Arch验证发现服务器默认鉴权会使Manager版本探针收到HTTP 401，因此主动取消 [workflow 29192059375](https://github.com/notnotype/neuro-book/actions/runs/29192059375)。该Release保持零资产、没有正式Manifest，Resolver会安全跳过。`/api/app/version`现作为只读公共部署探针，其他日志、配置和业务接口仍受鉴权；聚焦middleware测试和完整typecheck通过。修复进入`0.7.5`，仍需公开资产复验。

当前未完成的环境级验收：

- Manager `0.1.0-canary.5`已公开发布；仍需把npm当前误指prerelease的`latest` dist-tag清理，并在稳定版发布时重新建立正确`latest`。
- `0.7.5` Source、Linux Product与GHCR镜像CI已通过，Windows Product、assemble、verify和publish仍在运行；正式Manifest公开后再执行Product Bun、Manager GHCR无宿主checkout安装、admin/update和digest回滚终验。
- Windows Portable 尚未完成交互式 start → 浏览器 → create-admin → restart → update → data 保留终验；本轮不自动执行浏览器验收。

## Implementation Walkthrough

### 2026-07-12：任务建立与第一轮整体审查

- 用户确认独立 npm 包方案，并将 CLI 职责扩展为安装、更新、Runtime 和工具链管理。
- 初步建议的 `app/source` 分层被否决，改为 Git 仓库根作为统一安装底座；这一调整符合直接 `git clone` 的安装路径和 Nuxt 默认 `.output` 构建位置。
- 复查现有实现后，补充 Stage 0 非空目录冲突、Manager/应用版本解耦、native Product 平台矩阵、Windows 运行文件替换、Tool 许可证和 Portable 物理数据目录等门禁。
- 实际结果与最初讨论计划的出入：任务范围从“拆出轻量部署 CLI”扩大为“统一 Installation Root、组件协议、Release manifest、Stage 0、事务更新和现有部署迁移”；这是系统性重构，不适合只对现有 `scripts/deploy` 做增量改名。

### 2026-07-12：Manager、State Root 与发布协议实现

- 在同仓新增独立 workspace package `packages/neuro-book-manager`，包名 `@notnotype/neuro-book-manager`，bin 为 `neuro-book`；实现 install/update/start/status/doctor、Runtime、Tool 和 admin 命令。
- 建立严格 Installation/Release Manifest schema、Profile resolver、平台选择、Release 下载与 SHA256、Git materialize、安装锁、staging、Source/Product 备份和回滚。
- Manager bundle 安装到 `.runtime/manager/<version>`，稳定 wrapper 使用相对 Installation Root；managed Bun/rg/MinGit 使用不可变版本目录，只刷新 `.runtime/bin` wrapper，不修改系统 PATH。
- managed 组件状态补充官方 Source URL、SPDX license 和再分发说明。
- 新增应用 runtime path resolver，`NEURO_BOOK_STATE_ROOT` 统一 Workspace Root、Boot Config、Product Env、SQLite 相对路径和日志；Windows Portable 使用 `data/`，不再使用 `app/workspace` junction。
- Nuxt build 支持 `NEURO_BOOK_OUTPUT_DIR` staging；`product:stage` 不再生成 `product/source`。
- Source Docker 改为完整 Dockerfile 容器内 install/build；GHCR Compose 使用 digest 固定镜像且不要求宿主 Source checkout。
- 新增 Windows/POSIX Stage 0、Manager 独立 release helper/workflow、Source/Product/Portable/manifest 资产脚本和统一应用 Release assemble workflow。
- 删除旧部署 bin、旧 mode 模块、Source runtime Dockerfile、旧 Windows Launcher 更新实现和旧 Product source snapshot。

### 2026-07-12：Portable、事务边界与文档收口

- 修复 Portable 在 dirty index 中复制已删除 tracked 文件导致打包失败的问题；结构 smoke 成功生成 `neuro-book-windows-x64.zip`。
- 修复 Product 首次安装后 migration/健康检查失败时没有旧备份而遗留新 `.output` 的回滚缺口，并增加有/无旧 Product 两类测试。
- 修复 managed Runtime/Tool 同版本更新先删除当前目录的问题，避免网络失败破坏可用 Bun/rg/MinGit，也符合 Windows 不覆盖运行文件的约束。
- 修复 PowerShell Stage 0 的位置参数绑定，确保 `--profile/--dir` 透传给 Manager，而不会被误当作 Manager tag。
- Docker State Root 增加 `logs/` 初始化与持久化挂载。
- 同步 README 中英文、快速开始、部署文档、operator bridge、CONTEXT、Workspace 标准术语、PROJECT-STATUS、RELEASE 和营销草案。

### 实际结果与计划差异

- Manager core、目录合同、State Root 和发布资产已有实现基础；六个 Profile、Stage 0 与发布闭环仍在 Manifest v2 收口中，未达到可发布状态。
- 事务实现已覆盖 Release Source/Product 与不可变 Runtime/Tool 版本目录；通用运行进程探测、完整故障注入矩阵和所有安装阶段的统一 undo journal 尚未达到原计划的完整度，应在应用级 smoke 后继续加固。
- Windows Portable smoke 当前使用仓库已有的旧 `.output` 验证包结构，不能替代停服后用本轮代码新构建 Product 的运行验收。
- macOS、arm64、musl、systemd/pm2 和托管 Python 仍按计划留在 v1 范围外。

### 2026-07-12：Manifest v2、事务状态机与发布门禁收口

- 将 Installation Manifest 硬切 schema v2，组件固定为 `source/product/manager/managerRuntime/applicationRuntime/tools`，并补齐 Profile/provider、SemVer、revision、平台、路径越界和 managed 资产审计校验。
- Operation Journal 也接入严格 TypeBox schema；恢复前会验证嵌套 Installation Manifest、Git revision、受管相对路径和 Git commit point 必需的 next manifest，避免损坏账本直接驱动回滚或提交。
- Manager Host Runtime 与 Application Runtime 分离。Stage 0 把 Bun 路径、版本、来源和 SHA256 传给 Manager，Manager 复验后复制到版本目录；所有 mutating Manager 命令会接管当前 bundle并刷新稳定 wrapper。
- 安装和更新统一接入持久化 Operation Journal。Release Source、Product 和 Compose 明确拆成 stage/validate/switch，Source Product 使用 detached worktree，Git fast-forward 位于 migration/health 之后；原生更新增加端口检查、SQLite WAL checkpoint/备份与 HTTP 版本健康检查。
- Windows Portable 切到 PortableGit，真实执行 Bun/rg/Git/bash 版本门禁；创建管理员后启用 `data/config.yaml` 鉴权并提示重启，启动入口在服务健康后打开浏览器且保持前台窗口。
- Release resolver 会跳过未装配的新 Release，并交叉验证 tag/channel/asset URL/revision/GHCR digest。首次公开 canary 已产生 npm Manager、Source和GHCR，但Product失败导致Release未装配；不能把部分资产发布记录成完整发布通过。
- 实际计划差异：本地 Windows 没有 Docker，但本轮改用 SSH Arch完成Linux Product Bun、Source Docker和公开GHCR runtime smoke；GHCR rollback与最终公开资产verify仍必须等待修复后的完整Release。Bun 1.3.14 在Windows workspace `bun add` 后两次留下不完整hoisted链接，本轮通过完整 frozen hoisted重装恢复，未用显式添加缺失包掩盖问题。

### 2026-07-12：首次应用 Release CI 与 Arch Linux 实机修复

- 首次应用 canary 的 GHCR 和 Source 发布成功，Windows/Linux Product 在 `prepare-system-assets` 阶段同时报告缺少 `h3`。确认应用源码直接消费 `h3`，不能依赖 Nuxt/Nitro 的传递依赖，因此补为根直接依赖。
- Product vendor 原先在 Linux 保留 Bun package symlink，生成的 `.output/server/node_modules` 会指回构建机；现改为复制实体文件，保证移走根 `node_modules` 后 Product 仍独立运行。
- Product runtime 后处理明确以 hoisted linker 为构建合同。Dockerfile、Source Product Manager 路径和 Windows/Linux Product CI 使用同一 linker；不为 isolated linker 重建完整嵌套包管理器布局。
- Arch 实机暴露 Prisma migration 仍按 cwd 解释相对 SQLite URL。`preparePrismaEnv` 现在把相对 `file:` URL 基于 State Root 转为绝对路径后再交给 Prisma，数据库不再错误写入 Application Root。
- 实际结果与计划差异：Linux Product Bun、Source Docker 和公开 GHCR runtime smoke 已提前通过 SSH Arch 实机完成；完整 Release assemble、公开 Product/Portable 资产和 Manager GHCR rollback 仍需新的 canary workflow 终验。

### 2026-07-12：紧急 Patch 发布安全收口

- 审查发现 Product update catch 先直接恢复 Product，随后 Operation Journal 再次恢复，第二次会删除刚恢复的旧 `.output`；现删除调用方重复回滚，Product/Source/SQLite/Compose恢复只由journal负责。
- Source Dev不再硬编码系统`bun`；启动使用Application Runtime。Git fast-forward后在主checkout执行frozen hoisted install，失败会保留journal，下次mutating command先重试依赖安装，不自动reset Git。
- Release assemble只上传候选Actions artifact。Linux/Windows verify成功后，最终publish job才上传正式Manifest、SHA256和应用资产；Resolver仍以正式Manifest作为完整Release标志。
- Windows/POSIX Stage 0固定Bun 1.3.14官方archive与executable checksum，每次复用缓存时同时校验checksum和版本，损坏缓存会整版本重建。
- npm入口文档明确禁止`bunx run @notnotype/neuro-book-manager`，标准形式保持`bunx --bun @notnotype/neuro-book-manager@<tag> <command>`；该错误发生在Manager启动前，只能通过正确入口和发布smoke防止复发。
- 发布后Arch Source Docker实机build/start成功，但默认启用鉴权使Manager访问`/api/app/version`得到401并误判失败。版本接口现作为只读公共部署探针，其他App/日志/配置接口仍受鉴权；新增middleware聚焦测试约束该边界。
- 有缺陷的`0.7.4` workflow在正式Manifest发布前主动取消，GitHub Release保持零资产；随后发布`0.7.5`承载健康探针修复。实际计划差异是紧急patch从一次应用发布扩展为两次canary，目的是保证Resolver永远看不到已知不可用的完整Release。

### 2026-07-12：首次安装引导与多实例 Manager

- `bunx --bun @notnotype/neuro-book-manager@<tag>`无参数入口硬切为Clack安装向导，不再只显示Commander帮助或静默选择Profile。向导解释部署方式，并依次收集Installation Root、实例名称、channel、端口和鉴权，最后展示摘要和下一步命令。
- 新增用户级`~/.neuro-book-manager/config.json`严格schema，只保存安装偏好、实例名称、绝对Installation Root和默认实例。应用版本、组件provider、checksum、Runtime和更新状态不复制到用户配置，仍由每个实例的`.deploy/installation.json`唯一负责。
- 新增`neuro-book manage` blessed TUI以及`instances list/add/forget/default/config`命令。TUI覆盖实例状态、doctor、start、update、新安装、注册、默认选择和忘记索引；忘记操作不会删除Installation Root或用户数据。
- `update/start/status/doctor/runtime/tools/admin`新增全局`--root`与`--instance`选择。未显式指定时先解析当前目录实例，再回退用户配置的默认实例，Manager由此真正具备跨目录管理多个NeuroBook实例的能力。
- blessed顶层入口会动态require全部widgets，Bun表面构建成功但单文件bundle运行时缺失`./widgets/node`。实现没有复制node_modules或外置运行时依赖，而是增加静态widget适配层，只打包TUI真实使用的Screen/Box/List/Question/Prompt，保持`.runtime/manager/<version>/neuro-book.mjs`单文件运行合同。
- 验证结果：Manager typecheck通过；9个测试文件/25项测试通过；npm pack audit生成5文件、约0.33MB压缩包，并在空目录真实安装后运行`--version`、`status --help`、用户配置路径和GHCR安装dry-run。直接执行打包后的CLI也已验证非TTY环境会明确拒绝TUI且不会挂起。
- 实际结果与计划差异：最初只计划增加无参数引导和一个TUI入口；实现审查后补齐了实例索引严格schema、命令级实例选择和配置恢复命令，否则TUI会成为无法被普通CLI复用的第二套实例状态。没有实现后台进程管理、自动发现全盘实例或把installation manifest镜像到用户配置，避免扩大v1范围。

### 2026-07-12：npm Trusted Publisher 实测准备

- 用户已在npm为Manager配置GitHub Trusted Publisher。Manager workflow从`NPM_TOKEN`硬切到GitHub OIDC：job增加`id-token: write`，固定使用支持Trusted Publishing的npm 11.5.1，并通过`npm publish --provenance`发布。
- canary publish job不再尝试删除错误的`latest` dist-tag。Trusted Publisher负责包发布，dist-tag修正属于独立registry管理操作；把两者串在同一job会造成包已成功发布但workflow最终失败的假象。
- 本轮将发布新的Manager canary patch验证OIDC链。成功标准是GitHub Actions无需`NPM_TOKEN`即可发布、npm `canary`指向新版本且包带provenance；历史`latest → 0.1.0-canary.4`仍单独处理，不用它判断Trusted Publisher是否成功。
- `0.1.0-canary.6`首次实测中，OIDC权限、验证和provenance签名均成功，但registry返回隐藏授权失败的404。日志中的临时npmrc和占位`NODE_AUTH_TOKEN`一度被怀疑覆盖OIDC，因此下一canary先移除registry-url以分离变量。
- `0.1.0-canary.7`移除registry-url后变为明确`ENEEDAUTH`。对照npm官方Trusted Publisher故障排查后确认独立Manager package缺少必需的`repository.url`，npm无法把GitHub OIDC身份绑定到`notnotype/neuro-book`。现补齐精确repository URL和workspace directory，并恢复官方推荐的setup-node registry配置；下一canary验证包身份绑定。
- `0.1.0-canary.8`补齐repository后仍返回授权404。用户提供的npm配置截图确认Trusted Publisher额外绑定Environment `npm`，而workflow job没有声明Environment；该字段属于OIDC subject的一部分，必须精确匹配。publish job现增加`environment: npm`，并把repository URL写成npm实际规范化的`git+https`形式，下一canary验证完整身份四元组。
- `0.1.0-canary.9`Trusted Publisher实测成功：[workflow 29197120842](https://github.com/notnotype/neuro-book/actions/runs/29197120842)全绿，无`NPM_TOKEN`完成publish并由npm自动生成provenance。registry侧`canary`已指向`0.1.0-canary.9`，package repository/gitHead/integrity与发布提交一致；公开npm真实执行`--version`和`instances config`通过。
- 实际结论：Trusted Publisher配置必须同时匹配`notnotype / neuro-book / release-manager.yml / environment npm / allow npm publish`，Manager package还必须声明精确repository URL。历史错误`latest → 0.1.0-canary.4`不属于OIDC publish能力，仍按独立dist-tag操作处理。

### 2026-07-13：Installation Manifest v3与Windows发布压缩收口

- Installation Manifest硬切schema v3：Release Source/Product记录`archiveSha256`，Manager记录`bundleSha256`，managed Bun/rg同时记录archive与executable SHA256，PortableGit分别记录archive、Git和Bash SHA256。v2实例明确拒绝，Windows Portable只允许完整复用`data/`后重新安装。
- Fresh Install、应用update、Runtime和Tool维护统一进入Operation Journal。managed组件先在不可变版本目录完成下载、解压、版本与checksum校验，再备份并切换`.runtime/bin`；失败按磁盘journal恢复旧wrapper、manifest并清理本次新建目录。容器Profile会在下载前拒绝宿主管理应用工具。
- `doctor --json`改为稳定的`healthy/checks/paths/service/components/operations`结构，check带category、pass/warn/fail与remediation；Manager、Runtime、Tool使用真实文件checksum验证，Source/Product revision和未完成operation会参与最终healthy。TUI消费结构化结果并显示用户可读列表，不再倾倒整块JSON。
- Windows zip统一使用yazl`addFile`惰性打开文件与Node`pipeline`写入，处理backpressure、close和error，并输出文件计数进度。3500文件回归与真实43,777文件、约367MB Windows Product压缩均正常结束；此前`0.7.5`零资产workflow已取消。
- Windows Portable装配改为显式消费Actions中的Source/Product archive，并把两个公开归档的真实SHA256写入v3 manifest。Windows Product job依赖Source artifact并设置45分钟超时。
- 当前验证：Manager typecheck、9个测试文件/25项测试、npm tarball空目录安装审计通过；真实Source archive（2586文件）与Windows Product archive压缩通过。尚未完成公开Manager canary、应用canary A/B、Arch六Profile和Windows Portable A→B终验，因此Task 105继续保持实现中。

### 实际结果与计划差异

- 本轮没有为尚未正式发布的v2增加迁移层，按计划硬切；Release Manifest仍保持schema v2，因为它与Installation Manifest是不同协议，没有为了版本号表面对齐而制造无意义变更。
- doctor已先收口最关键的本地checksum、revision、wrapper路径和operation健康语义；Docker实际digest/HTTP、Git remote/branch/dirty的完整check仍需在公开A/B资产实机链路中继续补齐和验证，不能提前标记完成。

### 2026-07-13：已有实例发现、接管与上下文入口

- 新增统一只读实例检测Module，识别Manifest v3实例、无Manifest Git checkout、可复用Portable `data/`和普通目录；Git检查覆盖package identity、origin、branch、upstream、revision和dirty，损坏Manifest不会退化成普通checkout。
- 新增有限发现和搜索根配置：默认最多扫描3层，跳过`.git/node_modules/.output/.runtime/.deploy`等目录，Windows按规范化真实路径去重，权限错误转成warning而不是中断全部扫描。
- CLI增加`instances inspect/discover/import/roots`和`adopt`。无参数TTY入口按当前上下文进入管理、接管或部署菜单；非TTY只输出检测结果和推荐命令，没有隐式写入。
- `adopt`只支持source-dev/source-product/source-docker。dirty、未知remote、非法branch/upstream和未知Manager-owned目录会阻断；历史无metadata `.output`不进入Manifest，source-product复用现有安装事务在staged build健康后切换，失败恢复旧Product。
- TUI在无已注册实例时展示有限搜索发现的待接管候选；实际导入或接管仍要求用户明确确认，不自动修改候选目录。
- 验证结果：Manager typecheck通过；10个测试文件/29项测试通过；真实当前dirty checkout正确报告阻断和不可信Product；独立干净Git clone的source-product adopt dry-run无写入；Windows与SSH Arch Source Dev实际接管均完成，Manifest v3、wrapper、实例索引和doctor healthy通过，测试目录已清理。

### 实际结果与计划差异

- 没有增加全盘或HOME无限递归扫描；搜索根和深度保持有限，避免Windows性能、权限和符号链接风险。
- Product可信metadata目前只来自有效Installation Manifest；历史`.output`没有独立revision metadata，因此严格按计划视为不可信，不增加宽松导入或长期warning状态。

### 2026-07-13：实例发现与接管系统性收口

- 将原先同时承担扫描、身份和环境检测的实现拆为Candidate Discovery、Offline Inspection、Instance Import和Source Adoption。Discovery只做廉价身份筛选，其他JavaScript Git仓库不再误报；损坏Manifest稳定返回`invalid-installation`，不会进入部署菜单。
- `discoveryRoots: []`现在明确关闭自动发现。TUI把registered/discovered建模为联合列表并缓存本轮扫描，候选可直接import或以Source Dev adopt，invalid候选只展示remediation。
- Import离线门禁覆盖Manifest、Manager/Runtime/Tool checksum和版本、稳定wrapper目标、Product revision、Compose、State Root与未完成Operation；服务或容器停机只产生warning，`--yes`不能绕过blocker。`instances add`和`instances import`共用同一实现。
- Fresh Install不再接受已有Git checkout；Source Adoption使用独立入口。POSIX继续使用短路径detached worktree；Windows改为从固定revision导出tracked source snapshot，避免Bun linked-worktree误判和复制完整Git对象库。Source Dev先验证staged frozen install再安装主checkout；Source Product在staged source构建并备份SQLite；Source Docker以staged source为context并清理失败镜像。
- Windows实测发现深层worktree加node_modules会触发Filename too long，已改为系统临时目录短路径。Arch实测发现State Root `logs/`会触发提交前dirty门禁，现只在adoption提交点允许明确的Manager-owned untracked路径，并把根`logs/`加入gitignore；tracked修改仍始终阻断。
- SSH Arch实际通过Source Dev、Source Product和Source Docker接管；Product完成migration和HTTP健康，Docker完成容器内build/start/HTTP。Compose在POSIX使用当前UID/GID，避免容器把State Root写成root-owned。测试容器和镜像已清理。

### 实际结果与计划差异

- Windows真实验收推翻了“只需缩短linked worktree路径”的早期判断：Bun 1.3.14在linked worktree首次frozen install不可靠，而`clone --no-hardlinks`会复制本仓库数百MB Git对象。最终Windows adapter改为`git archive`固定revision snapshot，依赖安装继续保持`--frozen-lockfile --no-save --linker hoisted`，不使用retry或非frozen降级。
- 失败重试还暴露Operation已回滚但`.deploy/operations`审计记录和空`.runtime`父目录会被误判为未知状态。Inspection现在只在所有journal均为`committed/rolled-back`且没有未知文件时允许重试；任意损坏、未完成或额外文件仍阻断。
- `bun.lock`已按当前根包和Manager workspace manifests完整重建为hoisted解析图。重建使Nuxt、Prisma、Vitest等按现有semver范围前进；因此补齐`vue-tsc`直接devDependency、把Prisma adapter/client/CLI统一到7.8.0，并通过完整应用typecheck和Product build验证，而不是只接受锁文件生成成功。
- Product vendor审查发现新`tsx`已不再依赖`get-tsconfig`，旧required seed会错误阻断Product；该过期seed已删除，实际Nitro external closure仍由产物扫描补齐。
- Windows Bun 1.3.14还存在稳定复现的嵌套执行缺陷：Bun进程直接spawn `bun install --frozen-lockfile`会误报lock变化，同一命令经PowerShell宿主启动则成功。Manager新增Windows Bun子进程适配器，以环境变量JSON传递参数，避免命令字符串和路径转义；POSIX继续直接执行。新增参数转发和非零退出测试。
- Windows Source Dev真实接管最终通过：staged snapshot和主checkout均完成frozen/no-save/hoisted安装，HEAD保持不变，Git无用户改动，Manifest v3提交，`doctor.healthy=true`。当前门禁为应用typecheck、完整Nuxt/Product build、Manager typecheck、13个测试文件/39项测试和npm tarball空目录审计全绿。
- Windows Source Product随后完成真实接管：staged snapshot内安装和构建、SQLite migration、临时HTTP版本健康检查、Source/Product revision一致性及`doctor.healthy=true`均通过，主checkout HEAD保持不变。该Profile按设计不在根生成`node_modules`。
- 无根`node_modules`前台启动首次暴露Nitro把Windows staged长路径序列化为8.3短路径的情况；旧后处理只匹配当前cwd长路径，因此错误报告“patched 0”并留下`file://C:/Users/NAME~1/.../node_modules`。现改为拒绝并替换所有Windows长/短路径及POSIX绝对node_modules file URL，新增4项跨平台回归；修复后133个文件完成替换，Product无根依赖启动并通过`/api/app/version`。
- 公开发布检查确认`0.7.5`没有形成GitHub Release。失败run `29215886890`的Source、Linux Product、Windows Product/Portable和GHCR job实际均成功，assemble因无筛选下载把Buildx自动`.dockerbuild` artifacts一起合并而失败。workflow现按名称分别下载`source`、`product-linux`和`product-windows`，但仍需新canary发布才能验证最终assemble/verify/publish和A→B。
- TUI接管候选当前默认使用Source Dev；完整Profile选择仍由`neuro-book adopt`的Clack入口承担，避免在blessed中复制第二套复杂安装向导。

### 2026-07-13：部署入口、Portable Launcher与Release verify收口

- 公开用户路径重新分流：Windows普通用户明确下载`neuro-book-windows-x64.zip`，高级用户通过PowerShell Stage 0或bunx进入Manager；Linux不再单列“服务器/Docker”入口，所有部署统一进入Manager，并完整解释六种Profile。
- `install.ps1`、`install.cmd`和`install.sh`成为独立Release候选与正式资产，统一进入`SHA256SUMS`。Release verifier严格拒绝Stage 0脚本缺失、额外checksum条目或文件被篡改，Release Manifest schema保持不变。
- Portable的CMD/PowerShell Start、Update和Create Admin入口迁入Manager唯一Launcher Module。六个脚本只显式传递`--root`并调用Manager命令，安装器与Portable打包器不再复制模板；退出码由CMD/PowerShell完整透传。
- Release run `29229409817`确认Windows Product、Portable和四个托管可执行程序均正常。失败根因是verify job从Portable外部目录直接调用wrapper且未传`--root`，Manager按当前目录查找实例后输出Clack ANSI错误，随后被`ConvertFrom-Json`误判。CI现先检查退出码，再解析JSON，并以外部cwd加显式root验证跨目录合同。
- 首次尝试发布Manager `.12`时，Windows高负载让包含两个真实Git fixture的Discovery集成测试偶发超过Vitest默认5秒，超时中断又导致临时仓库清理EBUSY。隔离复跑2.46秒通过，确认不是Discovery回归；该复杂I/O用例现与其他集成测试一样声明20秒门限，发布脚本未留下commit或tag后再安全重试。
- Manager `0.1.0-canary.12`重试后workflow全绿，npm `canary`已更新且真实`bunx --bun ...@canary --version`返回`.12`。随后创建应用`0.7.7` patch canary并按发布规则使用`--no-watch`返回；新Release workflow在后台运行，不提前把候选资产视为公开完成。

### 2026-07-13：Portable空目录归档与Windows verify修复

- Release run `29236572553`除Windows verify外的Source、Windows/Linux Product、Portable、GHCR和assemble均成功。Windows四个托管程序与Manager命令退出码正常，唯一失败check是`state.logs`：构建stage中的`data/logs/`为空，原ZIP writer只登记普通文件，解压后该目录消失。
- 统一ZIP接口改为严格file/directory联合类型，文件使用`addFile`，目录使用`addEmptyDirectory`；Portable显式归档`data/logs/`，没有用`.gitkeep`污染用户状态，也没有放宽doctor或让只读诊断隐式修复目录。
- Windows verify在`doctor.healthy=false`时会输出全部fail check的id、message和remediation，避免以后只得到笼统的“Portable doctor未通过”。根Vitest配置同时纳入既有Release测试，防止发布门禁测试长期不执行。
- 本机使用现有Source/Product资产重新组装57,738条目的Portable并完整解压。从实例目录外运行wrapper后，Bun 1.3.14、rg 15.1.0、Git 2.55.0、Bash 5.3.15均可执行，`data/logs/`存在，Manager `0.1.0-canary.12`报告`doctor.healthy=true`且0个fail check。

### Portable空目录阶段的实际结果与计划差异

- 原计划只要求新增ZIP空目录回归；实施时发现既有`scripts/release/release-checksums.test.ts`不在根Vitest include内，常规测试不会执行。现只补入既有Release测试目录，没有扩大到新的发布协议或doctor长期能力。
- Manager bundle、Manifest schema和npm接口均未变化，因此没有发布新Manager canary；应用`v0.7.8-canary.20260713.100743Z.f36a8440`继续复用公开的`.12`并已按`--no-watch`启动后台Release链。

### 部署入口阶段的实际结果与计划差异

- 没有把Stage 0脚本加入Release Manifest。它们是用户引导资产，不是Manager需要解析或更新的应用组件；只进入GitHub Release与`SHA256SUMS`可以保持协议边界清晰。
- 没有修改Manager的当前目录发现规则来迎合CI。跨目录调用本来就应使用公开`--root`接口，修复验证命令比让wrapper隐式改变cwd更符合多实例合同。

### 2026-07-13：旧部署入口彻底清理

- 根应用包和运行脚本此前已经删除旧bin；本轮继续清理历史Task、部署契约、Release说明和官网静态包中的旧命令与脚本名，避免用户或Agent从搜索结果复制已失效入口。
- 官网服务器部署卡片改为当前`bunx --bun @notnotype/neuro-book-manager@canary`入口。历史Task继续保留当时的设计与验证结论，但统一以“旧部署CLI（已删除）”表述，不再保留可执行命令。
- 新增Git受管文本回归门禁，扫描文档、脚本、配置和官网静态JavaScript；旧命令名、旧GitHub包地址或同名文件重新进入仓库时测试会失败。

### 2026-07-13：0.7.8 Windows Portable CMD闪退修复

- 公开`0.7.8` Portable的checksum、Manifest v3、Manager、Bun、rg、Git、Bash和doctor均正常；真实双击等价复现确认CMD入口只打印Manager顶层帮助并以0退出，尚未进入migration或Product。
- 根因是`%~dp0`自带尾反斜杠，旧模板把它直接作为带引号的`--root`值传给Bun原生进程，Windows argv解析把后续`start`吞入同一参数。去掉尾分隔符后Manager识别正常；绕过Launcher后migration、Product启动和`/api/app/version`均通过。
- CMD模板现先通过`%~dp0.`解析无尾分隔符的绝对Installation Root，再调用Manager。非零退出时保存原退出码、打印错误并等待用户确认，避免真正的启动错误再次闪退。
- 新增真实`cmd.exe`回归：Start、Update和Create Admin必须分别传递完整子命令，Root不得携带尾分隔符；Manager返回23时Launcher必须显示错误、等待输入并继续返回23。Windows Release verify也会用stub wrapper实际执行三个CMD入口，不再只检查脚本文本。
- 实际结果与原计划一致：没有改变Manager参数协议或把业务逻辑放回Launcher；修复仅收口Windows参数边界和错误可见性。当前按用户要求暂不提交，也未发布新patch。

### 2026-07-13：0.7.8生产白屏与浏览器发布门禁

- 公开Portable的migration、Product进程和`/api/app/version`均正常，但真实Chromium稳定复现空DOM与`ReferenceError: Cannot access 'Jt' before initialization`。交叉检查两个生产Chunk确认它们相互import，根因是`nuxt.config.ts`按包路径强制分组Tiptap/ProseMirror与Studio widgets，破坏了Rollup真实依赖顺序。
- 生产构建已删除全部自定义`manualChunks`，不使用更复杂的包名列表补洞。全新Product构建后，Chromium已看到`.novel-ide-page`，无page error或console error，版本接口与包版本一致。
- 诊断Portable时另发现，安装路径位于名为`workspace`的祖先目录中会让Workspace Root猜测覆盖Manager传入的State Root。现固定“测试Context → 显式运行时Root → 无运行时合同时才推断cwd”的优先级，Project Path仍为`workspace/<project>`，物理目录正确落在`data/workspace`。
- 新增项目自有的`playwright-core`生产Smoke，通过Node+tsx运行（Playwright Node API不交给Bun宿主）。它验证IDE根容器、HTML/JS/CSS资源、page error、应用console error和版本契约；业务API的独立状态码仍由各专项测试负责。
- Windows verify对真实Portable运行migration、Product和Chrome/Edge Smoke；Linux verify用Source archive + Product overlay组装Product Bun并运行同一Smoke。失败时上传服务日志与截图，两个平台通过前不再公开Release资产。

### 白屏阶段的实际结果与计划差异

- 最初计划让Smoke对所有HTTP 4xx/5xx失败。本地真实首启发现Project Session打开期间可出现由业务界面自行恢复的409，它不阻止Vue挂载。最终门禁严格阻断HTML/JS/CSS、page error、应用console error和版本失配，不把生产挂载Smoke扩张成全量业务E2E。
- Playwright Node API在Bun 1.3.14宿主下会稳定挂起，同一脚本由Node 24 + tsx运行正常。因此CI明确使用Node执行，Product应用运行时仍然是Bun，没有改变部署合同。
- 本地完整验证为：应用/Manager typecheck、Manager 14文件42测试、Release/路径聚焦5文件8测试、全新Nuxt Product build、57,787条目Windows Portable组装、Portable doctor和真实Chrome首页挂载均通过。安装根特意放在名为`workspace`的祖先目录下，日志无State Root越界和ESM初始化异常。
- Manager `0.1.0-canary.13`发布workflow `29252645123`全绿，npm与公开bunx均返回`.13`。随后创建应用`v0.7.9-canary.20260713.131204Z.3b064b83`；按发布约定不等待Release Actions，公开资产仍需后续验证。

### 2026-07-13：Docker事务与公开资产最后提交协议

- `0.7.9` Release workflow `29252852294`最终全绿，Source、Windows/Linux Product、Portable、三个Stage 0、Manifest与SHA256SUMS共九个资产已公开；Windows/Linux生产浏览器Smoke均通过，删除“后台构建中”的过期状态。
- Docker更新把Compose切换、容器生命周期、App SQLite备份和Source Docker本地镜像纳入同一Operation Journal。失败与进程中断共用同一回滚实现：停止失败容器、恢复SQLite/WAL、恢复或删除Compose、重启旧digest，并清理未提交镜像。
- Windows Release门禁保留Launcher参数stub测试，同时直接从Portable目录外执行真实`Start Neuro Book.cmd`，由Manager承担migration、前台Product进程和健康启动，再运行Chromium页面Smoke。
- Release发布拆成`publish-payload → verify-public-payload → publish-index`。Source/Product/Portable/Stage 0先公开并从GitHub公开URL重新下载校验；正式Manifest与SHA256SUMS最后上传，因此任一公开Payload损坏都不会形成Manager可安装Release。
- Stage 0文档统一为“可审计的联网引导脚本”：固定Bun资产并运行Manager `@canary`，应用版本由Manager选择最新完整Release；不再承诺离线安装或固定应用Release。
- 实际计划差异：Docker镜像必须在build成功后立即写入Journal，不能等`prepareUpdate()`整体返回，否则后续Manager/Compose准备失败会留下孤儿镜像；实现因此把Journal更新推进到build完成点，并让catch统一重新读取持久化Journal恢复。

## TODO / Follow-ups

- [x] Windows Portable 使用 `data/` State Root，不使用 junction。
- [x] Manager 同仓独立 package、独立版本和 npm 发布。
- [x] Installation/Release Manifest 严格 schema。
- [x] Stage 0 用户 cache Bun、Manager Host Runtime 接管与空目录 Git materialize实现及聚焦测试通过。
- [x] Windows PortableGit/rg/Bun 托管、bash、checksum、wrapper、许可证与再分发记录完成本地组装验证。
- [x] Windows/Linux Product artifact 与 Windows Portable 结构。
- [x] 删除旧部署入口并同步当前部署文档。
- [x] 停止现有服务后重建根 `node_modules`，完成全新 Product build和无根 `node_modules` Product 隔离运行。
- [ ] 使用本轮新 `.output` 完成 Windows Portable start/create-admin/update/data 保留 smoke。
- [ ] Linux Product Bun、Source Docker容器内build和既有公开GHCR runtime smoke已在SSH Arch通过；`0.7.9`完整公开资产verify已通过，仍需下一patch完成Product Bun、Manager GHCR无宿主checkout安装和公开A→B数据保留验收。
- [ ] 增加下载中断、checksum、manifest mismatch、migration、文件占用和健康检查失败的完整故障注入矩阵。
- [x] 实现统一 installation Operation Journal，覆盖 Product、Release Source、Compose、数据库、created paths 与 Git commit point 恢复。
- [x] 公开发布Manager `0.1.0-canary.5`并触发应用`0.7.5` canary；Release资产闭环仍由上方未完成项跟踪。
- [x] 实现无参数Clack安装向导、用户级实例索引、`--root`/`--instance`选择和blessed多实例TUI；仍需随下一Manager版本公开后做真实bunx交互smoke。
