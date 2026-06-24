# Round 14 - Workbench Review Issue Focus Cleanup

## Background

继续 Task 66 的自主清理。本轮遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 命名和文件结构问题先记录，等待审批。

Round 13 已只读记录 `world-engine-workbench-real.ts` 的命名和文件结构候选问题。本轮回到代码层面，只处理一个简单纯规则，不动命名和文件结构。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中 `clearMissingReviewIssueFocus` 负责在 review queue 刷新后清掉已经消失的 issue 高亮：
  - 没有 focus 或没有 issueKey 时不清。
  - issueKey 仍存在于 review queue 时不清。
  - issueKey 已不存在时清空 `highlightedMutationFocus`。
- 这段判断不涉及请求、文案、样式或复杂主体语境，适合下沉为纯函数。
- 同一区域的 `alignFocusedSubject` 同时处理 touched subject、world mutation、subject system summary、selected subject fallback，属于复杂主体语境规则，本轮只记录为后续候选，不拆。

## Assessment

候选问题：

1. **review issue focus cleanup 判断**
   - 本轮采用。
   - Module 有轻量 Depth：表达“旧 issueKey 是否已经从 review queue 消失”。
   - Interface 小：输入 focus 和 reviewQueueItems，输出 boolean。
   - Locality 更好：Dialog 保留清空 Vue ref 的副作用，util 负责判断。

2. **alignFocusedSubject 主体语境规则**
   - 本轮不做。
   - 该规则复杂，涉及 world slice、subject system summary、selected subject fallback 和 mutation touched subject。
   - 按当前约束，先记录，不顺手拆。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `shouldClearWorldWorkbenchReviewIssueFocus`。
- `WorldEngineWorkbenchDialog.vue` 的 `clearMissingReviewIssueFocus` 改为调用该 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试，覆盖：
  - 无 focus 不清。
  - focus 没有 issueKey 不清。
  - issueKey 仍存在不清。
  - issueKey 消失时清。
- 更新入口静态测试，避免继续锁死 Dialog 内联 `some` 实现。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `shouldClearWorldWorkbenchReviewIssueFocus`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `clearMissingReviewIssueFocus` 保留为副作用入口，内部判断改为调用 util。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“判断消失的 review issue 是否需要清理高亮”测试。
- `app/utils/world-engine-ide-entry.test.ts`
  - 入口静态测试改为确认 util 承载该判断。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新最新测试结果、热点行数和 Round 14 索引。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 10 tests passed。

## No Behavior Drift Check

- 没有 issueKey 时仍不清理 focus。
- issueKey 仍存在时仍不清理 focus。
- issueKey 不存在时仍清空 `highlightedMutationFocus`。
- watch 表达式仍监听 review queue item keys。
- 没有修改 review queue 构造、issue triage、请求、通知或 mutation editor props。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：`alignFocusedSubject` 的主体语境 fallback 规则复杂，本轮不拆。后续如果要处理，应先列出 world mutation、selected subject、subject system summary 的优先级矩阵。
- 命名 / 文件结构：本轮没有改名、没有拆文件；Round 13 的待审批项仍保持。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2158 行。
- `app/utils/world-engine-workbench-real.ts`：约 838 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1224 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 755 行。

## Follow-ups

- `alignFocusedSubject` 需要作为复杂行为先建矩阵再决定是否拆。
- 继续逐步把 `world-engine-ide-entry.test.ts` 中的源码字符串断言迁移到更具体的 util / contract 行为测试。
- 命名和文件结构候选仍等待用户审批。
