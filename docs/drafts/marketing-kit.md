# NeuroBook 宣传材料弹药库（Marketing Kit）

> 用途：制作 PPT、发帖、演讲时直接取用的定位语、痛点叙事、功能卖点、对比表和演示脚本。
> 状态：草案，随产品版本更新。数字类素材（规则数、版本号）引用前先核对最新值。
> 诚实性红线：不说「开源」（License 是 PolyForm Noncommercial，说「源码可获取 / source-available」）；不宣传 RP 模式为当前可用主功能（写作模式 v1 已隐藏 RP 入口，表述为「重新设计中」）；不编造用户数 / 星数。

## 1. 一句话定位（Tagline）

主推版（PPT 封面 / GitHub About）：

> 本地优先的长篇小说 AI 创作 IDE —— 世界引擎防吃书，多 Agent 流水线写章节，llmlint 去 AI 味。

备选：

- 短版：**让 AI 写得了长篇的 IDE。**
- 对比版：**AI 聊天框写得好一段话，NeuroBook 写得完一部书。**
- 痛点版：**设定不漂移、时间线不混乱、文字没有 AI 味。**
- 英文版：**A local-first IDE for long-form fiction — a world engine that never forgets, an agent pipeline that writes chapters, and a linter that removes the AI flavor.**

## 2. 电梯陈述

30 秒版：

> AI 能写好一段文字，但写不好一部长篇：写到几十万字，设定漂移、时间线混乱、开始吃书，而且整章丢给模型，回来的文字一股 AI 味。NeuroBook 把长篇创作当成 IDE 问题来解决：世界状态由专门的 World Engine 用时间线管理，不靠模型记忆；写作由 leader、writer、检索等多个 Agent 分工完成；成稿再用 340 条规则的 llmlint 检掉 AI 味。整部作品是你本地的 Markdown 文件和 SQLite，随时带走。

90 秒版（在 30 秒版基础上追加）：

> 具体来说，World Engine 用「时间线 + 切面」做事件溯源：每个重要时间点记录一次状态变更，任意时刻的世界状态都能推算出来——角色三个月前受的伤、王国十年前的国库，随时可查。世界结构用 Zod schema 自己定义，历法可以完全架空。写作侧，默认主链是灵感探索 → 世界书初始化 → World Engine 建档 → 剧情规划 → 章节写作 → 写后回补，每个 Agent 有独立的工具权限：leader 可以改世界状态，writer 只能读。部署上 Windows 解压即用、服务器一行命令拉 Docker 镜像，模型 API Key 自己配，数据不出自己机器。

## 3. 痛点叙事（「问题」页素材）

每条 = 一页 slide：痛点标题 + 说明 + NeuroBook 的回答。

| # | 痛点标题 | 说明（讲稿） | NeuroBook 的回答（punchline） |
| --- | --- | --- | --- |
| 1 | 写长了就吃书 | 模型上下文装不下整部作品，设定靠对话记忆，越写越漂移：上一卷断了的手臂这一卷自己长回来了。 | 世界状态不靠模型记，靠引擎算。任意时刻的世界状态都可以从时间线推算出来。 |
| 2 | AI 写的一股 AI 味 | 填充词、机械过渡、公式化设问、「不是……而是……」，读者一眼识破。 | 像 eslint 检查代码一样检查稿件：340 条规则，静态规则秒扫全稿，LLM 规则做语境判断。 |
| 3 | 聊天框不是生产工具 | 设定贴在对话里、正文散落在会话记录里，换个工具全部重来。 | 设定、正文、剧情、世界状态全是本地文件，人和 Agent 改的是同一份 workspace，随时打包带走。 |
| 4 | 一次调用包打天下 | 让一个模型同时查设定、定剧情、写正文、管记忆，哪件都做不精。 | 领域化多 Agent：leader 规划、writer 写正文、retrieval 查设定，各自有工具白名单和上下文边界。 |

## 4. 三大支柱（核心功能页素材）

### 支柱一：World Engine —— 不吃书的世界状态引擎

副标题：任意时刻的世界状态，随时可查、永不漂移。

要点（slide bullets）：

- 「时间线 + 切面」事件溯源：每个重要时间点记录状态变更，任意时刻状态由之前切面推算得出。
- 补设定 = 在合适的时间点插一个切面；倒叙、回忆天然支持。
- 世界结构自己定义（Zod schema）：人物、门派、王国、大陆都可以是有状态的 subject。
- 历法自定义：现实公历、简化纪年、完全架空的历法都支持，公元前也能算。
- Agent 沙箱读写分权：leader 可写、writer 只读，写作时不会误改世界。
- 剧情 Scene 锚定世界时间轴、地点和出场角色，剧情规划与世界状态互相咬合。

讲稿金句：

> 长篇最大的敌人不是写不出来，是写着写着世界散架了。

演示建议：Workbench 里选一个 slice 点「查询此时状态」，展示同一个角色在两个时间点的不同状态。

### 支柱二：多 Agent 写作流水线 —— 不是聊天框，是工作室

副标题：检索、规划、写作、审校，各归其位。

要点：

- 默认写作主链：灵感探索 → 项目与世界书初始化 → World Engine 建档 → 剧情规划与状态推进 → 章节写作 → 写后回补。
- leader 负责剧情规划与调度，writer 专职正文，retrieval / researcher 查设定查资料。
- 每个 Agent 有独立的工具白名单、上下文模板和压缩策略。
- 全程人工审批（HITL）、会话树回溯、上下文压缩，长任务不失控。
- 编辑器内 Inline AI：选中即改、流式预览 diff、不打断主编辑流。

讲稿金句：

> 你不会让一个员工同时当编辑、资料员和写手，为什么让一个模型这么干？

演示建议：让 leader 规划下一章 → 展示它调用 World Engine 推进状态 → 调用 writer 产出正文。

### 支柱三：llmlint —— 给文字做 lint

副标题：写完的最后一步，去掉 AI 味。

要点：

- 340 条规则（311 条默认启用），覆盖填充词、机械过渡、公式化设问、二元对比、空泛总结、节奏单调等典型 AI 痕迹。
- 双层规则：静态正则秒级扫全稿，LLM 规则做语境判断。
- 类 eslint 体验：多文件 / glob、Markdown 遮罩、JSON / stylish 输出、机械问题自动修复。
- 既是 NeuroBook 内的润色 Skill，也是独立 CLI 工具：github.com/notnotype/llmlint。

讲稿金句：

> 代码有 linter 三十年了，文字现在也有了。

演示建议：现场对一段典型 AI 生成文字跑 `llmlint check`，展示命中报告和修复前后对比。

## 5. 次级卖点（一页多条的「还有更多」slide）

- 📂 数据自持有：全 Markdown + 项目级 SQLite，无云端锁定，任何编辑器都能打开。
- 🔑 模型自选：多 Provider，API Key 自己配，成本自己控。
- 🎭 SillyTavern 角色卡迁移：inspect → unpack → import 三段式，原卡和 worldbook 完整归档，稳定设定迁入世界书。
- 📦 Windows 解压即用：内置 Bun runtime 和预构建产物，双击启动，一键升级且保留数据。
- 🐳 服务器一行部署：`bunx --bun --package github:notnotype/neuro-book neuro-book-deploy`，低内存服务器拉预构建镜像。
- 🧩 可编程 Agent 底座（技术受众）：Profile 声明行为边界，TSX 类型安全地写上下文模板，Sidecar 旁路任务不污染主上下文。

## 6. 数字弹药（引用前核对）

| 数字 | 表述 | 来源 |
| --- | --- | --- |
| 340 / 311 | llmlint 规则总数 / 默认启用数 | docs/tasks/51、PROJECT-STATUS |
| 4 | 部署方式（Portable / ghcr / Product Bun / Source） | README、docs/deployment.md |
| 4 | World Engine 写入操作原语（replace / increment / remove / append） | docs/tasks/56 |
| 3 | SillyTavern 迁移阶段（inspect / unpack / import） | README |
| v0.5.x | 当前版本线（canary 快速迭代中） | GitHub Releases |

注意：没有可公开的用户数 / 星数 / 留存数据，不要在 PPT 里放增长曲线占位图。

## 7. 竞品对比（对比页素材）

| 能力 | AI 聊天框（ChatGPT 等） | SillyTavern / 酒馆 | NovelCrafter / Sudowrite | NeuroBook |
| --- | --- | --- | --- | --- |
| 长篇设定管理 | 靠对话记忆，易漂移 | worldbook 静态词条 | codex 静态词条 | ✅ 随时间演化的世界状态引擎 |
| 时间线 / 状态推算 | ❌ | ❌ | ❌ | ✅ 任意时刻状态可推算 |
| 多 Agent 分工 | 单对话 | 单角色对话 | 单次生成 | ✅ leader / writer / 检索分工 + 权限边界 |
| AI 味检查 | ❌ | ❌ | ❌ | ✅ llmlint 340 规则 |
| 数据归属 | 云端 | 本地 | 云端订阅 | ✅ 本地文件 + SQLite |
| 自定义历法 / 架空世界结构 | ❌ | ❌ | 有限 | ✅ Zod schema + 自定义 calendar |

讲稿口径：不贬低竞品，说「解决的问题不同」——聊天框解决「生成一段」，酒馆解决「角色对话」，NeuroBook 解决「长期经营一部作品」。

## 8. 目标用户画像（「为谁而做」页）

1. **长篇网文作者**：几十万字以上、多卷本，苦于设定表和时间线维护。核心钩子：World Engine。
2. **AI 辅助写作重度用户**：已经在用 AI 写作但被 AI 味和上下文限制折磨。核心钩子：llmlint + 多 Agent。
3. **SillyTavern / RP 玩家**：手里有大量角色卡和 worldbook 资产，想升级到有状态的世界。核心钩子：角色卡迁移 +（未来）RP 模式。口径注意：RP 模式表述为「重新设计中」。
4. **自部署爱好者**：要求数据本地、模型自选。核心钩子：本地优先 + 一行部署。

## 9. 演示脚本（Live Demo 流程，约 8 分钟）

1. **开场（30s）**：打开 Bookshelf，展示一个已有项目的 workspace 文件树——「这就是一部作品的全部，都是文件」。
2. **World Engine（3min）**：打开 Workbench → 看 timeline → 选一个历史 slice 查询「此时状态」→ 现场写一个切面（如「主角受伤」）→ 再查询状态变化。强调：这些不是笔记，是可推算的状态。
3. **写作主链（3min）**：对 leader 说「规划下一章」→ 展示它读世界状态、更新剧情 Scene → 调用 writer 产出正文到 manuscript → 展示 HITL 审批点。
4. **llmlint（1.5min）**：对刚生成的正文跑润色 Skill / CLI，展示命中规则和修复。
5. **收尾（30s）**：回到文件树——「刚才所有产出都落在这些本地文件里，打包就能带走」。

Demo 风险预案：现场模型调用可能慢或失败，提前录一段备用视频；World Engine 查询是纯本地计算，网络差时把演示重心放在支柱一。

## 10. 技术架构页（技术受众场合选用）

- 技术栈：Nuxt 4（Vue 3）+ Bun runtime + SQLite（App 级 + Project 级双库）+ Prisma。
- Agent 底座：NeuroAgentHarness，基于 Pi 框架扩展（multi-provider、tool calling、append-only session tree），支持 Multi-Agent、HITL、运行时 Profile / Tool Catalog、上下文压缩、Runtime Hooks。
- Profile 系统：TSX 作为上下文模板语言，类型安全、可预览、内容寻址编译产物 + 原子发布。
- World Engine：事件溯源三表（WorldSubject / WorldSlice / WorldPatch），patches + 4-op 写入协议，CodeAct 沙箱暴露分组 API（world.time / subject / search / slice）。
- 分发：Windows Portable（内置 Bun + 预构建 payload）、GHCR 预构建镜像，服务器零构建。

## 11. 反对意见应对（Q&A 备稿）

- **「为什么不开源？」**——源码完全公开可自由使用、修改、分享（PolyForm Noncommercial），只限制把软件本身拿去商用；**作者用它写的作品商业出版完全不受限**。
- **「我的稿子会不会被拿去训练？」**——数据全在本地文件和本地数据库，模型调用走你自己配置的 Provider，项目方不经手内容。
- **「模型费用谁出？」**——自带 API Key，多 Provider 可选，成本可控可见。
- **「和直接用 Claude/GPT 写有什么区别？」**——回到痛点页：模型负责生成，NeuroBook 负责让几十万字的工程不散架。
- **「RP 功能呢？」**——RP / 世界模拟能力在底层保留，入口正按写作模式的体验标准重新设计；当前版本主打写作模式。
- **「成熟度如何？」**——v0.5 快速迭代阶段，写作模式主链已跑通端到端验证；适合尝鲜共建，不承诺 API 稳定。

## 12. 建议 PPT 大纲（12 页）

1. 封面：logo + 主 tagline。
2. 问题：痛点 1（吃书）——可配「同一角色前后矛盾」的对比示意。
3. 问题：痛点 2（AI 味）+ 痛点 3（聊天框不是生产工具）。
4. 定位：一句话定位 + 三支柱总览图。
5. 支柱一：World Engine（配 Workbench 截图）。
6. 支柱一续：时间线推算原理示意（切面 → reduce → 任意时刻状态）。
7. 支柱二：多 Agent 流水线（配写作主链流程图）。
8. 支柱三：llmlint（配检查报告截图）。
9. 还有更多：次级卖点一页。
10. 对比页：竞品对比表。
11. 上手：部署三行命令 + 在线试用入口。
12. 结尾：仓库地址 + 文档入口 + 邀请共建。

## 13. 视觉素材清单

已有（docs/images/）：

- 主页.png、剧本工作台.png、TSX可视化编辑器.png

待补（按优先级）：

1. World Engine Workbench：timeline + 状态查询结果（支柱一主图，最高优先级）。
2. llmlint 检查报告（CLI stylish 输出或编辑器内呈现）。
3. 写作主链示意图（灵感 → 世界书 → World Engine → 剧情 → 章节 → 回补），需要手绘 / 制图。
4. Inline AI 改稿的流式 diff 预览动图。
5. Multi-Agent 会话树 / HITL 审批界面截图。
