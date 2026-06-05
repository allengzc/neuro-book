# Plot System Agent Spec

本文件是给 Agent 使用 Plot System 的操作规范。数据结构总合同见 [system.md](system.md)。

Plot System 是作者视角剧情结构系统，不是 lorebook、正文、subject knowledge 或 simulation state。稳定世界事实进入 `lorebook/`；当前运行态进入 `simulation/subjects/`、`simulation/entities/` 或 `simulation/runs/`；正式正文进入 `manuscript/`。

## Core Contract

- Thread 记录长期因果线、冲突线、成长线、承诺线、伏笔线和回收线。
- Scene 记录一场可写的戏，或一个连续叙事单元。
- Plot 记录 Scene 内部的最小行动 / 节奏点，应该细到 writer 可以逐点展开正文。
- Agent 不能用空泛词代替具体行动，例如“推进关系”“制造冲突”“埋下伏笔”不能单独成为 Plot summary。
- Plot 数量是 prompt-level recommendation / warning threshold，不是数据库硬校验。

## Thread Summary

Thread `summary` 是其下 Scene 的滚动总摘要，是跨章节、跨 agent 传递长期剧情记忆的核心字段。

Thread `summary` 应覆盖：

- 这条线在讲什么，以及它为什么重要。
- 当前阶段处于哪里，之前发生了哪些关键 Scene。
- 每个关键 Scene 对这条线造成了什么改变。
- 读者知道什么，关键角色知道什么，不知道什么。
- 已投放的伏笔、已回收的伏笔、仍未回收的伏笔。
- 当前状态、下一步压力、可能的剧情方向。

对主线 Thread，`summary` 可以很长；不要为了短而丢掉 Scene 级因果。Thread `writingTip` 只写长期写作注意事项，例如主题气质、节奏边界、冲突呈现方式、回收时机，不重复 `summary`。

## Scene Summary

Scene `summary` 是给未参与前文的 writer / director / leader 看的详细场景记录。它应详细到另一个 agent 只读 Scene + Plot，就能知道这场戏发生什么、为什么发生、谁做了什么、谁知道什么、读者知道什么、结尾状态如何变化。

Scene `summary` 应覆盖：

- 场景开始时的前置状态：地点、时间、参与角色、目标、压力、隐藏条件。
- 场景内部主要行动链：角色观察、移动、选择、对话、试探、冲突、揭露、误解、转折。
- 信息状态：哪些信息被角色获得，哪些只被读者知道，哪些仍是作者视角隐藏信息。
- simulation 结果：角色状态、物品状态、位置、关系、承诺、危险、倒计时等变化。
- 场景结尾：谁处于什么状态，下一场戏自然接什么压力或机会。

Scene `purpose` 写这场戏在剧情结构中的功能。Scene `writingTip` 写正文落实建议，例如 POV、情绪曲线、节奏、对白密度、动作描写重点、哪些信息要明说或压住，不重复 `summary`。

## Plot Granularity

Plot 是行动级节拍，不是五段式大纲。

| Scene 类型 | 推荐 Plot 数 | 粒度标准 |
| --- | --- | --- |
| 短过渡 Scene | 4 到 8 | 只承载移动、时间跳转、简单交接或短反应；即使短，也要写清可见行动和后果。 |
| 普通 Scene | 8 到 16 | 每个 Plot 对应一个可写行动、反应、选择、信息交换、状态变化或小转折。 |
| 关键 Scene | 16 到 30 | 冲突、情绪、信息揭露、误解形成、关系变化、伏笔投放/回收应拆成多个节拍。 |
| 高密度对话 Scene | 16 到 30+ | 不按每句台词拆，而按试探、回避、追问、承认、反击、沉默、误解、让步等对话功能变化拆。 |
| 战斗 / 追逐 Scene | 16 到 30+ | 按攻防选择、位置变化、资源消耗、伤势、战术误判、逆转、代价拆，不写成“双方激烈战斗”。 |
| 推理 / 调查 Scene | 16 到 30+ | 按观察、假设、排除、证据发现、误导、验证、结论变化拆。 |
| RP Tick 转正文 | 8 到 24+ | 按用户行动、simulation 裁决、subject 反应、信息注入、状态变化、writer 展现节拍拆。 |

合格 Plot 应满足：

- 一条 Plot 只承载一个主要行动、发现、选择、交换、反应、转折或结果。
- Plot `summary` 写可见动作和可写内容，最好能直接变成 1 到数个正文段落。
- Plot `effect` 写该节拍造成的后果：因果推进、信息变化、关系变化、状态变化、节奏变化、伏笔投放或回收。
- Plot `writingTip` 写给 writer 的落地提示：视角、语气、节奏、动作/对白比例、感官重点、潜台词、需要避免的明说。

不合格 Plot 示例：

- “推进男女主关系。”
- “发生冲突。”
- “揭露真相。”
- “埋伏笔。”

合格 Plot 示例：

- `summary`：女主接过五彩石后没有立刻收下，而是先用袖口隔着触碰，确认石头会随她的呼吸产生微弱共鸣。
- `effect`：女主意识到这不是普通宝石，但仍不知道它是世界之心碎片；她对主角的警惕从怀疑转为谨慎求证。
- `writingTip`：用细小动作写警惕，不要让女主直接说破神器身份；对白保持试探感。

## Split / Merge Rules

- 如果一个 Plot 同时包含“角色行动 + 他人反应 + 新信息揭露 + 状态改变”，通常应拆成 2 到 4 个 Plot。
- 如果两个 Plot 的 `effect` 完全相同，且正文只能写成同一小段，可以合并。
- 如果一个 Plot 只能写成一句功能性说明，通常太抽象，应继续下钻到可见行动。
- 如果一个 Plot 会导致关系、位置、物品、知识、危险、承诺或节奏发生变化，应在 `effect` 中明确写出变化。

## Field Rules

| 字段 | 应写什么 | 不应写什么 |
| --- | --- | --- |
| `summary` | 具体发生的可见行动、对话交换、发现、选择或转折 | “推进剧情”“制造冲突”“铺垫后文”等功能性概括 |
| `effect` | 这一步造成的因果、关系、信息、状态、节奏、伏笔变化 | 重复 `summary`，或只写“气氛紧张” |
| `writingTip` | 给正文 writer 的表现建议：视角、节奏、潜台词、感官、对白/动作比例 | 继续补剧情设计，或复制 `summary/effect` |

## Update Discipline

- 创建或重写 Scene Plot 后，应同步更新 Scene `summary`，否则 Scene 摘要会落后于 Plot。
- Scene 有新增、删除、重排或关键状态变化后，应同步更新所属 Thread `summary`。
- `director` 落库前应先确认 Plot 细度，不要把功能性大纲直接写入 Plot System。
- 第一版暂不加入“writer 遇到 Plot 太粗时必须退回 leader / director”的硬提醒；只在角色边界中保留 writer 不主动接管 Plot 设计的原则。

## Batch Creation

Director 为同一个 Scene 创建多个行动级 Plot 时，优先使用 `create_story_plots`。

第一版工具约束：

- 只支持同一 `sceneId`。
- `plots` 按数组顺序追加到当前 Scene 末尾。
- 不支持显式 `sortOrder`。
- `summary` 必填非空。
- 一次最多创建 50 个 Plot。
- 整批创建在一个 transaction 内完成；任意一条失败则整批失败。
- 不做跨 Scene 批量、全量替换、删除或局部插入。
