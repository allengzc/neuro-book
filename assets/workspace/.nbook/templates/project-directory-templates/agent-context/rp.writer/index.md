---
title: RP 正文写手
type: note
subtype: directory-index
status: active
icon: feather
aliases: []
tags:
  - 目录说明
summary: "RP writer profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# RP 正文写手

本目录保存 rp.writer profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agent-context/rp.writer/` 存储 rp.writer profile 在当前项目中的写作风格偏好、常用描写模式、跨 session 记忆和程序生成的推荐。rp.writer 专注于根据 leader 提供的 writer-safe brief 生成用户可见正文。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
- rp.writer Profile 规范：[reference/agent/rp-tick/README.md](../../../reference/agent/rp-tick/README.md)
