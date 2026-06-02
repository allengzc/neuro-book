---
name: 小说流程 09：章节写作
description: 用于把已经明确的 Plot、章节目标、设定上下文和写作约束交给普通 writer profile 写入唯一章节 manuscript index.md；不让 writer 直接维护 simulation/。
when_to_use:
  - 用户要求正式写一章、续写目标章节、按 Plot 写正文
  - leader 已经有明确 chapterPath、章节 Plot 和必要 lorebookEntries
  - emulation 或剧情规划结果已经整理成 writer-safe 约束，需要进入正文产出
---

# 小说流程 09：章节写作

本 skill 指导 leader 调用普通 `writer` profile。`writer` 是章节正文 agent，不是 emulator，也不是 RP writer。

## 前置检查

- 当前 Project Workspace 明确。
- 目标章节内容节点存在，例如 `project-slug/manuscript/001-volume/001-chapter/`。
- Plot System 中需要写入本章的 Scene 已挂到该 `chapterPath`。
- 需要设定上下文时，已通过 `retrieval` 得到候选，并由 leader 选择 `entries[].path`。
- 如果剧情状态尚未裁决，先使用 `novel-workflow-06-emulation-tick` 或让用户确认。

## 调用 writer

- `writer.input.chapterPaths` 必须且只能包含一个章节目录。
- `writer.input.lorebookEntries` 只传内容节点 path 字符串数组。
- 不把 retrieval 的 reason / use / risk / note 直接传给 writer。
- 不让 writer 自己遍历 `simulation/`。
- 如需使用 emulation 结果，由 leader 整理成 Plot、constraints、writer-safe brief 或选中的 lorebook state。

## 写后检查

章节完成后，leader 检查：

- Plot 是否全部落实。
- 角色视角和信息边界是否越界。
- 正文是否产生新的已裁决事实。
- 如状态发生变化，是否需要补一次 emulation commit。

## 完成标准

- 正文写入唯一目标章节 `index.md`。
- writer 通过 `report_result` 报告写入路径、润色情况和剧情摘要。
- 如发生世界状态变化，leader 已记录为后续 emulation commit 或直接完成 commit。
