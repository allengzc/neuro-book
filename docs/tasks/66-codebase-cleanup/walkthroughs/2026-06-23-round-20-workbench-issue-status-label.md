# Round 20 - Workbench Issue Status Label

## Background

继续 Task 66 的自主清理。本轮仍遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 符号命名和文件结构问题先记录，等待审批。

Round 19 已把 issue code 到 A/E 的映射下沉到 `world-engine-workbench-real.ts`。本轮继续处理相邻的 issue triage status 短文案重复。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `AGENTS.md`、`assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`、`assets/workspace/.nbook/templates/project-directory-templates/world-engine/index.md`、`docs/frontend-notification-channels.md` 等非本轮文件已修改或新增，本轮不触碰。
- issue triage status 到短文案的映射重复出现在：
  - `WorldEngineWorkbenchDialog.vue`
  - `WorldEngineWorkbenchPreviewSliceCard.vue`
  - `WorldEngineWorkbenchPreviewMutationEditor.vue`
- 共享规则一致：
  - `confirmed` -> `已确认`
  - `ignored` -> `已忽略`
  - `open` -> `待处理`
- Mutation Editor 额外有 `manual` 状态，文案为 `定位`，这不是后端 issue triage status，应保留在本地 adapter。

## Assessment

候选问题：

1. **issue triage status label 重复映射**
   - 本轮采用。
   - Module 有轻量 Depth：统一后端 issue triage status 的用户可见短文案。
   - Interface 小：输入 `WorldWorkbenchPreviewIssueStatus`，输出 string。
   - Locality 更好：共享规则在 util，组件本地 `issueStatusLabel` 继续作为 UI adapter。

2. **issue status class 重复**
   - 本轮不做。
   - class 是 UI 表现层规则，各组件可能存在细微差异；按当前约束不顺手扩大。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `worldWorkbenchIssueStatusLabel`。
- `WorldEngineWorkbenchDialog.vue`、`WorldEngineWorkbenchPreviewSliceCard.vue`、`WorldEngineWorkbenchPreviewMutationEditor.vue` 的本地 `issueStatusLabel` 保留，但内部调用共享 util。
- Mutation Editor 保留 `manual` -> `定位` 本地分支。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试。
- 更新 `app/utils/world-engine-workbench-preview.test.ts` 静态断言，确认组件调用共享 util。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `worldWorkbenchIssueStatusLabel`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 本地 `issueStatusLabel` 调用共享 util。
- `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceCard.vue`
  - 本地 `issueStatusLabel` 调用共享 util。
- `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 保留 `manual` 分支；真实 issue status 调用共享 util。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“将 issue triage 状态映射成短文案”测试。
- `app/utils/world-engine-workbench-preview.test.ts`
  - 更新静态断言。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新 Round 20 索引、热点行数、最新验证结果。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 3 files passed。
- 20 tests passed。

## No Behavior Drift Check

- `open` 仍显示为 `待处理`。
- `confirmed` 仍显示为 `已确认`。
- `ignored` 仍显示为 `已忽略`。
- Mutation Editor 的 `manual` 仍显示为 `定位`，未交给共享 util。
- issue status class、triage options、模板调用方式均未改变。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：issue status class 是否统一属于 UI 表现层规则，本轮不处理。
- 命名 / 文件结构：没有重命名旧符号，没有拆文件；Round 13 的待审批项仍保持。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2148 行。
- `app/utils/world-engine-workbench-real.ts`：约 899 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1225 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 817 行。
- `app/utils/world-engine-workbench-preview.test.ts`：约 1143 行。

## Follow-ups

- issue status class 重复先不处理，避免把 UI 表现层规则一次性拉大。
- 继续寻找简单纯规则下沉点。
- 命名和文件结构候选仍等待用户审批。
