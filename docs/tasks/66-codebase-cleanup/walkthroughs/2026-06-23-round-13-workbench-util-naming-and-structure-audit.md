# Round 13 - Workbench Util Naming And Structure Audit

## Background

用户更新了 Task 66 约束：

- 如果遇到 bug，不要修复，先记录。
- 遇到复杂问题也先记录。
- 符号命名问题不要直接改，记录后等待用户审批。
- 文件结构问题，例如 utils 规范化，也先记录，等待用户审批。

本轮因此不继续做代码重构，而是对 Round 2-12 持续扩展的 `world-engine-workbench-real.ts` 做命名与文件结构只读审计。

## Evidence

- 当前 worktree 仍有 Task 66 相关未提交变更；另有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 已修改，本轮不触碰。
- `app/utils` 中 World Engine 相关 util 文件包括：
  - `world-engine-preview.ts`
  - `world-engine-workbench-preview-filter.ts`
  - `world-engine-workbench-preview-mock.ts`
  - `world-engine-workbench-preview-state.ts`
  - `world-engine-workbench-preview-value.ts`
  - `world-engine-workbench-real.ts`
  - `world-engine-workbench-slice-classifier.ts`
- `world-engine-workbench-real.ts` 当前约 827 行，导出内容覆盖多个不同职责：
  - session / timeline：slice times、known times、remaining draft selection、timeline merge。
  - empty state / current view：empty slice state、world view filter parts。
  - Slice Composer：default subject selection、saved slice subject filter visibility。
  - review queue：issue triage summary、current review queue index、slice review summary、review queue items、issue identity key。
  - subject stats：left sidebar subject statistics。
  - subject system：initial attrs、RAG overview summary、subject merge。
  - subject file proposal：proposal generation、formatting、event/memory/state review helpers。
- 文件名里的 `real` 最初对应“真实 API Workbench”，但现在文件内不仅是 API 接入规则，也包含 UI 会话规则、审查队列规则、subject system proposal 规则。

## Assessment

### 命名候选问题

1. **`world-engine-workbench-real.ts` 的 `real` 含义变窄**
   - Problem：`real` 只能表达“非 mock / 真实 API”，但当前文件已经承载 Workbench session rules、review rules、subject proposal rules。
   - Risk：后续 agent 看到 `real` 可能继续把所有真实 Workbench 规则塞进同一个文件，形成更大的 catch-all Module。
   - Status：只记录，不改名。
   - 需要用户审批：是否接受 rename，例如 `world-engine-workbench-rules.ts`、`world-engine-workbench-session.ts`，或按职责拆分后分别命名。

2. **`WorldWorkbench*` 与 `WorldEngineWorkbench*` 前缀混用**
   - Problem：组件名多为 `WorldEngineWorkbench...`，util/type 多为 `WorldWorkbench...`，二者都能理解，但命名家族不完全一致。
   - Risk：搜索和新符号命名时容易出现第三种前缀，增加测试字符串和 import 噪音。
   - Status：只记录，不改名。
   - 需要用户审批：是否统一前缀；如果统一，优先方向是保留较短 `WorldWorkbench*` 作为内部规则前缀，还是全部拉齐为 `WorldEngineWorkbench*`。

### 文件结构候选问题

1. **`world-engine-workbench-real.ts` 已经从 util 变成多个规则 Module 的聚合**
   - Problem：文件内同时包含 session、review、subject system、subject proposal、formatting helpers。
   - Risk：Locality 开始变差；修改 review queue 时需要扫过 subject proposal 代码，反之亦然。
   - Status：只记录，不拆文件。
   - 需要用户审批：是否拆成更窄文件，例如：
     - `world-engine-workbench-session-rules.ts`
     - `world-engine-workbench-review-rules.ts`
     - `world-engine-workbench-subject-system.ts`
     - `world-engine-workbench-subject-proposals.ts`

2. **`app/utils` 下 World Engine Workbench 文件数量已多，但层级仍是扁平**
   - Problem：Workbench preview / real / classifier / state / value / mock 都平铺在 `app/utils`。
   - Risk：继续扩展后 `app/utils` 搜索噪音升高，规则文件和通用 util 文件混在一起。
   - Status：只记录，不移动文件。
   - 需要用户审批：是否建立 `app/utils/world-engine/` 或 `app/utils/world-engine-workbench/` 子目录。

## Plan

- 本轮不改任何命名或文件路径。
- 将命名和文件结构候选问题记录在 walkthrough。
- 更新 Task 66 README，把“命名 / 文件结构问题先记录待审批”的新约束写进任务主文档。
- 同步 PROJECT-STATUS，标记 Round 13 是只读审计。

## Changes

- `docs/tasks/66-codebase-cleanup/README.md`
  - 增加符号命名和文件结构问题先记录、待用户审批的约束。
  - 增加 Round 13 索引和 follow-up。
- `PROJECT-STATUS.md`
  - 更新 Task 66 说明，标明已记录 Workbench util 命名 / 文件结构候选问题。
- 本轮没有修改业务代码、测试代码、符号名或文件路径。

## Verification

- 本轮为只读审计 + 文档记录，没有业务代码变更。
- 未运行测试；最近一次相关验证仍是 Round 12：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-real.test.ts
```

结果：

- 2 files passed。
- 9 tests passed。

## Bugs / Complex Issues

- Bug：本轮未发现业务 bug。
- 复杂问题记录：
  - `world-engine-workbench-real.ts` 的职责拆分需要用户审批。
  - `WorldWorkbench*` / `WorldEngineWorkbench*` 前缀是否统一需要用户审批。
  - `app/utils` 下 World Engine Workbench 是否建立子目录需要用户审批。
- 按用户最新约束，本轮没有修复或重命名这些问题。

## Current Measurements

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：约 2158 行。
- `app/utils/world-engine-workbench-real.ts`：约 827 行。
- `app/utils/world-engine-ide-entry.test.ts`：约 1222 行。
- `app/utils/world-engine-workbench-real.test.ts`：约 732 行。

## Follow-ups Requiring Approval

- 是否重命名 `world-engine-workbench-real.ts`。
- 是否统一 `WorldWorkbench*` 与 `WorldEngineWorkbench*` 前缀。
- 是否拆分 `world-engine-workbench-real.ts`。
- 是否把 World Engine Workbench util 迁入子目录。
