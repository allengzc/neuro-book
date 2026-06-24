# Round 16 - Workbench Saved Edit Filter Preservation

## Background

继续 Task 66 的自主清理。本轮仍遵守当前约束：

- bug 不顺手修，先记录。
- 复杂问题先记录。
- 符号命名和文件结构问题先记录，等待审批。

Round 15 已把 “latest slice by subject” 规则下沉到 `world-engine-workbench-real.ts`。本轮查看保存 slice metadata / value patch 后的过滤器处理逻辑。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 和 `assets/workspace/.nbook/templates/project-directory-templates/world-engine/index.md` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中 `clearFiltersIfSavedEditWouldBeHidden` 负责保存编辑后保持当前 slice 可见：
  - 如果 edited slice 不命中 subject filter，清空 selected subjects 并切回 `any`。
  - 如果不命中 kind filter，kind 回到 `all`。
  - 如果不命中 search，search 清空。
  - 如果 health filter 不是 `all`，health 回到 `all`。
- 这段逻辑本质是 filter state 规则；已有 `world-engine-workbench-preview-filter.ts` 承载 subject / kind / health / search matcher。
- 本轮没有新建文件、没有移动文件、没有重命名旧符号；只在已有 filter util 中增加一个纯函数。

## Assessment

候选问题：

1. **保存编辑后的过滤器保留规则**
   - 本轮采用。
   - Module 有 Depth：集中回答“怎样调整 filter 才能让刚保存的 slice 继续可见”。
   - Interface 小：输入当前 filter state 和 edited slice，输出 next filter state。
   - Locality 更好：Dialog 继续负责写 Vue refs，filter util 负责纯判断。

2. **filter util 文件是否应该进入子目录**
   - 本轮不做。
   - 属于文件结构问题，Round 13 已记录待审批。

## Plan

- 在 `app/utils/world-engine-workbench-preview-filter.ts` 新增：
  - `WorkbenchPreviewFilterState`。
  - `buildWorkbenchPreviewFiltersAfterSavedEdit`。
- `WorldEngineWorkbenchDialog.vue` 的 `clearFiltersIfSavedEditWouldBeHidden` 改为调用该 util，并写回返回的 next filter state。
- 在 `app/utils/world-engine-workbench-preview.test.ts` 增加行为测试：
  - 不命中 subject / kind / search / health 时返回清理后的 filter state。
  - 已命中时保留原 filter state。
- 更新入口静态测试，避免继续要求 Dialog 直接调用底层 matcher。

## Changes

- `app/utils/world-engine-workbench-preview-filter.ts`
  - 新增 `buildWorkbenchPreviewFiltersAfterSavedEdit`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `clearFiltersIfSavedEditWouldBeHidden` 保留为副作用入口，内部使用 next filter state。
- `app/utils/world-engine-workbench-preview.test.ts`
  - 增加 saved edit filter preservation 行为断言。
- `app/utils/world-engine-ide-entry.test.ts`
  - 更新静态断言，确认 Dialog 使用新 filter util。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新 Round 16 索引、热点行数、最新验证结果。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 3 files passed。
- 16 tests passed。

## No Behavior Drift Check

- edited slice 不命中 subject filter 时仍清空 selected subjects，并把 mode 改成 `any`。
- edited slice 不命中 kind filter 时仍把 kind 改成 `all`。
- edited slice 不命中 search 时仍清空 search。
- health filter 非 `all` 时仍回到 `all`。
- 保存请求、通知、refresh timeline、issue 记录都没有修改。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：filter util 的目录归属仍属于文件结构问题，等待用户审批；本轮只在已有文件内增加函数。
- 命名 / 文件结构：没有重命名旧符号，没有拆文件。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2153 行。
- `app/utils/world-engine-workbench-real.ts`：约 846 行。
- `app/utils/world-engine-workbench-preview-filter.ts`：约 107 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1223 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 760 行。
- `app/utils/world-engine-workbench-preview.test.ts`：约 1140 行。

## Follow-ups

- 继续寻找保存 / 筛选 / 焦点中的简单纯规则。
- 命名和文件结构候选仍等待用户审批。
- 复杂主体语境 `alignFocusedSubject` 继续保持只记录，不顺手拆。
