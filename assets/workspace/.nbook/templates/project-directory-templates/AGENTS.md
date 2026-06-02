# AGENTS.md - Novel Workspace

本目录是单本小说 workspace。长期小说状态、初始化进度、待办和待定问题统一维护在 `PROJECT-STATUS.md`；它是本 workspace 唯一的小说状态入口。

- 不在本文件维护初始化流程的待办项，避免和 `PROJECT-STATUS.md` 漂移。
- 稳定设定写入 `lorebook/`；正文、章节草稿和章节资料写入 `manuscript/`。
- Agent 的 Plan Mode 计划、walkthrough 和调研 notes 放入 `.agent/plan/`；临时 scratch、缓存和命令输出草稿使用系统临时目录，不放入本 workspace。
- 修改内容节点后，优先运行对应的 `bun scripts/workspace.ts node validate` 校验。
