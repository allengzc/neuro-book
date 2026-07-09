# NeuroBook

[中文](README.md) | [English](README.en.md)

[![GitHub Release](https://img.shields.io/github/v/release/notnotype/neuro-book?include_prereleases&label=release)](https://github.com/notnotype/neuro-book/releases)
[![GHCR App](https://img.shields.io/badge/GHCR-neuro--book-8957e5?logo=github&label=app)](https://github.com/notnotype/neuro-book/pkgs/container/neuro-book)
[![Bun](https://img.shields.io/badge/runtime%20%2B%20build-Bun-000000?logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-%E5%8A%A0%E5%85%A5%E7%A4%BE%E5%8C%BA-5865F2?logo=discord&logoColor=white)](https://discord.gg/bSQB7mNpHB)
![QQ Group](https://img.shields.io/badge/QQ%E7%BE%A4-287447372-12B7F5?logo=qq&logoColor=white)

**让你写完长篇的创意写作 IDE**

每个人心里都有一部长篇，但绝大多数死在半路——不是死于没天赋，是死于没有工程。NeuroBook 把软件工程三十年的实践和创意写作一百年的方法论，做成你和 AI 共用的同一套工具：世界状态由引擎推算而不是靠模型记忆，伏笔像技术债一样记账追踪，成稿用 340 条规则做 lint。你的作品是本地的 Markdown 文件和 SQLite，随时带走。

<div style="display: flex; justify-content: space-between;">
  <img src="./docs/images/主页.png" width="31%"/>
  <img src="./docs/images/TSX可视化编辑器.png" width="31%"/>
</div>
<br/>

> 🖥️ 在线试用：http://8.148.4.22:3001/ ｜ 📦 [Windows 免安装包下载](https://github.com/notnotype/neuro-book/releases) ｜ 💬 [Discord](https://discord.gg/bSQB7mNpHB) ｜ 🐧 QQ 群 287447372

## 为什么是 NeuroBook

AI 能写好一段文字，但写不好一部长篇：

- **写长了就吃书**：设定靠模型的对话记忆，越写越漂移——上一卷断掉的手臂，这一卷自己长回来了。
- **挖的坑忘了填**：第 3 章埋的伏笔第 200 章还没收；AI 的思路一关对话就蒸发，作者的便签三个月就找不到。
- **一股 AI 味**：填充词、机械过渡、公式化排比，读者一眼识破。
- **工具是散的**：Word 写正文、Obsidian 管设定、网页聊天框讨论剧情——三个工具，三份数据，互相不认识；AI 的思路一关对话就蒸发。

NeuroBook 把这些当作工程问题来解决——设定、剧情、正文、世界状态都是 workspace 里可见的文件，作者和 Agent 在明确权限内共同维护。


| 能力                   | AI 聊天框  | 角色扮演工具 | 静态设定库型 | 挂机量产型 | NeuroBook                |
| ---------------------- | ---------- | ------------ | ------------ | ---------- | ------------------------ |
| 长篇设定管理           | 靠对话记忆 | 静态词条     | 静态卡片     | 摘要链     | ✅ 随时间演化的世界状态  |
| 任意时刻状态推算       | ❌         | ❌           | ❌           | ❌         | ✅ 切面推算，可审计      |
| 一致性矛盾检测         | ❌         | ❌           | 有限         | 部分       | ✅ 引擎主动报 issue      |
| 伏笔登记 / 推进 / 兑现 | ❌         | ❌           | 手工表格     | 部分       | ✅ 承诺账本              |
| AI 味检查              | ❌         | ❌           | ❌           | ❌         | ✅ llmlint               |
| 创作主导权             | 人         | 人           | 人           | 机器       | ✅ 人类主导 + Agent 执行 |
| 数据归属               | 云端       | 本地         | 视产品       | 本地       | ✅ 本地文件 + SQLite     |

## 四大核心能力

### 🌍 World Engine：不吃书的世界状态引擎

长篇最大的敌人是设定漂移。World Engine 用「时间线 + 切面」做事件溯源：每个重要时间点记录一次状态变更，任意时刻的世界状态都由之前的切面推算得出——角色三个月前受的伤、王国十年前的国库存量，随时可查、不会漂移。补设定就是在合适的时间点插入一个切面，倒叙和回忆天然支持。

- 世界结构自己定义（Zod schema）：人物、门派、王国、大陆都可以是有状态的 subject（主体）。
- 可以获取任何时间的 subject 状态
- 历法自定义：现实公历、简化纪年或完全架空的历法都支持，公元前也能算。
- 每次变更都是带时间戳的可审计记录；他什么时候获得了这把剑完全可以审计出来
- Agent 沙箱读写分权：leader 可写、writer 只读，写作时不会误改世界。

### 🧵 Plot Workbench：剧情工坊——伏笔有账本，决策有存档

结构归结构，因果归因果：**承载树**管故事在哪讲（卷 → 章），**因果树**管故事为什么发生（剧情线 → 场景）。倒叙、插叙、多线随便排，因果链永远清晰。

- **承诺系统**：每个伏笔都是对读者的承诺——埋下、推进、兑现全程记账，节拍挂在场景上随剧情自动更新，写到目标章自动进入写作指令。契诃夫说挂在墙上的枪必须响，NeuroBook 负责提醒你它还没响。不止伏笔——感情线想每隔几章发一次糖？也记上，它会提醒你已经三十章没发糖了。
- **创作决策记录**：三个月前为什么让主角黑化？翻回去只有结果、没有理由，想改又不敢改——Decision 记得：决策当场记档，风险必填，推翻也留痕。
- **章节信息控制**：读者知道什么、主角知道什么、必须隐瞒什么、只能暗示什么——希区柯克的悬念理论，做成了字段。
- 场景直接锚定世界时间轴、地点和出场角色，剧情规划与世界状态互相咬合。

### ✍️ 多 Agent 写作工作室：好马配好鞍

AI 已经是一匹好马，NeuroBook 是那副鞍（NeuroAgentHarness——Harness 本义就是马具），缰绳在你手里。目前的 AI 没有独立写完一本优质小说的能力，但它最擅长的恰恰是：整理资料、查证细节、陪你头脑风暴、给你泼冷水——一个人写作最难熬的不是难，是孤独，现在有搭子了。

- 各司其职：leader 规划剧情与调度，writer 专职正文，retrieval / researcher 查设定查资料——数值不乱编（引擎账上有），资料不瞎猜（researcher 去查）。
- 默认写作主链：灵感探索 → 项目与世界书初始化 → World Engine 建档 → 剧情规划与状态推进 → 章节写作 → 写后回补。
- **三模式**：讨论模式只出主意不动稿，计划模式先给完整方案、批准才执行；每次模式切换都要你点头。
- 编辑器内 Inline AI：选中即改、流式预览、不打断主编辑流、不占用主会话。

### 🧹 llmlint：给文字做 lint，去掉 AI 味

像 eslint 检查代码一样检查稿件。340 条规则覆盖填充词、机械过渡、公式化设问、二元对比、空泛总结、节奏单调等典型 AI 写作痕迹；静态规则秒级扫全稿，LLM 规则做语境判断，机械问题支持自动修复。既是编辑器里的润色 Skill，也是独立 CLI：[notnotype/llmlint](https://github.com/notnotype/llmlint)。

## 还有更多

- 🧭 **自带说明书的 AI 助手**：不用担心软件复杂——内置助手读过整套使用文档，直接问它「开新书该先干嘛」「伏笔怎么登记」，它教你用，还能替你直接操作。上手门槛就是会打字。
- 📂 **数据自持有**：`lorebook/`（世界书）、`manuscript/`（正文）、`world-engine/`（世界配置）全是本地 Markdown / TypeScript 文件 + 项目级 SQLite。无云端锁定，随时整包迁移，任何编辑器都能打开。
- 💰 **透明计费**：token 消耗按输入 / 输出 / 缓存创建 / 缓存命中分项计量，直接换算成美元 / 人民币——你能确切知道写这一章花了多少钱。
- 🔑 **模型自选**：多 Provider，API Key 自己配
- 📝 **结构化编辑器**：TipTap 富文本 + Markdown 扩展语法
- 🎭 **SillyTavern 角色卡迁移**：inspect → unpack → import 三段式导入，原卡与 worldbook 完整归档，稳定设定迁入世界书。AI RP 模式入口正在按写作模式的标准重新设计中。

## 快速开始

**Windows：解压即用。** 从 [GitHub Releases](https://github.com/notnotype/neuro-book/releases) 下载 zip，解压后运行：

```powershell
.\Start Neuro Book.cmd
```

包内内置 Bun runtime、预构建产物和完整源码快照，不装依赖、不跑构建；首次启动自动初始化数据，默认免密码直接使用，需要时运行 `.\Create Admin.cmd` 创建管理员并开启密码保护。之后用 `.\Update Neuro Book.cmd` 一键升级，`data/` 中的作品和配置全部保留。

**服务器 / Docker：**

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```


| 方式                     | 适合                                           |
| ------------------------ | ---------------------------------------------- |
| Windows Product Portable | Windows 本机用户，解压即用                     |
| ghcr                     | 服务器 Docker 部署，拉取预构建镜像，低内存友好 |
| Product Bun              | 已有 Bun 的本机或服务器，免源码运行            |
| Source Dev               | 开发者，源码开发和测试                         |

完整的部署、更新、管理员与模型配置说明见 [docs/deployment.md](docs/deployment.md)。要让其他 AI Agent 协助部署或排障，把 [docs/operator-bridge.md](docs/operator-bridge.md) 发给它即可。

## 面向开发者：可编程的 Agent 底座

NeuroBook 的每个核心功能都有双重血统——软件工程的成熟实践 × 创意写作的经典理论：


| NeuroBook 功能  | 软件工程血统                              | 创意写作血统                                   |
| --------------- | ----------------------------------------- | ---------------------------------------------- |
| World Engine    | 事件溯源（Event Sourcing，Martin Fowler） | 设定圣经（Story Bible）                        |
| 承诺系统        | 技术债追踪（Ward Cunningham）             | 契诃夫之枪、桑德森「承诺 / 推进 / 兑现」三法则 |
| 章节信息控制    | 最小权限 / 信息隔离                       | 希区柯克「桌下炸弹」悬念理论                   |
| 承载树 / 因果树 | 关注点分离                                | fabula / sjuzhet（故事与叙述分离）             |
| 创作决策记录    | ADR（Michael Nygard）                     | 金圣叹、脂砚斋的评点传统                       |
| llmlint         | lint（贝尔实验室，1978）                  | 奥威尔《政治与英语》                           |
| 三模式 + 审批   | Code Review、plan / apply                 | 编辑部三审制                                   |

承载这一切的底座是自研 NeuroAgentHarness（基于 Pi 框架的 multi-provider、tool calling、append-only session tree 扩展），并且整个 Agent 行为层可编程：

- **Profile**：声明式定义 Agent 的工具白名单、输入 / 输出 Schema、系统提示词、压缩与摘要策略和 Runtime Hooks。
- **TSX Profile**：用类型安全的 TSX 模板描述 Agent 上下文结构（System、History、Dynamic Context、Reminder、Import），可预览、可低代码编辑，还有「用户资产助手」Agent 协助你改——让 Agent 帮你改 Agent。
- **Sidecar Context**：在主任务前后 fork runtime-only 分支做检索、反思和记忆维护，旁路 transcript 不进入主 history，只把整理结果合并回主线。

本地开发：

```bash
bun install
bun run dev
```

常用命令：`bun run typecheck`、`bun run test`、`bun run docs:dev`。

## 文档

- [官网文档首页](docs/index.md)
- [快速开始](docs/quick-start.md)
- [基础教程：从第一本书到第一次 RP](docs/tutorials/index.md)
- [部署方式](docs/deployment.md)
- [Agent 心智模型](docs/agent/index.md)
- [Profile 介绍](docs/profile/index.md) / [Profile TSX 介绍](docs/profile-tsx/index.md)
- [Sidecar Context](docs/agent/sidecar.md)
- [NeuroBook Reference Bookshelf](reference/README.md)
- [PROJECT-STATUS.md](PROJECT-STATUS.md)

## 社区

- 💬 Discord：https://discord.gg/bSQB7mNpHB
- 🐧 QQ 讨论群：287447372

欢迎来聊——功能建议、问题反馈，或者只是聊聊你正在写的书。

## License

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify, and share the software for noncommercial purposes.

Commercial use requires prior written permission from the copyright holder. Personal authors may use NeuroBook to create, edit, and publish their own original works, including commercially published writing. The commercial restriction applies to commercial use of the software itself, not to the user's original creative output.

## Star History

<a href="https://www.star-history.com/?repos=notnotype%2Fneuro-book&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
 </picture>
</a>
