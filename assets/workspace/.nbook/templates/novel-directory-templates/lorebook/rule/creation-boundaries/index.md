---
title: 创作边界
type: rule
subtype: creation-boundaries
status: draft
icon: shield-alert
aliases: []
tags:
  - 小说初始化
  - boundary
summary: ""
refs: []
retrieval:
  enabled: true
  trigger: null
inject:
  profiles: # 直接上下文目标 profile key；创作边界通常给默认 profile，必要时可换成用户自定义 profile key。
    - leader.default
  always: false # 确认是长期硬边界后才设 true；临时偏好或待定限制保持 false。
governance:
  source: manual
  review: proposed
ext: {}
---

## 硬性边界

填写绝不采用的情节、设定、描写或价值取向。

## 雷点

记录目标读者或作者明确排斥的内容。

## 容易误写的方向

记录 Agent 或协作者需要特别避开的误读。

## Inject 使用

确认内容稳定后，可以按需要把 `inject.always` 改为 `true`，让写作 profile 默认带入。
