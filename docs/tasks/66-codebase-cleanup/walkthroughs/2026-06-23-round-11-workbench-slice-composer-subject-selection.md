# Round 11 - Workbench Slice Composer Subject Selection

## Background

继续 Task 66 的自主整理、清理、优化和重构。本轮仍按小步策略推进：不碰请求编排、不碰 UI 样式 class，只处理一个影响作者操作默认值的纯规则。

Round 10 已把保存后 subject filter 可见性判断下沉到 `world-engine-workbench-real.ts`。本轮继续检查 Workbench Dialog 中的 Slice Composer 相关规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中原本有三个相关 computed：
  - `selectedRegisteredSubjectIds`。
  - `sliceComposerRequestedSubjectId`。
  - `sliceComposerSubjectId`。
- 原规则决定作者打开 Slice Composer 时默认选中哪个 subject：
  - focused subject 已注册时优先使用 focused subject。
  - 否则使用 selected subjects 中最后一个已注册 subject。
  - 如果当前只有未注册 subject，则保留这个 requested id，用于打开前提示“尚未接入 World Engine”。
  - 最终传给 Composer 的 subject 如果未注册，则回落到第一个 World Engine subject；没有 subject 时回落到 `world`。
- 这段逻辑不涉及 i18n、API 请求或样式，但会影响作者新建 slice 时默认写给哪个主体，适合作为纯规则下沉并测试。

## Assessment

候选问题：

1. **Slice Composer 默认 subject 选择**
   - 本轮采用。
   - Module 有 Depth：需要同时保留 requested subject 上下文和最终可写 subject fallback。
   - Interface 小：输入 focusedSubjectId、selectedSubjectIds、worldSubjectIds，输出 `{requestedSubjectId, subjectId}`。
   - Locality 更好：Dialog 继续负责打开前提示和 Vue ref，util 负责选择规则。

2. **草稿标题 / Inspector 标题文案下沉**
   - 暂不做。
   - 主要是 UI 文案拼接，当前收益低于行为规则。

3. **请求编排抽象**
   - 仍不做。
   - 需要更完整的 session Interface 设计，不能只包 `$fetch`。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增：
  - `WorldWorkbenchSliceComposerSubjectSelection`。
  - `buildWorldWorkbenchSliceComposerSubjectSelection`。
- 在 `WorldEngineWorkbenchDialog.vue` 中删除 `selectedRegisteredSubjectIds` computed，把 `sliceComposerRequestedSubjectId` / `sliceComposerSubjectId` 改为读取 selection computed。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试，覆盖：
  - focused subject 已注册时优先。
  - selected subjects 中最后一个已注册 subject 优先。
  - focused 未注册但有 registered selected 时，使用 registered selected。
  - 只有未注册 subject 时，保留 requested id，但最终 subject 回落到第一个 world subject。
  - 没有 world subject 时最终回落到 `world`。
- 更新入口静态测试，使它不再锁死 Dialog 内部 computed 实现。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchSliceComposerSubjectSelection`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 删除 `selectedRegisteredSubjectIds` computed。
  - 新增 `sliceComposerSubjectSelection` computed。
  - `sliceComposerRequestedSubjectId` 和 `sliceComposerSubjectId` 继续保留原名字，避免模板和打开逻辑扩散修改。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“选择 Slice Composer 默认 subject 并保留未注册上下文”测试。
- `app/utils/world-engine-ide-entry.test.ts`
  - 把旧的 Dialog 内联选择规则字符串断言改为 util 承载断言。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新最新测试结果、热点行数和 Round 11 索引。
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

- focused subject 已注册时仍优先成为 requested 和最终 selected subject。
- selected subjects 中最后一个已注册 subject 仍作为 fallback。
- 未注册 subject 仍会作为 requested id 保留，供 `openSliceComposer` 显示“尚未接入 World Engine”的提示。
- 最终传给 Composer 的 subject 仍只使用已注册 subject；没有可用 subject 时仍回落到 `world`。
- 没有修改打开提示、保存逻辑、请求、通知文案或 timeline 刷新。

## Bugs / Decisions

- Bug：本轮未发现业务 bug。
- 难以决策点：无。
- 设计决策：requested subject 与最终 subject 是同一个行为规则的两面，应由一个 util 一次性返回，避免 Dialog 里两个 computed 各自复制 fallback 心智。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2157 行。
- `app/utils/world-engine-workbench-real.ts`：约 823 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1222 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 729 行。

## Follow-ups

- 继续优先处理 Slice Composer、筛选、焦点、草稿这些作者动作中的纯规则。
- `world-engine-ide-entry.test.ts` 仍有大量源码字符串断言；后续继续把能落到 util 的规则搬到行为测试。
- 请求编排和 Preview session composable 仍需要更强设计证据，不在本轮直接拆。
