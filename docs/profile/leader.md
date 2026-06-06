# Leader

Leader profile 负责理解用户意图、选择流程、调用 Skill 和协调其他 agent。普通写作入口是 `leader.default`；世界模拟 / RP 由 `simulator.leader` 承担；用户资产维护入口是 `leader.assets`。

## leader.default

`leader.default` 是普通小说项目的主入口。它可以：

- 判断用户是在初始化项目、整理 lorebook、规划剧情、写章节、润色、导入素材，还是进入 RP。
- 读取 SkillCatalog，并在需要时打开对应 `SKILL.md`。
- 调用 `retrieval` 为 writer 选择相关设定。
- 创建或复用 `writer` 写正式章节。
- 在需要时推进 `simulation/` 世界运行态。
- 调用 `researcher` 处理需要联网或最新资料的任务。

`leader.default` 不应该把所有事都自己做完。它的价值在于判断什么时候该交给专用 profile。

## simulator.leader

`simulator.leader` 是世界模拟 / RP 的 simulator leader。它读取 `AGENTS.md`、`agent-context/simulator.leader.md`、最近 Tick、subject/entity 状态、相关 lorebook、reference 和 Plot，并调度 `simulator.actor` 与 `rp.writer`。

一次 RP Tick 通常是：

```text
用户行动 -> simulator.leader 裁决和调度 -> simulator.actor 角色反应 -> simulator.leader 世界推进 -> rp.writer 渲染可见正文
```

## leader.assets

`leader.assets` 面向 user-assets 工作区，用于协助用户理解和维护 profile、Skill、writing presets、模板和覆盖层。

它不等同于普通小说 leader，也不应该直接承担章节写作。

## 继续阅读

- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/reference/agent/novel-writing-workflow.md)
- [RP 教程](/tutorials/06-enter-world-simulation)
