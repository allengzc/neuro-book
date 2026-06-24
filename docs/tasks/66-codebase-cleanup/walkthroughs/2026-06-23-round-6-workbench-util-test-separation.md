# Round 6 - Workbench Util Test Separation

## Background

Round 3 到 Round 5 持续把 Workbench 的纯规则下沉到 `app/utils/world-engine-workbench-real.ts`。这些规则的行为测试最初都补在 `app/utils/world-engine-ide-entry.test.ts` 里，导致入口测试同时承担：

- Header / IDE / Workbench wiring 静态契约。
- Preview / Workbench 子 Module 的源码字符串断言。
- `world-engine-workbench-real.ts` 的 util 行为测试。

这让测试 Module 的 Interface 变宽：维护入口时要读 util 行为 fixture，维护 util 时也要穿过入口测试文件。

## Evidence

- `docs/adr` 当前不存在，没有额外 ADR 约束。
- `docs/tasks/66-codebase-cleanup/README.md` 已在 Round 5 后记录 `world-engine-ide-entry.test.ts` 约 1836 行，并把“评估是否拆出 Workbench util 行为测试”列为 follow-up。
- `app/utils/world-engine-ide-entry.test.ts` 中有 4 个 `真实 Workbench util ...` 用例，全部直接跨 `world-engine-workbench-real.ts` 的 Interface。

## Assessment

候选问题：

1. **继续下沉 Dialog 规则**
   - 仍然值得做，但这轮先处理上几轮累积出来的测试结构债。

2. **拆分 Workbench util 行为测试**
   - 适合本轮。
   - 这不是新增测试量，而是把已有测试移动到更贴近 Interface 的文件。
   - 删除测试：如果没有专门测试文件，util 行为 fixture 会继续塞在入口测试里，入口测试的 Interface 继续变宽。

## Plan

- 新增 `app/utils/world-engine-workbench-real.test.ts`。
- 把 `world-engine-ide-entry.test.ts` 中 4 个 Workbench util 行为用例迁移过去。
- 从入口测试删除不再需要的 util imports 和类型 imports。
- 保留入口测试对 `world-engine-workbench-real.ts` 源文件的静态存在性检查。

## Changes

- `app/utils/world-engine-workbench-real.test.ts`
  - 新增 4 个迁移自入口测试的行为用例：
    - 保留完整 mutation 并合并 transient issue。
    - 决定空时间线下一步动作。
    - 统计 subject 事件和 issue 状态。
    - 用主体系统 overview 补齐待接入 subject 并生成主体文件建议。
- `app/utils/world-engine-ide-entry.test.ts`
  - 移除 `world-engine-workbench-real.ts` 的直接函数 imports。
  - 移除 4 个 util 行为用例。
  - 入口测试现在只保留 1 个入口 wiring / 静态契约用例。

## Verification

已运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 5 tests passed。

本轮没有跑全量 typecheck。修改是测试 Module 迁移，验证集中在被移动的两个测试文件。

## Result vs Plan

- 与计划一致：没有改业务代码。
- 与计划一致：测试总行为覆盖没有减少；原有 4 个 util 用例迁移到专门文件。
- 实际收益：`world-engine-ide-entry.test.ts` 从约 1836 行降到 1224 行。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：2291 行。
- `app/utils/world-engine-workbench-real.ts`：776 行。
- `app/utils/world-engine-ide-entry.test.ts`：1224 行。
- `app/utils/world-engine-workbench-real.test.ts`：616 行。

## Follow-ups

- 继续拆分或替换 `world-engine-ide-entry.test.ts` 中剩余的高噪声源码字符串断言。
- 继续寻找 Workbench Dialog 内部可下沉的纯规则，例如 `worldViewFilterParts` 和 inspector title / attention class。
- Preview 页面仍超过单文件约束，后续可评估是否有真正深的 session Module 可抽。
