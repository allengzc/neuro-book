---
title: 剧情导演
type: note
subtype: directory-index
status: active
icon: clapperboard
aliases: []
tags:
  - 目录说明
summary: "Director profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 剧情导演

本目录保存 director profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agent-context/director/` 存储 director profile 在当前项目中的剧情规划偏好、节奏控制原则、跨 session 记忆和程序生成的推荐。director 专注于剧情结构设计和叙事节奏把控。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
