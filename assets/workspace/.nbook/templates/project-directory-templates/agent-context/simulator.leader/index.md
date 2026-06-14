---
title: 模拟主管
type: note
subtype: directory-index
status: active
icon: orbit
aliases: []
tags:
  - 目录说明
summary: "Simulator leader profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 模拟主管

本目录保存 simulator.leader profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agent-context/simulator.leader/` 存储 simulator.leader profile 在当前项目中的推演偏好、裁决规则、跨 session 记忆和程序生成的推荐。simulator.leader 专注于世界状态推演和因果裁决。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
- simulator.leader Profile 规范：[reference/agent/simulator/README.md](../../../reference/agent/simulator/README.md)
