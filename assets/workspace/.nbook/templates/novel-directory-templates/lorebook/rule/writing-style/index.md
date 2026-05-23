---
title: 文风约束
type: rule
subtype: writing-style
status: draft
icon: pen-line
aliases: []
tags:
  - 小说初始化
  - style
summary: ""
refs: []
retrieval:
  enabled: true
  trigger: null
inject:
  profiles: # 直接上下文目标 profile key；文风约束通常给 subagent.writer，必要时也可给 leader.default。
    - subagent.writer
  always: false # 确认是长期稳定文风后才设 true；本章临时口味保持 false。
governance:
  source: manual
  review: proposed
ext: {}
---

## 叙事视角

填写人称、视角限制、信息透明度和旁白距离。

## 句式口味

记录句子长度、对白密度、描写颗粒度和节奏偏好。

## 节奏禁忌

记录不希望出现的拖沓方式、解释方式或文风偏差。

## Inject 使用

确认内容稳定后，可以按需要把 `inject.always` 改为 `true`，让写作 profile 默认带入。
