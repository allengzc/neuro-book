# Round 17 - Workbench Unsaved Draft Labels

## Background

继续 Task 66 的自主清理。本轮仍遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 符号命名和文件结构问题先记录，等待审批。

Round 16 已把保存编辑后的 filter preservation 规则下沉到 `world-engine-workbench-preview-filter.ts`。本轮回到 `WorldEngineWorkbenchDialog.vue`，寻找一个不涉及请求编排、不涉及复杂主体语境的小规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 和 `assets/workspace/.nbook/templates/project-directory-templates/world-engine/index.md` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中 `workbenchUnsavedDraftLabels` 负责关闭 Workbench 前汇总会丢弃的草稿标签：
  - Slice Composer 有未保存草稿时加入 `Slice Composer 草稿`。
  - metadata draft count 大于 0 时加入 `N 个 metadata 草稿`。
  - value draft slice count 大于 0 时加入 `N 个 value 草稿`。
- 这段逻辑不涉及请求、副作用或复杂状态流；Dialog 仍应负责读取 Vue refs、调用 confirm 和 emit。

## Assessment

候选问题：

1. **unsaved draft labels 汇总**
   - 本轮采用。
   - Module 有轻量 Depth：统一关闭确认中未保存草稿标签的顺序和格式。
   - Interface 小：输入三个计数 / 状态，输出 string array。
   - Locality 更好：Dialog 保留 close flow，util 承载标签规则并由测试覆盖。

2. **关闭确认流程本身**
   - 本轮不做。
   - 涉及 confirm dialog、model update、hasUnsavedDraftsChange、savingChange 等副作用，属于更复杂流程。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增：
  - `WorldWorkbenchUnsavedDraftCounts`。
  - `buildWorldWorkbenchUnsavedDraftLabels`。
- `WorldEngineWorkbenchDialog.vue` 的 `workbenchUnsavedDraftLabels` 保留为本地 adapter，内部调用 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试。
- 更新入口静态测试，使它不再要求 Dialog 内联 `labels.push(...)`。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchUnsavedDraftLabels`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `workbenchUnsavedDraftLabels` 改为调用 util。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“汇总关闭 Workbench 时会丢弃的草稿标签”测试。
- `app/utils/world-engine-ide-entry.test.ts`
  - 静态断言改为确认 util 承载标签文案。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新 Round 17 索引、热点行数、最新验证结果。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 3 files passed。
- 17 tests passed。

## No Behavior Drift Check

- 标签顺序保持：Slice Composer、metadata、value。
- 标签文本保持原中文文案。
- 关闭确认流程、`requestWorkbenchClose`、`handleWorkbenchModelUpdate`、watch emit 均未改变。
- 没有修改命名 / 文件结构；只新增函数。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：关闭确认流程本身牵涉多个 emit 和 confirm 副作用，本轮不拆。
- 命名 / 文件结构：没有重命名旧符号，没有拆文件；Round 13 的待审批项仍保持。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2148 行。
- `app/utils/world-engine-workbench-real.ts`：约 865 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1225 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 777 行。

## Follow-ups

- 继续寻找关闭 / 保存 / 筛选 / 焦点中的简单纯规则。
- 关闭确认流程如需整理，应先画出 modelValue、requestClose、confirm、emit 的副作用顺序。
- 命名和文件结构候选仍等待用户审批。
