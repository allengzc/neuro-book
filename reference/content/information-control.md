# Content Information Control

本文定义 NeuroBook 内容层的信息控制原则。第一版先固定模型，不定义完整 frontmatter schema、GraphRAG 边类型或自动可见性算法。

## Core Pattern

推荐模型是：

```text
Prototype / Instance + Event Sourcing + Subject-facing View
```

| Concept | Directory | Meaning |
| --- | --- | --- |
| Prototype | `lorebook/` | 类型、原型、全知规则、隐藏后果。 |
| Entity | `simulation/entities/` | 有状态实例。 |
| Subject | `simulation/subjects/` | 信息控制主体。 |
| Event Log | `events.md` | “怎么知道的 / 怎么变化的”流水。 |
| Snapshot | `state.md` | 当前状态快照。 |
| Knowledge | `knowledge.md` | subject 视角知道、相信或误解的内容。 |

引用路径不是可见性授权。`state.md` 或 `entity.md` 可以引用 `lorebook/...` 原型，但 subject 不能因为看到引用就读取完整 lorebook。

## Lorebook Is Omniscient

`lorebook/` 默认是全知、作者视角、AI 说明书。它可以记录：

- 世界真实设定。
- 角色秘密。
- 隐藏规则。
- 物品完整后果。
- 世界机制和玩法模块。

任何 subject / actor 都不能直接把完整 lorebook 当成自己的知识。subject 可见内容必须来自：

- 自己的 `subject.md`。
- 自己的 `events.md`。
- 自己的 `knowledge.md`。
- 自己的 `mind.md`。
- 自己的 `state.md`。
- simulator leader 过滤后的 subject-facing message。
- sidecar 过滤后的 actor-safe context。

## Subject Knowledge

`knowledge.md` 记录主体已经知道、被告知、观察到、自然推断到或误解的信息。

建议：

- 以自然语言写主体视角。
- 记录来源和获得过程时，优先写进 `events.md`，或在 knowledge 正文中简短说明。
- 不写上帝视角秘密。
- 不写“你不知道 X”清单；未知信息直接不出现。
- 不直接授权 subject 自行读取 `lorebook/...`。

例子：

```md
## 世界观

### 翠梦晶露

你在十年前的一次冒险中经过某座城市时，曾在酒馆里从一名流亡精灵口中听说过翠梦晶露。你知道这是一种与精灵秘仪相关的稀有材料，但并不知道它的完整用途。
```

## Entity State

entity 保存真实实例状态。subject 是否知道这些状态，由 subject knowledge 决定。

例子：

```text
lorebook/item/consumable/blood-potion/
simulation/entities/poisoned-blood-potion-001/
```

`entity.md`：

```yaml
kind: item
prototype: lorebook/item/consumable/blood-potion/
displayName: 血药
```

`state.md`：

```yaml
holder: simulation/subjects/npc-a/
condition:
  poisoned: true
subjectVisibleName: 血药
subjectVisibleProperties:
  - 看起来和普通血药没有区别
```

NPC-A 是否知道它有毒，不由 entity 决定，而由 `simulation/subjects/npc-a/knowledge.md` 决定。

## Relationship Patterns

创作中常见关系按四层记录：

| Relation Kind | Where | Example |
| --- | --- | --- |
| prototype relation | `lorebook/` | 血药属于消耗品；世界之心可以被分成三块。 |
| state relation | `simulation/entities/*/state.md` 或 `simulation/subjects/*/state.md` | NPC-A 持有某个碎片；某扇门已锁定。 |
| knowledge relation | `simulation/subjects/*/knowledge.md` | NPC-A 只知道自己碎片的能力，不知道其他碎片。 |
| event relation | `events.md` | NPC-A 在十年前从流亡精灵口中听说翠梦晶露。 |

这些关系可以互相引用，但不会自动互相泄露信息。

## Examples

三瓶普通血药：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

一瓶被下毒的血药：

```yaml
inventory:
  - entity: simulation/entities/poisoned-blood-potion-001/
    subjectVisibleName: 血药
```

世界之心三块碎片：

```text
lorebook/item/artifact/world-heart/
simulation/entities/world-heart-fragment-a/
simulation/entities/world-heart-fragment-b/
simulation/entities/world-heart-fragment-c/
```

每个持有者的 `knowledge.md` 只记录自己知道的碎片信息。不能因为 state 引用了 entity 或 entity 引用了 lorebook，就把全知规则暴露给 subject。

## Deferred Schema

后续再设计：

- lorebook 如何声明“谁默认知道什么、谁不知道什么”。
- `knowledge.md` 如何覆盖 lorebook 级默认声明。
- entity hidden state 如何转换为 subject-facing observation。
- simulator leader、subject simulator、entity simulator、writer、retrieval 分别能读取哪些正文分区。
- GraphRAG 如何表示 `who knows what`、`who holds what`、`what is where`。
- sidecar 如何把上帝视角设定过滤成 subject-facing context。

当前只固定原则：目录先分层，`lorebook/` 放 canonical / prototype，`simulation/subjects/` 放 information subject，`simulation/entities/` 放 stateful instance，`simulation/runs/` 放 run artifacts。
