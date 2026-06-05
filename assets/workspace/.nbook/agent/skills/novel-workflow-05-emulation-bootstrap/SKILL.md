---
name: novel-workflow-05-emulation-bootstrap
description: 用于在小说项目已有基础 lorebook 后，初始化当前世界运行态 simulation/，建立最小 subjects、entities、runs/current.md、runs/index.md 和 000000-initial-state tick；不推进剧情，不写章节正文。
when_to_use:
  - 用户要求初始化世界运行态、emulation、simulation 当前状态或 RP/写作共享状态
  - `novel-workflow-07-opening-plot-design` 或剧情推进前，项目已有 lorebook 但 simulation/subjects 或 runs/current.md 还没有可用状态
  - 从导入素材或已有设定进入写作/RP 前，需要建立主角、关键 NPC、重要实体的当前状态
---

# novel-workflow-05-emulation-bootstrap：Emulation 初始化

本 skill 只负责初始化世界运行态。当前目录名仍是 `simulation/`；`emulation` 是写作流程里的概念，表示“当前世界已经运行到什么状态”。

## 目标

- 建立最小可用 `simulation/` 状态。
- 让后续 `simulator.leader`、`novel-workflow-06-emulation-tick`、`novel-workflow-07-opening-plot-design`、RP Tick 或普通写作都能读取同一份当前状态。
- 明确哪些信息是 subject-facing，哪些仍是 GM / leader 全知视角。

## 不做什么

- 不推进下一段剧情。
- 不写章节正文。
- 不把完整上帝视角 lorebook 复制进 subject `knowledge.md`。
- 不把普通可堆叠物品实例化成 entity。

## 执行顺序

1. 确认 Current Project Workspace，所有文件路径使用 `project-slug/simulation/...`。
2. 检查 `simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md`、`simulation/writer.md` 是否存在；缺失时优先从默认 Project 模板补齐。
3. 如果当前任务已需要专门世界模拟主管，创建或复用 `simulator.leader`，后续推进由它读取本 skill 初始化出的 `simulation/`。
4. 读取基础 lorebook：故事概念、主角、关键 NPC、地点、势力、规则和重要物品。
5. 确定初始 subjects：至少包含玩家/主角；按用户要求或开局需要加入关键 NPC、势力代表或系统主体。
6. 为每个 subject 建立或更新：
   - `subject.md`：稳定扮演原则、身份和行动边界。
   - `events.md`：初始化前已经亲历、听说或被告知的事件。
   - `knowledge.md`：subject 已知、相信或误解的信息。
   - `mind.md`：当前短期心理、疑虑、动机。
   - `state.md`：当前位置、身体状态、持有物摘要、短期目标。
7. 只为需要状态追踪的对象创建 `simulation/entities/{entity-id}/`。普通三瓶血药这类无差异物品写入 subject `state.md` 的 inventory 摘要；被下毒、唯一、损坏、隐藏真相或有进度的对象才建 entity。
8. 建立或更新 `simulation/runs/current.md` 和 `simulation/runs/index.md`。
9. 创建 `simulation/runs/ticks/000000-initial-state/report.md`，必要时创建说明性 `prose.md`。

## 000000 Report 要点

`report.md` 至少记录：

- 初始化触发原因。
- 读取了哪些 lorebook / reference / plot。
- 创建或更新了哪些 subjects。
- 创建或更新了哪些 entities。
- 当前世界时间、场景和活跃压力。
- 信息边界：谁知道什么，谁不知道什么。
- 未决问题和下一步建议。
- 实际写入的文件列表。

`prose.md` 可以为空，也可以写一段用户可见的初始场景说明。不要把隐藏真相写入 `prose.md`。

## 完成标准

- `simulation/subjects/` 至少有一个可用 subject。
- `simulation/runs/current.md` 能说明当前世界状态。
- `simulation/runs/index.md` 能索引 `000000-initial-state`。
- `000000-initial-state/report.md` 说明初始化依据、状态边界和未决问题。
- 后续可以直接进入 `simulator.leader` / emulation tick、`novel-workflow-07-opening-plot-design` 或 RP 初始化。
