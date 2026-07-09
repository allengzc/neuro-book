# 写出前三章

这一节结束后，你会把项目设定、开局剧情和 writer 串起来，得到前三章正文草稿。

前三章的目标不是把整本书写完，而是建立读者愿意继续翻页的开局：主角出现、异常发生、核心问题浮出水面，并在第三章前后形成第一个清晰钩子。

## 先设计开局剧情

在调用 writer 前，先使用 `novel-workflow-07-opening-plot-design`。

```text
使用novel-workflow-07-opening-plot-design为当前项目设计前三章。请读取已有 lorebook，给出每章目标、冲突、结尾钩子和需要补充的设定。
```

如果项目已经有 `simulation/` 当前状态，leader 可以先看当前世界运行态。如果还没有，也可以先用普通设定和剧情讨论推进。

`novel-workflow-07-opening-plot-design` 最好产出这些内容：

- 第一章：主角的日常裂缝和第一个异常。
- 第二章：主角主动尝试，发现问题更深。
- 第三章：无法回头的选择、损失或新目标。

写前先让 Agent 给你一个确认版：

```text
在调用 writer 前，请先给我前三章写作简表：每章目标、视角角色、主要冲突、结尾钩子、必须使用的 lorebook 条目。
```

## 决定是否需要世界运行态

如果前三章涉及角色反应、势力行动、地点变化、物品持有、倒计时或隐藏状态，可以先让 leader 使用世界运行态推进流程。

常见说法：

```text
在写第一章前，先判断是否需要进行一次 emulation tick。如果需要，请用 novel-workflow-05-emulation-bootstrap 初始化当前世界运行态。
```

当前实现目录仍叫 `simulation/`。写作流程里说的 emulation，可以理解为“把稳定设定推进到下一刻发生了什么”。

## 写前确认清单

调用 writer 前，至少确认这些问题：

- 本章写入哪个 `manuscript/.../index.md`。
- 本章是谁的视角。
- 本章开头状态是什么。
- 本章结尾必须发生什么。
- 哪些设定不能改。
- 是否要使用特定文风或参考预设。

如果你还没想清楚，可以让 Agent 先问你：

```text
在写第一章前，请问我最多 5 个必要问题。只问会影响正文成败的问题。
```

## 调用 writer 写章节

当每章目标明确后，再调用 `novel-workflow-09-chapter-writing`。

```text
使用 novel-workflow-09-chapter-writing 写第一章。目标章节是 manuscript/001-volume/001-chapter/index.md。请只把正式正文写入该章节文件。
```

普通 `writer` 是正文 agent。它不负责维护 `simulation/`，也不应该自己乱翻所有文件。leader 会把章节目标、Plot、必要世界书条目和约束整理给它。

写第二章和第三章时，沿用同样方式：

```text
继续写第二章，目标章节是 manuscript/001-volume/002-chapter/index.md。先检查第一章留下的状态和 Plot，再调用 writer。
```

```text
继续写第三章，目标章节是 manuscript/001-volume/003-chapter/index.md。第三章结尾需要形成第一个强钩子。
```

## 写完后检查

每章写完后，使用 `novel-workflow-10-revision` 做一次轻量检查：

```text
使用 novel-workflow-10-revision 检查第一章：节奏、信息释放、角色动机、章末钩子。先给修改建议，再问我要不要执行修改。
```

如果正文已经改变了世界状态，比如角色受伤、物品转移、地点被破坏，leader 应该把这些变化整理进 `simulation/subjects/` 或 `simulation/entities/`，不要只留在聊天记录里。

作者自己也建议看这几项：

- 第一页是否让人知道“主角是谁、麻烦是什么”。
- 每章结尾是否有继续阅读的理由。
- 设定说明有没有压过角色行动。
- 主角是否真的做了选择，而不是只被事件推着走。
- 写完后有没有产生新事实，需要更新 lorebook、Plot 或 simulation。

## 常见返工提示词

如果正文方向对但节奏慢：

```text
请保留本章事件结果，压缩说明性段落，增强行动、对话和章末钩子。
```

如果文风不对：

```text
请不要改变剧情事实，只调整叙述口吻。目标是更有网文连载感，段落更短，情绪推进更明确。
```

如果设定太密：

```text
请标出本章中过早解释的设定，把不影响当前冲突的信息移到后文，只保留读者理解行动所需的内容。
```

## 最小验收

完成这一节后，项目里应该至少有：

- `manuscript/001-volume/001-chapter/index.md`
- `manuscript/001-volume/002-chapter/index.md`
- `manuscript/001-volume/003-chapter/index.md`
- 对应的剧情目标或 Plot 记录。
- 必要的 `lorebook/` 设定条目。

下一节会把外部角色卡导入这个项目。
