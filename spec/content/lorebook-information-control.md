# Lorebook Information Control Protocol

本文档写给 NeuroBook 的作者和 AI Agent。它定义 lorebook 应该如何组织、分类和准备信息控制，以便后续 GM、actor、writer、retrieval、SillyTavern 导入器和 GraphRAG 使用同一套语言。

当前版本先规范内容类型层和目录层；信息控制字段、正文分区和 GraphRAG 边类型仍是后续设计。

## Core Positioning

Lorebook 是给 AI 的作品说明书。它保存稳定、可复用、需要被 AI 检索和引用的作品设定。

Lorebook 可以包含两类内容，但必须区分：

- **作品内事实**：世界、角色、地点、势力、物品、事件、机制等。
- **AI 使用说明**：写作风格、创作边界、输出要求、信息披露规则等。

不适合作为默认 lorebook 条目的内容：

- 简介、故事概念、开局种子和项目定位。
- 剧情安排、章节过程、RP playthrough。
- 原始外部素材。
- MVU、prompt template、regex、tavern helper 脚本。
- 临时导入缓存、低置信 OCR/解析结果、review 便签。

推荐归属：

| Content | Recommended Place |
| --- | --- |
| 短简介 | `project.yaml.summary` |
| 长简介 / 故事概念 / 项目定位 | `PROJECT-STATUS.md`、planning 文档，或后续独立 project brief |
| 稳定世界事实 | 拆入具体 lorebook 节点 |
| RP 过程 | `roleplay/playthrough/` 或 Plot |
| 外部原始素材 | `reference/` |
| MVU / prompt template / regex / tavern helper | `reference/`，等待专门迁移 |

## Protocol Layers

Lorebook 协议分三层：

| Layer | Purpose | Contract |
| --- | --- | --- |
| 类型层 | 说明节点是什么 | `type` / `subtype` |
| 目录层 | 帮助管理、浏览、表达包含关系 | 路径结构、`lorebook/index.md` |
| 信息控制层 | 说明谁知道什么、谁不知道什么 | 后续 frontmatter / body schema / GraphRAG edges |

标准内容节点应显式写 `type`。系统合同以 frontmatter 为准；目录只提供组织方式和语义线索。

例子：

```text
lorebook/location/奥古斯提姆帝国/艾瑟嘉德/学院区/炼金术师公会/
```

节点自身仍应在 `index.md` 中声明：

```yaml
title: 炼金术师公会
type: location
subtype: guild-building
status: active
```

## Compatibility With Current Content Specs

当前 [内容节点当前状态规范](state.md) 仍允许内容节点目录使用同级 `state.md` 表达当前世界状态，[retrieval / inject 规范](retrieval.md) 也允许 writer 在读取内容节点时读取同级可选 `state.md`。本协议不在第一版删除这条现有合同。

本协议先收敛 lorebook 的稳定说明书结构：

- `index.md` 保存稳定设定、目录说明和可复用 AI 使用说明。
- 现有 `state.md` 仍按 `spec/content/state.md` 解释，用于客观当前状态。
- 不要把 RP actor 的主观心智、个人记忆、当前目标、情绪和私有 knowledge 写入 lorebook 同级 `state.md`。
- RP actor 动态状态进入 `roleplay/actors/{actor-id}/state.md`、`mind.md`、`knowledge.md`，剧情过程进入 Plot 或 `roleplay/playthrough/`。

长期方向是逐步减少并迁出 lorebook 下的 `state.md`，让 lorebook 更接近稳定说明书。迁移完成前，旧 `state.md` 仍是兼容结构，不应被导入器或 writer 立即视为非法。

## Type System V1

第一版默认模板只放 7 个通用高频目录，外加入口说明：

```text
lorebook/
|-- index.md
|-- world/
|-- character/
|-- location/
|-- faction/
|-- item/
|-- event/
`-- system/
```

前两层建议结构：

```text
lorebook/
|-- index.md                         # 当前项目 lorebook 目录说明，不是设定条目
|-- world/                           # 世界结构、历史、常识、世界内规则
|   |-- overview/
|   |-- history/
|   |-- geography/
|   |-- ecology/
|   |-- culture/
|   `-- rule/
|-- character/                       # 角色、NPC、可扮演实体
|   |-- 重要角色A/
|   |-- 重要角色B/
|   `-- minor/
|-- location/                        # 空间层级，真实项目继续向下嵌套
|   |-- 大陆A/
|   |-- 国家A/
|   `-- 城市A/
|-- faction/                         # 国家、势力、阵营
|   |-- 势力A/
|   `-- 势力B/
|-- item/                            # 物品、材料、装备、资源
|   |-- prop/
|   |-- book/
|   |-- consumable/
|   |-- material/
|   `-- equipment/
|-- event/                           # 历史事件与背景事件
|   |-- history/
|   |-- incidents/
|   |-- wars/
|   `-- rituals/
`-- system/                          # RP/玩法/状态规则/变量机制
    |-- state-rules/
    |-- variable-rules/
    |-- mechanics/
    `-- ui/
```

这些第二层目录是推荐范例，不是强制枚举。

## Supported Types

| Type | Default Root? | Meaning | Notes |
| --- | --- | --- | --- |
| `world` | Yes | 世界主设定、宇宙结构、历史总览、宏观地理、时代背景、世界内规则 | 世界规则放 `world/rule/`，但节点 type 仍是 `world`。 |
| `character` | Yes | 角色、NPC、主角、重要配角、可扮演实体 | 重要角色建议直接平铺在 `character/` 下。 |
| `location` | Yes | 地点、城市、区域、建筑、房间、场景空间 | 最适合利用目录层级表达空间包含关系。 |
| `faction` | Yes | 国家、势力、阵营、政治实体 | 势力通常不会很多，不建议默认过度细分。 |
| `item` | Yes | 道具、装备、材料、资源、文档物品、设备、货币 | 使用通用 subtype 和目录继续细分。 |
| `event` | Yes | 历史事件、背景事件、战争、事故、仪式、比赛 | 只收已成为背景事实的事件。未来剧情安排不写成 event。 |
| `system` | Yes | RP/玩法系统、状态规则、命定系统、炼金玩法、变量展示规则 | 机制化、可运行或可模拟的规则。 |
| `species` | No | 种族、血脉、生命类型 | 默认可放 `world/species/`；高频项目可提升为 `species/`。 |
| `creature` | No | 生物、魔物、动物、植物、生态实体 | 默认可放 `world/ecology/`；高频项目可提升为 `creature/`。 |
| `organization` | No | 组织、公会、学院部门、家族、教会、球队 | 默认可放 `faction/` 下；高频项目可提升为 `organization/`。 |
| `instruction` | No | 给 AI 的作品级使用说明，例如写作风格、创作边界、输出要求、检索规则、信息披露原则 | 只放可跨 agent 复用的作品级说明；profile 私有行为和工具权限不放 lorebook。 |

## Not Protocol Types

| Name | Destination |
| --- | --- |
| `relationship` | 不设计独立类型。人物关系下放 actor / roleplay 层；实体关系、阵营关系写在对应 lorebook 节点正文或 refs 中。重要势力可用势力专精 actor 扮演。 |
| `rule` | 不作为正式协议类型。世界内规则归 `world`，AI 指令归 `instruction`，机制规则归 `system`。 |
| `note` | 不作为稳定 lorebook 类型。低置信导入、未整理资料和临时说明优先进入 `reference/` 或待 review 区。 |
| `formatting` | 不做独立 type。状态栏格式或输出格式归入 `instruction` 或 `system`。 |
| `dynamic-mvu` | 不属于稳定 lorebook；保留在 `reference/` 或后续 RP mechanics 迁移任务。 |
| `dynamic-prompt` | 不属于稳定 lorebook；保留在 `reference/` 或后续 prompt / mechanics 迁移任务。 |

## Default Template And Extensions

默认模板只放通用高频顶层目录。协议支持更多类型，但不把所有支持类型都放进默认模板。

项目可以按题材把高频类型提升为顶层目录：

- 种族设定很重要：使用 `lorebook/species/`。
- 学院政治很重要：使用 `lorebook/organization/`。
- 怪物生态很重要：使用 `lorebook/creature/`。

自定义目录的目标是让作者管理更直觉，不是制造新的系统特例。系统、Agent 和导入器仍优先读取节点 frontmatter。

## Instruction Nodes

`instruction` 是给 AI 使用作品资料的说明，不是作品内事实。它适合保存“多个 agent 都可能需要知道”的作品级规则。

少量全局说明可以直接写在 `lorebook/index.md`。当说明较多、需要独立检索、需要 refs 或后续信息控制时，可以启用可选目录：

```text
lorebook/instruction/
|-- style/
|-- narration/
|-- boundary/
|-- disclosure/
|-- retrieval/
|-- formatting/
`-- continuity/
```

推荐 `instruction` subtype：

| Subtype | Use For | Examples |
| --- | --- | --- |
| `style` | 作品级文风、语气、修辞偏好 | 文笔清冷、少用网络梗、战斗描写偏写实。 |
| `narration` | 叙事视角、时态、旁白距离、内心描写边界 | 第三人称限知、避免上帝旁白提前揭示秘密。 |
| `boundary` | 创作边界、题材禁区、角色不可被破坏的底线 | 不写角色崩坏；不突破作品分级。 |
| `disclosure` | 信息披露原则、悬念保留、读者/角色知道什么的叙事规则 | 角色秘密只能通过剧情触发逐步揭示。 |
| `retrieval` | 检索和注入偏好，帮助 retrieval / writer 判断哪些条目优先使用 | 写学院场景时优先检索学院区、课程制度和当前出场角色。 |
| `formatting` | 作品级输出格式、状态栏展示、固定段落样式 | RP 输出末尾固定显示状态栏；章节正文不输出项目符号。 |
| `continuity` | 连贯性约束、设定优先级、冲突处理原则 | 新正文不得覆盖已确定时间线；冲突时以最近 canon 节点为准。 |

不应放入 `instruction` 的内容：

- 单次任务要求、用户临时指令和当前 Tick 命令。
- agent profile 私有行为、工具权限、run loop 流程和 sidecar 机制。
- RP actor 的个人记忆、心智、当前目标和状态。
- 作品内事实本身；事实应拆到 `world`、`character`、`location`、`faction`、`item`、`event` 或 `system`。

如果某条说明只服务某个 profile，例如 `rp.writer` 的工具限制、`rp.actor` 的扮演方式、GM 的调度流程，应放到 agent profile / roleplay 规范中，而不是 lorebook。

## Directory Conventions

### `lorebook/index.md`

`lorebook/index.md` 是当前项目 lorebook 的入口说明。它不是具体设定条目，而是告诉人类和 AI：这个项目如何组织说明书。

建议包含：

```md
# Lorebook

本目录是 AI 可检索的作品说明书。稳定世界事实、角色设定、地点、势力、物品、事件和机制进入这里。

## 默认目录

- `world/`：世界结构、历史、常识和世界内规则。
- `character/`：角色、NPC 和可扮演实体。
- `location/`：地点和空间层级。
- `faction/`：国家、势力和阵营。
- `item/`：物品、材料、装备和资源。
- `event/`：历史事件和背景事件。
- `system/`：RP/玩法/状态规则/变量机制。

## 项目扩展目录

- `species/`：本项目种族设定非常重要，因此提升为顶层目录。
- `organization/`：学院政治和组织网络非常重要，因此提升为顶层目录。

## 不放在这里

- 章节正文、剧情安排、故事概念和粗略开局剧情进入 `manuscript/`、Plot、playthrough 或项目状态文档。
- 原始外部素材进入 `reference/`。
- 动态脚本、MVU 变量补丁和提示词模板先进入 `reference/`，等待专门迁移。
```

### Containment

有明显从属关系的内容，优先放到对应节点下；没有稳定上级、或需要跨很多场景复用时，再放到通用顶层目录。

例子：

```text
lorebook/creature/plants/月眠草/
|-- index.md                         # type: creature, subtype: plant
`-- 干叶/
    `-- index.md                     # type: item, subtype: material
```

```text
lorebook/location/皇宫/女仆-A/
`-- index.md                         # type: character
```

目录表达从属，frontmatter 表达节点本体。

### Location

推荐地点层级从大到小组织：

```text
宇宙 -> 星球 -> 大陆 -> 国家 -> 省/领 -> 城市 -> 建筑 -> 房间/区域
```

并不是每个项目都需要完整层级。普通奇幻小说可能从大陆或国家开始；校园、都市或密室故事可以直接从城市、学院或建筑开始。

示例：

```text
lorebook/location/
`-- 阿斯塔利亚大陆/
    `-- 奥古斯提姆帝国/
        `-- 艾瑟嘉德/
            `-- 学院区/
                |-- index.md
                |-- 炼金术师公会/
                |   `-- index.md
                `-- 第一实验楼/
                    |-- index.md
                    `-- 地下储藏室/
                        `-- index.md
```

这类结构便于人类和 AI 理解：

```text
地下储藏室 -> located_in -> 第一实验楼
第一实验楼 -> located_in -> 学院区
学院区 -> located_in -> 艾瑟嘉德
艾瑟嘉德 -> located_in -> 奥古斯提姆帝国
奥古斯提姆帝国 -> located_in -> 阿斯塔利亚大陆
```

房间内的物品、规则和角色可以用正文 refs，也可以在需要长期管理、状态追踪或信息控制时作为子节点建立。

### Character

重要角色建议直接平铺在 `character/` 下，降低检索成本。

其他角色可以按作者偏好分类。和环境、势力强绑定的不重要角色，也可以放到对应 lorebook 目录下：

```text
lorebook/location/皇宫/女仆-A/
`-- index.md                         # type: character
```

### Faction And Organization

`faction` 保存国家、联盟、阵营和政治实体。势力通常不会很多，默认不建议细分太多二级目录。

`organization` 是支持类型，但不进默认模板。学院政治、组织网络、公会系统很重要的项目，可以提升为顶层目录：

```text
lorebook/organization/
|-- academy-council/
|-- alchemy-guild/
`-- student-union/
```

重要势力如果需要运行时模拟，后续可以用势力专精 actor 来扮演。

### Species And Creature

`species` 更适合表达“人类、精灵、龙族、兽族”这类文明、血统、可成为角色身份的类型。

`creature` 更适合表达“史莱姆、森林狼、食人花、月眠草”这类生态对象。

默认模板可以把它们放在 `world/` 下面：

```text
lorebook/world/
|-- species/
`-- ecology/
```

高频项目可以提升：

```text
lorebook/
|-- species/
|   |-- elves/
|   |-- beastfolk/
|   `-- dragons/
`-- creature/
    |-- monsters/
    |-- animals/
    `-- plants/
```

### Item

`item` 是高频但不适合穷举的类型。现实项目中的物品分类取决于题材：现代都市会有电器、服装、证件；奇幻会有武器、药剂、材料；科幻会有终端、载具、芯片。

第一版只保留几类通用 subtype：

| Subtype | Use For | Notes |
| --- | --- | --- |
| `prop` | 普通道具、剧情道具、一次性叙事物件 | 最宽泛的物品 subtype。 |
| `equipment` | 可装备、穿戴、携带并长期影响能力或身份的物品 | 武器、防具、服装、饰品都可先归这里。 |
| `consumable` | 会被消耗的物品 | 药剂、食物、弹药、一次性符咒。 |
| `material` | 可作为制作、交易或采集对象的材料 | 矿石、草药干叶、怪物素材、布料。 |
| `document` | 承载文本或信息的物品 | 书籍、信件、契约、证件、档案。 |
| `device` | 有功能结构的器具、设备、电器、终端 | 现代电器、魔导器械、科幻设备。 |
| `vehicle` | 交通工具或可乘坐/驾驶的物品 | 马车、飞船、机甲、飞艇。 |
| `currency` | 货币、票据、可计价资源 | 金币、银票、点数、信用芯片。 |
| `artifact` | 独特遗物、神器、唯一或准唯一物品 | 独特性强时用。 |

目录可以继续按作者直觉细分：

```text
lorebook/item/
|-- equipment/
|   |-- clothing/
|   |-- weapon/
|   `-- accessory/
|-- device/
|   |-- appliance/
|   `-- terminal/
|-- document/
|   |-- book/
|   `-- contract/
`-- material/
```

如果物品属于某个地点、角色、组织或生物的附属内容，可以放到对应节点下面，不必强行放到 `item/` 根目录。

## Classification Method

新概念优先按下面顺序判断：

1. 它是 AI 使用说明，还是作品内事实？
2. 如果是作品内事实，它的主要语义角色是什么：世界背景、角色、地点、势力、物品、事件、机制？
3. 如果它是规则，判断是世界内规则、创作指令，还是可运行/可模拟机制。
4. 如果它有明显上级实体，优先用目录嵌套表达从属。
5. 如果它会跨场景复用、需要单独检索或信息控制，建立独立节点。
6. 更细的现实世界分类优先用 `subtype`、目录、tag、refs 表达，不急着升级为新 type。

压力测试结论：

- `type` 不追求覆盖现实世界所有名词，而追求覆盖 AI 理解作品说明书时最常见的语义角色。
- 目录、tag 和 refs 可以表达比 `type` 更细的真实世界分类。
- 只有当某类节点高频、稳定、需要独立管理时，才考虑提升为项目顶层目录。

### Pressure Tests

| Concept | Suggested Type | Suggested Placement | Rationale |
| --- | --- | --- | --- |
| 附魔术 | `system` | `lorebook/system/enchantment/` 或 `lorebook/world/rule/magic/enchantment/` | 如果重点是玩法流程、制作步骤、状态效果，用 `system`；如果重点是世界内魔法法则，用 `world`。 |
| 一把附魔剑 | `item` | `lorebook/item/equipment/weapon/附魔剑/` | 物品本体是装备；附魔规则通过 refs 指向附魔系统。 |
| 附魔效果“霜火” | `system` 或 `item` | `system/enchantment/effects/霜火/` | 如果是可复用效果/机制，用 `system`；如果是一枚具体符文石或卷轴，用 `item`。 |
| 历史总览 | `world` | `lorebook/world/history/` | 宏观历史属于世界背景。 |
| 某场战争 | `event` | `lorebook/event/wars/某场战争/` | 具体已经发生的历史事件用 `event`。 |
| 历史课本 | `item` | `lorebook/item/document/book/历史课本/` | 它是承载历史信息的物品，不是历史本身。 |
| 运动项目“飞龙球” | `system` 或 `world` | `lorebook/system/sports/飞龙球/` | 如果描述规则、赛制、胜负判定，用 `system`；如果只描述文化地位，可放 `world/culture/sports/`。 |
| 飞龙球队 | `organization` 或 `faction` | `lorebook/organization/sports-team/` | 球队是组织；如果项目不启用 organization 顶层，可放 `faction/` 或相关地点下。 |
| 体育馆 | `location` | `lorebook/location/.../体育馆/` | 空间实体。 |
| 比赛“学院杯决赛” | `event` | `lorebook/event/competitions/学院杯决赛/` | 具体发生或设定为背景事实的比赛是事件。 |
| 校服 | `item` | `lorebook/item/equipment/clothing/校服/` | 服装通常是装备或普通物品；用目录或 tag 标注 clothing。 |
| 手机 | `item` | `lorebook/item/device/手机/` | 有功能结构的器具用 `device` subtype。 |
| 法律制度 | `world` 或 `system` | `world/rule/law/` | 世界内社会规则通常进 `world/rule/`；若要模拟审判流程，可建 `system/legal-procedure/`。 |
| 某条具体法律文本 | `world` 或 `instruction` | `world/rule/law/某法条/` | 如果是世界事实，用 `world`；如果是写作时必须遵守的 AI 指令，用 `instruction`。 |
| 菜谱 | `item` 或 `instruction` | `item/document/book/菜谱/` | 故事内存在的菜谱是文档物品；给 AI 的写作要求不是菜谱本体，才用 `instruction`。 |
| 赤砂蜥蜴鳞片 | `item` | `creature/monsters/赤砂蜥蜴/鳞片/` 或 `item/material/` | 从属明显时放赤砂蜥蜴下；跨场景高频交易时可放 `item/material/`。 |

## Information Control Deferred

信息控制层暂不在本版协议中定义 schema。

后续需要单独设计：

- lorebook 条目如何声明“谁默认知道什么、谁不知道什么”。
- 角色自己的 `knowledge.md` 如何覆盖默认声明。
- GM、actor、writer、retrieval 分别能读取哪些正文分区。
- GraphRAG 如何表示 `who knows what` 边。
- actor context-load sidecar 如何把上帝视角设定过滤成 actor-facing 上下文。

当前版本只保留一个原则：lorebook 可以准备进入信息控制，但在 schema 定稿前，不要求作者写固定字段。

## SillyTavern Worldbook Mapping

| Source Pattern | Target Type | Notes |
| --- | --- | --- |
| `世界主设定`、地理总览、历史年表、生命层级 | `world` | 生命层级可用 `subtype: power-scale`。 |
| `种族-*`、种族概览、血脉、智慧生物 | `species` 或 `world` | 默认模板可放 `world/species/`；种族高频项目可提升为 `species/`。 |
| 帝国、王国、联盟、阵营、势力概览 | `faction` | 国家和大势力进入 `faction/`。 |
| 公会、学院部门、行会、商会、家族、教会 | `organization` 或 `faction` | 默认模板可放 `faction/organization/`；组织高频项目可提升为 `organization/`。 |
| 城市、村镇、学院区、酒馆、公会建筑、遗迹 | `location` | 具体空间优先 `location`。 |
| `DLC-角色-*`、角色卡、NPC | `character` | 角色内部信息后续必须拆分 actor-safe / GM-only。 |
| `DLC-事件-*`、战争、历史事故、仪式 | `event` | 只收已成为背景事实的事件。 |
| 炼金、状态规则、角色生成、命定系统 | `system` | 与创作规则分开。 |
| 世界规则、生命层级、魔法法则 | `world` | 放入 `world/rule/`，使用更具体 subtype。 |
| 写作格式、创作边界、输出要求 | `instruction` | 可作为 AI 说明书，但必须和世界事实区分。 |
| 生物、魔物、植物、生态对象 | `creature` 或 `world` | 默认模板可放 `world/ecology/`；生态高频项目可提升为 `creature/`。 |
| 简介、故事概念、项目定位、开局种子 | 非 lorebook 默认条目 | 短简介进 `project.yaml.summary`；长概念进 planning / `PROJECT-STATUS.md`；稳定事实拆入具体 lorebook。 |
| DLC 开始/结束 marker、目录分隔条目 | 忽略或 reference | 通常不应成为稳定设定。 |
| `InitVar`、`mvu_update`、变量补丁、EJS、`@INJECT` | `reference/` | 不进入稳定 lorebook；后续由 RP mechanics / prompt migration 处理。 |

## Migration Notes

当前旧模板和导入器仍可能使用 `rule`、`note` 或把动态脚本混入 lorebook。迁移时应逐步收敛：

- `rule`：世界规则迁到 `world/rule/` 且 `type: world`；机制规则迁到 `system`；作品级 AI 指令迁到 `instruction`。
- `note`：低置信和未整理资料迁到 `reference/` 或待 review 区。
- `dynamic-mvu` / `dynamic-prompt`：保留到 `reference/`，等待 RP mechanics / prompt migration 任务。
- lorebook 同级 `state.md`：当前仍按 `spec/content/state.md` 兼容；不要新增 RP actor 主观状态；后续逐步把 lorebook 下的动态状态迁到 `roleplay/actors/{actor-id}/state.md`、Plot 或 playthrough。
