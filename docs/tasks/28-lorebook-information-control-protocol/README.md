# Lorebook Information Control Protocol

## User Request

- 新建一个 `Lorebook Information Control Protocol` 任务。
- 第一步先设计内容类型层：基于当前 novel lorebook 模板、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` 的大型 worldbook 条目，找到一套通用、常用、不过度碎片化的 lorebook 类型划分。
- lorebook 协议的目标是支持“信息分离控制”的条目，而不是像普通 lorebook 一样只写上帝视角全文。
- 当前先讨论内容类型、目录层级和分类压力测试；信息控制字段、正文分区和 GraphRAG 边后续再展开。

## Goal And Scope

### Goal

- 形成 `Lorebook Information Control Protocol` 的第一版任务上下文，先完成内容类型层设计。
- 给后续 actor sidecar、writer retrieval、SillyTavern 导入器、GraphRAG 和 `knowledge.md` 生成规则提供共同分类语言。
- 明确默认模板保持克制，但协议支持项目按题材扩展顶层目录。
- 明确 lorebook 是给 AI 的作品说明书；动态 RP 状态、剧情过程、原始外部素材和机器脚本不混进稳定 lorebook。

### In Scope

- lorebook 内容节点的 `type` / `subtype` 分类。
- 默认顶层目录和可扩展顶层目录。
- 目录层级如何辅助人类管理、AI 浏览和语义表达。
- 常见概念的分类压力测试。
- `who knows what` 信息控制模型的轮廓。

### Out Of Scope For This Pass

- 完整 frontmatter schema。
- 正文分区规范，例如 `Public Canon`、`Actor Safe Summary`、`GM Secrets`、`Writer Notes`。
- actor context-load sidecar 的实现细节。
- GraphRAG 边类型和检索策略。
- SillyTavern worldbook 的真实迁移脚本实现。

## Protocol Positioning

### Lorebook Is The AI Manual

Lorebook 是给 AI 的作品说明书。它保存稳定、可复用、需要被 AI 检索和引用的作品设定。

它可以包含两类内容，但协议必须把它们分开：

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

### Three Layers

协议先按三层理解 lorebook：

| Layer | Purpose | Contract |
| --- | --- | --- |
| 类型层 | 说明节点是什么 | `type` / `subtype` |
| 目录层 | 帮助管理、浏览、表达包含关系 | 路径结构、`lorebook/index.md` |
| 信息控制层 | 说明谁知道什么、谁不知道什么 | 后续 frontmatter / body schema / GraphRAG edges |

本任务只把类型层和目录层先收敛。信息控制层先记录模型，不定义完整 schema。

### Type And Directory

内容节点有两层语义：

- `type` / `subtype`：定义这个节点是什么。
- 目录层级：用于人类管理、AI 浏览和语义表达。

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

### Legacy State

当前实现和导入脚本还处在旧分类阶段，这是本协议后续要迁移的对象。

当前 novel directory template 的 lorebook 目录只内置少量初始化节点：

- `lorebook/note/...`
- `lorebook/rule/...`

当前 workspace content-node 校验允许的 lorebook type 是：

- `location`
- `character`
- `faction`
- `item`
- `rule`
- `note`

当前 SillyTavern 导入脚本已经识别更细的 worldbook entry category：

- `character`
- `location`
- `faction`
- `rule`
- `item`
- `event`
- `system`
- `formatting`
- `dynamic-mvu`
- `dynamic-prompt`
- `unknown`

`命定之诗与黄昏之歌` 的 worldbook 条目覆盖了世界主设定、种族、势力、组织、地点、角色、事件、系统玩法、状态规则、命定系统、DLC 边界和动态脚本等多种职责。它适合作为压力样本，但不能把其中每种标题都直接升级成默认顶层类型。

旧文档中曾把 `state.md` 作为 lorebook 内容节点同级状态文件。本协议暂时不沿用这个方向：RP 角色动态状态优先进入 `roleplay/actors/{actor-id}/state.md`，lorebook 保持稳定说明书定位。

## Type System V1

### Default Root Directories

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
`-- system/                          # RP/玩法/状态/变量机制
    |-- state/
    |-- variables/
    |-- mechanics/
    `-- ui/
```

这些第二层目录是推荐范例，不是强制枚举。

### Supported Types

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
| `instruction` | No | 给 AI 的写作风格、创作边界、输出要求、检索规则、信息披露规则 | 是 AI 说明书，不是世界事实。也可迁到 agent / roleplay 专用协议。 |

### Not Protocol Types

| Name | Destination |
| --- | --- |
| `relationship` | 不设计独立类型。人物关系下放 actor / roleplay 层；实体关系、阵营关系写在对应 lorebook 节点正文或 refs 中。重要势力可用势力专精 actor 扮演。 |
| `rule` | 不作为正式协议类型。世界内规则归 `world`，AI 指令归 `instruction`，机制规则归 `system`。 |
| `note` | 不作为稳定 lorebook 类型。低置信导入、未整理资料和临时说明优先进入 `reference/` 或待 review 区。 |
| `formatting` | 不做独立 type。状态栏格式或输出格式归入 `instruction` 或 `system`。 |
| `dynamic-mvu` | 不属于稳定 lorebook；保留在 `reference/` 或后续 RP mechanics 迁移任务。 |
| `dynamic-prompt` | 不属于稳定 lorebook；保留在 `reference/` 或后续 prompt / mechanics 迁移任务。 |

### Default Template Vs Project Extension

默认模板只放通用高频顶层目录。协议支持更多类型，但不把所有支持类型都放进默认模板。

项目可以按题材把高频类型提升为顶层目录：

- 种族设定很重要：使用 `lorebook/species/`。
- 学院政治很重要：使用 `lorebook/organization/`。
- 怪物生态很重要：使用 `lorebook/creature/`。

自定义目录的目标是让作者管理更直觉，不是制造新的系统特例。系统、Agent 和导入器仍优先读取节点 frontmatter。

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
- `system/`：RP/玩法/状态/变量机制。

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

## Knowledge Declaration Model

本任务先记录模型，不定义完整 schema。

### Lorebook Declaration

lorebook 条目声明的是“这类信息默认谁能知道、谁不能知道、需要什么条件才能知道”。

例子：

```text
只有精灵了解翠梦晶露。
只有高等精灵才知道翠梦晶露的具体用途。
非精灵通常只听过它是某种稀有精灵材料。
```

这类声明可以在后续 GraphRAG 中变成知识边：

```text
翠梦晶露 -- known_by(existence) --> 精灵
翠梦晶露 -- known_by(use_detail) --> 高等精灵
翠梦晶露 -- usually_unknown_by(use_detail) --> 非精灵
```

重要点：

- lorebook declaration 是默认规则，不等于所有角色的实际已知状态。
- declaration 应区分“知道存在”“知道传闻”“知道用途”“知道秘密细节”等信息层级。
- declaration 未来可以为 actor context-load sidecar 提供过滤依据。

### Character Declaration

角色自己的 `knowledge.md` 记录的是“这个角色实际知道什么，以及它如何知道”。

例子：

```md
### 翠梦晶露

罗恩在十年前的一次冒险中经过某座城市时，曾在酒馆里从一名流亡精灵口中听说过翠梦晶露。他知道这是一种与精灵秘仪相关的稀有材料，但并不知道它的完整用途。
```

这可以覆盖 lorebook 的默认声明：

- lorebook 默认说“非精灵通常不知道翠梦晶露”。
- 罗恩不是精灵，但他的 `knowledge.md` 声明了一个具体剧情来源。
- 因此 actor context-load 可以允许罗恩知道“存在和传闻层级”的信息，但不能自动给他“高等精灵才知道的具体用途”。

重要点：

- `knowledge.md` 是角色视角事实，不是 canonical truth。
- 角色声明可以覆盖默认知识规则，但最好记录来源、时间、可信度或获得方式。
- 这种覆盖不是任意授权；它只授予文本中明确写出的知识层级。

### Merge Rule Draft

后续 actor context-load sidecar 可以按这个顺序合并上下文：

1. 从 GM packet 提取当前 actor 可感知的事实。
2. 从 actor 自己的 `knowledge.md` 读取实际已知信息。
3. 从相关 lorebook 条目读取默认知识声明。
4. 只注入当前 actor 被允许知道的层级。
5. 把 GM-only secret、其他角色内心、未触发秘密留给 GM。

这能保持 actor 上下文纯洁：actor 不直接读取完整上帝视角 lorebook，而是获得经过 GM/sidecar 过滤后的角色视角材料。

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

## Decisions

### Accepted In This Pass

- 新增独立任务 `28-lorebook-information-control-protocol`。
- 第一版默认 lorebook 顶层目录为 `world / character / location / faction / item / event / system`，外加入口说明 `lorebook/index.md`。
- 支持类型全集大于默认模板目录；`species`、`creature`、`organization`、`instruction` 可以作为受支持扩展类型继续设计。
- 不把 `species` 作为默认顶层目录，但支持项目在种族高频时提升为 `lorebook/species/`。
- 新增 `creature` 作为生物、魔物、动物和植物的扩展类型；默认可归入 `world/ecology/`，高频项目可提升为 `lorebook/creature/`。
- 不把 `organization` 作为默认顶层目录，但支持项目在组织高频时提升为 `lorebook/organization/`。
- 不再设计 `relationship` 类型；人物关系下放 actor 层，实体关系和阵营关系写在对应 lorebook 节点正文或 refs 中。
- 不再兼容 `rule` 为正式协议类型；世界内规则进入 `world/rule/`，AI 写作/运行说明优先用 `instruction` 表达。
- `note` 不作为正式协议类型；低置信导入和未整理资料应优先进入 `reference/` 或待 review 区。
- lorebook 不再推荐同级 `state.md`；动态状态进入 `roleplay/actors/{actor-id}/state.md`、Plot 或 playthrough。
- 简介和故事概念不作为默认 lorebook 条目；短简介进 `project.yaml.summary`，长概念进 planning / `PROJECT-STATUS.md`，稳定事实拆入具体 lorebook。
- 目录层级用于人类管理、AI 浏览和语义表达；系统合同以 frontmatter 为准。标准内容节点应显式写 `type`。
- `lorebook/index.md` 应介绍当前项目的 lorebook 目录结构、项目扩展目录和不应放入 lorebook 的内容。
- `dynamic-mvu` 和 `dynamic-prompt` 不进入稳定 lorebook；继续保留在 `reference/`，后续由 RP mechanics / prompt migration 任务处理。
- 信息控制先采用“lorebook 默认声明 + character knowledge 实际声明”的双层模型；具体 schema 后续讨论。

### Deferred

- 完整 information-control frontmatter schema。
- 正文分区规范。
- actor context-load sidecar 的过滤算法。
- writer retrieval 如何读取 `instruction` 与 GM-only 内容。
- GraphRAG 的 `who knows what` 边类型和知识层级。
- 旧 `state.md` 合同与非 RP writer 读取行为如何迁移。

## Files Changed

- `docs/tasks/28-lorebook-information-control-protocol/README.md`

## Verification

- 已阅读当前 novel lorebook template、workspace-files lorebook type 校验、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` worldbook 条目样本。
- 本次只更新设计文档，未运行代码测试。

## TODO / Follow-ups

- 设计 lorebook information control frontmatter schema。
- 设计正文分区规范，例如 `Public Canon`、`Actor Safe Summary`、`GM Secrets`、`Writer Notes`。
- 更新 workspace-files lorebook type 校验，支持默认类型和受支持扩展类型，移除 `rule` / `note` 作为正式协议类型的长期目标。
- 更新 novel directory template，新增 `lorebook/index.md`，并把 `story-concept`、`synopsis`、`project-positioning`、`initial-plot-seed` 从默认 lorebook 节点迁出或降级为 planning 材料。
- 更新 SillyTavern 导入映射：`event -> lorebook/event`，`system -> lorebook/system`，世界规则进入 `world/rule`，种族/组织/生物按项目目录策略进入默认子目录或提升目录。
- 复核旧 `spec/content/state.md` 和 writer 读取同级 `state.md` 的合同，决定 lorebook 协议收敛后是否仅在非 RP 写作链路保留。
- 为 actor context-load sidecar 设计基于 knowledge declaration 的过滤策略。
- 为 GraphRAG 设计 `who knows what` 的边类型和知识层级。
