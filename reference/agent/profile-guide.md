# Agent Profile Guide

本文档说明 active Agent Profile 的职责边界、TSX Profile DSL 写法和新增 profile 时的检查点。

相关文档：

- [harness.md](harness.md)
- [context.md](context.md)
- [profile-import.md](profile-import.md)
- [project-workspace-guide.md](project-workspace-guide.md)

## Profile Definition

当前推荐使用 `defineAgentProfile()` 定义 profile。Profile 至少声明：

- `manifest.key`
- `manifest.name`
- `inputSchema`
- `tools`
- `context(ctx)`

需要结构化结果时声明 `outputSchema`。存在 `outputSchema` 时，`report_result.data` 是主路结构化输出的 runtime 校验依据；provider-visible schema 中该字段保持 optional，方便任务失败或只返回可读错误说明时仍能结束主 run。旁路结构化结果不要复用 `report_result`，必须通过 `report_sidecar_result.data` 返回。

`tools` 是 profile 的根工具绑定对象，决定模型可见工具 schema 和 profile 最大执行权限。推荐用 `defineProfileTools({...})` 显式声明工具集合；需要定制 `report_result.data` schema 时使用 `tools.reportResult({ dataSchema: OutputSchema })`。如果 profile 有 sidecar，root `tools` 需要同时声明 `report_sidecar_result: tools.reportSidecarResult()`；其 `data` schema 会由当前 profile 全部 `sidecarDataSchema` 汇总成 sidecar-name keyed 的 profile-stable union。sidecar 调用时必须传 `data: { "<sidecar-name>": payload }`，payload 才按该 sidecar 的 `sidecarDataSchema` 校验。主 run 需要收窄执行权限时声明 `mainRunToolKeys`，sidecar 需要收窄执行权限时声明 `sidecar.toolKeys`，二者都只能引用根 `tools` 中已有的 key。

`tools` 支持三种来源：

- `tools.read()` / `tools.write()` 等：引用内置全局工具。
- `defineAgentTool({...})`：定义并内联 profile 自带工具，该工具只在当前 profile run 内可见。
- `tools.registered("plugin_tool")`：引用运行时已注册但没有 typed factory 的插件工具；不要用它内联自带工具。

内置 profile 位于 `assets/workspace/.nbook/agent/profiles/builtin/`，例如：

- `leader.default.profile.tsx`
- `writer.profile.tsx`
- `retrieval.profile.tsx`
- `simulator.leader.profile.tsx`
- `simulator.actor.profile.tsx`
- `rp.writer.profile.tsx`

## Prepare Lifecycle

1. Harness 校验 profile input，并构造 `ProfilePrepareContext`。
2. Profile `context(ctx)` 返回 `<ProfilePrompt>`。
3. `server/agent/profiles/profile-dsl.ts` 编译 TSX tree，生成 `ProfileTurnPlan`。
4. Harness 根据 plan 组合 provider prompt、历史写入和 profile runtime state。
5. Assistant / tool result 进入 runtime transcript，并按当前 runtime hooks 写回。

常用 `ctx` 字段：

- `ctx.input`：通过 `inputSchema` 校验后的 profile 创建输入。
- `ctx.session`：当前 session facade，包含 workspaceRoot、messages、customState、linkedAgents 等。
- `ctx.vars`：变量访问器。TSX 中优先用 `<Variable>` 和 `<VariableSchema>` 注入。
- `ctx.catalog`：当前可见 agent profiles 和 profile issues。
- `ctx.skills`：当前可见 skills。
- `ctx.runtime`：本轮时间、用户 turn 计数等 runtime 信息。

## TSX Contract

Profile `context()` 应返回 `<ProfilePrompt>` 根节点：

```tsx
context() {
    return (
        <ProfilePrompt>
            <System>{SYSTEM_PROMPT}</System>
            <HistorySet>
                <Message>
                    <AgentCatalog />
                </Message>
                <Message>
                    <SkillCatalog />
                </Message>
                <Message>
                    <Import path="reference/agent/project-workspace-guide.md" />
                </Message>
            </HistorySet>
            <ModelContext>
                <VariableSchema paths={["client.currentProjectWorkspace"]} includeToolGuide />
            </ModelContext>
            <AppendingSet>
                <WorkdirReminder />
                <ProjectWorkspaceReminder />
                <PlanModeReminder />
            </AppendingSet>
        </ProfilePrompt>
    );
}
```

顶层允许：

- `System`
- `HistorySet`
- `ModelContext`
- `AppendingSet`
- `Compaction`
- `If`
- `Fragment`

非空文本必须放在支持 string 的节点内，例如 `System` 或 `Message`。不要在 `ProfilePrompt` 顶层放裸文本。

## System

`System` 是 profile 的身份、职责、工具边界和长期行为规则。它只接受 string-like children。

适合放：

- profile 是谁。
- profile 的任务边界。
- 工具使用原则。
- 与其他 agent 的协作原则。
- 必须长期遵守的输出规则。

不适合放：

- 本轮临时状态。
- 当前 Project Workspace。
- 变量值。
- 大段可共享的项目协议。共享协议优先放到 `reference/`，再用 `Import` 显式导入。

## HistorySet

`HistorySet` 是稳定历史前缀。缺少历史前缀时，它会写入 session 历史根部；已经存在稳定前缀时，不会每轮重复写入。

适合放：

- 可用 agent catalog。
- 可用 skill catalog。
- 共享规范导入，例如 `<Import path="reference/agent/project-workspace-guide.md" />`。
- 需要首轮持久化、后续不频繁变化的上下文。

规则：

- `SkillCatalog`、`AgentCatalog`、`Import` 都是 string fragment，必须包在 `Message` 或 `System` 这种 string 容器内。
- 不要放 `Reminder` 或 `Watch`。
- 不要放当前变量值、当前 selected file、当前任务状态等运行期内容。

## Import

`Import` 显式导入共享文本文件，避免复制长 prompt。

推荐用法：

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

支持：

- `path`
- `heading`
- `maxBytes`
- `required`
- `label`
- `as`，V1 只支持 `text`

V1 只允许 `AGENTS.md`、`reference/**` 和 `docs/**`。不要用 `Import` 读取 Project Workspace 文件；项目内容应通过 agent 文件工具、sidecar 或 runtime 注入读取。

详见 [profile-import.md](profile-import.md)。

## ModelContext

`ModelContext` 是本轮只给模型看的上下文，不写入产品历史。

适合放：

- `VariableSchema`
- `Variable`
- SQL schema summary
- 当前运行期只读摘要
- 不应持久化到历史里的 `Reminder` / `Watch`

规则：

- `Variable` / `VariableSchema` 第一版只能直接放在 `ModelContext`。
- `Reminder` / `Watch` 在 `ModelContext` 中生成的消息进入本轮 provider prompt，不写入产品历史。
- 不要把长期共享说明放在这里；稳定说明优先放 `HistorySet`。

## AppendingSet

`AppendingSet` 是贴近当前输入的上下文区域。它产出的非空消息会写入当前历史光标，并在模型上下文中位于当前用户消息之前。

适合放：

- `WorkdirReminder`
- `ProjectWorkspaceReminder`
- `PlanModeAvailabilityReminder`
- `PlanModeReminder`
- `LinkedAgentsReminder`
- `TaskReminder`
- `MentionedSkillsReminder`
- 需要靠近当前输入的运行期提醒

规则：

- `Reminder` 根据 `when`、变量 watch、函数 watch 和 `repeatEveryTurns` 控制注入频率。
- `Watch` 适合把重要外部状态变化写入历史。
- `ActivatedSkills` / `MentionedSkillsReminder` 必须包在 `Message` 内。
- 不接受非空裸文本。

## Variables

变量路径以 `client`、`global`、`project` 或 `session` 开始。

常见写法：

```tsx
<ModelContext>
    <VariableSchema paths={["client.currentProjectWorkspace", "client.studio.selectedFilePath"]} includeToolGuide />
</ModelContext>
```

Agent 需要读写变量时，按工具流程：

1. `variable_schema` 查询局部 schema。
2. `variable_read` 读取当前值。
3. `variable_patch` 提交 RFC 6902 JSON Patch。
4. 重要修改后再次读取验证。

## Minimal Skeleton

```tsx
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {defineProfileTools, tools} from "nbook/server/agent/profiles/profile-tools";
import {
    AppendingSet,
    HistorySet,
    Import,
    Message,
    ModelContext,
    ProfilePrompt,
    ProjectWorkspaceReminder,
    SkillCatalog,
    System,
    VariableSchema,
    WorkdirReminder,
} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "some.profile",
    name: "Some Profile",
    description: "Example profile.",
} as const;

export const InputSchema = Type.Object({
    prompt: Type.String(),
});

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    tools: defineProfileTools({
        read: tools.read(),
        write: tools.write(),
        edit: tools.edit(),
    }),
    context() {
        return (
            <ProfilePrompt>
                <System>
                    你是 Some Profile。只处理输入中明确要求的任务。
                </System>
                <HistorySet>
                    <Message>
                        <SkillCatalog />
                    </Message>
                    <Message>
                        <Import path="reference/agent/project-workspace-guide.md" />
                    </Message>
                </HistorySet>
                <ModelContext>
                    <VariableSchema paths={["client.currentProjectWorkspace"]} includeToolGuide />
                </ModelContext>
                <AppendingSet>
                    <WorkdirReminder />
                    <ProjectWorkspaceReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

## Profile-Owned Tool

profile 可以用 `defineAgentTool()` 定义自带工具，并把 definition 本身放进根 `tools`。自带工具的 key 只在当前 profile run 内解析，不会注册进全局 registry。

```ts
import {Type} from "typebox";
import {defineAgentTool, defineProfileTools, tools} from "nbook/server/agent/profiles/profile-tools";

const roll_dice = defineAgentTool({
    key: "roll_dice",
    description: "Roll one six-sided dice.",
    parameters: Type.Object({}),
    async execute() {
        const value = Math.floor(Math.random() * 6) + 1;
        return {
            content: [{type: "text", text: `rolled ${value}`}],
            details: {value},
        };
    },
});

const profileTools = defineProfileTools({
    roll_dice,
    report_result: tools.reportResult(),
});
```

## Checklist

新增或修改 profile 后检查：

- `key`、`kind`、`name` 和 `description` 是否准确。
- `inputSchema` 是否只包含创建输入，不混入每轮动态状态。
- 需要结构化结果时是否声明 `outputSchema`。
- `tools` 是否是 profile 最大工具集合；`mainRunToolKeys` / `sidecar.toolKeys` 是否只是它的子集。
- sidecar 是否使用 `report_sidecar_result` 而不是 `report_result` 返回旁路结果；是否声明了对应 `sidecarDataSchema`。
- `System` 是否只放 profile 身份、职责和长期行为边界。
- `HistorySet` 是否只放稳定前缀。
- 共享规范是否用 `Import` 引用，而不是复制长 prompt。
- `ModelContext` 是否只放本轮模型可见、不需要持久化的上下文。
- `AppendingSet` 是否贴近当前输入，Reminder 顺序是否合理。
- 变量路径是否通过 `VariableSchema` / `Variable` 暴露。
- 新 TSX 节点是否有定向测试覆盖。
- profile 是否可通过 `bun scripts/build/profile.ts check <file> --system` 或对应用户 assets check。
