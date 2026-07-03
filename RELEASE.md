# Release Notes

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
