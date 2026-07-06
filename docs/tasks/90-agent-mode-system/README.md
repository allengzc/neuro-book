# Agent 多模式系统（normal / discuss / plan）与 switch_mode 工具

> Active task. 前置讨论已定稿，本文档记录设计契约与实现 walkthrough。

## Relative documents refs

- `docs/tasks/archived/agent-plan-mode/README.md` — 现有二元 Plan Mode 的实现边界（本任务替换它的状态模型与工具）
- `docs/tasks/63-tool-approval-policy-system/README.md` — userInputRequest 审批链路（writer 审批复用它）
- `reference/agent/profile-guide.md` / `docs/profile-tsx/nodes.md` — Reminder DSL 节点文档（需同步更新）
- `server/agent/plan-mode-path.ts` — `.agent/plan` 目录解析（保留，错误文案改 switch_mode）

## User Request / Topic

- 现有 Harness 只有 "plan / 非 plan" 二元模式，需要扩展为三模式：
  1. **normal 普通模式**：无特殊提示词，可读可写。
  2. **discuss 讨论模式（只读）**：讨论为主，允许读文件、允许 bash 查询，写文件工具需审批。
  3. **plan 计划模式**：约束与讨论模式一致（只读 + 写审批），任务导向是制定计划。
- 工具改造：`enter_plan_mode` / `exit_plan_mode` 合并为 `switch_mode`，描述语义为"发起一个切换模式的审批，用户审批后进入目标模式"。
- 前端 `AgentComposer.vue` 适配：三态切换按钮、Shift+Tab 循环、placeholder 展示当前模式。
- 用户强调：**各种模式切换的 reminder 以及其他类型 reminder 需要设计好**（见下文 Reminder 设计矩阵）。

## Goal

Harness 支持 `normal | discuss | plan` 三模式：模式状态全链路（customState → reduce → DTO → 前端）为 enum；只读模式下 write/edit/apply_patch 自动挂起审批（复用 tool_user_input_required 链路）；`switch_mode` 替换 enter/exit_plan_mode 且所有切换需审批；reminder 按 `mode × phase` 渲染且 exit 按 fromMode 分叉。验证面：control-tools / harness / profile-dsl / prepare-run / 前端 useAgentSession 系列测试全绿 + typecheck 通过。约束：`.agent/plan` 计划文件工作流（planFilePath 预览、督促实现）不回退；bash 保持放行；不做旧数据兼容（快速开发期，允许直接迁移 customState key）。

## Current State

- 设计定稿（2026-07-06），同日完成整体设计审查：补入"批准后真实执行"与"pending 识别扩展"两个关键机制（§5）、steady 的 didChange 推导（§3/§4.1）、工具绑定面补全（§4.5）。未开始实现。
- 现状要点（调研结论）：
  - Plan Mode 是软模式：运行时不拦截写工具，靠 `PlanModeReminder` 提示词约束。
  - 状态是 `planModeActive: boolean`，存两个 customState：`ui.planMode.active`（前端投影）+ `agent.planMode`（含 `reminderKind: full|sparse|exit|reentry_full`）。
  - 审批链路完备：`userInputRequest.when()` → `tool_user_input_required` 挂起 → resolution 恢复（`neuro-agent-harness.ts:3714` 起）。但审批按工具名硬编码，工具无 reader/writer 分类，无 session 级审批开关。
  - `UserInputRequestContext` 只有 `args + session` 基本信息，**拿不到当前模式** —— 所以 writer 审批不能塞进工具自身 `when()`，必须由 harness 执行循环按模式注入。
  - Reminder DSL：`Reminder({watch, repeatEveryTurns})` —— watch 值变化 emit 一次，可选周期重放。现状 bug 级别问题：`sparse` 只在"拒绝切换"分支被设置，正常流程几乎渲染不到。

## Decisions / Discussion

用户已拍板：

1. **写工具约束 = 触发审批挂起**（非移除工具、非纯软提示）。只读模式下 write/edit/apply_patch 自动挂起等审批，批准仅豁免该次调用。
2. **bash 放行**，靠提示词约束只读查询（接受 shell 写绕过的 tradeoff；模式文案中明确禁止 shell 重定向写文件）。
3. **切换 UX**：Shift+Tab 循环 `normal→discuss→plan→normal`；现有 plan 按钮改三态切换按钮；**placeholder 展示当前模式和提示**。
4. **审批表单不允许改目标模式**：radio 只有批准/拒绝，想切别的用 Shift+Tab。
5. **SwitchModeSchema 不加 `additionalProperties: false`**（TypeBox 默认宽容，多余字段忽略）。
6. **discuss ↔ plan 互切 = "换脑子不换手"**：权限不变（都只读），只换任务导向；不督促执行、不丢计划草稿。"督促实现计划"只发生在 `plan → normal`。
7. 命名：`normal / discuss / plan`（不用 `readonly`，因为只读是 discuss 与 plan 共有约束，discuss 的独特点是讨论导向）。
8. **enter 文案不按 fromMode 分叉，只有 exit 按 fromMode 分叉**（避免 3×3 组合爆炸；互切语义由 enter 文案内一句通用提示覆盖）。
9. 数据模型直接替换不兼容旧数据：`planModeActive` 全链路 → `agentMode`，customState key `ui.planMode.active`/`agent.planMode` → `ui.agentMode`/`agent.mode`。
10. **plan 模式计划目录写入豁免审批**：plan 模式下 write/edit/apply_patch 目标路径在 `planModeDirectory` 内且为 `.md` 时直接执行（保持现有计划文件工作流，否则每写一次计划都要审批）；discuss 模式无任何豁免。apply_patch 含多个目标文件时须全部在计划目录内才豁免。

## 设计契约

### 1. 模式模型

```ts
// shared 层
export type AgentMode = "normal" | "discuss" | "plan";
export function isReadonlyMode(mode: AgentMode): boolean; // discuss | plan
```

| 模式 | 读 | bash | write/edit/apply_patch | 任务导向 |
|------|:--:|:--:|:--:|------|
| normal | ✓ | ✓ | ✓ 直接执行 | 无 reminder |
| discuss | ✓ | ✓ 查询 | 挂起审批 | 讨论、分析、提方案，不催动手 |
| plan | ✓ | ✓ 查询 | 挂起审批 | 产出可执行计划（`.agent/plan/<slug>.md`） |

### 2. `switch_mode` 工具（替换 enter/exit_plan_mode）

- 参数：`targetMode: "normal"|"discuss"|"plan"`（Literal Union 必填）、`reason?: string`、`planFilePath?: string`（仅 plan→normal 时有意义，供审批 UI 预览）。
- description（英文）："Request approval to switch the agent working mode. The switch only takes effect after the user approves. ..."
- `userInputRequest.when()`：按 targetMode 出 low-code form（radio 批准/拒绝 + reason 描述；targetMode=normal 且带 planFilePath 时追加只读预览提示字段）。
- `executeWithContext` 的 `details` 携带 `{approved, targetMode, pending?}` 供 harness 与前端气泡消费。
- harness 消费改造（替换现有 4 处 enter/exit_plan_mode 硬编码）：
  - `planModeDecision` → `modeSwitchDecision`：按 `toolName === "switch_mode"` 读 approved。
  - `appendPlanModeResolution` → `appendModeSwitchResolution`：按 targetMode 计算 nextMode 与 phase；no-op（target === current）幂等不写状态。`/mode` 用户命令与工具切换**共用**此状态写入函数。
  - `withExitPlanModePreview` → `withModeSwitchPreview`：`targetMode==="normal" && planFilePath` 时补 UI-only 计划预览。
  - `validateUserResolutionTool`：同条件下挂起前校验计划文件可读。

### 3. 状态 shape：customState `agent.mode`（替换 `agent.planMode`）

```jsonc
{
  "mode": "normal" | "discuss" | "plan",
  "fromMode": "normal" | "discuss" | "plan",   // 本次切换来源，exit 渲染分叉用
  "phase": "enter" | "reentry" | "steady" | "exit", // reminder 渲染档位
  "hasExitedPlan": true,        // 曾从 plan 退出，plan 再进入时 phase=reentry
  "reason": "...",              // 可选，switch_mode 传入
  "workDirectory": "<.agent/plan 绝对路径>",   // plan 专用，沿用 plan-mode-path
  "lastTransition": "switch_mode" | "ui_mode_toggle",
  "approved": true,             // 工具切换时的审批结果
  "updatedAt": "ISO8601"
}
```

phase 生成规则（appendModeSwitchResolution 与 `/mode` 命令统一）：

- 批准进 discuss/plan：`phase = "enter"`；例外 plan 且 `hasExitedPlan` → `"reentry"`。
- 批准回 normal：`phase = "exit"`，`fromMode = 切换前模式`；若 fromMode=plan 置 `hasExitedPlan = true`。
- 拒绝（保持原模式）：`phase = "steady"`（状态有变化会触发 reminder emit，但只需轻提醒）。
- **steady 的周期重放不靠写状态，靠 `ReminderChange.didChange` 推导**（审查修正，2026-07-06）：`Reminder` 的 emit 有两种触发——watch 值变化（`didChange=true`）和 `repeatEveryTurns` 周期到期（`didChange=false`）。ModeReminder 用 `render(change)` 而非 children：`didChange=true` 按 `state.phase` 渲染（enter/reentry/exit 全文）；`didChange=false`（周期重放）渲染 steady 文案（normal 渲染 null）。若不做此区分，周期重放会把 enter 全文重复注入。

前端投影 customState：`ui.agentMode: AgentMode`（替换 `ui.planMode.active: boolean`）。

### 4. Reminder 设计矩阵（本任务核心）

#### 4.1 `ModeReminder`（替换 PlanModeReminder / ActivePlanModeReminder）

- `watch = {mode: ctx.session.agentMode, state: customState["agent.mode"]}` —— 每次切换/审批决议 emit 一次。
- **`repeatEveryTurns` 默认 6** + **`render(change)` 按 `didChange` 分档**：变化触发（didChange=true）渲染 phase 全文；周期触发（didChange=false）渲染 steady；normal 渲染 null 周期重放自然静音。修复现状 sparse 几乎不渲染的问题。
- 注意 no-op 切换不写状态（§2），否则 `updatedAt` 变化会导致 fingerprint 变化、重复 emit 全文。
- 渲染矩阵（emit 时按 state 选择，默认文案英文、可被 slot 覆盖，**全文见 4.6**）：

| mode | phase | 内容要点 | 来源 |
|------|-------|---------|------|
| plan | enter | 只读约束 + 写工具会触发审批的说明 + bash 仅查询 + `.agent/plan` 工作目录 + 计划产出流程（含 switch_mode(normal)+planFilePath 退出步骤）+ 一句"若此前在讨论，把讨论结论整理进计划" | 现 full 文案迁移改造 |
| plan | reentry | enter 全文 + 前缀"你之前退出过 plan，本轮重新规划" | 现 reentry_full 迁移 |
| plan | steady | 一句话：仍在 plan 模式、只读、计划文件路径提醒、勿开始实现 | 现 sparse 迁移 |
| discuss | enter | 只读约束 + 写审批说明 + bash 仅查询 + 讨论导向（回答/分析/提候选方案，不产出 .agent/plan 文件、不催促实现）+ 一句"若已有计划草稿，先讨论不实现" | **新写** |
| discuss | steady | 一句话：仍在讨论模式、只读、聚焦讨论 | **新写** |
| normal | exit, fromMode=plan | **督促实现**：按批准的计划执行；有 planFilePath 时引用该文件为实现参考 | 现 exit 文案迁移 |
| normal | exit, fromMode=discuss | 恢复读写，按讨论结论行动即可，**无督促计划**（很短） | **新写** |
| normal | 其他 | 渲染 null | — |

- 互切说明：discuss↔plan 就是目标模式的 enter phase；权限文案相同、导向文案不同；上表两句"若此前…"即互切衔接语，不按 fromMode 分叉。

#### 4.2 `ModeAvailabilityReminder`（替换 PlanModeAvailabilityReminder）

- `watch = ctx.session.agentMode`；仅 `mode === "normal"` 时 emit："switch_mode is available: use plan for read-only planning before large/risky multi-step changes, discuss for read-only discussion."
- 活跃模式的持续提醒由 ModeReminder 负责，此节点在非 normal 渲染 null。保留可选 `repeatEveryTurns`。

#### 4.3 DSL Slot 泛化

- `PlanModeSlotKind` → `ModeSlotKind = "plan_enter" | "plan_reentry" | "plan_steady" | "discuss_enter" | "discuss_steady" | "exit_from_plan" | "exit_plain"`。
- 4 个命名组件（PlanModeFull/Sparse/Exit/Reentry）→ **单个 `<ModeSlot kind="...">`**，避免 7 个命名组件；校验沿用：只能作为 ModeReminder 直接子节点、每 kind 至多一次。
- 影响面：`profile-dsl.ts`、`profile-dsl-source-parser.ts`、`jsx-runtime.ts`、`shared/dto/profile-template.dto.ts`、`profile-template-editor` 节点配置、`docs/profile-tsx/nodes.md`、`reference/agent/profile-guide.md`。

#### 4.4 Writer 审批的提示文字（与 reminder 同属提示设计）

- 挂起表单（用户可见，中文）：
  - prompt：`讨论模式下请求写入文件` / `计划模式下请求写入文件`
  - radio label：`是否允许本次写入 <path>？`（批准 / 拒绝），description 展示工具名与目标路径；apply_patch 多文件时列出全部路径。
- **拒绝后的 toolResult 文本**（给模型，英文，按模式填充）：

  ```text
  The user declined this file write in {discuss|plan} mode. Stay read-only: continue the {discussion|planning} or ask what should change instead. Do not retry the same write. If the user wants execution, request it via switch_mode with targetMode "normal".
  ```

  要点：引导模型回到模式导向、禁止原样重试、指出正确出口是 switch_mode。
- 批准后正常执行，豁免仅限该次调用。

#### 4.5 其他既有 reminder 的关系（不动，但明确顺序）

- `TaskReminder`（agent.tasks, repeatEveryTurns=8）、`RuntimeLocationReminder`、`WorkspaceFocusReminder`、`LinkedAgentsReminder`、`MentionedSkillsReminder`：逻辑不变。
- `leader.default.profile.tsx` AppendingSet 顺序：RuntimeLocation → WorkspaceFocus → **ModeAvailabilityReminder** → LinkedAgents → TaskReminder → **ModeReminder** → MentionedSkills（Mode 系列原位替换 Plan 系列）。
- `leader.assets.profile.tsx` 同步替换。
- **工具绑定面（审查补全）**：`profile-tools.ts` 的 `builtin.control.enterPlanMode/exitPlanMode` → `switchMode`；`default-profile.ts`（内置 fallback profile）同步替换。rp / simulation-director / world-engine profiles 未直接绑定 plan 工具，无需改动。
- 已知轻微冗余（接受，与现状一致）：从只读切回 normal 的那一轮，ModeAvailabilityReminder（"可以用 switch_mode"）与 exit 文案同轮出现。

#### 4.6 Reminder 默认文案全文（定稿）

约定：英文（与现有 reminder 一致，slot 可覆盖）；`{workDirectory}` = `planModeDirectory` 解析路径，`{toolDirectory}` = `planModeToolDirectory` 相对路径（沿用现有两个占位符）；渲染时外层包 `systemReminder(...)`。相对现文案的语义改动：软约束句（"follow the restriction yourself"）全部替换为审批语义句；`enter_plan_mode`/`exit_plan_mode` 字样替换为 `switch_mode`；新增 bash 只读查询约束。

**`plan_enter`**（现 full 迁移改造）：

```text
Plan mode is active. The user wants a plan before execution, not execution itself.

## Mode Constraints

- Read-only exploration is allowed and encouraged: read files, search, and run read-only commands.
- The only directly writable location is Markdown files under {workDirectory}. File write tools targeting any other path will pause and ask the user for approval; do not attempt such writes unless the user explicitly asks for a specific change mid-planning.
- bash is for read-only inspection only. Never write files through shell redirection or scripts; use file tools so the mode rules apply.
- Do not create or invoke Explore agents. Work locally with read/search tools.
- Tests or commands are allowed only when they are read-only enough to refine the plan and do not update tracked files.
- If the user asks you to implement while plan mode is active, keep planning instead. Explain that implementation starts after switching to normal mode through switch_mode once the plan is ready.
- Do not work silently for long stretches. After meaningful exploration, report concise findings and the current direction in chat.

## Plan Work Directory

- The Project Workspace plan directory is {workDirectory}. It can contain plan files, walkthrough files, or research notes for this project.
- When using file tools from the Workspace Root cwd, write plan files via {toolDirectory}/<slug>.md. The switch_mode planFilePath argument must be Project Workspace relative, for example .agent/plan/<slug>.md, so the approval UI can preview the file.
- No file is bound when entering plan mode. Choose a short readable Markdown file name when the task needs persisted planning or walkthrough notes. Do not create files just for formality for small non-editing tasks.
- If a relevant Markdown file already exists in this exact plan directory, you can read it and make incremental edits using read and edit.
- Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.
- Build the plan visibly in chat as you learn and keep any Markdown work file aligned when one is used. Do not hide important decisions only in a file.

## Workflow

1. If the preceding conversation already worked through this task (for example in discuss mode), consolidate the agreed conclusions into the plan before new exploration.
2. Ground in the real repository with read-only exploration: inspect relevant files, schemas, tools, tests, and existing patterns.
3. Report what you learned in chat when it changes the plan, including unresolved decisions and the next intended step.
4. Ask the user via request_user_input only when an unresolved decision cannot be discovered from the repo and materially changes the implementation.
5. Present a concise execution-ready plan in chat. For non-trivial implementation work, also write or update a readable Markdown plan, walkthrough, or research note under {workDirectory}; the file name is your choice and the system will not generate a random slug.
6. Before requesting the switch, briefly report the plan status in chat and cite the Markdown file path when you wrote one. If you skip the file because the task is only a small non-editing task, say that briefly before requesting approval.
7. Call switch_mode with targetMode "normal" when the plan is complete and ready for approval. When a plan file exists, pass planFilePath like .agent/plan/<slug>.md so the approval UI displays that Project Workspace file. Never ask for plan approval via plain text or request_user_input; switch_mode is the approval request.
8. After approval, implement from the approved chat plan or the approved Markdown plan file shown during the switch approval.

The user explicitly requested no Explore agent for this project.
```

**`plan_reentry`**（现 reentry_full 迁移；前缀 + plan_enter 全文）：

```text
## Re-entering Plan Mode

You are returning to plan mode after previously leaving it. Before proceeding, inspect the latest chat context and any relevant Markdown plan file under {workDirectory} when available. Revise the visible plan in chat and update the plan file when the task still requires an implementation plan.

<plan_enter 全文>
```

**`plan_steady`**（现 sparse 迁移改造；`repeatEveryTurns` 周期重放）：

```text
Plan mode is still active (full instructions appeared earlier in this conversation).
- Read-only except Markdown work files under {workDirectory}. File write tools targeting other paths will pause for user approval; bash stays read-only inspection.
- Write or edit plan files via {toolDirectory}/<slug>.md. For switch_mode to normal, pass planFilePath as .agent/plan/<slug>.md so the approval UI can preview the Project Workspace file.
- Do not create or invoke Explore agents.
- Keep the user informed in chat: summarize important findings, unresolved decisions, and the current plan direction.
- Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.
- If an unresolved decision materially changes the plan, use request_user_input before switching.
- Do not start implementing. Call switch_mode with targetMode "normal" when the plan is ready for approval; never ask for plan approval via plain text or request_user_input.
```

**`discuss_enter`**（新写）：

```text
Discuss mode is active. The user wants a read-only discussion: analysis, answers, options, and recommendations — not execution.

## Mode Constraints

- Read-only exploration is allowed and encouraged: read files, search, and run read-only commands to ground your answers in the real project.
- File write tools will pause and ask the user for approval before executing. Do not attempt writes unless the user explicitly asks for a specific change mid-discussion; prefer describing what you would change and where.
- bash is for read-only inspection only. Never write files through shell redirection or scripts.
- Do not create or invoke Explore agents. Work locally with read/search tools.

## How to Work in Discuss Mode

- Focus on the conversation: answer questions, compare options with tradeoffs, point out risks, and give concrete recommendations.
- Ground claims in evidence: cite file paths and actual content you inspected rather than guessing.
- This is not plan mode: do not produce .agent/plan files or push toward an implementation plan unless the user asks for one.
- If a plan draft already exists from earlier planning, treat it as discussion material: clarify and challenge it with the user instead of implementing it.
- When the discussion converges and the user wants action, call switch_mode with targetMode "normal" to start executing, or "plan" if the task first needs a written plan. The switch takes effect only after user approval.
```

**`discuss_steady`**（新写；`repeatEveryTurns` 周期重放）：

```text
Discuss mode is still active (full instructions appeared earlier in this conversation). Stay read-only: discuss, analyze, and recommend. File write tools pause for user approval; bash stays read-only inspection. Do not start implementing or producing plan files. When the user wants execution, request it via switch_mode.
```

**`exit_from_plan`**（现 exit 迁移；mode=normal, phase=exit, fromMode=plan）：

```text
## Left Plan Mode

You are now in normal mode. You can make edits, run tools, and take actions.
Implement the approved plan from the switch approval. If a Markdown plan file was shown from {workDirectory}, treat that Project Workspace plan file as the implementation reference and read or cite only that file for details.
```

**`exit_plain`**（新写；mode=normal, phase=exit, fromMode=discuss）：

```text
## Left Discuss Mode

You are now in normal mode. You can make edits, run tools, and take actions.
Act on the conclusions agreed in the conversation. If scope was not settled during the discussion, confirm it with the user before large or risky changes.
```

**`ModeAvailabilityReminder`**（仅 normal 模式；现 availability 迁移扩写）：

```text
You are in normal mode. switch_mode is available: propose "plan" before large, risky, or multi-step changes to prepare a read-only plan first, or "discuss" when the user wants to talk through direction before any changes. Each switch takes effect only after user approval.
```

### 5. 只读约束的运行时注入（harness）

- `NeuroAgentTool` 增加能力标记 `mutatesWorkspace?: boolean`；`file-tools.ts` 中 write/edit/apply_patch 标注 true；bash/read 不标。
- harness 执行循环（现 userInputRequest 检查处，`neuro-agent-harness.ts:3714` 附近）：**当前 mode 为只读且工具 `mutatesWorkspace` → 注入审批挂起**（构造 low-code form，走同一 `tool_user_input_required` 事件与 resolution 链路）。
- **plan 模式豁免**（决策 10）：注入前解析工具参数中的目标路径；mode=plan 且全部目标路径落在 `planModeDirectory` 内且为 `.md` → 跳过审批直接执行。路径解析复用 `plan-mode-path.ts` 的安全校验思路（拒绝 `..`、绝对路径按项目根判断）。discuss 模式一律挂审批。
- 约束集中在 harness 一处：新工具只要标注能力即自动受管，不依赖每个工具自查模式（`UserInputRequestContext` 拿不到模式，这也是不放进工具 `when()` 的原因）。
- **批准后的真实执行（审查发现的关键机制，2026-07-06）**：现有 resolution 主路径（`appendResolutions` → `resolutionToToolResult`）只把 resolution **落库为 toolResult**，工具从不执行——对 plan 工具无碍（副作用由 harness 消费点做），但 writer 审批**批准后必须真正写文件**。设计：`appendResolutions` 消费点识别"harness 注入的 writer 审批"类 pending，approved=true 时**在该处真实执行工具**（`executeWithContext`），以**执行结果**（成功输出或执行错误）落库为 toolResult；approved=false 时落库 4.4 的拒绝文本。不走"恢复时重跑执行循环"方案（破坏现有 turn 闭合后直接发模型的恢复模型）。
- **pending 识别扩展（审查发现的第二个缺口）**：`findPendingApprovalCalls` 按 `userResolutionToolKeys`（静态声明 userInputRequest/approvalRequired 的工具）过滤 toolName，write/edit/apply_patch 不在集合内——注入审批挂起后，恢复/投影路径（invoke 858、投影 1484/1564、恢复 4961 等）会**找不到这个 pending**。设计：`userResolutionToolKeysForSnapshot` 改为 session 感知——当 session 处于只读模式时并入 `mutatesWorkspace` 工具 keys；同时 pending formSpec 已有 durable metadata（`agent.pendingUserResolution.<toolCallId>`），投影优先以它为准。
- **switch_mode no-op 前置拦截**：执行循环注入检查处 harness 已知当前 mode，`targetMode === 当前 mode` 时不挂审批，直接写错误 toolResult（"already in X mode"），不打扰用户（`when()` 拿不到模式，此校验只能放 harness）。

### 6. 前端

- `useAgentSession`：`state.planModeActive: boolean` → `state.agentMode: AgentMode`；`/plan` 命令 → `/mode`（或 `/plan` 别名保留切 plan）。
- `AgentComposer.vue`：plan 按钮 → 三态循环按钮（图标/颜色区分三模式）；Shift+Tab 循环；**placeholder 按模式变化**（如"讨论模式 · 只读讨论，改文件需批准（Shift+Tab 切换）"）；底部 badge 显示当前模式。
- `AgentExitPlanModeBubble.vue` → 泛化 `AgentSwitchModeBubble.vue`：渲染 targetMode + reason + plan 文件预览；`tool-render-registry.ts` 注册 `switch_mode`。
- i18n：`en-US.ts` / `zh-CN.ts` 增加三模式文案（placeholder / 按钮 title / badge / 审批表单）。
- 命令 DTO：`AgentCommandRequestDto` 的 `plan {active}` → `mode {mode: AgentMode}`。

## Verification / Test

- 待实现后填写实际结果。计划验证面：
  - `control-tools.test.ts`：switch_mode schema（targetMode 枚举、planFilePath 校验）、审批表单生成、description 英文无 CJK。
  - `neuro-agent-harness.test.ts` / `prepare-run.test.ts` / `write-plan.test.ts`：模式状态写入（phase/fromMode/hasExitedPlan）、只读模式 writer 挂起审批、**批准后 appendResolutions 消费点真实执行工具且以执行结果落库**、**注入审批的 pending 在恢复/投影路径可被识别**、plan 目录豁免路径判断、批准/拒绝分支、no-op 幂等与前置拦截、`/mode` 命令。
  - `profile-dsl.test.ts`：ModeReminder 渲染矩阵（7 种 slot kind）、ModeSlot 校验、ModeAvailabilityReminder。
  - 前端 `useAgentSession*` / `agent-message` / `agent-command-result` 测试适配 agentMode。
  - typecheck 全链路。

## Implementation Walkthrough

- 实现顺序（分批补丁，避免超大补丁）：
  1. shared 层：`AgentMode` + `isReadonlyMode` + DTO 字段替换。
  2. 工具层：`control-tools.ts` switch_mode；`types.ts` mutatesWorkspace；`file-tools.ts` 标注。
  3. harness 层：agentMode 全链路替换；执行循环只读审批注入；switch_mode resolution 消费；`/mode` 命令。
  4. 提示词层：profile-dsl ModeReminder/ModeAvailabilityReminder/ModeSlot；文案矩阵；两个 leader profile 挂载。
  5. 前端层：useAgentSession + AgentComposer 三态 + 气泡泛化 + i18n。
  6. 测试适配与文档同步（reference/agent、docs/profile-tsx、PROJECT-STATUS.md）。

## TODO / Follow-ups

- [ ] 按上述顺序实现（当前未开始）。
- [ ] 未来优化（不在本任务）：给 `UserInputRequestContext` 注入 `agentMode`，支持只读互切免审批等模式感知工具行为。
- [ ] 未来优化（不在本任务）：bash 命令静态分析拦截写操作（当前接受提示词约束的 tradeoff）。
