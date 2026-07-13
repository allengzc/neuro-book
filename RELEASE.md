# Release Notes

## Unreleased：Pi 运行时升级与统一安装管理

- Pi Models / Agent Runtime 升级到 `0.80.6`，模型解析改为显式 `Models` runtime；内置 Provider、本地多连接和自定义 OpenAI-compatible Provider 不再依赖全局注册表，冻结的 session、sidecar 与 compaction 会复用同一运行时连接，避免配置串线或执行途中漂移。
- 模型能力补齐 `max` thinking、分层价格 `cost.tiers` 与可生效的 request options。设置界面支持逐层价格编辑、重复阈值校验和完整覆盖；长上下文费用计算、Catalog、Config、Session、Profile 与中英文界面共用同一合同。
- Provider 错误新增统一清洗边界，覆盖 trace、健康检查、Harness、session、compaction 和最终 Assistant 消息；敏感文本会脱敏并限制长度，同时保留必要的 usage、reasoning 与 cache 统计。

- 新增独立轻量包 `@notnotype/neuro-book-manager` 和统一 `neuro-book` 命令，覆盖安装、更新、启动、状态、诊断、Bun Runtime、rg/PortableGit/bash 工具与管理员创建。npm 包只包含 Manager bundle，不携带 Nuxt、Vue、Prisma 等应用依赖。
- Git 仓库根成为统一 Installation Root；Source、`.output`、`.runtime` 和 `.deploy` 按组件分层。Windows Portable 不再使用 `app/` Product Root 或 junction，完整源码与 `.output` 位于根目录，用户状态稳定保存在 `data/`。
- 新增 `NEURO_BOOK_STATE_ROOT`，统一 Workspace Root、Boot Config、Product `.env`、SQLite 相对路径和日志目录。普通安装默认使用根状态，Windows Portable 使用 `data/`。
- Installation Manifest 硬切 v2，分开记录 Manager Host Runtime 与 Application Runtime。安装、更新和崩溃恢复共用持久化 Operation Journal；Release Source/Product/Compose 先 staging/validate 再切换，Source Product 在 detached worktree 构建，原生更新会备份 SQLite 并执行 HTTP 版本健康检查。
- Product build 支持 `NEURO_BOOK_OUTPUT_DIR` staging，源码更新与 Product 切换解耦；Product system profiles 会在 Nitro vendor 完成后以 Product 模式重新编译，确保无根 `node_modules` 时仍能加载。
- Source Docker 改为 Dockerfile 多阶段容器内安装与构建；GHCR 安装不再 clone 宿主源码，而是使用 Release Manifest 固定镜像 digest。
- Release 新增 Source、Windows/Linux Product、Windows Portable、统一 `release-manifest.json` 和 `SHA256SUMS`；Manager 使用独立 `manager-v*` tag 与 npm stable/canary 发布流程。
- 首次应用 canary 发布后修复了三项真实部署问题：应用直接使用的 `h3` 现在显式声明；Product vendor 不再保留指向构建机的 Bun package symlink；Prisma CLI 会把相对 SQLite URL 基于 State Root 转为绝对路径。Windows/Linux Product CI 与 Docker/Manager Source Product 统一使用 hoisted linker合同。
- 紧急发布补丁进一步修复 Product 更新失败时重复回滚可能删除已恢复 `.output` 的问题；回滚所有权现在只属于 Operation Journal。Source Dev 启动使用 Manifest 中的 Application Runtime，更新完成后执行 frozen依赖安装，失败时保留可恢复journal。
- Release资产先作为候选Actions artifact完成Linux/Windows验证，只有验证全绿后才把正式 `release-manifest.json` 和校验文件上传到GitHub Release，避免失败Release被Manager识别为可安装版本。Stage 0每次复用缓存Bun都会校验固定官方checksum和版本，损坏缓存会重新下载。
- Manager正确入口是 `bunx --bun @notnotype/neuro-book-manager@canary <command>`；`bunx run @notnotype/neuro-book-manager` 会被Bun按本地脚本或路径解析，不能启动Manager。
- Manager无参数启动现在进入完整Clack安装向导，并在安装成功后把实例注册到`~/.neuro-book-manager/config.json`。新增`neuro-book manage` blessed多实例TUI、`instances`索引命令，以及跨目录操作的`--root`/`--instance`选择；用户级配置只保存偏好和目录索引，不复制实例部署状态。
- Manager npm发布改用GitHub Actions Trusted Publisher：workflow申请`id-token: write`并执行带provenance的无token发布，不再读取`NPM_TOKEN`。npm dist-tag修正不混入OIDC publish job，避免包已发布后因额外registry写操作让workflow误报失败。
- Trusted Publisher前两次实测把问题收敛到包身份元数据：Manager workspace package缺少`repository.url`，npm无法把GitHub OIDC身份绑定到目标包。现补齐精确仓库URL和workspace directory，并按npm官方示例使用checkout/setup-node v6、registry-url和最新npm CLI。
- npm配置截图确认Trusted Publisher绑定了GitHub Environment `npm`；此前workflow job未声明该Environment，OIDC subject因此无法匹配并返回隐藏授权失败的404。Manager publish job现显式使用`environment: npm`，repository URL也改为npm规范化的`git+https`形式。
- Manager `0.1.0-canary.9`已通过GitHub Trusted Publisher无token发布，workflow全绿并生成npm provenance；公开npm `canary`已指向该版本，真实`bunx --bun ...@canary --version`与用户配置命令通过。历史`latest → 0.1.0-canary.4`仍需独立dist-tag管理，不影响OIDC发布链结论。
- Docker实机验证发现服务器默认鉴权会让Manager版本健康检查收到401；`/api/app/version`现作为只读公共部署探针，不开放日志、配置或业务数据接口，Source Docker与GHCR可在启用鉴权时完成安装和更新健康检查。
- 本轮已通过完整应用与Manager typecheck、23项Manager测试、npm tarball空目录审计、Windows Portable组装，以及Release/Portable脚本和workflow YAML校验。SSH Arch进一步通过Stage 0 managed Bun 1.3.14的Source Dev安装/启动、Linux Product无根依赖运行、Source Docker容器内install/build/start和既有公开GHCR digest smoke。应用`0.7.4`因鉴权健康探针401在正式资产发布前主动取消且保持零资产；修复后的`0.7.5` Source、Linux Product和GHCR镜像CI已通过，Windows Product、assemble、verify和最终publish仍以Actions结果为准，不能提前视为完整Release。

## 0.7.2-canary - 2026-07-11

这次 patch 集中收口 Agent Profile 的通用运行设置、自动摘要、Workspace 语义和发布产物一致性，同时修复 Markdown 编辑器的若干边界问题，并降低 llmlint 自动改写风险。

1. Agent 通用运行策略统一
Summarizer、Compaction 和单文件 diff 上限现在由 Harness 统一解析。设置支持 Global 通用默认、Global Profile 覆盖、Project 通用默认和 Project Profile 覆盖；Profile 源码只通过 `runtimeDefaults` 提供更低优先级的出厂策略。复杂策略按字段继承，trigger 与 keep-recent 等判别联合整体替换。手动 `/summarize` 和 compact 即使自动开关关闭也会使用最终策略强制执行；summarizer system session 不递归摘要并默认关闭 Compaction。

设置审查轮进一步修复了仅修改通用 runtime defaults 时无法保存的问题。空白字段明确表示继承，非法非空输入会在对应字段下报错而不会静默删除覆盖；界面会标明继承值来自 Harness、Profile、Global 或 Project 的哪一层。Profile 源码默认值与 Config 保存值现共用同一严格 schema。

2. Profile Workbench 公开表面进一步简化
`FileChangeNotice` 节点只保留 `mode`，单文件 diff 预算不再经过 Profile settings 或 turn plan，而是在 Harness 物化 notice 时注入最终 runtime 值。Variable 系统的运行时能力、`ctx.vars`、definition artifact 和全局工具仍然保留，但 `Variable` / `VariableSchema` TSX helper、`builtin.variable` Profile 绑定和 Workbench 变量插入暂时下线，减少 Profile 作者面对的重复入口。

发布前同时修复了 Profile settings fallback 的优先级回归：直接调用 Profile prepare 时，用户设置现在稳定覆盖表单默认值；`leader.assets` 的“最高优先级置顶提示词”不会再被空默认值覆盖。运行策略已经与 `settingsForm` 完全分层，不再需要 diff 保留键或 prepare fallback 补值。

3. Agent 文件提醒和 Workspace 语义更准确
文件变更 notice 改为英文 Git 风格状态，能区分 added、modified、deleted、renamed、restored 和 reverted，并继续保留 hunk、diff 统计、安全阻断、预算与 at-least-once 游标语义。敏感路径即使超出前四个 diff detail，也只显示不可点击路径与 file change inbox 指引，不会通过通用 footer 建议 Agent 主动读取。Reminder 状态分离“已观察值”和“实际注入轮次”，空 linked agents 不再产生空提醒，清空后重新关联同一 Agent 仍能再次通知。文档与提示词明确：Current Project Workspace 只是默认焦点，不是访问边界；普通 Agent cwd 始终是 Workspace Root。

4. Markdown 方言和模式切换更稳
`StructuredTextEditor` 在 rich/source 模式切换前同步结算两个编辑器的防抖输入，修复 300ms 窗口内切换可能丢失末尾输入的问题。Markdown 方言扩展组改为真实编辑器与测试共用的单一来源；HTML fallback 使用真实配对闭合判据，规范化规则与 tokenizer 保持同构；Inline AI 引用高亮的全文文本映射改为每轮只构建一次，避免随引用数量重复扫描全文。

5. Portable Profile artifacts 发布校验加强
`profile status` 发现 `compile_stale` 时会返回非零退出码。Product staging 会按 manifest 当前引用清理隔离副本中的历史 Profile artifacts，并同时校验 artifact / type artifact 是否存在、是否携带构建机绝对路径；Windows Portable 使用同一套 manifest 归一化规则，兼容数组与按 Profile key 索引的序列化形态。

6. 鉴权配置迁移到 Boot Config
`auth.enabled` 从可热更新的 Global Config 移到启动期 `config.yaml`。服务器部署默认开启、Windows Portable 默认关闭；创建管理员后会更新 Boot Config，并在重启后生效。管理员 API 统一使用同一守卫，鉴权关闭时本地放行；非法 Boot Config 会明确失败，不再静默伪装成默认值。

7. llmlint 自动修复权限更保守
默认规则集只保留 3 条无需语境判断的机械规则为 `fixability:auto`，不默认启用 candidate，其余规则均为 manual。规则带有 `action.replace` 只表示存在替换模板，不再隐含允许自动应用；最终是否可自动或候选修复，统一以配置合并后的 `fixability` 为准。

8. Profile 设置合并与旧 artifact 升级修复
Profile 直接 prepare 的默认设置遵循“表单默认值 < 调用方设置”，通用文件 diff 预算只补缺失项，不再覆盖用户已有设置。Profile 核心 helper 的语义变化会通过 compilerVersion 7 强制旧 bundle 失效重编，避免状态显示 loaded 但实际仍执行旧设置合并逻辑。

本轮发布前执行全仓类型检查，并覆盖 Profile / Harness / Config、Markdown 方言、Portable manifest、llmlint 与相关契约测试。浏览器验收未自动执行，建议重点手动检查普通 Profile 的自动摘要开关、StructuredTextEditor 快速切换模式，以及 Profile Workbench 精简后的编辑流程。

## 0.7.1-canary - 2026-07-10

这次 patch 是 0.7.0 canary 的验收与契约同步版，不新增业务代码，主要补齐 Agent 文件变更收件箱的最终验证结果和公开行为说明。

1. 文件历史操作的并发边界正式确认
Inbox 与每个变更组都以 revision 作为版本前置条件。读取 diff、接受、回退和接受全部时如果页面持有的是旧版本，服务端统一返回 412 并要求刷新，不会对已经变化的文件版本继续读取或执行操作。

2. 旧请求不会污染新项目或新版本
Composer 与完整 History Dialog 的 diff 请求按 `projectPath + path + revision + mode` 隔离。切换项目、刷新 Inbox 或卸载组件时会取消旧请求；延迟返回的旧项目、旧 revision 响应不会覆盖当前界面。

3. 敏感文件与 Agent 提示词预算说明补齐
敏感路径黑名单明确覆盖 `.ssh`、`.aws`、`.azure`、`.kube`、`.docker`、`.gnupg`、所有 `.env` 变体、常见凭据文件及私钥格式，并在读取 snapshot 正文前阻断。Agent 文件变更提醒最多展开 4 个文件详情、逐项列出 50 个文件，inline diff 总额最多 8192 字符，最终 notice 不超过 12,288 字符；Profile 只能收紧单文件预算，不能放宽系统上限。

4. 删除文件与大批量变更行为明确
已删除文件不会生成指向当前路径的无效链接；小型删除可展示 removed diff，超限时引导用户到文件变更收件箱审查或还原。文件超过逐项上限时会给出准确遗漏数量，并在成功交付后推进全部已见变更的游标，避免大批量改动反复提醒。

5. 浏览器终验完成
已在真实 Project 中验证收件箱默认收起、展开动画、滚动行为、同名子目录文件打开、Agent 模式自动展开 Studio、小型 diff、`.envrc` 正文阻断、旧响应隔离，以及 accept / revert / accept-all 的 412 刷新行为；验收产生的临时文件已清理并恢复原 Inbox 基线。

本轮发布前重新运行全仓类型检查和完整 Vitest。全套并发运行中，计时敏感的 Profile / Harness / Workspace Files 套件在负载下出现固定超时；所有受影响文件随后串行复跑并全部通过（5 files / 316 tests），未发现稳定业务失败。浏览器验收沿用 Task 102 已完成的真实终验记录，不重复自动启动浏览器。

## 0.7.0-canary - 2026-07-10

这次 minor canary 重点改善长篇写作时的编辑性能、Agent 文件变更审查和 Plot 规划体验，同时完成许可证迁移与一批运行时安全收口。

1. Markdown Studio 长文输入更流畅
富文本与源码编辑器统一使用防抖更新协议，输入过程中不再每次按键都触发多轮全文序列化、扫描和隐藏编辑器同步。切换文件、保存、磁盘同步和外部工具改写前会先结算待提交输入，并抑制自己保存产生的 watcher 回声，降低长章节卡顿和文本被旧磁盘内容覆盖的风险。

2. Markdown 方言能力扩展
评论统一为 `<comment>`，同时支持行内评论和跨段落评论块；新增 `<ruby>` 注音、`<bilingual>` 双语对照和显式 `<html>` 交互块。未知 HTML 默认只保留源码，不直接执行；显式 HTML 块需要用户点击后才在 sandbox iframe 中渲染。空文档、残缺标签和混合 Markdown 的 round-trip 也增加了回归保护。

3. Agent 文件变更收件箱
Agent 输入区上方新增默认收起的文件变更卡片，可查看 Project Workspace 相对路径、小型安全 diff，并执行单文件接受或接受全部；完整 Monaco 审查 Dialog 继续保留。`.env`、凭据、私钥、证书和 `.ssh` 等敏感路径在服务端读取正文前就会被阻断，大型或二进制变更只返回统计与文件引用。

4. Profile 提示词顺序与变更感知收口
Provider 消息顺序固定为 `History → ModelContext → AppendingSet → CurrentUserInput`，真实用户输入不再被 Writer 或 Inline Editor 重复复制。文件变更提醒改由 Profile DSL 的 `<FileChangeNotice />` 显式声明：Leader 使用完整模式、Writer 使用精简模式、Inline Editor 默认关闭；只有提醒成功进入模型后才推进游标，失败会在后续回合重试。

5. Plot 规划工作台更完整
剧本工作台收敛为线程规划、承诺账本和决策记录三个真实页面。承诺可查看铺垫/升级/兑现时间线并执行兑现、放弃、重开；决策可记录候选方案、风险、拍板理由和失效原因。Scene / Thread 编辑补齐结果类型、节奏职责与 MICE 类型，引用候选改接 Project Workspace 真实内容节点，相关刷新和错误展示也做了修正。

6. Project 生命周期与操作历史继续硬化
Project 数据面入口进一步统一要求显式打开项目，RAG、Profile Home、配置和相关 worker 路径补齐生命周期守卫。Workspace History 的安全 diff、收件箱查询、接受/回退和 Agent notice 共用同一套服务端策略，减少不同入口各自解释历史数据造成的偏差。

7. 许可证迁移到 AGPLv3
NeuroBook 与内置 llmlint snapshot 的许可证统一为 `AGPL-3.0-only`，README、manifest 和官网文案同步更新。第三方写作参考、本地文风素材和旧致谢文件不再进入 Git 或 Product source snapshot；用户用 NeuroBook 创作的独立作品不会仅因使用本软件而自动适用 AGPL。

8. llmlint 与交互细节更新
内置 llmlint snapshot 同步规则注册和修复能力更新；Profile Template、Plot 编辑器、文件历史、API 错误消息与中英文文案也完成了一轮一致性修整。

本轮自动化验证覆盖 Markdown 方言与空文档回归、Workspace History、Agent tools、Profile DSL / prompt 顺序、Plot 服务和全仓类型检查；各任务记录中的聚焦套件均已通过。浏览器交互未自动执行，发布后建议重点手动验收长章节连续输入、Markdown 新方言、Agent 收件箱小 diff / 敏感文件阻断、Profile 提示词行为，以及 Plot 承诺和决策工作台。

## 0.5.7-canary - 2026-07-06

这次 canary 主要是写作工作台体验、Plot/Writer 架构、Agent 可观测性和主题系统的一轮大更新。

1. Agent 请求可观测性
新增 Pi 请求 trace 记录与查看器。Agent 主 turn、sidecar、compaction 的 provider 请求会记录模型、usage、耗时、TTFT、规范化 context 和原生 payload；IDE 顶栏新增 Trace 入口，可按最近请求、session 或 system scope 查看详情。Trace 默认不进入可分享日志包，避免泄露 prompt 与正文。

2. Plot 升级为两棵树
Plot 从 Scene-only 进一步升级为承载树和因果树：Story -> Act -> Chapter -> Prose，以及 Story -> Phase -> Thread -> Scene。Scene 通过 `chapterId` 与 Chapter 交汇，ChapterBrief 成为 `StoryChapter` 的一等字段组，用于保存章节目标、POV、信息控制、节奏、开头收尾和禁写事项。

3. Writer brief 更结构化
writer 的章节 brief 改为基于 StoryChapter / Scene / World Engine 上下文编译，支持 autonomous 模式下的 Plot 只读工具和 ChapterBrief 信息控制。原 Task 80 ChapterOverride 已被 ChapterBrief 吸收并归档。

4. Plot 前端工作台迁移
Plot 面板从 manuscript 文件树派生章节，迁移为使用 StoryChapter 实体。新增章节编辑、ChapterBrief 表单、章节管理条、新建卷对话框和 Prose 关联视图。新 UI 还未做浏览器验收。

5. 主题系统 v2.1 与自定义主题
主题变量收口到 36 个 v2.1 token，8 套内置主题保留，World Engine / Agent / Markdown / diff / settings 等入口同步改用语义变量。设置页新增自定义主题编辑器，支持实时预览、核心调色、全变量编辑、重新生成、JSON 导入导出和取色器。浏览器全流程验证仍待执行。

6. Workshop 平台推进
`nb-workshop` sibling 仓完成 Phase 1 后端、Web 前端和友好上传流程：浏览、详情、发布、个人页、admin、邀请码、评论/点赞/收藏/举报、zip manifest 校验与在线编辑打包均已记录到 Task 88。NeuroBook 客户端安装闭环仍是后续 Phase 2。

7. Agent 模式系统准备
新增 normal / discuss / plan 三模式设计与相关前后端改造基础，目标是把“只读讨论”“只读计划”“正常执行”明确分开，并让只读模式下的写操作走用户审批。该系统仍以 Task 90 的后续实现和验证为准。

8. 其他体验与文档
Markdown Studio、Agent 气泡、Profile Template Editor、设置页、低代码表单、World Engine Workbench、参考文档和主题规范都有一轮 UI 与契约同步。

本轮验证主要来自各任务记录：Task 86 后端/reader/view-model/guard 单测与真实 provider smoke，Task 87 backend plot/profile/API 测试和 typecheck，Task 88 sibling 仓 typecheck/test/build，Task 89 聚焦主题测试与 OpenAPI 生成。部分前端新 UI 尚未浏览器验证，release 后建议重点手动验收 Trace 查看器、Plot ChapterBrief 编辑器、自定义主题编辑器和 Workshop 客户端后续接入路径。

## 0.5.6-canary - 2026-07-03

这次修复 GHCR 部署和管理员创建链路，重点是让安装器、镜像版本和 Product Runtime 合同重新对齐。

1. GHCR 部署可以选择 release 版本
`neuro-book-deploy --deploy-mode ghcr` 会在交互模式列出 stable / canary / alpha / beta / rc 版本，并保留 release tag 原始大小写。非交互模式默认使用当前安装器版本对应的镜像 tag，不再让 canary 安装器默认拉旧的 `latest`。`latest` 只代表最新 stable。

2. 管理员脚本不再误走宿主机源码
文档和部署 README 会按 local-git、ghcr、source Docker 分别给出管理员创建命令。ghcr 使用容器内 `.output/server/scripts/cli/create-admin.ts`，依赖镜像内 Nitro vendor 和打包好的 `nbook` runtime package。

3. Prisma Client 缺失时行为更清楚
local-git / source 源码运行时如果缺少 `server/generated/prisma/client.ts`，CLI 会先自动执行 Prisma generate。Product / GHCR 运行时不会在运行机生成 Prisma Client，而是检查 `.output/server/node_modules/nbook/server/generated/prisma/client.ts`，缺失时直接提示拉取匹配镜像或重新构建。

4. 构建门禁补齐 Product 运行文件
Nuxt/Nitro 后处理和 Product staging 都会检查管理员脚本、`has-users`、Prisma preflight、SQLite migration、Prisma schema/config 和打包后的 Prisma Client，避免镜像发布后才发现运行文件缺失。

5. 源码管理员命令缺依赖时提示更明确
local-git / source 管理员脚本在自动补 Prisma Client 前会先确认本地 Nuxt CLI 是否存在；即使 `.nuxt/tsconfig.json` 残留，只要源码依赖没有安装，也会直接提示先 `bun install --frozen-lockfile`，并提醒 ghcr 用户改用容器内 Product 脚本。`nuxt:prepare` 失败和 Prisma generate 失败也会分开报告，不再误导为同一个错误。

6. World Engine 配置加载不再依赖项目目录临时模块
`calendar.ts` 与 `schema/index.ts` 仍保持单文件 TypeScript 配置入口，但转译后的 `.mjs` 现在会进入统一 runtime artifact cache 后再导入。Project Workspace 下的 `.world-engine-*.mjs` 只作为短暂中转文件，避免 Product / Agent 环境在加载时误把被清理的临时文件当成根因。

本轮已验证管理员脚本最小复现、源码缺 Nuxt CLI 提示、残留 `.nuxt` 但缺依赖提示、GHCR dry-run、GHCR tag dry-run、World Engine 用户配置 smoke、Product runtime smoke、`bun run nuxt:build` 和 `bun run product:stage`。Docker smoke 因当前本机没有 `docker` 命令未执行。

## 0.5.3-canary - 2026-07-01

这次 patch 继续修产品运行时加载和 llmlint 工程结构，适合在 0.5.2 canary 基础上验证。

1. Product / Nitro 动态 artifact 加载更稳
新增服务端内部 `importRuntimeArtifact()`，让运行时生成的 `.mjs` 文件通过原生动态 import 加载，避免 Product/Nitro bundle 接管 `import(variable)` 后无法解析运行时文件路径。World Engine schema/calendar、profile compiled artifact 和 variable definition artifact 都改走同一入口。

2. World Engine 配置加载继续收口
`calendar.ts` / `schema/index.ts` 仍先转译为 hash `.mjs`，再通过新的 runtime artifact import 加载。这样既保留 TypeScript 配置入口，也避免产品包里动态生成模块被打包器解析路径误伤。

3. llmlint 切到 sibling 独立开发仓
llmlint 真相源改为 sibling `../llmlint` 仓库；NeuroBook 内的 `assets/workspace/.nbook/agent/skills/llmlint/` 现在只是 `../llmlint/skill` 的 runtime snapshot。新增同步脚本把 skill 镜像回 NeuroBook，并清理旧嵌套 `.git`、`node_modules`、`evals` 和 `.gitignore`。

4. user-assets 同步更干净
真实用户 runtime 副本会硬切清理 llmlint 旧开发资产，避免把仓库元数据、依赖目录或评测语料同步进用户 workspace。

5. llmlint 评测指标口径修复
eval harness 的文档负担分数改用去重 span / 千字，AI 检测器 AUC 和模型排名不再被同一句多规则重复命中放大；报告也补上人类侧 Agent 桶误杀率。

6. llmlint 规则与测试去 scratch 化
curated import 测试改用最小 fixture，不再依赖旧临时规则样本目录；规则文档也把历史 scratch 路径改成稳定描述。内置规则文件同步了本轮从 sibling 仓镜像回来的最新 snapshot。

验证记录来自对应任务：runtime artifact import 覆盖了 helper 单测、World Engine、profile、variable definition、Nuxt build、product stage 和 staged Product smoke；llmlint sibling 仓迁移记录了独立仓测试、同步脚本、user-assets 清理和 runtime 副本检查；eval harness 记录了 fixture 与真实小样本指标重跑。本次发布不等待 GitHub Actions release workflow。

## 0.5.2-canary - 2026-07-01

这次 patch 主要修产品运行时兼容性和 llmlint 文档口径，适合继续在 0.5.1 canary 基础上验证。

1. World Engine 配置加载更稳
`calendar.ts` 与 `schema/index.ts` 仍保持 TypeScript 入口，但运行时会先转译成内容 hash `.mjs` 再导入，不再依赖宿主环境能直接动态导入 `.ts` 文件。Product runtime 也会带上 `nbook/world-engine/schema` helper，避免产品包里解析 schema helper 失败。

2. 临时模块清理更完整
World Engine loader 会清理旧 `.world-engine-*.ts` 与新 `.world-engine-*.mjs` 临时文件，减少异常中断后残留文件影响后续加载的可能。

3. Agent 结构化提问面板更宽松
Agent pending user input 的结构化问题区域高度上调，选项和说明较多时不容易显得拥挤。

4. llmlint 安装与运行说明更准确
llmlint 文档改为推荐通过 `skills` CLI 安装，并明确运行时是 Bun 原生或 Node + `tsx`；裸 Node 直接运行 TypeScript 源码不是支持路径。`fix` 命令、`fixability:auto` 和自动修复说明也同步到当前实现。

5. llmlint 发布模型说明收口
文档澄清 `assets/workspace/.nbook/agent/skills/llmlint` 既是 NeuroBook vendored runtime snapshot，也是 llmlint 独立发布仓的就地嵌套 git 工作区；早期 `.agent/workspace/llmlint` 只是废弃 scratch 克隆。

6. llmlint eval harness 跑出首轮真实 lift
评测生成侧已经能用真实模型从 brief 生成 render，并跑出第一张 AI vs 人类文本判别报告。小样本显示 ROC-AUC 1.000，deepseek-v4-flash 在当前样本上比 mimo 更接近人类文本；该结果只作为 M3 扩量前的方向性验证。

验证记录来自对应任务：World Engine loader 增加了 TS-only schema、`nbook/world-engine/schema` helper 和临时模块清理测试；llmlint 文档收口记录了 Bun、Node+tsx、裸 Node 三态验证，以及 skill/assets 双拷贝一致性检查；eval harness 记录了模型 smoke、brief/render 生成和首轮 lift 报告。本次发布不等待 GitHub Actions release workflow。

## 0.5.1-canary - 2026-06-30

这次 patch 主要是性能和工具体验打磨，适合在 0.5.0 canary 的基础上继续验证。

1. 项目列表速度优化
`/api/projects` 增加了 5 秒短缓存和分层统计缓存。Novel IDE 主入口不再发会绕过缓存的 include-only 查询，项目列表热请求可以直接命中缓存；接口也加了 `Server-Timing` 分段，方便之后继续定位慢点。

2. 项目列表后台预热
服务启动后会后台渐进预热 Project manifest、Agent session count 和单项目统计缓存，不阻塞服务启动，也不会把第一个真实请求绑进全量预热。

3. llmlint 命令行更像一个真正的稿件工具
`llmlint check/fix` 支持 tinyglobby glob 输入，例如 `manuscript/**/*.md` 和 `!drafts/**`；输出在终端下会有颜色，在 JSON、管道或 Agent 抓取时保持纯文本。

4. llmlint 依赖自包含
llmlint skill 目录声明并安装自己的运行依赖，部署副本也能直接解析 `tinyglobby` / `picocolors`，减少产品环境里“根依赖碰巧存在”的隐患。

5. llmlint 评测体系进入第一阶段
评测 harness 的消费侧和数据获取文档已落地：支持 reference / brief / rendition / plot group 这套语料合同，后续可以用 AI vs 人类配对 lift、检测器 AUC 和模型“最像人类”排名来治理规则质量。

6. 文档与发布纪律
`AGENTS.md` 已补充发布流程：发布前读 tasks、更新 `RELEASE.md`，canary 发布命令统一带 `--no-watch`，创建 GitHub Release 后不再等待 GitHub Actions。

验证记录来自对应任务：Task 83 记录了 5 files / 19 tests passed 与 typecheck passed；Task 77 记录了 llmlint CLI、glob、颜色、自包含依赖和 user-assets 同步验证；Task 82 记录了 M1 consumer/acquisition 的 fixture 自检与 reference 输入策略。本次发布不等待 GitHub Actions release workflow。

## 0.5.0-canary - 2026-06-30

这次更新是"写作模式"第一版的收尾，把剧情系统、世界设定、AI 助手、AI 痕迹检测工具这几块核心功能做稳定了。

1. 剧情系统大幅简化
以前写剧情要进一个单独的界面，现在直接在正常写作界面里就能写。剧情结构也砍简单了——只保留"场景（Scene）"这一个概念，原来那套"故事线 /
剧情节拍"废弃了。每个场景靠"什么时间、在哪、有谁出场"跟世界设定挂钩。

2. 场景能联动世界设定了
写场景时能直接查到对应的世界设定和角色当时的状态。剧情工作台加了新功能：编辑场景与设定的关联、选角色/地点、看上下文。AI
也能拿到"这一章该怎么写"的简报。

3. AI 助手的配置更可靠
配置编译后的存储方式改了，保证绝不会用到过期或编译失败的旧配置。设置页能看到编译状态，而且这套机制不再拖慢编辑器。

4. AI 助手的工具交互更顺
"AI 向你提问"的功能独立成了专门的问答机制。读文件、改文件、审批、计划模式这些操作在中断后能更好地恢复，还加了行号定位和预检查。

5. llmlint（AI 痕迹检测工具）增强
- 检测规则从目录里自动加载，新增了整篇稿件级别的检测
- 命令行能扫多文件/整个目录，能自动修掉零宽字符、重复标点这类"一看就是 AI 写的"机械痕迹
- 搭好了单独发布到 GitHub 的骨架（独立命令行工具 + Agent Skill）
- 设计完了一套评测方法：拿 AI 写的和人写的对比，看检测器能不能区分、哪个模型写得"最像人"

6. AI 助手的 MCP 配置方案
第一版架构设计定了，关键点是 MCP 配置不会拖慢编译。

7. 文档同步
相关文档都更新到了最新状态。
