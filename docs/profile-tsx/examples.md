# 示例

这一页给出几个 Profile TSX 的常见写法。完整合同以 [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md) 为准。

## 最小 profile

```tsx
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {
    AppendingSet,
    HistorySet,
    Message,
    ModelContext,
    ProfilePrompt,
    RuntimeLocationReminder,
    SkillCatalog,
    System,
    VariableSchema,
    WorkspaceFocusReminder,
} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "agent.example",
    name: "Example Agent",
    description: "示例 profile。",
} as const;

export const InputSchema = Type.Object({
    prompt: Type.String(),
});

const allowedToolKeys = ["read", "write", "edit"] as const;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    allowedToolKeys,
    context() {
        return (
            <ProfilePrompt>
                <System>
                    你是 Example Agent。只处理用户明确要求的任务。
                </System>
                <HistorySet>
                    <Message>
                        <SkillCatalog />
                    </Message>
                </HistorySet>
                <ModelContext>
                    <VariableSchema paths={["client.currentProjectWorkspace"]} includeToolGuide />
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

## 导入共享 Reference

```tsx
<HistorySet>
    <Message>
        <Import path="AGENTS.md" />
    </Message>
    <Message>
        <Import path="reference/agent/neurobook-project-guide.md" />
    </Message>
</HistorySet>
```

适合把长期共享规则放进 `reference/`，避免复制大段 prompt。

## 只给本轮模型看的变量 schema

```tsx
<ModelContext>
    <VariableSchema
        paths={[
            "client.currentProjectWorkspace",
            "client.studio.selectedFilePath",
        ]}
        includeToolGuide
    />
</ModelContext>
```

变量 schema 不应该写进稳定历史；它属于当前运行环境。

## 贴近用户输入的提醒

```tsx
<AppendingSet>
    <RuntimeLocationReminder />
    <WorkspaceFocusReminder />
    <PlanModeReminder />
</AppendingSet>
```

这些提醒会靠近当前用户消息，帮助模型在执行前记住当前工作边界。

## 检查命令

系统 profile 示例：

```bash
bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system
```

编译系统 profile 后，还需要根据任务需要刷新 metadata 或跑对应窄测试。用户 profile 优先用 Workbench 或 Agent runtime `profile check/compile/preview`。
