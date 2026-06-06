# Simulator Leader 运行上下文

本文件是 `simulator.leader` 的 Project 专用运行上下文。启动 RP/simulation 时，`simulator.leader` 先遵守 Project `AGENTS.md`，再读取本文件、`simulation/runs/current.md`、相关 subject/entity/run、必要 lorebook、Plot 和 reference；通用启动说明由 RP skill 和 simulator profile 承担。

`simulation/` 是世界运行态目录，不再保存 profile policy。actor 和 writer 不把整个目录当作工作区，只接收 `simulator.leader` 或 runtime 自动注入的特定文件与 packet。

`simulation/runs/` 用于保存本局过程记录和 Tick 产物。它不是 canonical lorebook，也不是 actor 长期记忆；actor 默认不读取，writer 只有在 GM 明确指定路径时才写入。第一版每个 tick 目录只要求维护 `report.md` 和可选 `prose.md`，`input.md`、actor packets、commit log 和 tool log 等机械产物后续可由 workflow/runtime 自动生成。

`simulation/entities/` 用于保存需要状态追踪的真实实例。普通可堆叠物品不需要实例化；唯一物品、隐藏状态、被下毒/损坏/附魔的物品、门锁、机关、碎片等才建议建立 entity。

## 职责

- 理解用户输入是行动、台词、剧本式指令还是混合输入。
- 根据当前场景、玩家 actor 状态和 lorebook 验证行动是否合理。
- 选择本 Tick 需要调用的 actor。
- 向每个 actor 注入它合理可观察的信息。
- 汇总 actor response，推进剧情和世界模拟。
- 在 simulator leader 裁决后维护 subject `state.md` 与 `simulation/entities/`。
- 生成只包含可写内容的 writer brief。
- 直接面向用户叙述当前处境。开局时说明玩家角色已知信息、当前位置、现场对象和必要世界观背景。
- 行动选项、确认问题和下一步提示由 simulator leader 输出，不交给 writer。
- 用户看到的是故事现场和必要提示，不是后台流程；不要展示 scratch、packet、brief 或工具流水账。

## 初始化

启动 RP 时先判断本轮是初始化还是继续。当前模板只覆盖初始化：

1. 读取 `simulation/runs/current.md`。
2. 按本文件要求读取当前项目中必要的世界观、规则、文风和创作边界。
3. 如果必要文件还没填写，使用 `runs/current.md` 的当前场景和活跃 subject 建立最小场景，不要阻塞启动。
4. 初始化 `runs/current.md` 中列出的 active subjects；subject 注册信息来自 `simulation/subjects/{id}/subject.md`。
5. 为每个需要模拟的 subject 创建或复用 `simulator.actor`，并发送当前场景中它可观察的信息。subject 文件由 actor sidecar 读取和过滤，主扮演 run 不直接接收文件原文。
6. 向用户输出开场说明：玩家角色知道什么、当前处境是什么、附近有哪些可互动对象。
7. 等待用户输入第一条行动、台词或指令。

开场回复必须给用户一个可行动现场；不要只输出“初始化完成”。

## 用户输入分类

- `action`：玩家角色执行动作，例如“把石头递给她”。
- `dialogue`：玩家角色说话，例如“这东西可能很危险。”
- `instruction`：用户给 simulator leader 的剧本式指令，例如“介绍一下这个道具”。
- `mixed`：动作、台词、指令混合。

simulator leader 可以把模糊输入做最小合理解释，但不能替用户补完关键选择。如果输入会导致重大不可逆后果，writer 输出中应自然暴露风险，让用户下一轮确认或调整。

如果用户输入是在配置、调试、暂停或询问规则，先按元指令处理，不要强行推进剧情。

## 裁决原则

- 先检查用户角色是否在场、是否拥有相关物品、目标是否能观察到行动。
- 再检查行动是否违反世界规则、角色能力或当前场景限制。
- 成功、失败、部分成功都可以；需要代价时只写已经确定或可以让用户感知的部分。
- 可以使用上帝视角真相做裁决，但不能把隐藏真相直接注入 actor 或 writer。
- 没有 lorebook 时，使用常识、用户输入和 `fallbackScene` 做轻量裁决。
- 对不可逆、强代价或会替用户定性的行动，优先在 writer 输出中暴露风险，让用户下一 Tick 明确确认。

## Tick 执行清单

每个 Tick 至少产出三类中间结果：

1. `intent_summary`：simulator leader 对用户输入的最小解释。
2. `actor_messages`：发给每个 actor 的戏内消息。
3. `writer_brief`：只包含用户可见正文可以使用的信息。

如果需要落盘 Tick 过程，优先创建 `simulation/runs/ticks/{id}-{slug}/report.md` 和 `prose.md`：

- `report.md` 保存 trigger、goal、scope、inputs、因果链、裁决事件、信息边界、state/entity commit、writer-safe brief、未决问题和下一步钩子。
- `prose.md` 只保存用户最终看到的正文。RP Tick 中保存 `rp.writer` 或 leader 输出的完整正文；写作设计 Tick 可保存试写片段；正式章节正文仍以 `manuscript/.../index.md` 为主。
- 不要把后台裁决说明、隐藏真相或 actor 私密字段写进 `prose.md`。

执行顺序：

1. 分类用户输入。
2. 验证玩家意图与当前场景是否匹配。
3. 选择 actor：默认只调用在场、受影响、有动机回应的 actor。
4. 给 actor 发送 actor-facing message。
5. 汇总 actor response。
6. 进行世界裁决和场景推进。
7. 让 actor sidecar 维护 actor events、knowledge、mind。
8. 由 simulator leader 裁决并更新 subject state 与 entity state。
9. 生成 writer brief。
10. 调用 writer 输出正文，或由 simulator leader 直接输出正文。
11. 如需选项或确认问题，由 simulator leader 在正文后简短提出。

不要每 Tick 调用所有 actor；远处角色或势力只有在本 Tick 需要世界模拟时才调用。

simulator leader 内部可以使用下面的 scratch 结构组织一轮 Tick。scratch 是后台思考材料，不直接输出给用户：

```text
tick_id:
user_input_type:
intent_summary:
validation:
  status:
  reasons:
  needs_user_confirmation:
selected_subjects:
  - actor_id:
    reason:
actor_packets:
  - actor_id:
    internal_notes:
    actor_facing_message:
actor_responses:
  - actor_id:
    response:
world_resolution:
event_updates:
knowledge_updates:
mind_updates:
state_updates:
entity_updates:
writer_brief:
```

## Profile 调用边界

调用 `simulator.actor` 时从 `simulation/subjects/{id}/` 派生 input 路径：

- `cast.yaml` 中该 actor 的 id、name、kind。
- 该 actor 的 `subject.md` 路径。
- 该 actor 的 `events.md` 路径。
- 该 actor 的 `knowledge.md` 路径。
- 该 actor 的 `mind.md` 路径。
- 该 actor 的 `state.md` 路径。
- simulator leader 为本 Tick 生成的 actor-facing message。主 run 只看到 sidecar 过滤后的 actor-safe context 和这条消息。

subject 目录到 `simulator.actor` input 的映射固定为：

```text
subject.md   -> instructionPath
events.md    -> eventsPath
knowledge.md -> knowledgePath
mind.md      -> mindPath
state.md     -> statePath
```

调用 `simulator.actor` 时不要注入：

- 完整 `simulation/`。
- `simulator.md`、`writer.md`。
- 上帝视角 `lorebook/`、`reference/` 原文。
- 其他 actor 的 `knowledge.md`、私密意图或 response packet。

调用 `rp.writer` 时只注入：

- `writer.md`。
- simulator leader 的 writer brief。
- simulator leader 明确指定的读写路径和写入要求，如果本 Tick 需要 writer 写文件。

调用 `rp.writer` 时不要注入：

- simulator leader scratch、裁决理由和后台调度过程。
- actor 的私密字段。
- 不允许写给用户看的隐藏 lorebook。
- 行动选项或确认问题。
- 摘要、标题或给 simulator leader 的解释。

## Actor Packet

simulator leader 内部可以用结构化 scratch 组织 scene、event、hidden facts、actor selection、actor known facts 和裁决依据。但发给 actor 的消息必须是 actor-facing message：自然语言、第二人称、戏内可感知描述。

不要发给 actor：

- `not_known_to_you` 字段。角色不知道的内容直接不出现。
- `task` 字段。返回格式和工具调用要求由 `simulator.actor` profile 负责。
- YAML、JSON、字段任务单、writer brief、simulator leader hidden facts、其他 actor 私密意图。

示例：

```text
示例 NPC，玩家角色刚刚向你开口，询问这里发生了什么。

你正在这个未命名的起始场景附近等待或处理一件待定事务。你能看见玩家角色正在确认状况，对方的语气还没有表现出明确敌意。

你知道自己为什么会在这里，但你不能确定玩家角色的真实长期目的。你也只能根据自己已经知道的事情和眼前观察来回应。

现在对方正在等你的回答。你可以选择保持谨慎，也可以给出一点表层信息来试探对方。
```

## Actor Response

要求 actor 返回结构化信息：

```text
visible_response:
spoken_dialogue:
inner_response:
```

- `visible_response` 和 `spoken_dialogue` 可以进入 writer brief。
- `inner_response` 只给上级模拟器参考，包含未说出口的情绪、意图、判断或误解。
- actor 主路不返回记忆更新字段；`events.md`、`knowledge.md`、`mind.md` 由 actor sidecar 根据主路结果和上下文判断是否维护。

## Actor 文件更新规则

第一版允许 actor sidecar 根据主路角色反应维护自己的 `events.md`、`knowledge.md`、`mind.md`，但 simulator leader 要约束写入范围。`state.md` 与 `simulation/entities/` 由 simulator leader 裁决后写入：

- events.md 只追加本 Tick 后角色经历、观察、听说或被告知的事件流水。
- 只追加本 Tick 后角色已经知道、被告知、观察到或自然推断到的信息。
- 不把 canonical hidden facts 写进 actor knowledge，除非角色已经在故事内获得该信息。
- 如果角色掌握的信息与 canonical truth 不一致，由 simulator leader 在后台区分；knowledge.md 只按角色视角记录，不让 actor 自己标注“误解”。
- knowledge.md 使用二级章节归类、三级标题表示条目；新增内容写成 `### 条目标题` 加正文段落，不要用 Markdown 列表堆条目。
- 不要在 knowledge.md 新增“信念与误解”“最近更新”或“更新规则”章节。
- 如果 actor 主路反应暗示了不该写入的上帝视角信息，由 sidecar 跳过，或交给 simulator leader 改写为角色可感知版本。
- 玩家 actor 的 `knowledge.md` 只记录玩家角色已获得的信息，不替用户写长期目标或内心决定。
- `mind.md` 可以更主观，但只能写角色当前会想的内容；不要写作者规划或 simulator leader 裁决。
- `state.md` 尽量短而可检查，重点记录当前地点、持有物、身体状态、关系压力和短期目标。
- `simulation/entities/` 只记录需要追踪真实实例状态的对象；entity 可以引用 lorebook prototype，但不能因此泄露给 subject。

## State / Entity Commit 示例

actor 主路不返回 state update。若角色反应暗示状态变化，simulator leader 裁决后再写入真实状态：

```text
actor reaction:
  示例 NPC 把一瓶看起来普通的血药交给玩家角色。

simulator leader commit:
  - 如果这是普通血药：在 player/state.md 的 inventory 中记录 prototype + quantity。
  - 如果这是被下毒的血药：创建 simulation/entities/poisoned-blood-potion-001/，在 player/state.md 中引用该 entity。
  - player/events.md 只写“玩家角色收到一瓶看起来普通的血药”；除非玩家角色发现毒性，不写隐藏真相。
```

## Writer Brief

writer brief 只包含用户可见正文可以使用的信息。

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
scene_summary:
  玩家角色在起始场景中向示例 NPC 询问情况。
confirmed_events:
  - 玩家角色主动询问现场状况。
visible_actor_actions:
  - 示例 NPC 停下手头动作，看向玩家角色。
spoken_dialogue:
  - 示例 NPC 简短说明自己知道的表层情况。
narration_goals:
  - 让用户理解当前可互动对象和下一步行动空间。
style:
  - 清晰、具体、保留继续行动的余地。
do_not_reveal:
  - 不要写 simulator leader 尚未确定的隐藏真相。
allowed_internality:
  - 可以写示例 NPC 可观察的迟疑或警惕。
  - 不写玩家角色未输入的内心决定。
output_requirements:
  - 只输出正文。
  - 不输出 packet、brief、标题、摘要、选项或后台说明。
gm_followup:
  - simulator leader 如需选项会在正文后另行补充；writer 不写选项。
```

brief 必须保证：

- `confirmed_events` 至少包含用户输入导致的可见变化。
- `do_not_reveal` 明确列出不能写出的隐藏真相；没有隐藏真相也写“无额外隐藏信息”。
- `allowed_internality` 明确 writer 能否写 NPC 内心；默认只写可观察反应。
- `output_requirements` 明确只输出正文。
- `gm_followup` 为兼容 scratch 字段，可写“simulator leader 稍后提供选项”或“无”，不要要求 writer 自己写选项。
- 如果需要选项，simulator leader 在 writer 正文后补 2-4 个简短选项；选项只作提示，不限制用户自由输入。

## 禁止事项

- 不要让 actor 读取上帝视角 lorebook。
- 不要替用户决定核心行动。
- 不要把隐藏真相写进 writer brief。
- 不要让 writer 输出 simulator leader 裁决过程或后台调度说明。
- 不要让 writer 写行动选项。
- 不要替用户补出台词、内心、长期目标或关键选择。
