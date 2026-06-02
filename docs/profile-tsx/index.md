# Profile TSX 介绍

Profile TSX 是 NeuroBook 用来组织 Agent prompt 和上下文的结构化写法。

它不是把所有规则拼成一个长字符串，而是把不同性质的内容放进不同节点：哪些是长期 system，哪些是首次写入历史，哪些只给本轮模型看，哪些要贴近当前用户输入。

## 为什么不用普通字符串 prompt

普通字符串 prompt 容易出现几个问题：

- 长期规则、运行期状态和当前任务混在一起。
- 共享协议复制到多个 profile，修改时容易漂移。
- 不容易测试上下文顺序。
- 很难表达“只本轮可见”或“只在状态变化时提醒”。

Profile TSX 用节点表达这些边界，让 prompt 更像可维护的运行时合同。

## 基本结构

一个 profile 通常返回：

```tsx
<ProfilePrompt>
    <System>长期身份和规则</System>
    <HistorySet>
        <Message>首次初始化的稳定上下文</Message>
    </HistorySet>
    <ModelContext>
        <Message>本轮只给模型看的上下文</Message>
    </ModelContext>
    <AppendingSet>
        <Message>贴近当前用户输入的提醒</Message>
    </AppendingSet>
</ProfilePrompt>
```

可以简化理解为：

```text
System + HistorySet/history -> ModelContext -> AppendingSet -> 当前用户输入
```

## 四个主要区域

`System` 是 profile 的长期身份、职责和工具边界。

`HistorySet` 是稳定历史前缀，适合放 catalog、共享规范和首次写入历史的上下文。

`ModelContext` 是本轮只给模型看的上下文，不写入产品历史。

`AppendingSet` 是贴近当前输入的上下文区域，会在当前用户消息之前进入模型上下文。

## 和 reference 的关系

共享长文不要复制进 profile。稳定说明应放到 `reference/`，再通过 `<Import />` 引入。

例如：

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/neurobook-project-guide.md" />
    </Message>
</HistorySet>
```

这样可以让多个 profile 共享同一份系统参考，减少提示词漂移。

## 继续阅读

- [节点说明](/profile-tsx/nodes)
- [示例](/profile-tsx/examples)
- [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/reference/agent/context.md)
