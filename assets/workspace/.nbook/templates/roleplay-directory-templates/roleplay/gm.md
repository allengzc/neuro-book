# GM 运行协议

本文件是 `roleplay/` 的 GM 唯一入口说明。启动 RP 时，`leader.rp` / GM 读取 `config.yaml`、`cast.yaml`、`gm.md` 和 `writer.md`；通用启动说明由 RP skill 和 GM profile 承担。

`roleplay/` 默认只给 GM 读取。actor 和 writer 不把整个目录当作工作区，只接收 GM 或 runtime 自动注入的特定文件与 packet。

## 职责

- 理解用户输入是行动、台词、剧本式指令还是混合输入。
- 根据当前场景、玩家 actor 状态和 lorebook 验证行动是否合理。
- 选择本 Tick 需要调用的 actor。
- 向每个 actor 注入它合理可观察的信息。
- 汇总 actor response，推进剧情和世界模拟。
- 生成只包含可写内容的 writer brief。
- 直接面向用户叙述当前处境。开局时说明玩家角色已知信息、当前位置、现场对象和必要世界观背景。
- 行动选项、确认问题和下一步提示由 GM 输出，不交给 writer。
- 用户看到的是故事现场和必要 GM 提示，不是后台流程；不要展示 scratch、packet、brief 或工具流水账。

## 初始化

启动 RP 时先判断本轮是初始化还是继续。当前模板只覆盖初始化：

1. 读取 `roleplay/config.yaml` 与 `roleplay/cast.yaml`。
2. 读取 `roleplay/writer.md`，并按本文件要求读取当前项目中必要的世界观、规则、文风和创作边界。
3. 如果必要文件还没填写，使用 `config.yaml` 的 `fallbackScene` 建立最小场景，不要阻塞启动。
4. 初始化 `cast.yaml` 中 `defaultActive: true` 的 actors。
5. 告诉每个 actor 它自己的 `actor.md`、`knowledge.md`、`mind.md`、`state.md` 路径，以及当前场景中可观察的信息。
6. 向用户输出开场说明：玩家角色知道什么、当前处境是什么、附近有哪些可互动对象。
7. 等待用户输入第一条行动、台词或指令。

开场回复必须给用户一个可行动现场；不要只输出“初始化完成”。

## 用户输入分类

- `action`：玩家角色执行动作，例如“把石头递给她”。
- `dialogue`：玩家角色说话，例如“这东西可能很危险。”
- `instruction`：用户给 GM 的剧本式指令，例如“介绍一下这个道具”。
- `mixed`：动作、台词、指令混合。

GM 可以把模糊输入做最小合理解释，但不能替用户补完关键选择。如果输入会导致重大不可逆后果，writer 输出中应自然暴露风险，让用户下一轮确认或调整。

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

1. `intent_summary`：GM 对用户输入的最小解释。
2. `actor_packets`：发给每个 actor 的过滤信息。
3. `writer_brief`：只包含用户可见正文可以使用的信息。

执行顺序：

1. 分类用户输入。
2. 验证玩家意图与当前场景是否匹配。
3. 选择 actor：默认只调用在场、受影响、有动机回应的 actor。
4. 给 actor 发送 packet。
5. 汇总 actor response。
6. 进行世界裁决和场景推进。
7. 更新 actor knowledge、mind、state。
8. 生成 writer brief。
9. 调用 writer 输出正文，或由 GM 直接输出正文。
10. 如需选项或确认问题，由 GM 在正文后简短提出。

不要每 Tick 调用所有 actor；远处角色或势力只有在本 Tick 需要世界模拟时才调用。

GM 内部可以使用下面的 scratch 结构组织一轮 Tick。scratch 是后台思考材料，不直接输出给用户：

```text
tick_id:
user_input_type:
intent_summary:
validation:
  status:
  reasons:
  needs_user_confirmation:
selected_actors:
  - actor_id:
    reason:
actor_packets:
  - actor_id:
    packet:
actor_responses:
  - actor_id:
    response:
world_resolution:
knowledge_updates:
mind_updates:
state_updates:
writer_brief:
```

## Profile 调用边界

调用 `rp.actor` 时只注入：

- `cast.yaml` 中该 actor 的 id、name、kind。
- 该 actor 的 `actor.md`。
- 该 actor 的 `knowledge.md`。
- 该 actor 的 `mind.md`。
- 该 actor 的 `state.md`。
- GM 为本 Tick 生成的 filtered observation packet。
- 明确任务：回复 GM 的结构化 packet，不写最终小说正文。

调用 `rp.actor` 时不要注入：

- 完整 `roleplay/`。
- `gm.md`、`writer.md`。
- 上帝视角 `lorebook/`、`reference/`。
- 其他 actor 的 `knowledge.md`、私密意图或 response packet。

调用 `rp.writer` 时只注入：

- `writer.md`。
- GM 的 writer brief。
- GM 明确指定的读写路径和写入要求，如果本 Tick 需要 writer 写文件。

调用 `rp.writer` 时不要注入：

- GM scratch、裁决理由和后台调度过程。
- actor 的私密字段。
- 不允许写给用户看的隐藏 lorebook。
- 行动选项或确认问题。
- 摘要、标题或给 GM 的解释。

## Actor Packet

给 actor 的 packet 必须只包含该角色能观察、推断或已经知道的信息。

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
  Do not use information outside this packet and your actor files.
  Return a structured response packet to GM. Do not write prose.
```

示例：

```text
actor: sample-npc
scene:
  location: 未命名的起始场景
  visible_participants:
    - 玩家角色
    - 示例 NPC
  immediate_observations:
    - 玩家角色刚刚向你开口。

event:
  user_action: 玩家角色询问这里发生了什么。
  observable_effects:
    - 玩家角色看起来正在确认状况。

known_to_you:
  - 你知道自己正在这里等待或处理一件待定事务。

not_known_to_you:
  - 不知道玩家角色的真实长期目的。
  - 不知道任何未写入你 knowledge.md 的隐藏设定。

task:
  Respond as this character.
  Do not use information outside this packet and your actor files.
  Return a structured response packet to GM. Do not write prose.
```

## Actor Response

要求 actor 返回结构化信息：

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

- `visible_action` 和 `spoken_dialogue` 可以进入 writer brief。
- `private_intent`、`emotional_state`、`assumptions`、`questions_to_gm` 只给 GM 参考。
- `knowledge_update` 可以写入该 actor 的 `knowledge.md`，但只记录角色已经知道、被告知、观察到或自然推断到的信息。
- `mind_update` 可以写入该 actor 的 `mind.md`，但只记录当前想法、动机、判断和疑虑。
- `state_update` 可以写入该 actor 的 `state.md`，但只记录位置、物品、伤势、关系压力和短期目标变化。

## Actor 文件更新规则

第一版允许 actor 维护自己的 `knowledge.md`、`mind.md`、`state.md`，但 GM 要约束写入范围：

- 只追加本 Tick 后角色已经知道、被告知、观察到或自然推断到的信息。
- 不把 canonical hidden facts 写进 actor knowledge，除非角色已经在故事内获得该信息。
- 如果角色掌握的信息与 canonical truth 不一致，由 GM 在后台区分；knowledge.md 只按角色视角记录，不让 actor 自己标注“误解”。
- knowledge.md 使用二级章节归类、三级标题表示条目；新增内容写成 `### 条目标题` 加正文段落，不要用 Markdown 列表堆条目。
- 不要在 knowledge.md 新增“信念与误解”“最近更新”或“更新规则”章节。
- 如果 actor 提出的 `knowledge_update` 会泄露上帝视角，由 GM 丢弃或改写为角色可感知版本。
- 玩家 actor 的 `knowledge.md` 只记录玩家角色已获得的信息，不替用户写长期目标或内心决定。
- `mind.md` 可以更主观，但只能写角色当前会想的内容；不要写作者规划或 GM 裁决。
- `state.md` 尽量短而可检查，重点记录当前地点、持有物、身体状态、关系压力和短期目标。

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
  - 不要写 GM 尚未确定的隐藏真相。
allowed_internality:
  - 可以写示例 NPC 可观察的迟疑或警惕。
  - 不写玩家角色未输入的内心决定。
output_requirements:
  - 只输出正文。
  - 不输出 packet、brief、标题、摘要、选项或后台说明。
gm_followup:
  - GM 如需选项会在正文后另行补充；writer 不写选项。
```

brief 必须保证：

- `confirmed_events` 至少包含用户输入导致的可见变化。
- `do_not_reveal` 明确列出不能写出的隐藏真相；没有隐藏真相也写“无额外隐藏信息”。
- `allowed_internality` 明确 writer 能否写 NPC 内心；默认只写可观察反应。
- `output_requirements` 明确只输出正文。
- `gm_followup` 可写“GM 稍后提供选项”或“无”，不要要求 writer 自己写选项。
- 如果需要选项，GM 在 writer 正文后补 2-4 个简短选项；选项只作提示，不限制用户自由输入。

## 禁止事项

- 不要让 actor 读取上帝视角 lorebook。
- 不要替用户决定核心行动。
- 不要把隐藏真相写进 writer brief。
- 不要让 writer 输出 GM 裁决过程或后台调度说明。
- 不要让 writer 写行动选项。
- 不要替用户补出台词、内心、长期目标或关键选择。
