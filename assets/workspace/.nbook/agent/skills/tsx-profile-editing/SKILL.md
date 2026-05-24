---
name: tsx-profile-editing
description: 编辑 Neuro Book TSX Agent Profile，包括 builtin 覆盖、自定义 agent、TypeBox schema contract、ProfilePrompt DSL、编译检查和预览。
---

# TSX Profile Editing

用于创建、修改、诊断 `workspace/.nbook/agent/profiles/**/*.profile.tsx` 或系统 `assets/workspace/.nbook/agent/profiles/**/*.profile.tsx`。

## 模块契约

Profile 文件应显式导出：

- `profileManifest`：包含 `key`、`name`、可选 `description`。
- `InputSchema`：TypeBox 输入 schema。普通 agent 可用 `Type.Object({})`。
- `OutputSchema`：TypeBox 输出 schema。空对象 schema 表示没有额外结构化字段。
- `Input` / `Output`：用 `Static<typeof InputSchema>` / `Static<typeof OutputSchema>` 推导的类型别名。
- `default`：`defineAgentProfile({...})` 返回值。

推荐新文件使用 `defineAgentProfile`：

```tsx
export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys: ["read"],
    context(ctx) {
        return <ProfilePrompt>...</ProfilePrompt>;
    },
});
```

## Builtin 限制

覆盖 `leader.default`、`leader.assets`、`writer`、`retrieval` 时，不允许修改 `key`、`InputSchema`、`OutputSchema`。可以修改 prompt、helper function、`allowedToolKeys`。

## 常用节点

- `ProfilePrompt`：profile 根节点。
- `HistorySet`：稳定历史前缀。
- `ModelContext`：本轮模型可见但不写入 session 的上下文。
- `AppendingSet`：追加到当前轮附近的上下文。
- `Message`：模型消息。
- `Reminder`、`Watch`：运行时提醒与变量观察。
- `SkillCatalog`、`ActivatedSkills`：skill 目录与显式提到 skill 的提醒。当前没有独立 skill 工具，需要按 catalog location 用 `read` 打开 `SKILL.md`。
- `If`：条件渲染。

## 工作流

1. 读取目标 `.profile.tsx`。
2. 做最小 TSX 修改，不把当前对话临时要求硬编码成长期提示词。
3. 保存文件。
4. 修改单个 profile 后优先让用户在 Workbench 编译/预览，或用真实 prepare 预览确认；项目根 `scripts/` 是开发者脚本，不作为 Agent runtime 合同。
5. 让用户在 Profile 工作台校验或真实 prepare 预览。保存成功不代表 profile 可运行。
6. 调坏 builtin 覆盖时，用工作台恢复系统版本。

## 安全边界

动态 profile 是可信本地代码，不做 sandbox。不要直接运行陌生来源 profile；如果用户要导入第三方 profile，先审查源码、工具权限、schema contract 和提示词行为。
