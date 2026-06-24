# Round 5 - Workbench Empty State Module

## Background

继续 Task 66 的自主代码清理。Round 3 / Round 4 已把 Workbench review issue 统计规则从 `WorldEngineWorkbenchDialog.vue` 下沉到 `world-engine-workbench-real.ts`。本轮继续找 Dialog 内与 Vue 响应式无关、但规则密集的决策树。

## Evidence

- `docs/adr` 当前不存在，没有额外 ADR 约束。
- `git status --short` 仍显示 worktree 很脏，本轮继续避免大拆。
- `WorldEngineWorkbenchDialog.vue` 中 `emptySliceState` 原本内联多分支决策：
  - 选中的 subject 尚未注册到 World Engine。
  - 已选 subject 但当前视角没有 slice。
  - 有 slice / 有过滤但未选中 slice。
  - Project 有待同步的 simulation/subjects。
  - demo schema 不可用时应该创建 subject、创建 world subject，还是直接新建 slice。
  - demo schema 可用时展示一键示例世界。
- 这段逻辑决定作者打开 Workbench 后“第一个卡住的地方在哪里”，属于作者主路径入口规则，不应该藏在 Dialog 的模板附近。

## Assessment

候选问题：

1. **继续抽请求编排 Module**
   - 仍不适合本轮。
   - `$fetch` wrapper 会是浅 Module；真正值得抽时应同时收拢 request token、busy/error/notice 和状态回流。

2. **下沉 empty slice state 决策树**
   - 适合本轮。
   - Interface 可以保持小：传入 subject 选择、world subject 集合、是否有 slice / 过滤、待同步数量、demo schema 状态。
   - Implementation 承担作者入口空状态的标题、描述和动作选择。
   - 删除测试：如果删除这个 Module，复杂度会回到 Dialog 或其它入口 UI，不会消失。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增：
  - `WorldWorkbenchEmptySliceAction`。
  - `WorldWorkbenchEmptySliceState`。
  - `buildWorldWorkbenchEmptySliceState(input)`。
- `WorldEngineWorkbenchDialog.vue` 只把当前 computed 状态传给 util。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 静态断言不再要求文案和类型必须存在于 Dialog。
  - 新增行为测试覆盖主要空状态分支。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 empty slice state 类型和决策函数。
  - 集中维护空时间线的标题、描述和 action。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 删除本地 `EmptySliceAction` / `EmptySliceState`。
  - `emptySliceState` 改为调用 `buildWorldWorkbenchEmptySliceState`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 新增 “真实 Workbench util 决定空时间线下一步动作” 用例。
  - 将旧源码位置断言改到 util 或行为断言。

## Verification

已运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：

- 1 file passed。
- 5 tests passed。

本轮没有跑全量 typecheck。修改范围集中在 Workbench util、Dialog computed 调用和对应窄测试。

## Result vs Plan

- 与计划一致：没有改模板结构，没有改交互动作。
- 与计划一致：empty slice state 决策树从 Dialog 下沉到 util。
- 额外修正：入口测试里几条旧源码位置断言随规则迁移改成 util / 行为断言。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：2291 行。
- `app/utils/world-engine-workbench-real.ts`：776 行。
- `app/utils/world-engine-ide-entry.test.ts`：1836 行。

## Follow-ups

- 继续寻找 Workbench 内部可下沉的规则密集点，例如 `worldViewFilterParts`、`inspectorButtonTitle`、busy guard 文案。
- `world-engine-ide-entry.test.ts` 继续变大，后续应考虑把 Workbench util 行为测试拆出为专门文件，降低入口测试噪音。
- 请求编排 Module 仍应先做 Interface 设计，不要从 `$fetch` wrapper 起步。
