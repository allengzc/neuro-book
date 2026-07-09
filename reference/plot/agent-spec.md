# Plot System Agent Spec

本文件是给 Agent 使用 Plot System 的操作规范。数据结构总合同见 [system.md](system.md)。

Plot System 是作者视角剧情结构系统，不是 lorebook、正文、subject knowledge 或 World Engine state。稳定世界事实进入 `lorebook/`；动态世界状态、时间线和事实推进进入 World Engine；正式正文进入 `manuscript/`。

## Core Contract

- Thread 记录长期因果线、冲突线、成长线、承诺线、伏笔线和回收线。
- Scene 记录一场可写的戏，或一个连续叙事单元。
- Scene 是最小剧情单位；不要再创建 Scene 内部 Plot Beat。
- 事实推进、状态变化、位置变化和资源变化应通过 World Engine patch 表达，不要在 Plot System 里保存第二份动态状态。
- Agent 不能用空泛词代替具体行动，例如“推进关系”“制造冲突”“埋下伏笔”不能单独成为 Scene summary 或 purpose。

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

Scene `summary` 是给未参与前文的 writer / director / leader 看的详细场景记录。它应详细到另一个 agent 只读 Scene + World Engine 上下文，就能知道这场戏发生什么、为什么发生、谁做了什么、谁知道什么、读者知道什么、结尾状态如何变化。

Scene `summary` 应覆盖：

- 场景开始时的前置状态：地点、时间、参与角色、目标、压力、隐藏条件。
- 场景内部主要行动链：角色观察、移动、选择、对话、试探、冲突、揭露、误解、转折。
- 信息状态：哪些信息被角色获得，哪些只被读者知道，哪些仍是作者视角隐藏信息。
- World Engine 结果：角色状态、物品状态、位置、关系、承诺、危险、倒计时等变化应在 World Engine patch 中落定；Scene summary 只做作者视角摘要。
- 场景结尾：谁处于什么状态，下一场戏自然接什么压力或机会。

Scene `purpose` 写这场戏在剧情结构中的功能。Scene `writingTip` 写正文落实建议，例如 POV、情绪曲线、节奏、对白密度、动作描写重点、哪些信息要明说或压住，不重复 `summary`。

## Scene Granularity

Scene 不是五段式大纲，也不是单个动作点。一个 Scene 应能被 writer 展开成连续正文，且具备明确起点、冲突或信息变化、结尾状态。

| Scene 类型 | 粒度标准 |
| --- | --- |
| 短过渡 Scene | 只承载移动、时间跳转、简单交接或短反应；也要写清可见行动和后果。 |
| 普通 Scene | 有明确目标、压力、行动链、信息变化或关系变化。 |
| 关键 Scene | 冲突、情绪、信息揭露、误解形成、关系变化、伏笔投放/回收需要在 summary 中写出完整链条。 |
| 高密度对话 Scene | 按试探、回避、追问、承认、反击、沉默、误解、让步等对话功能变化组织 summary。 |
| 战斗 / 追逐 Scene | 写清攻防选择、位置变化、资源消耗、伤势、战术误判、逆转和代价；具体状态进入 World Engine。 |
| 推理 / 调查 Scene | 写清观察、假设、排除、证据发现、误导、验证和结论变化。 |

合格 Scene 应满足：

- `summary` 写可见行动链和信息变化，不只写功能标签。
- `purpose` 写该 Scene 对长期因果线、伏笔或章节节奏的功能。
- `writingTip` 写给 writer 的落地提示：视角、语气、节奏、动作/对白比例、感官重点、潜台词、需要避免的明说。
- `worldAnchor` 尽量连接时间范围、相关 subjects 和地点；规划阶段未知时可以先为空。

不合格 Scene 示例：

- “推进男女主关系。”
- “发生冲突。”
- “揭露真相。”
- “埋伏笔。”

合格 Scene 示例：

- `summary`：女主接过五彩石后没有立刻收下，而是先用袖口隔着触碰，确认石头会随她的呼吸产生微弱共鸣。主角没有解释来源，只说这是能让她离开矿坑的筹码；女主因此决定暂时合作，但要求主角先交出一半路线。
- `purpose`：让女主从怀疑转为谨慎求证，同时把五彩石从道具升级为逃离矿坑的关键筹码。
- `writingTip`：用细小动作写警惕，不要让女主直接说破神器身份；对白保持试探感。

## World Engine Anchor

Scene 连接 World Engine 时优先填写：

- `startTime` / `endTime`：项目日历字符串，允许为空。
- `subjectIds`：所有相关 World Engine subjects。
- `locationSubjectId`：单个主地点 subject，允许为空。

使用规则：

- 先规划、后连接时间线是合法工作流；不要为了填时间而伪造 instant。
- 如果 Scene 事实已经发生或被确认，应由 World Engine patch 记录状态变化。
- `get_scene_world_context` 用于读取 Scene 时间范围内的 slices 和 subject states；不要用 SQL 手写替代它。
- 如果 Scene 的 World Engine 上下文为空，先确认 `worldAnchor` 是否缺时间、subjects 或地点。

## Update Discipline

- Scene 有新增、删除、重排或关键状态变化后，应同步更新所属 Thread `summary`。
- Scene summary 与 World Engine patch 不应互相矛盾；若正文修订产生新事实，先回到 World Engine 做 patch，再更新 Scene / Thread 摘要。
- Leader（或手动 director）落库前应确认 Scene 粒度足够 writer 使用，不要把功能性大纲直接写入 Plot System。
- Writer 不主动接管长期剧情结构；遇到 Scene 过粗、缺少 World Engine 上下文或事实矛盾时，默认回报 leader。
