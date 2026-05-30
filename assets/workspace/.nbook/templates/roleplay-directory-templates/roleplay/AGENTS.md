# Roleplay AGENTS.md

本目录是当前 Project Workspace 的 RP 运行配置。默认只给 `leader.rp` / GM 读取；不要让 actor 或 writer 自行遍历整个 `roleplay/`。

## 启动顺序

1. 读取 `config.yaml`、`cast.yaml`、`gm.md` 和 `writer.md`。
2. 尝试读取 `config.yaml` 中的 `startup.optionalRead`；不存在时不要报错，使用 `fallbackScene` 启动。
3. 根据 `cast.yaml` 初始化 `defaultActive: true` 的 actors。默认包含玩家 actor 与示例 NPC actor。
4. 初始化 actor 时，只注入该 actor 的 `actor.md`、`knowledge.md` 和 GM 当前观察 packet。
5. 用户输入第一条行动、台词或剧本式指令后，进入 Tick 流程。
6. Tick 结束时，只把 GM 整理好的 writer brief 与 `writer.md` 注入给 `rp.writer`。

## Profile 注入契约

- `rp.actor` 只接收 `actor.md`、`knowledge.md` 和 GM 过滤后的观察 packet。
- `rp.actor` 不接收 `roleplay/AGENTS.md`、`gm.md`、`writer.md`、完整 `lorebook/` 或 `reference/`。
- `rp.writer` 只接收 `writer.md` 和 GM 的 writer brief。
- `rp.writer` 不接收完整 `roleplay/`、`lorebook/` 或 `reference/`，也不自己检索文件。
- 如果当前 runtime 暂时没有 profile 级文件注入能力，GM 必须在调用文本里手动粘贴同等范围的信息，不要扩大上下文。

## 最小可运行流程

如果项目还没有完整 lorebook，GM 仍然要能运行：

1. 使用 `config.yaml` 的 `fallbackScene` 建立一个中性的初始场景。
2. 把用户输入解释为玩家角色的行动、台词、指令或混合输入。
3. 调用 `sample-npc` 做现场反应。
4. GM 汇总结果，生成不泄露后台信息的 writer brief。
5. `rp.writer` 输出用户可见正文，并留下可继续行动的现场反馈。

## Tick 清单

每次用户输入后按这个顺序执行：

1. 判断用户输入类型：行动、台词、剧本式指令或混合输入。
2. 验证玩家 actor 是否能执行该意图；无法确定时做最小合理裁决。
3. 选择本 Tick 需要调用的 actors，默认只调用在场且 `defaultActive: true` 的 actor。
4. 给每个 actor 发送过滤后的观察 packet，不发送上帝视角真相。
5. 收集 actor response packet，区分可写内容和 GM 私有参考。
6. 按 `gm.md` 的规则更新对应 actor 的 `knowledge.md`。
7. 生成 writer brief，并明确 `do_not_reveal` 和 `allowed_internality`。
8. 调用 `rp.writer` 输出正文。

## 信息边界

- GM 可以读取 `lorebook/`、`reference/` 与 `roleplay/` 中的上帝视角信息。
- actor 只知道自己的 `knowledge.md` 与 GM 当前注入的信息。
- writer 只写用户可见正文，不输出 GM 裁决过程、actor packet 或隐藏设定。
- 玩家是故事内 actor，但用户输入永远高于模板推测；不要替用户决定核心行动。

## 文件更新规则

- 第一版只允许 actor 更新自己的 `knowledge.md`。
- `actor.md`、`gm.md`、`writer.md` 和 `cast.yaml` 是作者配置，运行中不要自动改写。
- knowledge 更新只能记录角色合理知道、相信或误解的信息；不要写入角色不该知道的隐藏真相。
- 如果 actor 直接写入 `knowledge.md`，GM 仍要在下一轮读取时把它当作 belief view，不当作世界真相。

## 输出要求

- GM 和 actor 之间使用 `gm.md` 中的 packet 字段。
- GM 给 writer 的 brief 使用 `gm.md` 中的 writer brief 字段。
- writer 最终只输出正文，不输出 YAML、JSON、调度说明或“下面是结果”之类的包装语。

## 当前限制

- 第一版不设计持久化 session。
- 第一版不实现完整变量系统。
- 第一版不实现 sidecar；writer 的 lorebook 摘要由 GM 主动整理，actor 可以直接维护自己的 `knowledge.md`。
