---
title: RP 主持
type: note
subtype: directory-index
status: active
icon: messages-square
aliases: []
tags:
  - 目录说明
summary: "RP leader profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# RP 主持

本目录保存 rp.leader profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agent-context/rp.leader/` 存储 rp.leader profile 在当前项目中的专用指导、优先读取的内容节点列表、跨 session 记忆和程序生成的推荐。与项目根的 `AGENTS.md` 不同，这里的内容只对 rp.leader 可见。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择和项目运行说明）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
- rp.leader Profile 规范：[reference/agent/rp-tick/README.md](../../../reference/agent/rp-tick/README.md)
