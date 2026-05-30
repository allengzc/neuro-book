# Roleplay Runtime Structure

## Purpose

本文记录 NeuroBook RP 模式的目录结构和运行协议设计。本轮设计 roleplay 优先，写作模式只作为共享设定资产来源，不展开详细写作流程。

当前约束：

- 不设计记忆持久化。
- 不实现完整变量系统。
- 不复刻 SillyTavern 前端 JS、MVU runtime 或 Prompt Template runtime。
- 已把 `SidecarProfilePass` 作为后续设计记录到 `docs/tasks/23-agent-sidecar-profile-pass/README.md`，本次 spike 先不实现。
- 重点设计一个最小可行 RP Tick：用户行动 -> GM -> actors -> GM -> writer -> 用户结果。

## Core Model

最基础 RP 模式由三类 agent 组成：

- `leader.rp` / `GM`：用户进入 RP 模式后的主控 agent。`leader.rp` 是推荐 profile 名，`GM` 是它在 RP 流程里的职责名，负责剧情推进、世界演化、规则裁决、信息控制和 actor 调度。
- `rp.actor`：通用角色扮演 agent，只基于角色可知信息、当前观察和角色动机回应。
- `rp.writer`：负责把 GM 的结果写成用户可读正文，不直接承担规则裁决。

用户也是故事中的扮演者。区别是 GM 不直接把裁决和推理暴露给用户，而是通过 writer 生成结果。

推荐把一次用户输入到最终输出称为一个 Tick：

```text
user input
-> GM intake
-> GM validate / adjudicate
-> GM select active actors
-> GM send filtered observation packets
-> actors return response packets
-> GM resolve world simulation
-> GM build writer brief
-> writer produce user-facing prose
```

## Entry Model

第一版推荐新增 `leader.rp`，而不是让 `leader.default` 每次创建一个 `rp.gm` 再要求用户切换上下文。

`leader.rp` 的好处：

- 用户一开始就和 RP 主控对话，进入模式后不用在 leader / GM session 之间来回切换。
- `leader.rp` 可以直接读取 `roleplay/` 目录，把 GM 职责作为自身运行协议。
- 后续如果需要把 GM 拆成独立 subagent，仍可以保留 `leader.rp` 作为用户入口，由它创建或连接 `rp.gm`。

兼容路径：

- `leader.default` 仍可以通过 skill 初始化 RP 目录、创建 GM session 或调用已有 GM。
- 如果采用独立 GM session，skill 必须明确提醒用户切换到哪个 session 继续 RP，避免用户继续在普通 leader 对话里输入行动。

## Information Layers

RP 目录结构必须明确三层信息边界。

### Canonical / God View

给 GM 使用。包含世界真实设定、隐藏背景、角色秘密、系统机制和事件真相。

来源包括：

- `lorebook/character/...`
- `lorebook/location/...`
- `lorebook/faction/...`
- `lorebook/rule/...`
- `lorebook/note/...`
- `roleplay/AGENTS.md`
- `roleplay/gm.md`
- `reference/silly-tavern/...`

actor 默认不能直接读取这一层。

### Actor Belief View

给 actor 使用。它不是“真相的子集”，而是角色相信、知道、误解、关心的世界。

这一层可以包含：

- 角色明确知道的事实。
- 角色错误相信的事实。
- 角色对其他人的关系判断。
- 角色目标、偏好、禁忌、说话方式。
- GM 在当前 Tick 注入的观察信息。

### Narratable View

给 writer 使用。它只包含“可以写给用户看的内容”。

writer 不应默认读取完整上帝视角 lorebook。否则容易提前泄露秘密或把 GM 推理写进正文。GM 应明确告诉 writer：

- 本 Tick 已确认发生了什么。
- 哪些台词、动作、反应可以写出。
- 哪些隐藏真相不能写出。
- 是否允许写角色内心。
- 目标文风、篇幅、视角和输出格式。

## Proposed Directory Structure

```text
roleplay/
|-- config.yaml
|-- AGENTS.md
|-- cast.yaml
|-- gm.md
|-- writer.md
|-- actors/
|   `-- {actor-id}/
|       |-- actor.md
|       `-- knowledge.md
```

`roleplay/` 第一版默认只由 `leader.rp` / GM 直接读取。actor 和 writer 不把整个目录当作工作区；它们只接收 GM 或 runtime 自动注入的特定文件与 packet。

### Root Files

- `AGENTS.md`：`leader.rp` / GM 的入口说明。它面向读取 `roleplay/` 的主控 agent，而不是面向所有 subagent。
- `config.yaml`：RP 运行配置，例如默认 GM profile、actor profile、writer profile、默认玩家 actor、默认 cast。
- `cast.yaml`：本局可调度 actor 注册表。为了减少零散目录，第一版不再使用 `cast/cast.yaml`。
- `gm.md`：GM 专用运行协议，包含可读范围、信息披露规则、Tick 协议、actor packet 模板和 writer brief 模板。
- `writer.md`：`rp.writer` 的自动注入提示词来源，描述文风、输出契约、禁止事项和 writer brief 消费规则。它不是 `AGENTS.md`，因为 writer 不应把整个 `roleplay/` 当作自己的工作目录。

### No `imports/`

第一版 `roleplay/` 只保存 RP 编排和角色运行资料，不再保存 `imports/`。

SillyTavern 原始素材、解包报告和动态脚本归档继续放在：

```text
reference/silly-tavern/{card-slug}/...
```

稳定可复用设定继续进入：

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/rule/...
lorebook/note/...
```

如果导入器识别到 MVU、状态栏、Prompt Template、regex scripts 等 RP 动态机制，第一版只在 `reference/silly-tavern/...` 中保留迁移说明，后续再由 GM 或专门工具转写到 `roleplay/gm.md`、`roleplay/writer.md` 或 actor 文件中。

### `cast.yaml`

`cast.yaml` 是编排层，不保存角色正文设定。它回答“这场 RP 里有哪些 actor、谁当前在场、谁由用户操控、哪些 actor 默认启用、actor 对应哪个 profile 和知识目录”。

示例：

```yaml
defaultPlayerActor: player
defaultActorProfile: rp.actor
defaultWriterProfile: rp.writer

actors:
  - id: player
    name: 主角
    kind: player
    profile: rp.actor
    instruction: roleplay/actors/player/actor.md
    knowledge: roleplay/actors/player/knowledge.md
    controlledBy: user
    defaultActive: true

  - id: erina
    name: 天原绘璃奈
    kind: npc
    profile: rp.actor
    instruction: roleplay/actors/erina/actor.md
    knowledge: roleplay/actors/erina/knowledge.md
    canonicalSource: lorebook/character/000601-DLC-角色-天原绘璃奈
    defaultActive: false
```

`cast.yaml` 可以支持的功能：

- GM 快速枚举本局可调度 actor。
- 标记玩家操控角色，例如 `controlledBy: user`。
- 记录 actor 是否在当前默认 cast 中启用。
- 把 actor 运行目录映射到 canonical lorebook 来源。
- 支持多主角、多玩家、临时 NPC、势力 actor、旁白 actor。
- 支持后续 UI 展示“当前演员表”和 active actor 选择。

玩家操控角色也必须是 `roleplay/actors/{actor-id}/` 下的 actor。GM 仍应把用户视为故事内 actor，但不能替用户决定核心行动意图。

### `actors/{actor-id}/`

actor 目录只放该 actor 可用的信息。第一版每个 actor 只保留两个文件，避免把角色资料拆得过散：

- `actor.md`：作者设定的角色扮演指令，包括角色身份、人格、语气、目标、行动原则、扮演限制。
- `knowledge.md`：角色已知事实、信念、误解、关系、地点认知。

如果某个角色不知道自己的隐藏身世，这部分不能写入 actor knowledge，应只留在 GM 可读的 canonical layer。

玩家角色也使用同样结构：

```text
roleplay/actors/player/
|-- actor.md
`-- knowledge.md
```

玩家 actor 的作用不是让模型替用户做决定，而是让 GM 知道玩家角色的基础身份、能力边界、当前已知信息和可验证资源。用户每 Tick 的输入仍是玩家角色的最高行动来源。

### `writer.md`

`writer.md` 是 `rp.writer` 的提示词素材，不是 writer 的工作目录。

`rp.writer` 是独立 profile。实现上可以先复制现有 writer profile，再针对 RP 输入参数和提示词微调。它不复用普通写作 writer 的 profile 身份，以避免“小说章节写作”和“Tick 结果渲染”混在一起。

第一版不实现 writer 自主检索 lorebook 的 sidecar。GM 需要在 writer brief 中放入本 Tick 必须知道、且可以写给用户看的 lorebook 摘要或限制。

### No Default `sessions/`

快速 spike 阶段不做持久化记忆，因此默认不创建 `sessions/`。当前场景和参与者先由 GM 的运行输入、用户消息和临时上下文携带。后续需要持久化 session、回放或调试时，再单独引入 `roleplay/sessions/`。

## Agent Profiles

### `leader.rp`

职责：

- 作为用户进入 RP 模式后的主 session。
- 读取 `roleplay/AGENTS.md`、`roleplay/config.yaml`、`roleplay/cast.yaml`、`roleplay/gm.md`。
- 初始化或连接本局 actors。
- 理解用户输入是行动、台词、剧本式指令还是混合输入。
- 验证用户行动是否合理。
- 读取 canonical / god view。
- 选择本 Tick 需要调用哪些 actor。
- 向 actor 注入 filtered observation packet。
- 汇总 actor response。
- 推进剧情和世界模拟。
- 生成 writer brief。

`leader.rp` 可以被理解为内置 GM 职责的 leader。第一版推荐直接使用它，不额外创建 `rp.gm`。

### Optional `rp.gm`

`rp.gm` 可以作为兼容或后续拆分方向保留：

- 如果 `leader.default` 负责启动 RP，它可以创建 `rp.gm` session，并提醒用户切换过去。
- 如果未来 GM 需要后台运行或被多个入口复用，可以把 GM 从 `leader.rp` 中拆成独立 profile。
- 本次 spike 不优先实现 `rp.gm`。

GM 职责不应该：

- 直接向用户输出最终正文。
- 让 actor 读取上帝视角 lorebook。
- 在 writer brief 中泄露不该被用户知道的秘密。
- 替用户决定核心行动。

### `rp.actor`

职责：

- 全心全意扮演一个角色。
- 只基于 actor knowledge 和 GM 当前 packet 作出反应。
- 输出结构化 response packet，而不是最终小说正文。
- 可以给 GM 报告角色内心、意图、疑问，但不直接面向用户。

actor 不应该：

- 使用上帝视角信息。
- 操控用户角色。
- 直接推进全局世界状态。
- 写最终 prose。

### `rp.writer`

职责：

- 根据 GM writer brief 输出用户可读正文。
- 保持文风、节奏、视角和沉浸感。
- 不输出 GM 的推理过程。
- 不泄露 GM 标记为 hidden 的内容。

实现策略：

- 新增独立 `rp.writer` profile。
- 初版直接复制现有 `writer` profile，再针对 RP 输入参数和提示词微调。
- 微调输入参数，使其消费 `writerBrief`、`style`、`doNotReveal`、`allowedInternality`、`outputRequirements`。
- 提示词上强调它只负责 Tick 结果渲染，不负责世界裁决和角色私密决策。
- `rp.writer` 不读取 `roleplay/AGENTS.md`，只接收 GM brief 和自动注入的 `roleplay/writer.md`。

## Initialization Flow V0

第一版只做初始化，不展开继续 RP 的复杂恢复。

### 1. User Enters RP Mode

用户从普通 leader 或 skill 入口启动 RP 模式。

推荐路径：

```text
user -> leader.rp session
```

`leader.rp` 启动后读取：

- `roleplay/AGENTS.md`
- `roleplay/config.yaml`
- `roleplay/cast.yaml`
- `roleplay/gm.md`
- `roleplay/writer.md`

然后根据 `config.yaml` 和 `cast.yaml` 判断是否已有可用 actor。

收到用户第一条 RP 指令后，`leader.rp` 先判断这是初始化还是继续已有 RP。V0 只实现初始化；继续已有 RP 暂时不展开持久化恢复。

兼容路径：

```text
user -> leader.default -> create rp.gm session -> user switches to rp.gm
```

如果使用兼容路径，启动 skill 必须把目标 session 说清楚。

### 2. GM Loads Canonical Context

初始化时，GM 按 `roleplay/AGENTS.md` 和 `roleplay/gm.md` 的指导熟悉相关文件。作者可以在这些文件里定义启动时必须查看的范围，例如：

- 世界观总览。
- 世界规则。
- 当前剧情状态。
- 默认地点。
- 初始登场角色。
- 从 SillyTavern 导入的参考报告。

这些文件属于 God View。GM 可以读取隐藏设定，但必须在后续 actor packet 和 writer brief 中做信息过滤。

### 3. GM Creates Actor Sessions

GM 根据 `cast.yaml` 初始化本局 actors。设计目标是创建全部 cast actors，让后续 Tick 可以快速调度；如果 spike 实现成本过高，可以先 lazy-create 默认 active actors，但这是实现折中，不改变目录设计。

每个 actor 初始化输入至少包含：

- actor id 和显示名。
- `roleplay/actors/{actor-id}/actor.md` 路径。
- `roleplay/actors/{actor-id}/knowledge.md` 路径。
- GM 给出的初始场景观察。

第一版 actor 可以开放文件编辑工具，让它在必要时自己更新 `knowledge.md`。这和后续 sidecar 设计不同：sidecar 的目标是保持主扮演上下文纯洁，本次 spike 先接受更直接的工具开放方式，以便快速验证流程。

### 4. Actor Profile Consumes Author Instruction

`rp.actor` 是通用 profile；具体角色差异来自 `actor.md` 和 `knowledge.md`。

`actor.md` 由作者维护，可以包含：

- 角色身份。
- 人格和说话方式。
- 行动原则。
- 与玩家或其他角色的关系基调。
- 扮演禁忌。
- 特定输出偏好。

`knowledge.md` 记录角色相信或知道的事实。它可以和 canonical truth 不一致。

### 5. Enter Tick Loop

初始化完成后，`leader.rp` 进入 Tick 流程：

```text
user action / dialogue / instruction
-> leader.rp as GM
-> selected rp.actors
-> leader.rp world resolution
-> rp.writer
-> user-facing output
```

第一版默认为非抢话模式：没有用户输入时，actor 不主动抢叙事权。

## Tick Protocol V0

### 1. GM Intake

GM 解析用户输入类型：

- `action`：角色行动。
- `dialogue`：角色台词。
- `instruction`：剧本式指令，例如“介绍一下这个道具”。
- `mixed`：动作、台词、指令混合。

GM 需要把用户输入转成当前 Tick 的意图，不擅自扩展用户未表达的关键行动。

### 2. Validation / Adjudication

GM 根据当前场景和 canonical context 验证：

- 用户角色是否在场。
- 用户是否持有相关物品。
- 目标角色是否能观察到该行动。
- 行动是否违反世界规则。
- 是否需要失败、部分成功、代价或额外信息。

### 3. Actor Selection

GM 不应每 Tick 调用所有 actor。只选择 active actors：

- 当前场景在场者。
- 被用户行动直接影响者。
- 有强烈动机反应者。
- 需要推进远处世界状态的关键角色或势力。

第一版只做非抢话模式：每个 Tick 由用户输入触发，actor 不主动抢用户输入前的叙事权。

### 4. GM -> Actor Packet

GM 给 actor 的信息必须是角色合理可获得的信息。

模板：

```text
actor: {actor-id}
scene:
  location:
  visible_participants:
  immediate_observations:

event:
  user_action:
  observable_effects:

known_to_you:
  - ...

not_known_to_you:
  - ...

task:
  Respond as this character.
  Do not use information outside this packet and your actor knowledge.
```

示例：用户把“世界之心”交给女主。

```text
actor: heroine
event:
  user_action: 主角把一块五彩缤纷的石头交到你手里。
observable_effects:
  - 石头隐约有异常力量感。
  - 你无法确认它的真实名称和用途。
not_known_to_you:
  - 不知道它叫“世界之心”。
  - 不知道它的完整机制。
task:
  基于你的性格、当前关系和有限认知回应。
```

### 5. Actor -> GM Response Packet

actor 返回结构化信息：

```text
visible_action:
spoken_dialogue:
private_intent:
emotional_state:
assumptions:
questions_to_gm:
```

说明：

- `visible_action` 和 `spoken_dialogue` 可进入 writer brief。
- `private_intent` 和 `emotional_state` 只给 GM，用于后续推进。
- `questions_to_gm` 表示 actor 需要 GM 裁决的信息。

### 6. GM Resolution

GM 汇总 actor responses，并进行：

- 行动结果裁决。
- 场景变化。
- NPC 反应合并。
- 世界规则触发。
- 后续冲突或悬念安排。

GM 可以使用 canonical hidden facts，但必须决定哪些可以进入 narratable view。

### 7. GM -> Writer Brief

writer brief 只包含可写内容。

模板：

```text
scene_summary:
confirmed_events:
visible_actor_actions:
spoken_dialogue:
narration_goals:
style:
do_not_reveal:
allowed_internality:
output_requirements:
```

示例：

```text
confirmed_events:
  - 主角把一块五彩缤纷的石头递给女主。
  - 女主感到疑惑和隐约震撼。
  - 女主询问这是什么。
do_not_reveal:
  - 不要写出“世界之心”的真实名称，除非用户已在角色可听见范围内说明。
  - 不要写出 GM 对该物品完整机制的判断。
allowed_internality:
  - 可以写女主的疑惑、迟疑和本能震撼。
  - 不可以写她不知道的物品真相。
```

### 8. Writer Output

writer 输出最终用户可见文本。输出中不应包含：

- GM 裁决过程。
- actor response packet。
- 隐藏设定。
- 后台调度说明。

## Knowledge Control Rules

1. `lorebook/character/` 是上帝视角角色设定，默认只给 GM 和开发者。
2. actor 只能读取 `roleplay/actors/{actor-id}/` 和 GM packet。
3. `rp.writer` 只读取 GM writer brief 和自动注入的 `roleplay/writer.md`，不默认读取完整 lorebook。
4. GM 每 Tick 只向 actor 注入合理可观察信息。
5. actor knowledge 可以包含错误信念。GM 负责区分 belief 与 canonical truth。
6. 用户是 actor，并且应在 `roleplay/actors/{player-id}/` 下拥有自己的 actor 目录；用户输入可以是行动、台词或剧本式指令，GM 负责把它转为故事内可执行意图。
7. 非抢话模式下，actor 只在用户 Tick 后响应；抢话模式后续单独设计。
8. 第一版允许 actor 通过文件工具维护自己的 `knowledge.md`；后续如果实现 sidecar，应把知识更新移到独立旁路 run，减少主扮演上下文污染。
9. 第一版不让 `rp.writer` 自主检索 lorebook；GM 必须把可写信息整理进 writer brief。后续 sidecar 可补“写作前检索相关 lorebook”。

## Sidecar Boundary

用户提出的“主流程保持纯净，旁路 run 负责检索或更新知识”的机制已经记录为 `SidecarProfilePass`。本次 roleplay spike 先不实现，但目录设计需要给它留位置。

未来可接入的两个旁路：

- `rp.writer` prepare-run sidecar：先退出写作模式，检索本次 writer brief 相关 lorebook，再把可写摘要注入主写作上下文。
- `rp.actor` settle-run sidecar：主扮演回复完成后，退出扮演模式，生成 `knowledge.md` 更新建议或直接执行受控写入。

本次 spike 的临时策略：

- writer：由 GM 主动整理 lorebook 摘要，不让 writer 查文件。
- actor：允许 actor 读取和编辑自己的 `knowledge.md`，优先验证多 actor RP Tick 是否成立。
- 所有 sidecar 相关实现推迟到 `docs/tasks/23-agent-sidecar-profile-pass/README.md` 后续任务。

## Open Questions

- actor knowledge 是由导入器自动生成初稿，还是由 GM skill 手动维护。
- 是否需要 `roleplay/actors/{actor-id}/secrets.md` 表示“角色自己知道但其他 actor 不知道”的信息。
- `rp.writer` 从现有 writer profile 复制后，具体要删改哪些普通章节写作参数。
- 是否需要 debug 模式保存 Tick scratch；默认不创建 `sessions/`。
- 后续抢话模式如何定义 actor 主动行动的触发条件。
- `leader.rp` 是否需要完全取代 `rp.gm`，还是保留独立 `rp.gm` 给高级编排使用。
- actor 初始化时创建全部 cast actors，还是只创建当前 active actors。
- actor 第一版开放文件编辑工具后，是否需要限制只能写自己的 `knowledge.md`。

## Next Steps

- 起草 `leader.rp` profile。
- 视需要保留 `rp.gm` profile 草案，但不作为第一优先级。
- 起草 `rp.actor` profile。
- 起草 `rp.writer` profile。
- 起草 `RP目录初始化` skill，使其能创建上述目录骨架。
- 设计 actor knowledge 从 SillyTavern worldbook / canonical lorebook 生成初稿的规则。
