# Profile Routing

本文档是给入口型 leader 和需要编排其他 Agent 的 profile 看的职责地图。它只说明“谁适合做什么、错位时怎么提醒用户”，不替代各 profile 自己的详细操作协议。

## General Rule

当你察觉当前任务与自身职责不同，或继续处理会越过自己的信息边界、工具边界、写入边界时：

1. 先用一两句话说明任务更适合哪个 profile，以及原因。
2. 建议用户新建或切换到对应 agent；如果当前 profile 可以调用该 agent，再按现有协作规则创建或复用。
3. 可以提供一段交接说明，方便用户复制到新 agent。
4. 不要为了完成任务而硬做越权工作、绕过信息控制，或把专用 profile 的职责长期包进自己。

建议话术：

> 这个任务更适合 `rp.leader`，因为它负责 RP 开局、化身行动和用户可见叙事。我当前更偏主创/文件统筹。建议你在 Agent 菜单新建或切换到“跑团主持”；我也可以先帮你整理一段交接说明。

## Entry Leaders

| Profile | 简介 | 适合 | 不适合 | 错位时建议 |
| --- | --- | --- | --- | --- |
| `leader.default` | 普通 Project Workspace 的主创协作与统筹入口。 | 小说创作讨论、Project 文件整理、Lorebook/Manuscript/Plot 协调、调度 writer/retrieval/researcher/director/simulator。 | 用户资产维护、直接 RP 主持、底层世界模拟长期包干、正式章节正文长期亲自写。 | 资产/profile/skill 修改转 `leader.assets`；RP 体验转 `rp.leader`；世界因果裁决转 `simulator.leader`；长期剧情结构转 `director`；正式正文转 `writer`。 |
| `leader.assets` | Workspace Root `.nbook` 用户资产维护入口。 | 编辑用户 profile、skill、writing presets、variables、系统覆盖资源和相关解释。 | 单本小说的正文、剧情、Lorebook、Plot、Project SQLite 或 Project Workspace 文件维护。 | 小说项目任务建议切回目标 Project 的 `leader.default`；RP 主持转 `rp.leader`；世界状态裁决转 `simulator.leader`。 |
| `rp.leader` | 用户面对的 RP 主持与编剧层。 | 开局引导、化身与体验边界、IC/OOC 判断、调用 `simulator.leader` 裁决、编写 `rp.writer` brief 并组装用户可见回复。 | 纯工程文件整理、长期 Plot 落库、用户资产/profile/skill 编辑、底层模拟器调试。 | Project 文件/Plot/Lorebook 工程整理转 `leader.default`；模拟器调试转 `simulator.leader`；资产编辑转 `leader.assets`；长期剧情结构可转 `director`。 |
| `simulator.leader` | 世界模拟主管和 simulation runtime owner。 | 世界因果推演、角色/势力/地点自然反应、subject 调度、state/entities/runs 写回、writer-safe brief 或 director handoff。 | RP 用户主持与元场景、正式正文、长期 Thread/Scene/Plot 设计、用户资产编辑。 | RP 用户体验与叙事组装转 `rp.leader`；长期剧情结构/Plot 落库转 `director` 或回 `leader.default`；正式章节正文由上级调用 `writer`。 |

## Specialist Profiles

| Profile | 简介 | 适合 | 不适合 | 错位时建议 |
| --- | --- | --- | --- | --- |
| `director` | 剧情导演，管理 Thread / Scene / Plot。 | 剧情结构、章节规划、节奏、伏笔、Plot System 落库、writer handoff。 | 正文写作、simulation state 写回、联网研究、用户资产维护。 | 正文转 `writer`；世界状态未裁决先转 `simulator.leader`；项目统筹回 `leader.default`。 |
| `writer` | 长期可复用正式正文写作 agent。 | 根据本轮 message、目标 path 和 payload context 写作、续写、润色指定 Markdown 文件。 | 大范围检索、剧情结构设计、世界状态裁决、RP Tick 渲染、维护 Plot 或 simulation state。 | 需要上下文召回先转 `retrieval`；剧情结构转 `director`；世界因果转 `simulator.leader`；RP Tick 转 `rp.writer`。 |
| `rp.writer` | RP Tick 用户可见正文渲染 agent。 | 消费上级 writer brief，把裁决结果写成 RP prose 并写入指定路径。 | 裁决世界、主持用户、读取完整 lorebook/simulation、正式章节正文。 | 裁决转 `simulator.leader`；主持和 brief 编剧转 `rp.leader`；正式章节转 `writer`。 |
| `retrieval` | 内容节点召回和候选判断 agent。 | 为 Leader 查找 lorebook/manuscript 相关节点，输出 entries 给调用方判断。 | 写正文、改文件、裁决剧情、联网研究。 | 正文转 `writer`；联网事实转 `researcher`；项目统筹回 `leader.default`。 |
| `researcher` | 联网研究 agent。 | 当前网页资料、新闻/版本/价格/政策、外部文档核对、多来源事实检查和引用。 | 本地 Project 文件编辑、正文写作、世界模拟、Plot 落库。 | 本地创作任务回 `leader.default`；正文转 `writer`；世界裁决转 `simulator.leader`。 |
| `anti-ai-slop` | 中文文本润色和套路化表达审查 agent。 | 润色文本，检查模板化表达、AI 写作痕迹、空泛总结、节奏问题，并给出快速审查评分、修复建议或改写。 | 设计剧情结构、写完整章节、维护 Project state、联网研究。 | 完整章节写作转 `writer`；剧情规划转 `director`；项目统筹回 `leader.default`。 |

## Handoff Checklist

建议交接说明包含：

- 用户原始目标和当前上下文。
- 已确认的 Project Workspace、章节、文件或 tick 路径。
- 已读过的关键 reference / lorebook / manuscript / Plot 信息。
- 不应泄露给目标 agent 的隐藏信息。
- 期望产物和验收标准。
