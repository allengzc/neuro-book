---
name: novel-workflow-09-chapter-writing
description: 小说流程 09：章节写作。用于把已经明确的章节目标、关键剧情点和写作约束交给普通 writer profile 写入唯一章节 manuscript index.md。核心契约是 Leader-Writer 协作：leader 写作前先把本章剧情事件推进进 World Engine，再给 writer 简化 brief；writer 拥有 World Engine 只读查询能力，自查角色状态后写正文。
when_to_use:
  - 用户要求正式写一章、续写目标章节、把设计好的剧情落成正文
  - leader 已经有明确的目标章节内容节点路径、本章剧情目标和必要 lorebook
  - 本章涉及的世界状态变化需要在写作前推进进 World Engine
---

# novel-workflow-09-chapter-writing：章节写作

本 skill 指导 leader 调用普通 `writer` profile，把设计好的章节写成正文。原理见 `reference/world-engine/workflow.md` 第 6 节 Leader-Writer 协作；本文只讲操作流程。

核心契约：**writer 对 World Engine 只读**。所以协作围绕"写作前 leader 已经把世界状态推进好"展开——leader 先演化世界、设计剧情，再调用 writer；writer 自己查询 World Engine 写正文。

## 前置检查

开始前确认：

- 当前 Project Workspace 明确。
- 目标章节内容节点存在，例如 `project-slug/manuscript/001-volume/001-chapter/`，其中 `index.md` 是写入目标。**若目标章节节点还不存在（新用户写第一章时常如此），先用 `workspace node new <project-slug>/manuscript/NNN-volume --type volume` 建卷，再用 `workspace node new <project-slug>/manuscript/NNN-volume/NNN-chapter --type chapter` 建章节，再继续。**
- World Engine 已初始化（有 calendar、纪元锚点、需追踪的角色 subject）。**若未初始化，先用 `novel-workflow-world-engine-init` 把 World Engine 建好，再回来写章节。**
- 需要设定上下文时，已确定要建议 writer 读取的 lorebook 内容节点 path。

## 第一步：写作前先推进 World Engine（关键）

**世界状态先行。** 在调用 writer 之前，leader 先把本章要发生的剧情事件，按时间顺序用 `write_world_slice` 写入 World Engine（解封、交流、追入、对峙……）。这样 writer 查到的永远是已推进到位的一致状态，而不是滞后于正文的旧状态。

推进时遵循**最少支持当前叙事**原则（详见 `reference/world-engine/recording-principles.md`）：

- 群体角色先用单一 subject 表示整体（"邪教徒巡逻队"而不是逐个邪教徒），需要时再拆分重要个体。
- 每个 subject 通常 1-2 条切面（起因 + 当前状态），不记录每一个细节行动。
- 临时龙套不建 subject，只在主角切面的 `events` 文本里提及。
- 角色需要展现之前未交代的能力 / 知识时，向更早时间插入一条 `kind=backstory` 切面溯源，而不是在当前时刻凭空 set。

操作边界（详见 `reference/world-engine/calendar-system.md` 与 `subject-lifecycle.md`）：

- 时间一律用项目日历字符串（第一版月份是数字，如「星辉历312年 5月5日 14:00」），禁止 raw instant。
- 同一 instant 只能有一个切面；**Agent 没有改/删已有切面的工具**，目标时刻已存在切面时会冲突报错，改用相邻时间点写入，不要试图覆盖（编辑/删除切面只在 Workbench HTTP 层可用）。
- 写完后检查返回的 issues：E issues（`broken-relative` / `dangling-ref`）必须修；A issues（`base-shifted` / `masked`）确认本次语义符合预期即可，不落库。
- 对用户用人话解释做了什么（"我把这段剧情记到时间线里了"），不抛 slice / mutation / op 这些术语。

## 第二步：准备简化 brief 调用 writer

通过 `invoke_agent` 调用 `writer`。两个入口各有分工：

- `input`：传 `{path: "project-slug/manuscript/001-volume/001-chapter/index.md", context: {lorebookEntries: ["project-slug/lorebook/character/foo/", ...]}}`。
  - `path` 是本轮唯一写入目标，必须是带 project-slug 前缀的 cwd-relative 路径，指向章节 `index.md`。
  - `context.lorebookEntries` 只传内容节点 path 字符串数组（目录路径，结尾带 `/`）。
- `message`（brief）：本章的写作任务正文。

brief 应当**简化**——因为写作前世界状态已推进好、writer 又能自查，只传剧情框架，不传可查询的状态细节：

| brief 应该传 | brief 不要传 |
| --- | --- |
| 章节目标 / 关键剧情点 | 详细角色状态 |
| 信息控制（谁知道什么 / 谁不知道什么） | 完整世界状态 |
| 写作约束（视角、节奏、章节如何收尾） | HP / 位置等可查询的细节 |
| 建议读取的 lorebook（也可放 input.context） | 完整时间线记录 |
| World Engine 查询提示（查哪些 subject、哪个时间范围） | mutation 细节 |

**不要**把 HP、位置、完整状态塞进 brief。writer 会自己用 `execute_world_query` 查到当前真值；把状态都塞进 brief 既冗余，又会让 writer 退化成纯执行者，还浪费了它的查询能力。

信息控制是 brief 的硬要求：按 subject 视角分别说明知识边界，例如「薇洛丝视角：不知道莉雅的真实身份」「反派视角：从教会典籍见过项链记载，认出标志但不确定眼前女孩是谁」。writer 据此控制每个角色的言行与心理披露。

brief 示例（节选）：

```
本章目标：薇洛丝在星陨遗迹深处解开莉雅的封印，两人初次交流后被追来的邪教徒巡逻队逼入绝境。
关键剧情点：1) 解封过程的异象 2) 莉雅失忆、只记得片段 3) 邪教徒追入，章末停在对峙瞬间。
信息控制：薇洛丝不知道莉雅真实身份与被封印原因；莉雅失忆，不知外面世界过了多久。
写作约束：薇洛丝单视角第三人称；节奏由探索转紧张；章末收在对峙未发生战斗的悬念上。
World Engine 查询提示：用 execute_world_query 查 weiluosi、liya、cultist-patrol-01 在「星辉历312年 5月5日」当天的状态。
建议读取：project-slug/lorebook/location/ruins-meteor/。
```

## 第三步：writer 侧（自查状态后写正文）

writer 拥有 `execute_world_query` 只读能力。它的典型流程是：读 brief 指定的 lorebook → 用 `execute_world_query` 按提示查相关 subject 在章节时间范围的状态 → 构思并写入正文到章节 `index.md` → `report_result` 报告落点。

leader 不需要在此步骤干预；writer 是自主子代理。注意 writer 能查到角色真值，但在某个角色视角的叙述里不会让该角色"知道"他不该知道的设定——查询服务于写作一致性，不等于授权角色越界知情。

## 第四步：写后检查

writer 完成后，leader 检查成果：

- 剧情点是否全部覆盖。
- 角色视角 / 信息边界是否越界（有没有让角色知道他不该知道的设定）。
- writer 是否有超出 brief 的自由发挥（新增角色、改变受伤程度、使用未预设能力）。

通常 writer 的细节发挥（环境描写、角色反应、内心独白）不改变世界状态，不需要补回 World Engine。

## 两种协作模式

**模式 A：标准（推荐）**

```
leader 设计剧情 → leader 写作前推进 World Engine → leader 准备简化 brief → writer 自查并写正文 → leader 检查成果
```

世界状态先行，writer 看到的状态始终一致。需要严格控制剧情走向时用这个模式。

**模式 B：自由发挥（可选，默认不推荐）**

```
leader 给大致方向 → writer 自由发挥（含剧情细节）→ leader 事后把偏离的状态变化补回 World Engine
```

仅在**用户明确允许 writer 自由发挥**的探索性写作时使用。leader 只给方向，writer 可增加新角色、改变受伤程度。写后 leader 读取正文、提取状态变化，补进 World Engine（创建新角色 subject、更新状态、补能力溯源）。此模式生成快、即兴感强，但 writer 承担了部分剧情设计、World Engine 滞后于正文、需要更多后处理，所以默认不推荐。

## 完成标准

- 正文写入唯一目标章节 `index.md`。
- 本章状态变化已在 World Engine：标准模式写作前已推进，自由模式写后已补回。
- writer 已通过 `report_result` 报告写入路径与剧情摘要。
- 角色视角与信息边界没有越界。
