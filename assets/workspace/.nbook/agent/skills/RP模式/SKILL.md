---
name: RP模式
description: 用于用户想进入 NeuroBook RP/simulation 模式、启动 leader.rp、理解 simulator leader / subject simulator / rp.writer Tick 流程，或让当前 session 临时按 RP 协议工作。
when_to_use:
  - 用户说进入 RP、开始 roleplay、跑角色扮演、用 GM 带剧情、和角色互动
  - 用户询问 leader.rp、rp.actor、rp.writer、simulation、subject knowledge 或 RP 模式怎么用
---

# RP模式

用于把当前 Project Workspace 切到 RP/simulation 优先的运行方式。`simulation/` 是默认 Project 模板的一部分，不再单独安装 `roleplay/` 目录模板。

## 前置检查

- 当前 Project Workspace 必须存在 `project.yaml`。
- 当前 Project Workspace 应存在 `simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md`、`simulation/writer.md`、`simulation/subjects/*`，并可按需使用 `simulation/entities/*`。
- 如果没有 `simulation/`，重新用默认 Project 模板创建项目，或手工从 `assets/workspace/.nbook/templates/project-directory-templates/simulation/` 补齐。
- 如果用户要从 SillyTavern 卡进入 RP，先使用 `novel-import-silly-tavern-card` 完成 `inspect -> unpack -> import`；旧 `SillyTavern角色卡导入` 仍是兼容入口。动态机制归档在 `reference/silly-tavern/...`，后续再迁移到 simulation 机制。

## 启动方式

先询问用户选择入口：

1. 新建或切换到 `leader.rp` 会话，由它作为 simulator leader 调度 `rp.actor` 和 `rp.writer`。
2. 就地让当前 session 按 RP/simulation 协议工作。第一版只通过 prompt/skill 约束当前 session，不修改 session `profileKey`。

## leader.rp 流程

1. 读取 `simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md` 和 `simulation/writer.md`。
2. 根据 `cast.yaml` 创建或复用 `rp.actor` 会话；每个 subject 只注入自己的 `subject.md`、`events.md`、`knowledge.md`、`mind.md` 与 `state.md`。
3. 创建或复用 `rp.writer`，只给它 `simulation/writer.md` 与 simulator leader brief。
4. 用户发送第一条行动、台词或剧本式指令后，进入 Tick。

`cast.yaml` 到 actor input 的字段映射固定为：`instruction -> instructionPath`、`events -> eventsPath`、`knowledge -> knowledgePath`、`mind -> mindPath`、`state -> statePath`。路径要从 Project Workspace 相对路径转换成 Agent cwd 可用路径。

## Tick 流程

1. simulator leader 理解用户输入，把用户当作故事内 player subject 的操作者。
2. simulator leader 验证行动合理性，必要时读取 lorebook、reference 和 simulation 配置。
3. simulator leader 给相关 `rp.actor` 发送过滤后的 subject-facing message，不泄露上帝视角秘密。
4. subject simulator 返回结构化 response packet。
5. simulator leader 做世界裁决、剧情推进和信息边界整理。
6. `rp.actor` 的旁路维护自己的 `events.md`、`knowledge.md` 与 `mind.md`。
7. simulator leader 裁决并写入 subject `state.md` 与必要的 `simulation/entities/*`。
8. simulator leader 构造 writer brief，调用 `rp.writer`。
9. 最终只把用户可见正文和必要的简短 GM 提示返回给用户。

如果 Tick 需要落盘，第一版优先写入 `simulation/runs/ticks/{id}-{slug}/report.md` 和 `prose.md`。`report.md` 保存后台裁决、状态提交、信息边界和 writer-safe brief；`prose.md` 保存 `rp.writer` 或 leader 输出给用户的完整正文。`input.md`、actor packets、tool log 等机械产物后续可由 workflow/runtime 自动生成，不要求手写。

## 边界

- `leader.rp` 是 simulator leader，可在 GM 裁决后写入 subject `state.md`、`simulation/entities/*` 和必要的 `simulation/runs/*`。
- `rp.actor` 是 subject simulator；主扮演阶段不读取完整 `simulation/`、`lorebook/`、`reference/` 或其他 subject 文件。
- `rp.actor` 的旁路可以维护自己的 `events.md`、`knowledge.md` 与 `mind.md`；`state.md` 与 `entities` 由 simulator leader 裁决。
- `rp.writer` 只消费 `simulation/writer.md` 和 simulator leader brief，不自主遍历 `simulation/` 或 lorebook。
- 第一版不做持久化 session 记忆，不实现完整变量系统。

## 信息控制模型

- `lorebook/` 保存原型、规则和全知设定。
- `simulation/subjects/{id}/events.md` 保存该 subject 怎么经历或获知信息。
- `simulation/subjects/{id}/knowledge.md` 保存该 subject 已知、相信或误解的内容。
- `simulation/subjects/{id}/state.md` 保存 GM 裁决后的当前状态快照。
- `simulation/entities/{entity-id}/` 保存需要状态追踪的真实实例，例如被下毒的血药、世界之心碎片、门锁或唯一道具。

普通可堆叠物品不需要实例化，可以在 subject `state.md` 中用 `prototype + quantity` 记录。特殊、隐藏状态、唯一或被改造的实例才进入 `simulation/entities/`；subject 是否知道实例真相仍由自己的 `events.md` 与 `knowledge.md` 决定。

## 完成标准

- 用户已经选择 `leader.rp` 或就地 RP 入口。
- `simulation/` 目录存在且最小文件齐全。
- `cast.yaml` 中至少有 player subject。
- agent 能解释下一步要读哪些文件、创建哪些 subject simulator、如何开始第一 Tick。
