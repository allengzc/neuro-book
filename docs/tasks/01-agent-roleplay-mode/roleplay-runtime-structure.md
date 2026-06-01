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

试用后的当前取舍：GM / `leader.rp` 直接面向用户。writer 是正文代笔，不是用户交互入口；GM 可以调用 writer 生成正文，再转述或直接贴给用户，也可以在简单 Tick 中自己叙述。

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
- `roleplay/gm.md`
- `reference/silly-tavern/...`

actor 默认不能直接读取这一层。

### Actor Knowledge View

给 actor 使用。它不是“真相的子集”，而是角色在故事内已经知道、被告知、观察到或自然理解的世界。

这一层可以包含：

- 角色明确知道的事实。
- 角色对其他人的关系判断。
- 角色目标、偏好、禁忌、说话方式。
- 角色可引用的公开世界观、地点常识和组织常识。
- GM 在当前 Tick 注入的观察信息。

如果 actor knowledge 中的信息与 canonical truth 不一致，由 GM / leader 在后台判断。actor 自己不需要、也不应该在 `knowledge.md` 里标注“这是误解”。

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
|-- cast.yaml
|-- gm.md
|-- writer.md
|-- run/                  # proposed, name TBD; current playthrough / tick artifacts
|   |-- current.md
|   `-- ticks/
|       `-- 000001/
|           |-- user-input.md
|           |-- gm-scratch.md
|           |-- actors/
|           |-- writer-brief.md
|           `-- prose.md
|-- actors/
|   `-- {actor-id}/
|       |-- actor.md
|       |-- knowledge.md
|       |-- mind.md
|       `-- state.md
```

`roleplay/` 第一版默认只由 `leader.rp` / GM 直接读取。actor 和 writer 不把整个目录当作工作区；它们只接收 GM 或 runtime 自动注入的特定文件与 packet。

## Directory Template

RP 目录模板位于：

```text
assets/workspace/.nbook/templates/roleplay-directory-templates/
```

它不是默认小说目录模板的一部分。普通小说项目仍由 `novel-directory-templates` 创建；RP 是按需安装到已有 Project Workspace 的扩展目录。

安装入口复用 Project Workspace 模板命令：

```text
workspace project create my-novel --template roleplay-directory-templates
workspace project create my-novel --target /path/to/project --template roleplay-directory-templates
```

同一个命令的语义：

- 目标不存在时：创建完整 Project Workspace，未显式传 `--template` 时默认使用 `novel-directory-templates`。
- 目标已存在且显式传 `--template` 时：把模板文件补入现有 Project Workspace，只创建缺失文件，已有文件进入 `skippedFiles`，不覆盖用户内容。
- 目标已存在但未显式传 `--template` 时：报错，避免把“创建项目”和“补模板”混淆成误操作。
- 传入 `--target <dir>` 时：`<dir>` 是实际 Project Workspace 根目录；相对路径按当前 cwd 解析，模板覆盖层仍来自当前 Workspace Root 的 `.nbook/templates`。

`--json` 输出会返回 `mode: "created"` 或 `mode: "updated"`。RP 初始化 skill 后续应读取 `createdFiles` / `skippedFiles` 向用户报告实际写入结果。

不要设计或提示第二套模板安装命令。使用项目模板和使用 roleplay 模板都走 `workspace project create`。

### Root Files

- `config.yaml`：RP 运行配置，例如默认 GM profile、actor profile、writer profile、默认玩家 actor、默认 cast、fallback scene、profile 输入边界和 Tick checklist。
- `cast.yaml`：本局可调度 actor 注册表。为了减少零散目录，第一版不再使用 `cast/cast.yaml`。
- `gm.md`：GM 唯一入口说明和专用运行协议，包含可读范围、信息披露规则、Tick 协议、profile 调用边界、actor packet 模板和 writer brief 模板。
- `writer.md`：`rp.writer` 的自动注入提示词来源，描述文风、输出契约、禁止事项和 writer brief 消费规则。writer 不应把整个 `roleplay/` 当作自己的工作目录。

### `run/` / Playthrough Artifacts

`session` 这个名字容易和 Agent Session 混淆，暂不推荐直接使用。当前更倾向把“本局游戏进程、Tick 产物、writer 正文文件”放进 `roleplay/run/`，但名字仍待定，也可以继续讨论 `playthrough/`、`runtime/`、`current-run/`。

第一版设计目标不是长期记忆，而是保存当前游玩过程中的可检查产物：

- `current.md`：当前场景、人称视角、世界时钟、最近 Tick 摘要和下一步待处理事项。
- `ticks/{tick-id}/user-input.md`：用户本 Tick 的原始输入。
- `ticks/{tick-id}/gm-scratch.md`：GM 内部裁决、隐藏信息、actor 选择和不应给用户看的判断。
- `ticks/{tick-id}/actors/{actor-id}.result.json`：actor 本 Tick 的结构化结果。后续如果引入 sidecar，这里可以保存旁路整理后的结果，而不是 actor 主扮演上下文亲自写出的工具参数。
- `ticks/{tick-id}/writer-brief.md`：GM 发给 writer 的可写正文 brief。
- `ticks/{tick-id}/prose.md`：writer 生成或 GM 最终确认的用户可见正文。

关键边界：

- `run/` 是本局过程记录，不是 canonical lorebook，也不是 actor 长期记忆。
- actor 默认不读取 `run/`，除非 GM 把其中内容过滤后注入。
- writer 可以在 GM 明确要求时把正文写入 `run/ticks/{tick-id}/prose.md`，但不自行浏览完整 `run/`。
- 后续如果实现回放、debug、存档或分支剧情，优先扩展 `run/`，不要把这些内容塞进 `knowledge.md`。

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
    mind: roleplay/actors/player/mind.md
    state: roleplay/actors/player/state.md
    controlledBy: user
    defaultActive: true

  - id: erina
    name: 天原绘璃奈
    kind: npc
    profile: rp.actor
    instruction: roleplay/actors/erina/actor.md
    knowledge: roleplay/actors/erina/knowledge.md
    mind: roleplay/actors/erina/mind.md
    state: roleplay/actors/erina/state.md
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

actor 目录只放该 actor 可用的信息。第一版每个 actor 保留四个文件：

- `actor.md`：作者设定的角色扮演指令，包括角色身份、人格、语气、目标、行动原则、扮演限制。
- `knowledge.md`：角色已知世界观、事实、关系、地点认知和可引用的可知 lorebook 条目。它是给 actor 看的角色视角资料，不写上帝视角。
- `mind.md`：角色当前正在想什么、判断什么、犹豫什么、想要什么。
- `state.md`：角色当前位置、持有物、伤势、姿态、关系压力和短期目标。

如果某个角色不知道自己的隐藏身世，这部分不能写入 actor knowledge，应只留在 GM 可读的 canonical layer。

玩家角色也使用同样结构：

```text
roleplay/actors/player/
|-- actor.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

玩家 actor 的作用不是让模型替用户做决定，而是让 GM 知道玩家角色的基础身份、能力边界、当前已知信息和可验证资源。用户每 Tick 的输入仍是玩家角色的最高行动来源。

### `writer.md`

`writer.md` 是 `rp.writer` 的提示词素材，不是 writer 的工作目录。

`rp.writer` 是独立 profile。实现上可以先复制现有 writer profile，再针对 RP 输入参数和提示词微调。它不复用普通写作 writer 的 profile 身份，以避免“小说章节写作”和“Tick 结果渲染”混在一起。

第一版不实现 writer 自主检索 lorebook 的 sidecar。GM 需要在 writer brief 中放入本 Tick 必须知道、且可以写给用户看的 lorebook 摘要或限制。

试用后调整：

- `rp.writer` 可以使用 bash 与文件读写工具。
- 工具只用于 GM 明确指定的读取素材或输出路径；writer 仍不自行遍历完整 `roleplay/`、`lorebook/` 或 `reference/`。
- `rp.writer` 只写正文，不写行动选项、确认问题、GM 控制面或摘要。
- 常规 Tick 中，writer 通过普通 assistant 回复输出正文，不再通过 `report_result.data.prose` 返回。

### No Default `sessions/`

快速 spike 阶段仍不做持久化记忆，因此默认模板可以先不创建 `sessions/`。如果需要保存本局过程，优先设计 `roleplay/run/` 这类 playthrough artifacts 目录，而不是使用 `sessions/` 命名，避免和 Agent Session 概念冲突。

## Agent Profiles

### `leader.rp`

职责：

- 作为用户进入 RP 模式后的主 session。
- 读取 `roleplay/config.yaml`、`roleplay/cast.yaml`、`roleplay/gm.md` 和 `roleplay/writer.md`。
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

第一版实现状态：

- 已新增 builtin profile `leader.rp`。
- 创建 input 只有可选 `roleplayRoot`；每轮用户行动仍通过普通 prompt 进入。
- `leader.rp` 持有读取、bash、agent 编排和用户询问工具，不直接写文件。
- 它通过 prompt 协议读取 `config.yaml`、`cast.yaml`、`gm.md`、`writer.md`，再创建/复用 `rp.actor` 与 `rp.writer`。`gm.md` 是唯一 GM 入口说明。

### Optional `rp.gm`

`rp.gm` 可以作为兼容或后续拆分方向保留：

- 如果 `leader.default` 负责启动 RP，它可以创建 `rp.gm` session，并提醒用户切换过去。
- 如果未来 GM 需要后台运行或被多个入口复用，可以把 GM 从 `leader.rp` 中拆成独立 profile。
- 本次 spike 不优先实现 `rp.gm`。

GM 职责不应该：

- 让 actor 读取上帝视角 lorebook。
- 在 writer brief 中泄露不该被用户知道的秘密。
- 替用户决定核心行动。

### `rp.actor`

职责：

- 全心全意扮演一个角色。
- 只基于 actor knowledge、mind、state 和 GM 当前 packet 作出反应。
- 输出结构化 response packet，而不是最终小说正文。
- 可以给 GM 报告角色内心、意图、疑问，但不直接面向用户。

actor 不应该：

- 使用上帝视角信息。
- 操控用户角色。
- 直接推进全局世界状态。
- 写最终 prose。

输入边界：

- `rp.actor` 只接收该 actor 的 `actor.md`、`knowledge.md`、`mind.md`、`state.md` 和 GM 当前 filtered observation packet。
- 第一版可给 actor 开放文件编辑工具，但作用域应限制为自己的 `knowledge.md`、`mind.md`、`state.md`。
- `rp.actor` 不接收完整 `roleplay/`、`lorebook/`、`reference/`、其他 actor knowledge 或 GM scratch。

第一版实现状态：

- 已新增 builtin profile `rp.actor`。
- 创建 input 绑定 `actorId`、`actorName?`、`kind?`、`instructionPath`、`knowledgePath`、`mindPath`、`statePath`。
- profile prepare 会自动读取并注入 `actor.md`、`knowledge.md`、`mind.md` 与 `state.md`。
- 每轮 GM packet 通过 `invoke_agent.message` 传入，不放进创建 input。
- 输出必须通过 `report_result.data` 返回 `visible_action`、`spoken_dialogue`、`private_intent`、`emotional_state`、`assumptions`、`questions_to_gm`、`knowledge_update`、`mind_update`、`state_update`。
- 现有文件工具还不能 runtime-enforce path scope；第一版用 profile prompt 严格要求 actor 只能读写自己的 `knowledgePath`、`mindPath`、`statePath`。

### `rp.writer`

职责：

- 根据 GM writer brief 输出用户可读正文。
- 保持文风、节奏、视角和沉浸感。
- 不输出 GM 的推理过程。
- 不泄露 GM 标记为 hidden 的内容。
- 不输出行动选项或确认问题；这些由 GM 负责。

实现策略：

- 新增独立 `rp.writer` profile。
- 第一版不复用普通 `writer` 的章节文件写入流程，只复用 profile DSL 和写作约束思路。
- 微调输入参数，使创建 input 绑定 `writerInstructionPath` 和稳定输出约束；每轮 writer brief 通过 `invoke_agent.message` 传入。
- 提示词上强调它只负责 Tick 结果渲染，不负责世界裁决和角色私密决策。
- `rp.writer` 只接收 GM brief 和自动注入的 `roleplay/writer.md`。
- `rp.writer` 不接收完整 `roleplay/`、`lorebook/`、`reference/` 或 GM scratch；brief 缺少的设定视为不可写信息。
- `rp.writer` 可以使用 read/write/edit/bash，但只操作 GM 明确指定路径。

第一版实现状态：

- 已新增 builtin profile `rp.writer`。
- 创建 input 绑定 `writerInstructionPath`，可选 `style`、`outputRequirements`、`language`。
- profile prepare 会自动读取并注入 `roleplay/writer.md`。
- `rp.writer` 开放 `read`、`write`、`edit`、`bash` 工具；它不自主检索 lorebook，只按 GM 明确路径读写。
- 常规输出是普通 assistant 正文，不要求 `report_result`，也不输出摘要。

## Initialization Flow V0

第一版只做初始化，不展开继续 RP 的复杂恢复。

### 1. User Enters RP Mode

用户从普通 leader 或 skill 入口启动 RP 模式。

推荐路径：

```text
user -> leader.rp session
```

`leader.rp` 启动后读取：

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

初始化时，GM 按 `roleplay/gm.md` 的指导熟悉相关文件。作者可以在这个文件里定义启动时必须查看的范围，例如：

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
- `roleplay/actors/{actor-id}/mind.md` 路径。
- `roleplay/actors/{actor-id}/state.md` 路径。
- GM 给出的初始场景观察。

第一版 actor 可以开放文件编辑工具，让它在必要时自己更新 `knowledge.md`、`mind.md`、`state.md`。这和后续 sidecar 设计不同：sidecar 的目标是保持主扮演上下文纯洁，本次 spike 先接受更直接的工具开放方式，以便快速验证流程。

### 4. Actor Profile Consumes Author Instruction

`rp.actor` 是通用 profile；具体角色差异来自 `actor.md`、`knowledge.md`、`mind.md` 和 `state.md`。

`actor.md` 由作者维护，可以包含：

- 角色身份。
- 人格和说话方式。
- 行动原则。
- 与玩家或其他角色的关系基调。
- 扮演禁忌。
- 特定输出偏好。

`knowledge.md` 记录角色在故事内已经知道、被告知、观察到或自然理解的信息。它是 actor 可直接读取的角色视角资料，不写上帝视角、幕后真相或 GM 裁决。

`knowledge.md` 的格式约定：

- 使用二级章节归类，例如 `## 世界观`、`## 人物认知`、`## 地点认知`、`## 物品与线索`。
- 每个具体条目使用三级标题，例如 `### 王都的公共传闻`。
- 条目正文使用自然段，不用 Markdown 列表堆条目。
- 不维护“信念与误解”“最近更新”或“更新规则”章节；如果角色视角信息与真相不一致，由 GM / leader 在后台判断，更新规则写在 profile prompt 中。
- 可以引用 GM 明确允许该角色知道的 lorebook 条目；actor 不能因此自行读取完整 lorebook。

`mind.md` 记录当前短期心理状态，例如疑虑、判断、动机和情绪倾向。

`state.md` 记录当前可变状态，例如位置、持有物、伤势、姿态、关系压力和短期目标。

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

重要调整：GM 内部可以用结构化字段组织场景、事件和 hidden facts，但发给 `rp.actor` 的消息不应是 YAML / JSON / 表单任务单。actor 消息应该使用自然语言和第二人称，把模型推进角色扮演状态，而不是 agent 填任务状态。

不要发给 actor：

- `not_known_to_you` 字段。角色不知道的内容直接不出现。
- `task` 字段。返回格式、工具调用要求和“不要写小说正文”等约束应放在 `rp.actor` profile system prompt 中。
- GM hidden facts、完整 canonical lorebook、其他 actor 私密意图或 writer brief。
- `actor:`、`scene:`、`known_to_you:` 这类让上下文像工单的字段名。

推荐发送风格：

```text
{角色名}，{当前场景已经发生了什么}。

你看见……
你听见……
你刚刚做过或说过……
你现在处在……压力下。

你知道……
你担心……
你需要维持/追求/避免……
```

示例：用户把“世界之心”交给女主。GM 内部知道它叫世界之心，但女主还不知道，所以 actor 消息不出现这个名称：

```text
他把那块五彩缤纷的石头交到了你手里。

石头比看起来更沉，表面像是有细小的光在缓慢流动。你说不出它是什么，也无法判断它是不是某种魔法道具，但它确实让你产生了一种很难忽视的力量感。

他没有立刻解释，只是把它交给了你。此刻你们仍在众人视线之中，你能感觉到自己掌心里的东西正在吸引注意。

你还不知道这块石头的名字，也不知道它真正能做什么。你只能根据眼前看到和感受到的东西反应。
```

完整样例：布劳尔子爵在勇者召唤仪式后的 actor 消息。

```text
阿曼德·布劳尔子爵，召唤仪式刚刚结束。

仪式大厅里的法阵余光还没有完全散去。两排铁甲卫兵守在大厅两侧，你身旁的持杖法师沉默地站着。被召唤而来的四个人就在你面前。

你亲眼看见，前三个人身上分别显现出了清晰的力量迹象：一个运动打扮的男生身前浮现金色光幕盾牌，一个洛丽塔装束的女孩周围迸出元素火花，一个戴眼镜的女生身旁环绕着符文光辉。

但第四个人不同。

那是一个白发、矮小到近乎孩子体型的人，穿着你完全不熟悉的奇异便装和运动鞋。她看起来不像骑士，也不像法师，更不像古书记载中的勇者。仪式完成后，她身上没有显现任何能力，只是站在原地，没有动作，也没有解释。

你刚刚压低声音问身边的法师：“这个是不是召唤的时候混进来的？”

法师没有回答。他只是移开了目光。

你很清楚自己为这场勇者召唤付出了多大的代价。布劳尔子爵领已经被危机逼到墙角，你急需真正能拯救领地的勇者。三个有能力的人让你看见了一点希望，可第四个人的存在让你尴尬、失望，也让你不安。

现在，所有人的视线都还在仪式大厅里。卫兵在看着你，法师在回避你，被召唤者们也在等你开口。

你必须维持贵族的体面，至少不能让场面立刻失控。
```

这个样例刻意不说“薇洛丝”、不说隐藏身份、不列 `not_known_to_you`，也不写返回格式。名字、隐藏能力和异世界知识留在 GM scratch / canonical layer，由 GM 决定何时、如何过滤给角色。

### 5. Actor -> GM Response Packet

actor 返回结构化信息：

```text
visible_action:
spoken_dialogue:
private_intent:
emotional_state:
assumptions:
questions_to_gm:
knowledge_update:
mind_update:
state_update:
```

说明：

- `visible_action` 和 `spoken_dialogue` 可进入 writer brief。
- `private_intent` 和 `emotional_state` 只给 GM，用于后续推进。
- `questions_to_gm` 表示 actor 需要 GM 裁决的信息。
- `knowledge_update`、`mind_update`、`state_update` 表示 actor 对自己三类文件的更新建议或已写入摘要。

工具参数命名建议：

- 现有 `report_result.walkthrough` 名字会诱导 actor 写过程解释，不适合沉浸式 RP。
- 建议把该字段改为 `result`，description 写成“本次工具调用的可读结果；需要时可以写简短 walkthrough”。
- `report_result.data` 继续保留结构化 packet，字段设计保持上面这组。
- 更理想的中期设计是 sidecar result pass：actor 主上下文只沉浸式回应，旁路上下文再把回应整理为 `report_result.data`、文件更新摘要和 `run/ticks/{tick-id}/actors/{actor-id}.result.json`。

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
gm_followup:
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
- 行动选项或确认问题。

## Knowledge Control Rules

1. `lorebook/character/` 是上帝视角角色设定，默认只给 GM 和开发者。
2. actor 只能读取 `roleplay/actors/{actor-id}/` 和 GM packet。
3. `rp.writer` 只读取 GM writer brief 和自动注入的 `roleplay/writer.md`，不默认读取完整 lorebook；即使有文件工具，也只使用 GM 明确指定路径。
4. GM 每 Tick 只向 actor 注入合理可观察信息。
5. actor knowledge 只表达角色视角的已知信息；如果它和 canonical truth 不一致，GM 负责在后台区分。
6. 用户是 actor，并且应在 `roleplay/actors/{player-id}/` 下拥有自己的 actor 目录；用户输入可以是行动、台词或剧本式指令，GM 负责把它转为故事内可执行意图。
7. 非抢话模式下，actor 只在用户 Tick 后响应；抢话模式后续单独设计。
8. 第一版允许 actor 通过文件工具维护自己的 `knowledge.md`、`mind.md`、`state.md`；后续如果实现 sidecar，应把这些更新移到独立旁路 run，减少主扮演上下文污染。
9. 第一版不让 `rp.writer` 自主检索 lorebook；GM 必须把可写信息整理进 writer brief。后续 sidecar 可补“写作前检索相关 lorebook”。

### Lorebook Visibility Discussion

通用世界观不应该在每个 actor 的 `knowledge.md` 中重复维护。一个可继续讨论的方向是给 lorebook 内容节点增加“谁能知道”的作者标注，例如：

```yaml
visibility:
  audience:
    - gm
    - actor:player
    - actor:sample-npc
  condition: 开局常识，或 GM 在剧情中告知后可见。
```

这个方向的关键边界：

- canonical lorebook 仍默认是 GM / leader / 作者视角；没有 visibility 标注时不自动进入 actor 知识。
- actor 的 `knowledge.md` 可以引用“该 actor 可知道”的 lorebook 条目，减少通用世界观重复。
- GM / leader 负责把引用解析为 actor 可见摘要；actor 不能因为看见引用就自行读取完整 lorebook。
- visibility 应描述“谁能知道/何时能知道”，不要要求 lorebook 原文完全 actor-safe；真正注入 actor 前仍需要 GM 过滤隐藏真相和措辞。
- 这部分暂不落成实现合同，后续需要结合 lorebook frontmatter schema、导入器和 retrieval/inject 规则继续设计。

暂定推荐方向：

- visibility 只表示“这个条目在什么条件下可以被谁知道”，不表示 actor 可以直接读取原文。
- `knowledge.md` 中的引用应是角色视角的索引或摘要，例如“王都公共常识来自 lorebook/world/capital”，而不是把完整 canonical 条目复制进去。
- 如果条目同时包含公开常识和隐藏真相，作者应优先拆条目，或在条目中提供 actor-safe 摘要字段；不要依赖 actor 自己过滤。
- 导入器后续可以根据 visibility 生成 actor `knowledge.md` 初稿：公共常识写成摘要，私密或条件知识只放引用占位，等待 GM 在剧情中解锁。

## Sidecar Boundary

用户提出的“主流程保持纯净，旁路 run 负责检索或更新知识”的机制已经记录为 `SidecarProfilePass`。本次 roleplay spike 先不实现，但目录设计需要给它留位置。

未来可接入的两个旁路：

- `rp.writer` prepare-run sidecar：先退出写作模式，检索本次 writer brief 相关 lorebook，再把可写摘要注入主写作上下文。
- `rp.actor` settle-run sidecar：主扮演回复完成后，退出扮演模式，生成 `knowledge.md` 更新建议或直接执行受控写入。

本次 spike 的临时策略：

- writer：由 GM 主动整理 lorebook 摘要，writer 只按 GM 明确路径使用文件工具。
- actor：允许 actor 读取和编辑自己的 `knowledge.md`、`mind.md`、`state.md`，优先验证多 actor RP Tick 是否成立。
- 所有 sidecar 相关实现推迟到 `docs/tasks/23-agent-sidecar-profile-pass/README.md` 后续任务。

## Open Questions

- actor knowledge 是由导入器自动生成初稿，还是由 GM skill 手动维护。
- 是否需要 `roleplay/actors/{actor-id}/secrets.md` 表示“角色自己知道但其他 actor 不知道”的信息。
- 是否需要 debug 模式把 Tick scratch 保存到 `run/`；默认不创建 `sessions/`。
- 后续抢话模式如何定义 actor 主动行动的触发条件。
- `leader.rp` 是否需要完全取代 `rp.gm`，还是保留独立 `rp.gm` 给高级编排使用。
- actor 初始化时创建全部 cast actors，还是只创建当前 active actors。
- 是否要给 actor knowledge 写入增加 runtime path scope 或 sidecar settle-run，以替代当前 prompt-enforced 限制。

## Next Steps

- 视需要保留 `rp.gm` profile 草案，但不作为第一优先级。
- 起草 `RP目录初始化` skill，使其能创建上述目录骨架。
- 设计 actor knowledge 从 SillyTavern worldbook / canonical lorebook 生成初稿的规则。
- 真实试跑 `leader.rp` 初始化和第一个 Tick，检查 cast.yaml、actor session 复用和 writer brief 是否需要更强结构化模板。
