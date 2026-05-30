# Agent Sidecar Profile Pass

## User Request

- 将“旁路上下文”机制提升为 `NeuroAgentHarness` 的核心能力，而不是只作为 NeuroBook roleplay 的局部技巧。
- 先记录当前设计想法，后续再进行更详细讨论。
- 不需要 `RuntimeContextPass`；确定性上下文注入可以继续由 profile TSX / profile input schema 承担。
- 重点设计 `SidecarProfilePass`：profile 作者可以声明在主 run 前后或特定阶段旁路 invoke 一次，把旁路结果处理后注入主上下文。

## Goal

- 形成一个稳定的任务上下文，后续围绕 `SidecarProfilePass` 继续讨论、原型和实现。
- 保持和 `docs/tasks/18-agent-runtime-pipeline-hooks/README.md` 的 Run Kernel / runtime hooks 设计一致。
- 保留 roleplay 场景的第一需求：`rp.writer` 主写作上下文保持纯净，但写作前可以旁路检索 lorebook；`rp.actor` 主扮演上下文保持纯净，但回合后可以旁路生成知识更新建议。

## Current State

- 18 号任务已经把 `NeuroAgentHarness` 拆向 Run Kernel / Turn Transaction / runtime hooks：
  - `prepareRun` / `prepareTurn` / `ingestTurn` / `prepareNextTurn` / `settleRun` 已经是可讨论的扩展边界。
  - `runtimeMessages` 可以注入 `RunFrame`，不写入 session history。
  - `ingestTurn` 可以返回 runtime-only transcript，避免污染持久对话。
- 当前 profile 的 `allowedToolKeys` 同时承担“模型可见工具”和“执行上限”两层含义。
- roleplay 需求要求主 actor / writer 上下文尽量纯净：
  - `rp.actor` 主流程不应该自己读取文件或检索 lorebook。
  - `rp.writer` 主写作阶段不应该自由使用 bash / read 等检索工具。
  - 但旁路阶段需要临时允许工具，用来检索、整理、反思或生成注入材料。

## Design Seed

### 核心概念

`SidecarProfilePass` 是一次围绕主 profile run 的旁路 profile invocation。它不直接取代主 run，也不默认写 session history，而是产出一段结构化结果，再由 merge 函数转成主 run 可消费的 runtime context。

它适合表达这些动作：

- 写作前检索相关 lorebook。
- 角色扮演后生成 `knowledge.md` 更新建议。
- GM 推进前让规则审计器检查状态约束。
- 主 agent 主动进入旁路的能力以后再讨论，第一版先做 profile 声明式自动旁路。

### 为什么不是 RuntimeContextPass

暂时不引入 `RuntimeContextPass`。

原因是它的定位容易和 profile TSX、profile input schema、prepare context 编译重叠。确定性的上下文注入继续留在 profile 自己的输入和模板层处理；`SidecarProfilePass` 只负责“需要一次 AI 旁路 run 才能生成”的上下文。

### 缓存与工具策略

为了避免破坏 provider prompt/tool cache，profile 的工具集合应该保持稳定：

- `allowedToolKeys` 仍描述 profile 的最大工具集合，也就是模型可见工具集合。
- 运行时增加阶段性的 `ToolPolicyGate`，控制当前 phase 是否允许执行某个工具。
- 主 phase 禁用的工具仍可见，但调用时返回 tool result，说明该工具当前阶段不可用。
- 旁路 phase 可以打开 profile 工具集合的子集，并注入 reminder 说明当前允许使用哪些工具。

例子：

```ts
defineAgentProfile({
    key: "rp.writer",
    allowedToolKeys: ["bash", "read", "report_result"],
    sidecars: [
        writerLorebookRetrievalPass,
    ],
});
```

主写作阶段：

- `bash` / `read` 在 tool schema 中保持可见。
- runtime reminder 告诉 writer 当前不可使用检索工具，只执行写作任务。
- 如果模型调用 `bash` / `read`，ToolPolicyGate 返回“当前写作阶段不可用”。

旁路检索阶段：

- 注入进入旁路的提示词。
- `bash` / `read` 被 ToolPolicyGate 放行。
- 模型通过 `report_result` 返回结构化检索结果。

### Profile 作者接口草案

```ts
type SidecarProfilePass<TInput, TSidecarInput, TOutput> = {
    name: string;
    stage: "prepareRun" | "prepareTurn" | "ingestTurn" | "prepareNextTurn" | "settleRun";

    profileKey?: string | ((ctx: SidecarContext<TInput>) => string);

    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);

    tools: {
        enable: string[];
    };

    input?: (ctx: SidecarContext<TInput>) => TSidecarInput;
    inputSchema?: TSchema;

    outputSchema: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";

    merge: (ctx: SidecarContext<TInput>, result: SidecarResult<TOutput>) => SidecarMergePlan;

    errorPolicy?: "fail_parent" | "skip" | "fallback";
    timeoutMs?: number;
};
```

```ts
type SidecarMergePlan = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonValue;
    writePlans?: SessionWritePlan[];
};
```

说明：

- `enterPrompt`：进入旁路时注入的指令，例如“退出写作模式，先检索本次写作任务相关 lorebook”。
- `tools.enable`：旁路阶段允许执行的工具，必须是 profile 最大工具集合的子集。
- `input` / `inputSchema`：用于从当前主 run 上下文构造旁路输入。AI 主动进入旁路时是否需要额外 InputSchema，后续再定。
- `outputSchema`：旁路必须返回的结构化结果。
- `merge`：把旁路结果转成主 run 的 runtime context、runtime state 或写入计划。

### report_result 规则

- 优先要求旁路 profile 使用 `report_result` 退出旁路。
- `report_result` 的 schema 由 `outputSchema` 决定。
- 如果没有提供 `report_result` 工具，行为应与当前 `invoke_agent` 逻辑保持一致：将最后一条 assistant message 当成结果。
- 如果配置了 `parse_final_message_json` fallback，则尝试把最后一条消息解析为 JSON 并按 `outputSchema` 校验。

### 和 Run Kernel hooks 的关系

`SidecarProfilePass` 不应该绕过 18 号任务建立的 Run Kernel 边界。

推荐实现方式：

- sidecar 由 runtime hook stage 触发，但 sidecar 本身是更高层的 profile 作者能力。
- sidecar invocation 使用独立 `RunFrame` 或 forked run context，不污染主 run session history。
- sidecar 结果只通过 `merge()` 回到主线。
- `merge()` 返回的 `runtimeMessages` 进入主 `RunFrame`，不默认落盘。
- 如需持久化，必须显式返回 `SessionWritePlan`，仍由 `SessionWriteExecutor` 执行。

## Roleplay First Use Cases

### rp.writer 写作前检索

流程：

1. GM 调用 `rp.writer`，下发写作任务。
2. `rp.writer` 进入 `prepareRun` sidecar。
3. sidecar 提示模型退出写作模式，先查找本次写作任务相关 lorebook。
4. sidecar 允许 `bash` / `read` 等检索工具。
5. sidecar 通过 `report_result` 返回相关条目、来源、引用理由。
6. `merge()` 将检索结果注入主写作上下文。
7. 主 `rp.writer` 开始写作，此时检索工具再次被禁用。

### rp.actor 回合后知识更新建议

第一版不直接写 `knowledge.md`，只生成建议：

1. actor 完成一次角色回复。
2. `ingestTurn` 或 `settleRun` sidecar 进入反思阶段。
3. sidecar 提示模型退出扮演模式，生成本回合角色应新增、修正或遗忘的知识。
4. sidecar 通过 `report_result` 返回 `knowledge_delta_suggestion`。
5. 后续由 GM、开发者或专门的持久化机制决定是否落入 `knowledge.md`。

## Decisions

- 不新增 `RuntimeContextPass`。
- 第一版只做 profile 声明式自动旁路；agent 主动调用旁路先不做。
- 主 profile 与 sidecar 共用稳定的最大工具集合；当前 phase 的工具可执行性由 ToolPolicyGate 控制。
- 禁用工具的约束同时通过 reminder 和工具执行层表达，不能只靠提示词。
- sidecar 结果优先使用 `report_result`；无 `report_result` 时 fallback 到最后一条 assistant message。
- sidecar 结果必须经过 `merge()` 才能注入主上下文。
- roleplay spike 阶段不做 actor knowledge 持久化，只生成 knowledge delta suggestion。

## Files Changed

- `docs/tasks/23-agent-sidecar-profile-pass/README.md`

## Verification

- 文档任务创建完成。
- 未运行代码测试；本次只新增设计文档。

## TODO / Follow-ups

- 细化 `SidecarProfilePass` 类型，并和当前 `defineAgentRuntime()` / `defineAgentProfile()` 类型对齐。
- 调研当前 `allowedToolKeys` 的模型可见性和执行上限耦合点，设计 `ToolPolicyGate`。
- 明确 sidecar invocation 是独立 session、forked run context，还是 sessionless RunFrame。
- 定义 sidecar runtime-only transcript 的 session 展示和调试方式。
- 设计 `rp.writer` lorebook retrieval pass 的最小可用原型。
- 设计 `rp.actor` knowledge delta suggestion 的输出 schema。
