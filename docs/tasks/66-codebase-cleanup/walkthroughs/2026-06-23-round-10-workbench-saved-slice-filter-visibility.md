# Round 10 - Workbench Saved Slice Filter Visibility

## Background

继续 Task 66 的自主清理。本轮保持小步重构：只处理一个有明确规则密度、无网络副作用、低行为偏移风险的 Workbench Dialog 切面。

Round 9 已把 review 队列焦点选择规则下沉到 `world-engine-workbench-real.ts`。本轮继续检查 Dialog 中仍内联的纯规则。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 中 `clearSubjectFilterIfSavedSliceWouldBeHidden` 负责保存 slice 后判断当前 subject filter 是否仍能看到这条 slice。
- 原实现内联了规则：
  - 没有 selected subject 时不清过滤。
  - `all` 模式要求保存的 mutations 触及所有 selected subjects。
  - `any` 模式只要求触及任一 selected subject。
  - 不命中时清空 selected subjects，并把 filter mode 回到 `any`。
- 这段规则不涉及 i18n、样式 class 或 API 请求，适合作为纯函数下沉。

## Assessment

候选问题：

1. **草稿标题 / Inspector 标题文案下沉**
   - 暂不做。
   - 虽然简单，但主要是 UI 文案拼接；当前优先处理更接近行为语义的规则。

2. **保存后 subject filter 可见性判断**
   - 本轮采用。
   - Module 有 Depth：承载 `all` / `any` 过滤语义和空过滤默认可见语义。
   - Interface 小：输入 mutations、selectedSubjectIds、subjectFilterMode，输出 boolean。
   - Locality 更好：Dialog 保留“是否清空 ref”的副作用，util 只回答“保存后的 slice 是否仍可见”。

3. **请求编排抽象**
   - 仍不做。
   - 仅包 `$fetch` 会变成浅 Module；需要等 request token、busy/error/notice、状态回流能一起收拢再设计。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `isWorldWorkbenchSliceVisibleInSubjectFilter`。
- `WorldEngineWorkbenchDialog.vue` 的 `clearSubjectFilterIfSavedSliceWouldBeHidden` 改为调用该 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试，覆盖：
  - 空 selected subjects 默认可见。
  - `any` 模式触及任一 subject 即可见。
  - `all` 模式缺少任一 selected subject 即不可见。
  - `all` 模式全部触及才可见。
  - `any` 模式完全不触及时不可见。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `isWorldWorkbenchSliceVisibleInSubjectFilter`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `clearSubjectFilterIfSavedSliceWouldBeHidden` 继续作为副作用入口存在，但内部可见性判断改为调用 util。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“判断保存后的 slice 是否仍命中 subject 过滤”测试。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 更新最新测试结果、热点行数和 Round 10 索引。
- `PROJECT-STATUS.md`
  - 更新 Task 66 当前说明。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 8 tests passed。

## No Behavior Drift Check

- 空 subject filter 仍不清空过滤。
- `all` 模式仍要求保存 slice 触及所有 selected subjects。
- `any` 模式仍要求保存 slice 触及至少一个 selected subject。
- 不命中时仍由 Dialog 清空 selected subjects，并把 subject filter mode 设回 `any`。
- 没有修改保存请求、通知文案、timeline 刷新或 issue 记录。

## Bugs / Decisions

- Bug：本轮未发现业务 bug。
- 难以决策点：草稿标题 / Inspector 标题文案是否下沉仍暂不处理；请求编排抽象仍需要更强设计证据。
- 设计决策：保存后过滤可见性属于行为语义，适合放进 `world-engine-workbench-real.ts`；清空 Vue ref 的副作用继续留在 Dialog。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2163 行。
- `app/utils/world-engine-workbench-real.ts`：约 803 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1220 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 701 行。

## Follow-ups

- 继续寻找保存、筛选、焦点、草稿这些用户动作中的纯规则下沉点。
- `world-engine-ide-entry.test.ts` 仍有大量源码字符串断言；后续只在有对应 util / contract 行为测试时逐步替换。
- 如果要抽请求编排，先写设计计划，不直接开拆。
