# Sidecar Profile Pass

`SidecarProfilePass` 是 profile 声明的旁路 run。它沿用当前 profile、当前 session、当前 session tree 和当前 input，在主 run 前后 fork 一段 runtime-only 分支，完成检索、反思或维护任务后，通过 `merge()` 把结果注入主线。

它不是新 profile，也不通过 `profileKey` 切换身份。

## When To Use

适合：

- `actor.context-load`：actor 主 run 前检索并整理角色可知设定。
- `actor.memory-save`：actor 主 run 后维护 `knowledge.md` 和 `mind.md`。
- writer 写作前检索相关 lorebook。
- simulator leader 推进前做规则审计。

不适合：

- 确定性上下文注入。确定性内容继续用 profile TSX、input schema、variables 或 `<Import />`。
- agent 主动临时切换 profile。V1 只支持 profile 声明式自动旁路。

## V1 Contract

```ts
type SidecarProfilePass<TInput, TSidecarData> = {
    name: string;
    stage: "prepareRun" | "settleRun";
    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);
    allowedToolKeys?: readonly string[];
    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge: (ctx: SidecarContext<TInput>, result: SidecarResult<TSidecarData>) => SidecarMergePlan;
};
```

V1 规则：

- `stage` 只支持 `prepareRun` 和 `settleRun`。
- sidecar transcript 默认 `runtime_only`，不进入主 history。
- 禁止 nested sidecar。
- sidecar 失败、waiting、schema 校验失败或缺少必要结果时，父 run 失败。
- `allowedToolKeys` 必须是当前 profile `allowedToolKeys` 的子集。
- provider-visible tools 保持 profile 最大集合，避免破坏工具/schema 缓存；sidecar 工具限制在执行层和 reminder 中表达。

## Result And Merge

`report_result` 固定支持：

```ts
type ReportResultArgs = {
    result: string;
    data?: JsonValue;
    sidecar_data?: JsonValue;
};
```

- 主路结构化输出使用 `data`。
- sidecar 结构化输出使用 `sidecar_data`。
- `sidecarDataSchema` 只在 Harness runtime 校验，不参与 provider-visible schema 渲染。
- 没有 `report_result` 时，可按 `outputFallback` 使用最后一条 assistant message。

`merge()` 可以返回：

- `runtimeMessages`：注入父 run 模型上下文，不落 session。
- `runtimeState`：写入父 run runtime state。
- `writePlans`：显式持久化 session custom state 或 projection。

## Roleplay Actor Pattern

`actor.context-load`：

- stage: `prepareRun`
- tools: `read`, `report_result`
- 输入：GM packet、actor path、当前 subject files。
- 输出：actor-safe lorebook summary 和 source paths。
- merge：把 actor-safe 摘要注入 actor 主 run。

`actor.memory-save`：

- stage: `settleRun`
- tools: `read`, `write`, `edit`, `report_result`
- 目标：更新 `knowledge.md` 和 `mind.md`。
- 不更新 `state.md`；位置、持有物、伤势等仍由 simulator leader / 后续变量系统裁决。

历史设计过程见 [../../docs/tasks/23-agent-sidecar-profile-pass/README.md](../../docs/tasks/23-agent-sidecar-profile-pass/README.md)。
