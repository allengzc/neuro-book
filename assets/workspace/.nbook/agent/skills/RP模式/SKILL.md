---
name: RP模式
description: 用于用户想进入 NeuroBook roleplay/RP 模式、启动 leader.rp、理解 GM/actor/writer Tick 流程，或确认当前 Project Workspace 是否已具备 roleplay/ 运行目录。
when_to_use:
  - 用户说进入 RP、开始 roleplay、跑角色扮演、用 GM 带剧情、和角色互动
  - 用户询问 leader.rp、rp.actor、rp.writer、GM Tick、actor knowledge 或 RP 模式怎么用
---

# RP模式

用于把当前 Project Workspace 切到 roleplay 优先的运行方式。RP 模式不是普通写作 profile；用户应和 `leader.rp` 会话交互，由它作为 GM 调度 `rp.actor` 和 `rp.writer`。

## 前置检查

- 当前 Project Workspace 必须存在 `project.yaml`。
- 当前 Project Workspace 应存在 `roleplay/AGENTS.md`、`roleplay/config.yaml`、`roleplay/cast.yaml`、`roleplay/gm.md`、`roleplay/writer.md` 和 `roleplay/actors/*`。
- 如果没有 `roleplay/`，先使用 `RP目录初始化`。
- 如果用户要从 SillyTavern 卡进入 RP，先使用 `SillyTavern角色卡导入` 完成 `inspect -> unpack -> import --rp`。

## 启动方式

1. 提醒用户创建或切换到 `leader.rp` 会话。`leader.default` 可以协助准备，但正式 RP Tick 应由 `leader.rp` 接管。
2. `leader.rp` 启动后读取 `roleplay/AGENTS.md`、`config.yaml`、`cast.yaml`、`gm.md` 和 `writer.md`。
3. `leader.rp` 根据 `cast.yaml` 创建或复用 `rp.actor` 会话；每个 actor 只注入自己的 `actor.md` 与 `knowledge.md`。
4. `leader.rp` 创建或复用 `rp.writer`，只给它 `roleplay/writer.md` 与 GM writer brief。
5. 用户发送第一条行动、台词或剧本式指令后，进入 Tick。

## Tick 流程

1. GM 理解用户输入，把用户当作故事内 player actor。
2. GM 验证行动合理性，必要时读取 lorebook、reference 和 roleplay 配置。
3. GM 给相关 `rp.actor` 发送过滤后的观察 packet，不泄露上帝视角秘密。
4. actor 返回结构化 response packet。
5. GM 做世界裁决、剧情推进和信息边界整理。
6. GM 构造 writer brief，调用 `rp.writer`。
7. 最终只把 `rp.writer` 的正文返回给用户。

## 边界

- `leader.rp` 是 GM 主控，不直接写文件。
- `rp.actor` 可以维护自己的 `knowledge.md`，但不能读取完整 `roleplay/`、`lorebook/` 或其他 actor 的 knowledge。
- `rp.writer` 不检索 lorebook、不读写文件，只渲染 GM brief。
- 第一版不做持久化 session 记忆，不实现完整变量系统，不实现 sidecar profile pass。
- 用户输入可以是行动、台词或剧本式指令；完全沉浸式输入规则以后再收紧。

## 完成标准

- 用户已经进入或准备切换到 `leader.rp` 会话。
- `roleplay/` 目录存在且最小文件齐全。
- `cast.yaml` 中至少有 player actor。
- `leader.rp` 能解释下一步要读哪些文件、创建哪些 actor、如何开始第一 Tick。
