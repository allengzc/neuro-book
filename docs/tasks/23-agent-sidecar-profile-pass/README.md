# Agent Sidecar Profile Pass

## User Request

- 将“旁路上下文”机制提升为 `NeuroAgentHarness` 的核心能力，而不是只作为 NeuroBook roleplay 的局部技巧。
- 不需要 `RuntimeContextPass`；确定性上下文注入继续由 profile TSX / profile input schema 承担。
- 重点设计 `SidecarProfilePass`：profile 作者可以声明在主 run 前后旁路 invoke 一次，把旁路结果处理后注入主上下文或执行必要写入。
- 第一版 spike 至少要保证 `actor.context-load` 和 `actor.memory-save` 可用。
- `SidecarProfilePass` 不创建新 profile，也不通过 `profileKey` 切换 profile；它必须沿用当前 profile、当前 session 和当前 session tree。

## Goal

- 形成 Harness 层可实现的 `SidecarProfilePass` V1 接口。
- 保持和 `docs/tasks/18-agent-runtime-pipeline-hooks/README.md` 的 Run Kernel / runtime hooks 设计一致。
- 支持 profile 作者声明自动旁路，V1 先覆盖 `prepareRun` 和 `settleRun` 两个阶段。
- 验证 roleplay actor 的两个首要用例：
  - `actor.context-load`：GM packet 进入 actor 主 run 前，旁路检索并整理 actor-safe 设定。
  - `actor.memory-save`：actor 主 run 结束后，旁路维护 `knowledge.md` 与 `mind.md`。

## Current State

- 18 号任务已经把 `NeuroAgentHarness` 拆向 Run Kernel / Turn Transaction / runtime hooks：
  - `prepareRun` / `prepareTurn` / `ingestTurn` / `prepareNextTurn` / `settleRun` 已经是可讨论的扩展边界。
  - `runtimeMessages` 可以注入 `RunFrame`，不写入 session history。
  - `ingestTurn` 可以返回 runtime-only transcript，避免污染持久对话。
- 当前 profile 的 `allowedToolKeys` 同时承担“模型可见工具”和“执行上限”两层含义。
- roleplay 需求要求 actor 主上下文尽量纯净：
  - `rp.actor` 主扮演阶段只做角色反应，不自行检索完整 lorebook。
  - `rp.actor` 需要在 GM packet 后获得与本 Tick 相关、且角色可知的设定补充。
  - `rp.actor` 需要在主 run 后更新自己的认知和心智文件，但不应该把这类维护任务混入扮演上下文。

## V1 Scope

第一版是 Harness 能力 spike，不追求完整策略系统。

包含：

- profile 可声明 `sidecars`。
- sidecar 可在 `prepareRun` 或 `settleRun` 自动触发。
- sidecar 使用当前 session、当前 profile、当前 input、当前 session tree 上下文继续跑。
- sidecar 从父 run 当前节点 fork，完成后 merge 回父 run 原位置。
- sidecar transcript 默认为 `runtime_only`，不污染 actor 主 run 对话历史。
- sidecar 通过 `report_result.sidecar_data` 返回结构化结果；无 `report_result` 时可 fallback 到最后一条 assistant message。
- `sidecarDataSchema` 如果存在，只用于 Harness 侧校验 `report_result.sidecar_data` 或 fallback JSON，不参与 provider tool schema 渲染。
- sidecar 结果通过 `merge()` 转成主线可消费的 runtime 注入、runtime state 或显式写入计划。
- sidecar 失败时直接让父 run 失败；V1 不做 skip/fallback。
- 禁止嵌套 sidecar。

不包含：

- 不实现 `RuntimeContextPass`。
- 不实现 agent 主动进入 sidecar。
- 不实现结构化 patch/apply 系统；`actor.memory-save` 可以先自由使用 `write` / `edit`。
- 不实现工具违规后的“删除该条消息 + system-reminder + continue run”清理。
- 不让 `actor.memory-save` 更新 `state.md`；`state.md` 仍由 GM / 后续变量系统负责。
- 不把 `rp.writer` 写作前检索列入 V1 必须验收项；它保留为后续同一机制的扩展用例。

## Design

### Core Concept

`SidecarProfilePass` 是围绕当前 profile run 的旁路 invocation。它不是新的 profile，也不切换 profile 身份，而是在当前 session tree 的同一上下文点 fork 出一段 runtime-only 分支，完成检索、反思或维护任务后，把结果 merge 回主线。

它适合表达这些动作：

- actor 主 run 前检索并整理角色可知设定。
- actor 主 run 后维护 `knowledge.md` 与 `mind.md`。
- writer 写作前检索相关 lorebook。
- GM 推进前让规则审计器检查状态约束。

### Why Not RuntimeContextPass

暂时不引入 `RuntimeContextPass`。

原因是它的定位容易和 profile TSX、profile input schema、prepare context 编译重叠。确定性的上下文注入继续留在 profile 自己的输入和模板层处理；`SidecarProfilePass` 只负责“需要一次 AI 旁路 run 才能生成”的上下文。

### Session Tree Semantics

sidecar 的关键约束：

- 从父 run 当前节点 fork。
- 沿用当前 profile 的 system prompt、tools 上限、input 和 session context。
- 额外注入 `enterPrompt`，让模型进入旁路任务。
- sidecar 的 assistant / tool result transcript 标记为 `runtime_only`，默认不进入主 run history。
- sidecar 完成后回到父 run 原位置继续，父 run 只看见 `merge()` 注入的结果。

也就是说，sidecar 是“当前 profile 的旁路 phase”，不是“创建另一个 profile 代跑”。

### Tool Policy

为了避免破坏 provider prompt/tool cache，profile 的最大工具集合应保持稳定：

- `allowedToolKeys` 仍描述 profile 的最大工具集合。
- sidecar 的 `allowedToolKeys` 必须是当前 profile `allowedToolKeys` 的子集。
- 主 phase 和 sidecar phase 可以通过 prompt/reminder 与运行时权限表达“当前阶段哪些工具可用”。
- V1 暂时主要通过提示词限定主 phase 不使用被禁止工具。
- V1 不做工具违规后的上下文清理；后续可以在 Harness hook 中补“删除违规消息 + 注入 system-reminder + continue run”。
- provider-visible tool schema 不能因为进入 sidecar 而变化；旁路返回结构通过固定 `report_result.sidecar_data` 字段承载，具体结构只通过 sidecar system reminder 和 Harness runtime validator 约束。

例子：

```ts
defineAgentProfile({
    key: "rp.actor",
    allowedToolKeys: ["read", "write", "edit", "report_result"],
    sidecars: [
        actorContextLoadPass,
        actorMemorySavePass,
    ],
});
```

### Profile Author API Draft

```ts
type SidecarProfilePass<TInput, TOutput> = {
    name: string;
    stage: "prepareRun" | "settleRun";

    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);

    allowedToolKeys?: string[];

    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";

    merge: (ctx: SidecarContext<TInput>, result: SidecarResult<TOutput>) => SidecarMergePlan;
};
```

```ts
type SidecarResult<TSidecarData> = {
    result: string;
    sidecarData: TSidecarData;
};

type SidecarMergePlan = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonValue;
    writePlans?: SessionWritePlan[];
};
```

字段说明：

- `name`：稳定标识，例如 `actor.context-load`、`actor.memory-save`。
- `stage`：V1 只支持 `prepareRun` 与 `settleRun`。
- `enterPrompt`：进入旁路时注入的指令，例如“退出扮演模式，先检索本次 GM packet 相关且角色可知的设定”。
- `allowedToolKeys`：旁路阶段允许执行的工具，必须是当前 profile `allowedToolKeys` 的子集。
- `sidecarDataSchema`：旁路期望返回的 `sidecar_data` 结构，只用于 Harness runtime 校验，不参与模型可见 tool schema。
- `outputFallback`：没有 `report_result` 时如何把最后一条 assistant message 视作结果。
- `merge`：把旁路结果转成主 run 的 runtime context、runtime state 或写入计划。

注意：接口里不再有 `profileKey`。sidecar 不负责选择另一个 profile。

## report_result Rules

- `report_result` 的 provider-visible tool schema 必须稳定，不能按 sidecar 动态替换。
- `report_result` 固定新增可选字段 `sidecar_data?: JsonValue`，专门给 sidecar phase 返回结构化结果。
- 进入 sidecar 时，Harness 注入 system reminder，明确告知模型：
  - 当前处于 sidecar phase。
  - 当前 sidecar 名称，例如 `actor.context-load`。
  - 当前允许使用的工具。
  - 必须通过 `report_result.sidecar_data` 返回什么结构。
- 优先要求 sidecar 使用 `report_result.sidecar_data` 退出旁路。
- `sidecarDataSchema` 只由 Harness 在收到结果后校验 `sidecar_data`，不能用于渲染模型可见 tool schema。
- `report_result.data` 继续保留给主 profile 输出；sidecar 不应复用 `data` 承载旁路结果，避免和主路 output contract 混淆。
- `report_result.data` 在 provider-visible tool schema 中也应保持可选。profile 的 `outputSchema` 只能表达“主路期望的结构化输出形状”，不能强制模型每次调用都必须传 `data`；因为任务失败、信息不足或 profile 自己选择只返回错误说明时，`data` 可能无法生成。
- 主路如果要求 `data`，应由 profile prompt / system reminder / Harness runtime validator 表达，而不是通过 provider-visible required 字段表达。
- 如果当前没有提供 `report_result` 工具，行为应与当前 `invoke_agent` 逻辑保持一致：将最后一条 assistant message 当成结果。
- 如果配置了 `parse_final_message_json` fallback，则尝试把最后一条消息解析为 JSON 并按 `sidecarDataSchema` 校验。

固定字段示意：

```ts
type ReportResultArgs = {
    result: string;
    data?: JsonValue;
    sidecar_data?: JsonValue;
};
```

注意：当前实现中的 `reportResultSchemaForProfile(profile)` 会从 `profile.outputSchema` 派生模型可见 `report_result.data` schema。sidecar V1 需要避免把旁路专属 schema 放进这里，否则主路和旁路 schema 不同会破坏缓存。
同时，`profile.outputSchema` 不应再让 `report_result.data` 在 provider-visible schema 中变成 required；它应降级为可选字段的结构说明和 runtime 校验依据。

## Relationship With Run Kernel Hooks

`SidecarProfilePass` 不应该绕过 18 号任务建立的 Run Kernel 边界。

推荐实现方式：

- sidecar 由 runtime hook stage 触发，但 sidecar 本身是更高层的 profile 作者能力。
- sidecar invocation 使用 forked `RunFrame`，沿用当前 session tree 上下文。
- sidecar transcript 默认 `runtime_only`。
- sidecar 结果只通过 `merge()` 回到主线。
- `merge()` 返回的 `runtimeMessages` 进入主 `RunFrame`，不默认落盘。
- 如需持久化，必须显式返回 `SessionWritePlan`，或由 sidecar 自己通过允许的文件工具完成。

## Roleplay V1 Use Cases

### actor.context-load

触发时机：GM packet 已进入 actor invoke 后，actor 主 run 之前。

目的：

- 检索本 Tick 相关设定。
- 只整理 actor 合理可知的信息。
- 把整理结果注入 actor 主 run，避免 actor 主 run 自己读取完整 lorebook。

建议配置：

```ts
const actorContextLoadPass: SidecarProfilePass<ActorInput, ActorContextLoadResult> = {
    name: "actor.context-load",
    stage: "prepareRun",
    allowedToolKeys: ["read", "report_result"],
    enterPrompt: (ctx) => "...退出扮演模式，检索本次 GM packet 相关且角色可知的设定...",
    sidecarDataSchema: actorContextLoadSchema,
    merge: (ctx, result) => ({
        runtimeMessages: [
            actorSafeLorebookMessage(result.sidecarData),
        ],
    }),
};
```

输出重点：

- actor-safe 设定摘要。
- 来源路径或条目标识，方便 debug。
- 不注入隐藏真相、其他 actor 私密知识或 GM 裁决过程。

失败策略：

- V1 直接让 actor 主 run 失败。
- 不静默跳过，避免 actor 在缺少关键上下文时继续生成。

### actor.memory-save

触发时机：actor 主 run 完成后。

目的：

- 退出扮演模式，回顾本轮输入、actor 回复和已知文件。
- 更新 `knowledge.md`：角色新知道、修正或遗忘的信息。
- 更新 `mind.md`：角色当前想法、猜测、情绪、动机。
- 不更新 `state.md`。位置、持有物、伤势、关系压力等状态仍由 GM / 后续变量系统裁决。

建议配置：

```ts
const actorMemorySavePass: SidecarProfilePass<ActorInput, ActorMemorySaveResult> = {
    name: "actor.memory-save",
    stage: "settleRun",
    allowedToolKeys: ["read", "write", "edit", "report_result"],
    enterPrompt: (ctx) => "...退出扮演模式，更新该 actor 的 knowledge.md 与 mind.md...",
    sidecarDataSchema: actorMemorySaveSchema,
    merge: (ctx, result) => ({
        runtimeState: {
            actorMemorySave: result.sidecarData.summary,
        },
    }),
};
```

输出重点：

- 已修改文件列表。
- 更新摘要。
- 无法判断或需要 GM 裁决的信息。

V1 策略：

- 允许自由 `write` / `edit`。
- 不做 patch/apply，不做状态冲突检查。
- 不更新 `state.md`。

## Decisions

- 不新增 `RuntimeContextPass`。
- `SidecarProfilePass.profileKey` 删除；sidecar 沿用当前 profile，不创建或切换 profile。
- 第一版只做 profile 声明式自动旁路；agent 主动调用旁路先不做。
- V1 stage 只做 `prepareRun` 与 `settleRun`。
- sidecar transcript 默认为 `runtime_only`。
- sidecar 结果优先使用 `report_result.sidecar_data`；无 `report_result` 时 fallback 到最后一条 assistant message。
- `sidecarDataSchema` 如果存在，只用于 Harness runtime 校验 `report_result.sidecar_data` 或 fallback JSON，不参与 provider tool schema 渲染。
- `report_result.data` 最终字段语义确认降级为 optional；`profile.outputSchema` 不再让 provider-visible `data` 必填，强约束交给 prompt/reminder 和 runtime validator。
- `sidecar_data` 确认为旁路结构化返回字段名。
- 进入 sidecar 时必须注入 system reminder，让模型知道自己处于旁路 phase，并说明当前 `sidecar_data` 的期望结构。
- sidecar 结果必须经过 `merge()` 才能注入主上下文。
- sidecar 失败时父 run 失败。
- V1 禁止 nested sidecar。
- `actor.context-load` 通过 prompt 限制信息过滤，不做严格 projection/apply 系统。
- `actor.memory-save` 可以自由 `write` / `edit`，但只负责 `knowledge.md` 与 `mind.md`，不负责 `state.md`。
- 工具禁用后的违规消息清理推迟到后续 Harness hook。

## Files Changed

- `docs/tasks/23-agent-sidecar-profile-pass/README.md`
- `docs/tasks/01-agent-roleplay-mode/README.md`
- `docs/tasks/01-agent-roleplay-mode/roleplay-runtime-structure.md`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/harness/run-frame-state.ts`
- `server/agent/harness/run-kernel-types.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/define-agent-runtime.test.ts`
- `server/agent/profiles/define-agent-runtime.ts`
- `server/agent/profiles/report-result-schema.ts`
- `server/agent/profiles/report-result-schema.test.ts`
- `server/agent/profiles/types.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/agent/harness/types.ts`

## Verification

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "sidecar|report_result 校验|create -> prompt -> report_result|runtime_only transcript 下 report_result"`
- `bunx vitest run server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/turn-failure.test.ts server/agent/profiles/report-result-schema.test.ts`
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/report-result-schema.test.ts`
- `bunx tsc --noEmit --pretty false --project tsconfig.json` 仍会被 SillyTavern 导入脚本既有类型问题阻断；过滤本次相关路径无新增错误。

## Implemented V1

- `AgentProfile` 新增 `sidecars?: readonly SidecarProfilePass[]`。
- `SidecarProfilePass` 支持 `prepareRun` 和 `settleRun` 两个自动触发点。
- sidecar 沿用当前 profile、当前 session、当前 session tree 和当前 profile input，不再包含 `profileKey`。
- sidecar 通过同一个 `runLoop()` 执行，但启用旁路 RunFrame 标志：
  - `forceRuntimeOnlyTranscript`：assistant/toolResult transcript 不写入 session history。
  - `suppressEvents`：旁路内部 turn 不发公开 runtime event。
  - `disableSteer`：旁路不消费用户 steer。
  - `disableAutomaticCompaction`：旁路不触发自动 compaction。
- `prepareRun` sidecar 的 `merge().runtimeMessages` 会注入父 run 的模型上下文，不落 session。
- `settleRun` sidecar 只在父 run completed 后执行，可通过 `merge().writePlans` 写入 session custom state，或让旁路工具自己写文件。
- sidecar 失败、进入 waiting、缺少 `sidecar_data` 且无 fallback、或 `sidecarDataSchema` 校验失败时，父 run 失败。
- provider-visible tool schema 保持 profile 最大 `allowedToolKeys`，sidecar 的 `allowedToolKeys` 作为执行权限子集。模型仍能看到稳定工具 schema，但越权工具会返回 tool error 并允许模型同 run 修正。
- `report_result.data` 改为 optional；`sidecar_data` 固定 optional，专供 sidecar 返回结构化结果。
- `sidecarDataSchema` 只在 Harness 侧校验 `report_result.sidecar_data` 或 fallback 结果，不参与 provider-visible tool schema。

## TODO / Follow-ups

- 实现主路 `report_result.data` 的 runtime 校验策略：当 profile 明确要求结构化输出但模型未给 `data`，由 runtime 决定提醒、失败或允许纯文本错误结果。
- 将 `rp.actor` 接入 `actor.context-load` / `actor.memory-save`，并为 actor 文件路径、读写范围和提示词补 profile 级测试。
- 明确 sidecar 内部 transcript 是否需要单独 debug 可观测面；V1 只保证不污染主 history。
- 后续设计工具违规消息清理：删除违规 assistant/toolResult + 注入 system reminder + continue run。
- 后续再设计 `rp.writer` lorebook retrieval pass。
- 后续再评估 nested sidecar 是否需要开放；V1 禁止自动嵌套。
