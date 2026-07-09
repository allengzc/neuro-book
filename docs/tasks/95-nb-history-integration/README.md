# nb-history 集成（操作日志 / 文件历史接入 NeuroBook）

> **状态：blocked on [Task 94 生命周期模型重构](../94-project-lifecycle-model/README.md)** —— history.sqlite 作为 ProjectSession 会话资源接入，等显式生命周期落地后开工。

## Relative documents refs

- [Task 91 操作日志 / 文件历史](../91-operation-log-file-history/README.md)：**主档案**——模块契约（GOAL.md）、spike 验收结果、集成可行性分析（挂点核实 + 前置发现 + 决策点）都在那里，本目录不重复，只做集成执行记录。
- [Task 94 生命周期模型重构](../94-project-lifecycle-model/README.md)：前置——WorkspaceHistory 注册为 ProjectSession 资源，项目 open 时开库（D13）。
- `../nb-history/`：模块本体（sibling 仓，31 tests 验收全绿；README = API 文档，NOTES = 契约发现 14 条）。

## User Request / Topic

Task 91 spike 验收通过、集成可行性定案后，用户确认集成任务与生命周期重构一并推进：「本次任务涉及到了 "NeuroBook 底层的项目生命周期模型重构" + "集成 nb-history"」。

## Goal

NeuroBook 全部写入路径接入 nb-history 记账，四视图（单文件时间线 / 删除找回 / 用户收件箱 / 会话 unseen 提醒）在宿主可用；隐私红线落实（history.sqlite 严禁进入 task 72 可分享日志包）。

## Decisions / Discussion

**待用户批复的集成决策（D7–D14，建议已备）：**

| # | 决策点 | 建议 |
|---|---|---|
| D7 | 驱动 | 留 `@libsql/client`（宿主全线 libsql；Docker 形态可能跑 node，bun:sqlite 不存在） |
| D8 | auto-accept | 默认开、N=14 天未审自动接受，`global-workspace` scope 可配（兼解 inbox 最坏情况偏差与「未接受段永不 prune」） |
| D9 | 编辑器自动保存节流 | 先实测前端保存频率再定窗口；收口层「hash 相同不记账」直接做 |
| D10 | userId | 固定 `"local"`（模块天然 n 用户，以后零迁移） |
| D11 | workspace CLI 归因盲区 | v1 接受 external 归因 + 自回声；红线：CLI 永不自开 history.sqlite |
| D12 | `fileChangeAwareness` | 默认 minimal；leader.default = full（+先写后补 instruction）；inline editor = off |
| D13 | history 库打开时机 | 项目 open 时预热（显式生命周期给了 eager 的自然位置） |
| D14 | prune 调度 | 项目 open 时距上次 ≥24h 则后台跑一次 |
| D15 | **（审查补）closed 期间的外部变更可见性**：项目 closed 时 watcher 不在，外部编辑不会实时入账——正确性无损（写路径内建对账保证 beforeHash 链恒精确、下次写入自愈），但 unseen/收件箱的**完整性**会延迟到该文件下次被触碰。待定：open 时是否后台跑一次增量对账扫描（mtime 过滤降成本）| 建议 v1 不做全量扫描，观察实际延迟是否成为问题 |

## Verification / Test

（开工时定：写入面收口回归 + reconcile 回声抑制 + 提醒注入端到端 + 隐私排除核查）

## Implementation Walkthrough

集成清单（源自 Task 91 README 集成前置/TODO，开工时逐项记录）：

1. **前置**：watcher 排除 `.nbook/`（`isIgnoredWorkspaceWatchPath` 现只滤 `.git`）；nb-history 仓 commit。
2. WorkspaceHistory 注册为 ProjectSession 资源（open 开库 / close 关库）。
3. 写入面收口：编辑器 `writeWorkspaceTextFile` 等（user）、agent write/edit/apply_patch（`registerWrite`，sessionId 归因）、平台 `writeProsePointers` 等（system）；顺带补 write 工具的 hash-since-read 新鲜度检查（Task 91 D11）。
4. watcher → `reconcile`（只喂内容根路径；模块回声由 hash 比对吸收）。
5. harness：createAgent 接 `initCursor`；unseen 提醒注入（照抄 prepare-next-turn 的 report_result reminder 形状）+ 送达后 `advanceCursor`；profile `fileChangeAwareness` 设置。
6. 配置：retention / auto-accept 进 `CONFIG_REGISTRY`；prune 调度。
7. task 72 日志包排除登记（物理隔离已天然满足，补文档红线）。
8. UI 面（可后置单列）：收件箱 / 时间线 / 删除找回，复用 Monaco diff。

## TODO / Follow-ups

- [ ] 等 Task 94 完成后开工；开工前请用户批复 D7–D14。
- [ ] 下游（不在本任务内）：先写后补 leader instruction + 回补设定 skill → 整书导入。
