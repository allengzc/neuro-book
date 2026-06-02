# 示例

这页给出 Profile TSX 的最小骨架和常见片段。完整实现参考见 [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)。

## 最小骨架

```tsx
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import { Type } from "typebox";
import { defineAgentProfile } from "nbook/server/agent/profiles/define-agent-profile";
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
    key: "example.helper",
    name: "Example Helper",
    description: "一个最小 profile 示例。",
} as const;

const InputSchema = Type.Object({});

const allowedToolKeys = ["read", "report_result"] as const;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    allowedToolKeys,
    context() {
        return (
            <ProfilePrompt>
                <System>
                    你是 Example Helper。只处理用户明确要求的任务。
                </System>
                <HistorySet>
                    <Message>
                        <SkillCatalog />
                    </Message>
                    <Message>
                        <Import path="reference/agent/neurobook-project-guide.md" />
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

## Leader 风格片段

Leader 通常需要知道可用 agent、skill 和 Project Workspace 语义。

```tsx
<HistorySet>
    <Message>
        <AgentCatalog />
    </Message>
    <Message>
        <SkillCatalog />
    </Message>
    <Message>
        <Import path="reference/agent/leader-default.md" />
    </Message>
    <Message>
        <Import path="reference/agent/neurobook-project-guide.md" />
    </Message>
</HistorySet>
```

这类内容适合稳定写入历史前缀，不需要每轮重新复制。

## Writer 风格片段

Writer 更关注章节、写作输入和明确的正文边界。

```tsx
<System>
    你是章节正文写作 Agent。你只写当前输入指定章节的 index.md。
</System>
<ModelContext>
    <VariableSchema paths={["client.currentProjectWorkspace"]} includeToolGuide />
</ModelContext>
<AppendingSet>
    <ProjectWorkspaceReminder />
</AppendingSet>
```

实际 writer 还会通过 input 接收章节路径、设定条目、约束和写作预设。大范围设定召回应由 retrieval 或 leader 先完成。

## Import 共享参考

当多个 profile 都需要同一份说明时，把说明放在 `reference/`，再用 `Import`：

```tsx
<Message>
    <Import
        path="reference/content/markdown-dialect.md"
        heading="Markdown 方言"
        maxBytes={8000}
    />
</Message>
```

这样可以控制导入范围，也能减少多个 profile 之间的文档漂移。

## Reminder 示例

```tsx
<AppendingSet>
    <Reminder id="current-project" watchPath="client.currentProjectWorkspace" repeatEveryTurns={5}>
        <Message>当前 Project Workspace 已变化，请优先使用新的项目路径。</Message>
    </Reminder>
</AppendingSet>
```

`Reminder` 适合放需要靠近当前输入、但不必每轮都重复的运行期提醒。

## 常见错误

- 在 `ProfilePrompt` 顶层写裸文本。
- 把当前 Project Workspace 写死进 `System`。
- 用 `Import` 读取 `lorebook/...` 或 `manuscript/...`。
- 把临时状态放进 `HistorySet`。
- 让 writer 自己大范围搜索所有设定，而不是由 retrieval 先召回候选。
