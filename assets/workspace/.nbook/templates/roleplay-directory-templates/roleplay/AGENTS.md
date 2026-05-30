# Roleplay AGENTS.md

本目录是当前 Project Workspace 的 RP 运行配置。默认只给 `leader.rp` / GM 读取；不要让 actor 或 writer 自行遍历整个 `roleplay/`。

## 启动顺序

1. 读取 `config.yaml`、`cast.yaml`、`gm.md` 和 `writer.md`。
2. 根据 `cast.yaml` 初始化玩家 actor 和示例 NPC actor。
3. 只把 actor 自己的 `actor.md`、`knowledge.md` 与当前 Tick 的观察 packet 注入给该 actor。
4. 只把 GM 整理好的 writer brief 与 `writer.md` 注入给 `rp.writer`。

## 信息边界

- GM 可以读取 `lorebook/`、`reference/` 与 `roleplay/` 中的上帝视角信息。
- actor 只知道自己的 `knowledge.md` 与 GM 当前注入的信息。
- writer 只写用户可见正文，不输出 GM 裁决过程、actor packet 或隐藏设定。

## 当前限制

- 第一版不设计持久化 session。
- 第一版不实现完整变量系统。
- 第一版不实现 sidecar；writer 的 lorebook 摘要由 GM 主动整理，actor 可以直接维护自己的 `knowledge.md`。
