# NeuroBook Directory Protocol

本文定义 Project Workspace 的内容目录职责。它面向作者、导入器、simulator leader、writer、retrieval 和 Agent。

## Core Split

| Directory | Purpose | Primary Reader |
| --- | --- | --- |
| `lorebook/` | 无状态、稳定、全知视角的作品说明书：canon、prototype、规则和 AI 使用说明。 | simulator leader、retrieval、授权后的 writer、开发者 |
| `manuscript/` | 正文、章节、草稿和章节本地 notes。 | writer、editor、作者 |
| `simulation/` | 世界模拟层：subjects、entities、runs、simulator 协议和 writer brief。 | simulator leader、simulator profiles |
| `reference/` | 外部素材、导入归档、低置信迁移材料。 | 导入器、research / migration agent |
| `.nbook/` | Project config、Project SQLite、runtime artifacts 和系统控制文件。 | runtime、开发者 |

`roleplay/` 是旧目录名。当前目标能力目录是 `simulation/`。

## Target Shape

```text
project/
|-- project.yaml
|-- .nbook/
|-- manuscript/
|-- lorebook/
|   |-- index.md
|   |-- world/
|   |-- character/
|   |-- location/
|   |-- faction/
|   |-- item/
|   |-- event/
|   |-- system/
|   `-- instruction/
|-- simulation/
|   |-- config.yaml
|   |-- simulator.md
|   |-- cast.yaml
|   |-- writer.md
|   |-- subjects/
|   |-- entities/
|   `-- runs/
`-- reference/
```

旧目录迁移：

```text
roleplay/                 -> simulation/
roleplay/gm.md            -> simulation/simulator.md
roleplay/actors/{id}/     -> simulation/subjects/{id}/
roleplay/playthrough/     -> simulation/runs/
```

## Lorebook

`lorebook/` 是给 AI 的无状态作品说明书。它保存稳定、可复用、需要被检索和引用的全知设定、类型、原型和规则。

默认模板推荐：

```text
lorebook/
|-- index.md
|-- world/
|-- character/
|-- location/
|-- faction/
|-- item/
|-- event/
|-- system/
`-- instruction/
```

支持但默认不提升为顶层的高频类型：

- `species`
- `creature`
- `organization`
- `mechanic`

项目可以把任何高频类型提升为顶层目录。例如种族叙事很重的项目可以有 `lorebook/species/`，学院政治很重的项目可以有 `lorebook/organization/`。

### Type Guidelines

| Type | Use For |
| --- | --- |
| `world` | 世界结构、历史、地理、文化、生态、世界内规则。 |
| `character` | 上帝视角角色设定、背景、秘密、作者备注。 |
| `location` | 空间层级，按真实地点从大到小嵌套。 |
| `faction` | 国家、阵营、政治实体、冲突集团。 |
| `item` | 物品原型、装备、道具、文档、材料、设备、消耗品。 |
| `event` | 已发生的历史事件、背景事件、战争和事故。 |
| `system` | 可运行/可模拟机制、玩法模块、状态规则。 |
| `instruction` | 作品级 AI 使用说明，例如风格、边界、检索、披露、continuity。 |
| `species` | 文明、血统、可成为角色身份的种族类型。 |
| `creature` | 魔物、动物、植物和生态对象。 |
| `organization` | 公会、学院部门、商会、家族、教会等组织。 |

`rule` 不再作为独立兼容目录。世界规则放 `world/rule/`，机制规则放 `system/`，AI 使用说明放 `instruction/`。

### Location

地点适合用目录层级表达：

```text
宇宙 -> 星球 -> 大陆 -> 国家 -> 省/领 -> 城市 -> 建筑 -> 房间/区域
```

项目不需要补齐所有层级。校园、都市或密室故事可以直接从城市、学院或建筑开始。

### Item

`item` 的默认 subtype：

| Subtype | Use For |
| --- | --- |
| `prop` | 普通道具和剧情道具。 |
| `equipment` | 武器、防具、服装、饰品等长期装备。 |
| `consumable` | 药剂、食物、弹药、一次性符咒。 |
| `material` | 矿石、草药、怪物素材、布料。 |
| `document` | 书籍、信件、契约、证件、档案。 |
| `device` | 电器、魔导器械、终端、功能设备。 |
| `vehicle` | 交通工具、坐骑、飞船、机甲。 |
| `currency` | 货币、票据、点数、信用芯片。 |
| `artifact` | 独特遗物、神器、唯一或准唯一物品。 |

更细的现实分类优先用目录、`subtype`、tag 和 refs 表达。

## Simulation

`simulation/` 是世界模拟层。它不只服务 RP，也服务写作过程中的世界推进、角色反应判断、信息控制和实体状态维护。

```text
simulation/
|-- config.yaml
|-- simulator.md
|-- cast.yaml
|-- writer.md
|-- subjects/
|-- entities/
`-- runs/
```

文件职责：

| File | Purpose |
| --- | --- |
| `config.yaml` | simulation 运行配置。 |
| `simulator.md` | simulator leader 的运行协议、裁决原则和信息控制规则。 |
| `cast.yaml` | 本次 simulation 可调度 subjects、entities、profiles 和路径注册表。 |
| `writer.md` | writer 的提示词素材、文风和输出契约。 |
| `subjects/` | 信息控制主体目录。 |
| `entities/` | 有状态实例目录。 |
| `runs/` | Tick 记录、scratch、brief 和 run artifacts。 |

`simulator leader` 负责全局裁决、世界推进、信息控制、subject / entity simulator 调度和 writer brief 构造。`actor` 是 simulator 的一种，不是顶层目录。

## Roleplay Runtime Profiles

当前 RP / simulation 默认使用三个 builtin profile。profile key 保留 `rp` 命名，但路径和文档口径使用 `simulation`：

| Profile | Role | Reads | Writes |
| --- | --- | --- | --- |
| `leader.rp` | 用户面对的 simulator leader / GM。理解用户输入、读取 simulation 根文件、调度 actor、裁决世界、构造 writer brief 并最终面向用户叙述。 | `simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md`、`simulation/writer.md`，以及 `simulator.md` 授权的 god-view lorebook / reference。 | 第一版不直接写文件；状态修改通过 actor sidecar、后续状态系统或作者操作完成。 |
| `rp.actor` | 单个 subject 的角色扮演 simulator。只基于 subject-facing 文件和 GM packet 输出角色反应。 | 创建 input 绑定的 `subject.md`、`knowledge.md`、`mind.md`、`state.md`；`actor.context-load` sidecar 可读取相关设定并过滤为 actor-safe context。 | 主扮演 run 不主动写文件；`actor.memory-save` sidecar 可维护 `knowledge.md` 与 `mind.md`。 |
| `rp.writer` | Tick 正文渲染器。把 GM writer brief 写成用户可见正文。 | 创建 input 绑定的 `simulation/writer.md` 和 GM brief；只读取 GM 明确指定的额外路径。 | 普通 assistant 回复正文；只有 GM 明确指定输出路径时才写文件。 |

`leader.rp` 不应该把完整 `simulation/`、`lorebook/` 或 `reference/` 交给 actor / writer。它必须把上帝视角内容过滤成 actor-facing message 或 writer brief。

`rp.actor` 创建 input 的稳定字段：

| Field | Meaning |
| --- | --- |
| `actorId` | 本局 subject id，应对应 `simulation/cast.yaml`。 |
| `actorName` | 可选显示名。 |
| `kind` | 可选类型，例如 `player`、`npc`、`faction`、`system`。 |
| `instructionPath` | `simulation/subjects/{id}/subject.md` 的 Agent cwd 相对路径。 |
| `knowledgePath` | `simulation/subjects/{id}/knowledge.md` 的 Agent cwd 相对路径。 |
| `mindPath` | `simulation/subjects/{id}/mind.md` 的 Agent cwd 相对路径。 |
| `statePath` | `simulation/subjects/{id}/state.md` 的 Agent cwd 相对路径。 |

`rp.actor` 主路通过 `report_result.data` 返回角色 response packet，核心字段是：

- `visible_action`
- `spoken_dialogue`
- `private_intent`
- `emotional_state`
- `assumptions`
- `questions_to_gm`
- `knowledge_update`
- `mind_update`
- `state_update`

`state_update` 只是报告给 GM 的建议，不代表 actor 可自行裁决世界状态。`state.md` 当前仍由 GM / 后续状态系统负责。

`rp.writer` 创建 input 的稳定字段：

| Field | Meaning |
| --- | --- |
| `writerInstructionPath` | `simulation/writer.md` 的 Agent cwd 相对路径。 |
| `style` | 可选稳定文风偏好。 |
| `outputRequirements` | 可选稳定输出约束。 |
| `language` | 可选输出语言。 |

`rp.writer` 不强制 `report_result`，默认直接用 assistant 回复正文。行动选项、确认问题和 GM 控制面内容由 `leader.rp` 输出，不交给 writer。

## Subjects

`simulation/subjects/{subject-id}/` 保存会知道、误解、判断、行动、隐瞒的主体。玩家角色也应该是一个 subject。

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

| File | Purpose |
| --- | --- |
| `subject.md` | subject 模拟指令、稳定人格、语气、行动原则。 |
| `events.md` | subject 亲历或被告知的重要事件流水账。 |
| `knowledge.md` | subject 已知世界观、事实、关系和地点认知。 |
| `mind.md` | 当前短期心理状态、疑虑、判断、动机和情绪倾向。 |
| `state.md` | 当前地点、持有物摘要、身体状态、关系压力和短期目标。 |

## Entities

`simulation/entities/{entity-id}/` 保存需要状态的实例。实例化的目的不是信息控制，而是状态追踪。

```text
simulation/entities/{entity-id}/
|-- entity.md
|-- events.md
`-- state.md
```

建立 entity 的条件：

- 独立状态。
- 隐藏真相。
- 唯一性或准唯一性。
- 持有人差异。
- 损坏、激活、进度、位置等需要追踪。
- 未来会作为剧情关键对象。

普通可堆叠、无差异物品不需要实例化。三瓶普通血药可以只在 subject `state.md` 中记录数量；一瓶被下毒的血药应建立 entity。

## Reference

Project Workspace 的 `reference/` 保存原始外部素材和迁移材料：

- SillyTavern 原始角色卡和 worldbook 解包。
- MVU、prompt template、regex、tavern helper 脚本。
- 低置信 OCR / 解析结果。
- 导入报告和待 review 资料。

`reference/` 不直接等于稳定设定。导入器和 Agent 应把它作为迁移输入，而不是默认注入 writer、subject 或 entity simulator。

## Runs

`simulation/runs/` 保存本次世界模拟、RP、写作试跑或调试过程中的 Tick 产物。它是过程记录，不是 canonical lorebook，也不是 subject 长期记忆。

推荐结构：

```text
simulation/runs/
|-- current.md
`-- ticks/
    `-- 000001/
        |-- user-input.md
        |-- simulator-scratch.md
        |-- subject-results/
        |-- entity-updates/
        |-- writer-brief.md
        `-- prose.md
```

规则：

- `runs/` 不命名为 `sessions/`，避免和 Agent Session 混淆。
- subject 默认不读取完整 `runs/`。
- 需要沉淀的结果应整理回 `simulation/subjects/`、`simulation/entities/`、Plot 或 `lorebook/`。
- `writer-brief.md` 只能包含可写信息；不要把 GM scratch 或隐藏真相直接交给 writer。

## Classification Method

新概念按下面顺序判断：

1. 它是作品事实、AI 使用说明、subject 视角资料、entity 状态，还是运行过程产物？
2. 如果是作品事实，放入最合适的 lorebook type。
3. 如果是 subject 视角资料，放入 `simulation/subjects/{id}/`。
4. 如果是有状态实例，放入 `simulation/entities/{id}/`。
5. 如果是运行过程，放入 `simulation/runs/` 或 Plot。
6. 如果是外部原始素材或低置信迁移材料，放入 Project Workspace `reference/`。
7. 如果有明显从属关系，优先用目录嵌套表达。

旧长版协议归档在 [../../docs/archived/reference/lorebook-information-control-v0.md](../../docs/archived/reference/lorebook-information-control-v0.md)。
