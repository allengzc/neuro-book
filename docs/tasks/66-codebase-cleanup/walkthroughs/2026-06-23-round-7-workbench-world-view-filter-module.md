# Round 7 - Workbench World View Filter Module

## Background

继续 Task 66 的自主清理。用户新增约束：修改必须注意不能和原有版本发生功能偏移；如果修复中发现 bug 要记录；遇到难以决策的地方不要改，记录下来。

Round 3 到 Round 5 已把 Workbench 的 review issue、subject stats、empty state 等纯规则逐步下沉到 `world-engine-workbench-real.ts`。本轮继续寻找 `WorldEngineWorkbenchDialog.vue` 内小而规则密集的下沉点。

## Evidence

- `docs/adr` 当前不存在，没有额外 ADR 约束。
- 当前 worktree 只显示 Task 66 本轮相关文件仍有未提交改动；本轮不碰无关文件。
- `WorldEngineWorkbenchDialog.vue` 中 `worldViewFilterParts` 原本内联构造顶部“当前视角”标签：
  - focused subject 语境。
  - subject filter 模式。
  - slice kind filter。
  - slice health filter。
  - search 关键词截断。
- `sliceHealthFilterLabel` 使用 `t(...)` 读取 i18n 文案，不能直接搬进 util 写死中文，否则会造成主题语言/文案行为偏移。

## Assessment

候选问题：

1. **继续拆 `world-engine-ide-entry.test.ts`**
   - 仍值得做，但 Round 6 已先拆出 util 行为测试。
   - 继续拆需要搬大量源码字符串断言，收益偏结构，风险偏高。

2. **下沉 `worldViewFilterParts`**
   - 适合本轮。
   - Interface 可以保持小：subject id/name、过滤模式、kind/status/search、已翻译 labels。
   - Implementation 集中当前视角标签的顺序和截断规则。
   - 删除测试：如果没有这个 Module，标签规则会继续留在 Dialog；未来 Sidebar / Preview 若要复用也会重复拼装。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增：
  - `WorldWorkbenchWorldViewFilterLabels`。
  - `buildWorldWorkbenchWorldViewFilterParts(input)`。
- `WorldEngineWorkbenchDialog.vue` 保留 i18n adapter：
  - `sliceHealthFilterLabel(filter)` 仍使用 `t(...)`。
  - Dialog 传入 `labels` 和 `sliceHealthFilterLabel`，util 只拼装和截断。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试。
- 更新入口测试中过时的源码位置断言。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchWorldViewFilterParts`。
  - 新增内部 `shortWorldWorkbenchFilterText`，保持原 18 字符截断规则。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `worldViewFilterParts` computed 改为调用 util。
  - 删除本地 `shortFilterText`。
  - 保留本地 `sliceHealthFilterLabel` 作为 i18n adapter，避免语言文案偏移。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“构造当前视角过滤标签”测试，覆盖 focused subject、subject all 模式、kind/status/search 截断顺序。
- `app/utils/world-engine-ide-entry.test.ts`
  - 将旧的 Dialog 内源码位置断言改为 util 位置断言。

## Verification

第一次运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

发现两个测试断言偏移：

- 入口测试仍要求 `modeLabel` 必须在 Dialog 内。
- 新 util 测试对 `slice(0, 18)` 截断结果预期少了“截断”两个字。

这不是业务 bug，属于测试迁移后的断言位置/期望修正。已只修测试断言，没有改业务行为。

最终运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 6 tests passed。

## No Behavior Drift Check

- 原 `sliceHealthFilterLabel` 的 i18n 行为保留在 Dialog，没有把状态标签硬编码进 util。
- 原 search 截断规则仍是 `text.length <= 18 ? text : text.slice(0, 18) + "..."`。
- 原标签顺序保持为：主体语境、subject filter、kind、status、search。

## Bugs / Decisions

- Bug：本轮未发现业务 bug。
- 难以决策点：无需要暂停的问题。
- 设计决策：i18n 文案继续由 Dialog adapter 提供，util 只处理结构性拼装，避免语言行为偏移。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：2283 行。
- `app/utils/world-engine-workbench-real.ts`：823 行。
- `app/utils/world-engine-ide-entry.test.ts`：1224 行。
- `app/utils/world-engine-workbench-real.test.ts`：662 行。

## Follow-ups

- 继续寻找 Workbench Dialog 内部可下沉的纯规则，例如 inspector button title / attention class。
- 继续拆分或替换入口测试中剩余的大量源码字符串断言。
- 如果下一轮发现需要改变用户可见文案或 i18n key，应先记录决策点，不直接改。
