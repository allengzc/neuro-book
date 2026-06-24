# Round 15 - Workbench Latest Slice By Subject

## Background

继续 Task 66 的自主清理。本轮仍遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 符号命名和文件结构问题先记录，等待审批。

Round 14 已把 review issue focus cleanup 判断下沉到 `world-engine-workbench-real.ts`。本轮继续寻找 Workbench Dialog 中可下沉、但不牵涉复杂主体语境的纯规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 的 `applyDefaults` 会在创建 / 同步 subject 后优先定位到触及 preferred subjects 的最新 slice。
- 原本 `latestSliceTouchingSubjects` 内联规则：
  - 过滤空 subject id。
  - 如果没有目标 subject，返回 `null`。
  - 从 `slices.value` 末尾向前找第一个 mutation 触及任一目标 subject 的 slice。
- 该规则不涉及 Vue 副作用、请求、文案或命名 / 文件结构问题，适合下沉为纯函数。
- 同一区域的 `alignFocusedSubject` 仍涉及 world mutation、selected subject、subject system summary 的优先级，属于复杂问题，本轮继续只记录，不拆。

## Assessment

候选问题：

1. **latest slice by preferred subject**
   - 本轮采用。
   - Module 有轻量 Depth：表达“从时间线末尾找最新触及任一目标 subject 的 slice”。
   - Interface 小：输入 slices 和 subjectIds，输出 slice 或 `null`。
   - Locality 更好：Dialog 保留 apply defaults 的整体选择流程，util 负责目标 slice 查询规则。

2. **alignFocusedSubject 主体语境规则**
   - 本轮不做。
   - 按当前约束作为复杂问题记录，不顺手拆。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `findWorldWorkbenchLatestSliceTouchingSubjects`。
- `WorldEngineWorkbenchDialog.vue` 的 `latestSliceTouchingSubjects` 保留为本地 adapter，内部调用 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加断言，覆盖：
  - 空 subjectIds 返回 `null`。
  - 从 timeline 末尾返回最新命中的 slice。
  - 不命中时返回 `null`。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `findWorldWorkbenchLatestSliceTouchingSubjects`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `latestSliceTouchingSubjects` 改为调用 util。
- `app/utils/world-engine-workbench-real.test.ts`
  - 在现有 timeline util 测试中补 latest slice by subject 断言。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新 Round 15 索引、热点行数和已完成成果。
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

- 空 subjectIds 仍返回 `null`。
- 仍从当前 timeline 末尾向前找最新触及目标 subject 的 slice。
- `applyDefaults` 的 preferred slice / kept slice / fallback slice 顺序未改变。
- 没有修改 `alignFocusedSubject`、subject system summary fallback、请求、通知或 UI 文案。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：`alignFocusedSubject` 仍需要单独建优先级矩阵，不在本轮拆。
- 命名 / 文件结构：本轮没有改名、没有拆文件；Round 13 的待审批项仍保持。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2155 行。
- `app/utils/world-engine-workbench-real.ts`：约 846 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1224 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 760 行。

## Follow-ups

- `alignFocusedSubject` 后续如要处理，应先记录 world mutation、selected subject、subject system summary、first mutation fallback 的优先级矩阵。
- 继续寻找简单纯规则下沉点；复杂行为继续先记录。
- 命名和文件结构候选仍等待用户审批。
