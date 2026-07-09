# Project 生命周期模型重构（显式 open / close / presence）

## Relative documents refs

- [Task 92 Project 资源生命周期统一管理](../92-project-resource-lifecycle/README.md)：前作——隐式模型（惰性开 + touch/busy 推断 + 空闲清扫）与资源属主注册表；本任务把它升级为显式模型并吸收其审查遗留 8 项。
- [Task 91 操作日志 / 文件历史](../91-operation-log-file-history/README.md)：下游消费者——nb-history 集成（Task 95）骑在本任务之上，history.sqlite 将成为 ProjectSession 的会话资源。
- [Task 21 Project Workspace Index Watcher](../21-project-workspace-index-watcher/README.md)：tree index watcher 是被纳管的核心资源之一。
- [reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：Project Workspace / Workspace Root 术语。

## User Request / Topic

用户在 Task 92 审查轮与 VS Code / code-server / JetBrains 架构对比讨论后拍板：**NeuroBook 底层项目生命周期模型需要重构**——统一资源（文件缓存、sqlite 连接等），并且像 VS Code 一样具备显式「打开工作区/项目」「显式关闭项目」「显式报活（用户在场 + agent 在场）」的能力。为保持代码架构干净、心智模型统一，**接受重构短痛，采用严格模式**（不保留隐式 open 双轨兜底）。

## Goal

引入一等的 **ProjectSession**：显式 `open(projectPath)` 建立作用域并预热会话资源，显式 `close()` 级联释放；在场由「用户 presence 连接 + 运行中 agent invocation」两路显式声明，presence 归零后经宽限期自动 close；数据面 API 在未 open 时抛 typed error（守卫收在资源获取咽喉，不撒路由）。验证面：生命周期状态机 / 在场 / 宽限 / 守卫的单测 + 存量受影响测试迁移后全绿 + 全仓 typecheck + 手动走查（多标签页、刷新、agent 后台运行时关标签页）。

## Current State

- **设计已锁定（下表），未开始实现。**
- **执行拆分为两份 GOAL（2026-07-08 用户指定）**：[GOAL-A.md](GOAL-A.md)——核心机制（状态机/presence/宽限/HTTP 接口/harness/前端接线），本会话派发 subagents 执行；[GOAL-B.md](GOAL-B.md)——数据面守卫接线 + initProjectDatabase 收敛 + 存量测试迁移（繁琐面），派发外部实现 agent，**blocked on GOAL-A 合入**。
- Task 92 代码已 commit（`10696bf0`）；nb-history 仓已初始 commit（`e70d586`）。
- 基础已备：Task 92 的资源属主注册表（四属主接入、删除/关停路径已通）是本任务的演进起点；harness 侧 session 元数据含 projectPath、invocation 准入点明确（Task 91 可行性分析核实过）。

## Decisions / Discussion

| # | 决策 |
|---|---|
| D1 | **严格模式**：数据面 API 对未 open 的项目直接抛 typed `ProjectNotOpenError`（HTTP 4xx，语义清晰），**不保留隐式 open 双轨**——隐式兜底会让漏接 open 静默降级、纪律永远立不起来。用户明确接受短痛。符合 CLAUDE.md 快速开发期不留兼容的立场。 |
| D2 | **控制面 / 数据面边界**：项目列表、统计（如 readPlotCounts）、manifest 读、创建、删除、zip 导入 = **控制面**，不需要 open（对应 VS Code 的 recent list——列表页不能被迫打开全部项目）；plot / world engine / rag / workspace 文件 / 将来的 history = **数据面**，必须 open。 |
| D3 | **三个合法 opener**，除此无人可开：① 前端进入项目视图（`await open` → 挂 presence → 才发数据请求，刷新竞态由时序消解）；② harness invocation 准入 ensure-open（天然声明 agent 在场）；③ 服务端后台任务显式 open/close（如将来的 prune 调度）。 |
| D4 | **在场两路显式声明**：用户在场 = **专用 presence 接口**（新建，不复用现有 tree SSE / session events；选型 SSE——单向存活信号足够、与现有 eventing 同栈、服务端可感知断连；多标签页 = 连接引用计数）；agent 在场 = 该项目**运行中的 invocation**（+ 短宽限），闲置未归档 session 不算在场。 |
| D5 | **presence 归零 → 宽限期 → close 级联释放**；宽限期先用常量（暂定 5 分钟）。Task 92 的空闲清扫**降级为泄漏兜底**（防 opener 异常遗留的孤儿会话），TTL 维持常量不接配置（用出需求再说）。 |
| D6 | **吸收 Task 92 审查 8 项**：(1) close 顺序改「先关门、全部成功后再除名」；(3) 清扫/宽限路径去 force GC（force 仅保留在删除项目路径）；(4) 属主 `closeAll` 从可选改必填；(5) 删除 world-engine 冗余属主注册；(6) `closeAllProjects` 委托 `closeProject` 消除复制；(7) 单处调用的 helper 内联并消除 ensureIndexEntry 重复计算；(8) 补齐缺失的函数注释。发现 (2)（watcher 事件不报活）由显式在场在机制层消解，不再需要 watcher-touch 补丁。 |
| D7 | **会话资源 = 长命资源**：plot Project PrismaClient、tree index watcher、agent sql 单槽 client、（Task 95）history 双连接。**机会项非必做**：world engine 可从按次开关客户端升级为会话缓存客户端——确定性 close 出现后才有此选项，收益是省去每次调用的建连开销。 |
| D8 | Workspace Root 层资源（user-assets watcher、profile source watcher、app Prisma）**不属于 ProjectSession**，维持现状（仅关停路径统一收口）。 |
| D9 | **（审查补）数据面守卫清单必须含 workspace-files 读写路由**（read/write/create/delete/rename/convert/upload-file/download，当 root=`workspace/<slug>` 时）：它们直接 fs 操作、不经任何 facade 咽喉，漏守卫 = 文件面整体绕过模型；且 Task 95 后文件写入要记账进 history（会话资源），届时必然需要 open——Task 94 一步到位。落点：workspace-files 路由共用的 root 解析入口加 `assertProjectOpen`，不逐路由撒。其他 root（Workspace Root / user-assets）照常放行。 |
| D10 | **（审查补）close 的两层语义**：前端没有"关闭项目"端点——标签页只有「断开自己的 presence 连接」（多标签页下 A 关不掉 B 的会话）；**session close 是内部动作**（presence 归零→宽限到期 / 删除流程 / 关停），将来如需管理面"强制关闭"再单独做带确认的管理端点。防止实现时做出危险的公开 close API。 |
| D11 | **（审查补）open 的预热清单**：eager = `initProjectDatabase`（迁移收敛到 open 跑一次——**现状是 plot/world/sql 每次调用都全量跑一遍 DDL+迁移检查再 GC，这是既有的显著浪费，本重构顺带消除**）+ tree index watcher 启动（但 watcher 初扫不阻塞 open 返回，异步就绪）+（Task 95）history 双连接；lazy = plot/world/sql 客户端维持首用即建。 |
| D12 | **（用户已批）删除"使用中"项目 = 拒绝**：presence>0 或有运行中 invocation → 409 并返回占用方摘要；仅宽限态允许强制 close 后删除。 |
| D13 | **（定案）** `ProjectNotOpenError` → HTTP 409 + `data.code="PROJECT_NOT_OPEN"`；`config/project.put` 归数据面；原 touch 降级为 `markProjectActivity`（仅更新 lastActivityAt 供可观测性，不再承载生命周期语义）。 |

## Verification / Test

- 新增单测：状态机（open/幂等 open/close/重复 close）、presence 计数与归零→宽限→close、agent 在场探针、strict 守卫抛错、审查项回归（关门顺序、closeAll 必填契约）。
- 存量迁移：直接调 facade 的测试补 open（或测试 helper 统一处理）后全绿；全仓 typecheck。
- 手动走查（用户执行浏览器部分）：开两标签页关一个不掉资源；F5 刷新无竞态报错；关闭标签页后 agent 后台继续跑不被拆资源；宽限期后资源确实释放。

## Implementation Walkthrough

（实现时逐 slice 记录）

- **S1 ProjectSession 核心**：演进 `server/workspace-files/project-resources.ts` —— 会话状态机 + presence 计数 + 宽限定时 + 兜底清扫降级 + 审查项 (1)(3)(4)。
- **S2 opener 接线**：presence SSE 新接口；前端进入/离开项目视图（含 SSR 取数检查——IDE 页若有服务端取数需先 open 或关 ssr）；harness invocation 准入 ensure-open + agent busy 探针。
- **S3 咽喉守卫 + 属主迁移**：facade / ensureIndexEntry / sql-tool 取资源入口 + workspace-files 路由 root 解析入口（D9）改走会话（未 open 抛 `ProjectNotOpenError`）；`initProjectDatabase` 从 per-call 挪到 open（D11）；审查项 (5)(6)(7)(8)。
- **S4 测试迁移与新增**。
- **S5 文档同步**（reference、PROJECT-STATUS、本 README）。

## TODO / Follow-ups

- [ ] S1–S5 实现。
- [ ] 待定细节（余量）：宽限期时长定稿（暂 5min 常量，GOAL-A 实现）；前端错误 UX 文案；IDE 页面 SSR 取数情况核实（GOAL-A A4 内完成）。
- [ ] 宽限到期 close 不做在途请求排空（宽限时长即缓冲），实现时在 close 注释写明该取舍。
- [ ] 完成后解锁 [Task 95 nb-history 集成](../95-nb-history-integration/README.md)。
