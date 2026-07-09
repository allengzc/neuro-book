# Profile TSX 介绍

TSX Profile 是 NeuroBook 编写 Agent profile 的主要方式。它使用 TSX 作为上下文模板语言，表达一个 profile 的 system prompt、history、dynamic context、runtime reminder 和编译策略。

如果你只是使用 NeuroBook，不需要写 TSX。你只有在创建自定义 profile、修改内置 profile 或维护 user-assets 时才需要读这一组文档。TSX Profile 的价值是让 Agent 上下文保持类型安全、可预览、可检查，并为低代码编辑和可视化辅助维护提供结构基础。

## 最小结构

一个 TSX profile 的 `context()` 返回 `<ProfilePrompt>`：

```tsx
<ProfilePrompt>
    <System>你是一个专用 Agent。</System>
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
```

四个区域的直觉：

- `System`：长期身份和职责。
- `HistorySet`：History，首次写入 session 的稳定前缀。
- `ModelContext`：Dynamic Context，只给本轮模型看的临时上下文。
- `AppendingSet`：Reminder，贴近当前用户输入、通常会写入历史的运行期提醒。

## 编译和运行

TSX 源文件不是 runtime 真相源。运行时使用 `.compiled` artifact。

修改 profile 后，需要在 Workbench 或 CLI 中执行 check / compile。系统 profile 的开发验证通常使用：

```bash
bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system
```

用户 profile 则应通过 user-assets 的 Workbench 或 runtime `profile` CLI 检查。

## 继续阅读

- [节点说明](./nodes.md)
- [示例](./examples.md)
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/reference/agent/context.md)
