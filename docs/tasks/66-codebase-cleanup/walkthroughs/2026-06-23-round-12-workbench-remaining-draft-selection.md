# Round 12 - Workbench Remaining Draft Selection

## Background

用户更新了 Task 66 目标：继续自主整理、清理、优化和重构，但如果遇到 bug 不要顺手修，先记录；遇到复杂问题也先记录。本轮按这个约束继续，只处理一个简单纯规则，不碰复杂请求编排或潜在 bug 修复。

Round 11 已把 Slice Composer 默认 subject 选择规则下沉到 `world-engine-workbench-real.ts`。本轮继续查看删除 slice 后的草稿会话规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中删除 slice 后会先计算 `nextDraftSliceId`：
  - 如果当前删除的 slice 之外还有草稿 slice，删除后进入 draft 视角并打开它。
  - 如果没有剩余草稿，则不进入 draft 视角。
- 原实现的 `firstRemainingDraftSliceId` 直接读取 `draftSliceIds.value.find((sliceId) => sliceId !== deletedSliceId) ?? ""`。
- 这段规则简单、无副作用、不涉及 UI 文案或请求，适合下沉为 util，并让 Dialog 保留会话态 adapter。

## Assessment

候选问题：

1. **删除 slice 后选择第一个剩余草稿**
   - 本轮采用。
   - Module 有轻量 Depth：表达“跳过被删除 slice，保留第一个其它草稿”的删除后会话规则。
   - Interface 小：输入 draftSliceIds 和 deletedSliceId，输出 remaining draft slice id 或空字符串。
   - Locality 更好：删除流程副作用留在 Dialog，选择规则由 util 测试覆盖。

2. **删除后的 snapshot / transient issue 清理**
   - 暂不做。
   - 涉及多组前端会话态副作用，属于更复杂问题；按新约束先不展开。

3. **请求编排抽象**
   - 仍不做。
   - 复杂且需要系统设计，不能在本轮顺手拆。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `findWorldWorkbenchFirstRemainingDraftSliceId`。
- `WorldEngineWorkbenchDialog.vue` 保留 `firstRemainingDraftSliceId`，内部改为调用 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 中补覆盖：
  - 有其它草稿时返回第一个其它草稿。
  - 只有被删草稿时返回空字符串。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `findWorldWorkbenchFirstRemainingDraftSliceId`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `firstRemainingDraftSliceId` 改为调用 util，删除流程不变。
- `app/utils/world-engine-workbench-real.test.ts`
  - 在现有 Workbench util 行为测试中补 remaining draft selection 断言。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 同步用户更新后的 bug / 复杂问题记录约束。
  - 更新热点行数和 Round 12 索引。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 9 tests passed。

## No Behavior Drift Check

- 删除流程仍先在请求前计算 `nextDraftSliceId`。
- 仍跳过被删除 slice，返回第一个其它草稿 slice id。
- 没有其它草稿时仍返回空字符串。
- `enterDraftViewForSlice`、`clearSessionStateForDeletedSlice`、`recordTransientIssues` 和 API 删除请求均未改变。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：删除后的 snapshot / transient issue / draft surface 清理涉及多组前端会话态副作用，本轮不拆，只记录为后续候选。
- 设计决策：下沉选择规则，不下沉删除流程副作用；Dialog 继续承担 Vue ref 和请求编排。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2158 行。
- `app/utils/world-engine-workbench-real.ts`：约 827 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1222 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 732 行。

## Follow-ups

- 继续按“发现 bug / 复杂问题先记录”的新约束推进。
- 如要整理删除后的 session cleanup，应先画出 metadata drafts、value drafts、transient issues、snapshot、full snapshot、mutation focus 的副作用矩阵，再决定是否拆。
- 继续逐步把 `world-engine-ide-entry.test.ts` 中可转成行为测试的源码字符串断言迁移到专用 util 测试。
