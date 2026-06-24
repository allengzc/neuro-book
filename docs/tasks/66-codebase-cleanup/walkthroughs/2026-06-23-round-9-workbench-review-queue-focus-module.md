# Round 9 - Workbench Review Queue Focus Module

## Background

用户重新要求继续在 Task 66 内自主整理、清理、优化和重构代码。本轮沿用既定流程：先看 git / task / 代码证据，再选一个低风险切面做小步清理，最后记录 walkthrough。

Round 8 曾阶段收尾，但当前目标重新开启，因此本轮继续推进，不把阶段收尾视为终止条件。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `WorldEngineWorkbenchDialog.vue` 仍超过 2000 行。
- Dialog 顶部 `currentReviewQueueIndex` 内联了 review 队列焦点选择规则：
  - 优先使用 `focus.issueKey` 定位具体 issue。
  - 如果 issue key 找不到，则回落到当前 selected slice 下的 subject / attr。
  - 最后回落到当前 selected slice 的第一条 review item。
- 这段规则不涉及 i18n、UI class 或请求编排，适合下沉为纯函数。

## Assessment

候选问题：

1. **抽 `$fetch` 请求编排**
   - 暂不做。
   - 当前风险是形成浅 Module；需要同时收拢 request token、busy/error/notice 和状态回流规则才值得设计。

2. **抽 Inspector button class / title**
   - 暂不做。
   - class 是样式 Interface，抽到 util 后可能把 UI 细节扩散到业务 util。

3. **下沉 review 队列焦点选择规则**
   - 本轮采用。
   - Module 有一定 Depth：承载 issue key、subject attr、selected slice fallback 的优先级。
   - Interface 小：输入 focus、reviewQueueItems、selectedSliceId，输出 index。
   - Locality 更好：专用 util 测试直接覆盖焦点优先级，Dialog 只保留响应式组合。

## Plan

- 在 `app/utils/world-engine-workbench-real.ts` 新增 `buildWorldWorkbenchCurrentReviewQueueIndex`。
- `WorldEngineWorkbenchDialog.vue` 的 `currentReviewQueueIndex` computed 改为调用该 util。
- 在 `app/utils/world-engine-workbench-real.test.ts` 增加行为测试，覆盖：
  - issueKey 命中优先。
  - issueKey 失效时按 selected slice + subject + attr 回落。
  - 无 focus 时按 selected slice 回落。
  - 无匹配时返回 `-1`。
- 更新入口测试，把旧的 Dialog 内联 `findIndex` 字符串断言改成 util 函数位置断言。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchCurrentReviewQueueIndex`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `currentReviewQueueIndex` 改为调用 `buildWorldWorkbenchCurrentReviewQueueIndex`。
- `app/utils/world-engine-workbench-real.test.ts`
  - 新增“按 issue key 和当前 slice 计算 review 队列焦点”测试。
- `app/utils/world-engine-ide-entry.test.ts`
  - 入口静态测试不再要求 Dialog 内出现 review queue `findIndex` 实现，改为确认 util 承载焦点函数。
- `docs/tasks/66-codebase-cleanup/README.md`
  - 状态从 Round 8 的阶段收尾更新为当前继续进行。
  - 更新热点行数、最新测试结果和本轮索引。
- `PROJECT-STATUS.md`
  - Task 66 改回 `In Progress`，说明用户已重新开启持续清理。

## Verification

运行：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 7 tests passed。

## No Behavior Drift Check

- 原优先级保持不变：issueKey 命中优先，其次当前 slice + subject + attr，最后当前 selected slice。
- 返回值仍使用 `findIndex` 语义；没有匹配时保持 `-1`。
- 没有改动 review issue 状态、筛选、请求、通知或 UI 文案。

## Bugs / Decisions

- Bug：本轮未发现业务 bug。
- 难以决策点：请求编排抽象、Inspector 样式 class 抽象、Preview session composable 仍暂不处理。
- 设计决策：继续只下沉纯规则，不把 UI 样式或网络副作用塞进 util。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2165 行。
- `app/utils/world-engine-workbench-real.ts`：约 788 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1220 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 669 行。

## Follow-ups

- 继续寻找 Workbench Dialog 中可测试的纯规则，而不是抽浅 wrapper。
- `world-engine-ide-entry.test.ts` 仍有大量源码字符串断言；后续继续用 util / contract 行为测试替换其中高噪声部分。
- 若要处理请求编排，需要先设计真正深的 session Interface，再动代码。
