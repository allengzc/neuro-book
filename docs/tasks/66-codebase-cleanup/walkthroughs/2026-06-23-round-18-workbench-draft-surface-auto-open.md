# Round 18 - Workbench Draft Surface Auto Open

## Background

继续 Task 66 的自主清理。本轮仍遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 符号命名和文件结构问题先记录，等待审批。

Round 17 已把关闭 Workbench 前的 unsaved draft labels 汇总下沉到 `world-engine-workbench-real.ts`。本轮继续寻找 draft 工作流中的简单纯规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 和 `assets/workspace/.nbook/templates/project-directory-templates/world-engine/index.md` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中 `openDraftSurfacesForSlice` 负责从 draft 时间线定位 slice 时自动打开处理草稿的面板：
  - 只有 `sliceHealthFilter === "draft"` 时才处理。
  - 目标 slice 有 metadata draft 时打开 Inspector。
  - 目标 slice 有 value draft 时展开 Mutation Editor。
- 这段规则不涉及请求、命名、文件结构或复杂主体语境，适合下沉为纯函数。

## Assessment

候选问题：

1. **draft surface auto-open**
   - 本轮采用。
   - Module 有轻量 Depth：集中决定 draft slice 对应的处理面板。
   - Interface 小：输入 slice id、health filter、metadata draft ids、value draft ids，输出 `{openInspector, expandMutationEditor}`。
   - Locality 更好：Dialog 保留写 Vue refs 的副作用，util 负责纯判断。

2. **draft 工作流整体状态机**
   - 本轮不做。
   - 涉及删除 slice、show all drafts、metadata drafts、value drafts、discard event，多入口状态机偏复杂，按当前约束先记录不拆。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增：
  - `WorldWorkbenchDraftSurfaceState`。
  - `buildWorldWorkbenchDraftSurfaceState`。
- `WorldEngineWorkbenchDialog.vue` 的 `openDraftSurfacesForSlice` 改为调用该 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试，覆盖：
  - 非 draft health filter 不打开面板。
  - metadata draft 打开 Inspector。
  - value draft 展开 Mutation Editor。
  - 同一 slice 同时有两类 draft 时两个面板都打开。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchDraftSurfaceState`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `openDraftSurfacesForSlice` 保留为副作用入口，内部使用 util 返回的 surface state。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“决定 draft slice 需要自动打开的草稿处理面板”测试。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新 Round 18 索引、热点行数、最新验证结果。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 3 files passed。
- 18 tests passed。

## No Behavior Drift Check

- 非 draft 状态仍不会自动打开任何草稿面板。
- metadata draft 仍打开 Inspector。
- value draft 仍展开 Mutation Editor。
- `selectSlice`、`enterDraftViewForSlice`、`showAllDraftSlices` 调用链未改变。
- 没有修改请求、通知、命名或文件结构。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：draft 工作流整体状态机偏复杂，本轮不拆；如后续处理，应先列出 delete / show all / select / discard / save 的状态流。
- 命名 / 文件结构：没有重命名旧符号，没有拆文件；Round 13 的待审批项仍保持。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2152 行。
- `app/utils/world-engine-workbench-real.ts`：约 884 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1225 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 804 行。

## Follow-ups

- 继续寻找简单纯规则下沉点。
- draft 工作流整体状态机和复杂主体语境规则继续只记录，等待更明确设计。
- 命名和文件结构候选仍等待用户审批。
