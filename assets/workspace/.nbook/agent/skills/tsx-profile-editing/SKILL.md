---
name: tsx-profile-editing
description: 编辑 Neuro Book TSX Agent Profile，包括 builtin 覆盖、自定义 agent、TypeBox schema contract、ProfilePrompt DSL、编译检查和预览。
---

# TSX Profile Editing

用于创建、修改、诊断 `workspace/.nbook/agent/profiles/**/*.profile.tsx` 或系统 `assets/workspace/.nbook/agent/profiles/**/*.profile.tsx`。普通修改优先写用户覆盖层；只有用户明确要求维护系统内置资源时才改 `assets/workspace/.nbook/...`。

## 模块契约

Profile 文件应显式导出：

- `profileManifest`：包含 `key`、`name`、可选 `description`。
- `InitialSchema`：TypeBox 创建期初始化 schema。普通 agent 可用 `Type.Object({})`。
- `PayloadSchema`：可选。TypeBox 单次 invocation payload schema；只有需要 `invoke_agent.input` 时声明。
- `OutputSchema`：TypeBox 输出 schema。空对象 schema 表示没有额外结构化字段。
- `Initial` / `Payload` / `Output`：用 `Static<typeof ...Schema>` 推导的类型别名。
- `default`：`defineAgentProfile({...})` 返回值。

推荐新文件使用 `defineAgentProfile`：

```tsx
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.file.read,
    ),
    context(ctx) {
        return <ProfilePrompt>...</ProfilePrompt>;
    },
});
```

## Builtin 限制

覆盖 `leader.default`、`leader.assets`、`writer`、`retrieval` 时，不允许修改 `key`、`InitialSchema`、`PayloadSchema`、`OutputSchema`。可以修改 prompt、helper function、根 `tools` 绑定和主路 `toolKeys`。

系统 builtin 和用户覆盖必须共用同一个 schema contract。遇到 `builtin_schema_locked` 时，解释为“可以改行为和提示词，但不能把创建参数或输出协议换成另一种形状”。

## 常用节点

- `ProfilePrompt`：profile 根节点。
- `System`：provider 级系统提示，不显示为普通聊天消息。
- `HistorySet`：稳定历史前缀。
- `ModelContext`：本轮模型可见但不写入 session 的上下文。
- `AppendingSet`：追加到当前轮附近的上下文。
- `Message`：模型消息。
- `Reminder`、`Watch`：运行时提醒与变量观察。
- `Variable`：把变量值注入当前模型上下文。
- `VariableSchema`：把变量 schema、可读/可写能力和变量工具提示注入当前模型上下文。
- `AgentCatalog`：可创建/调用的 agent profile 索引和 schema 摘要。
- `SkillCatalog`、`ActivatedSkills`：skill 目录与显式提到 skill 的提醒。当前没有独立 skill 工具，需要按 catalog location 用 `read` 打开 `SKILL.md`。
- `If`：条件渲染。

`Variable` / `VariableSchema` 第一版只放在 `ModelContext` 里，不放在 `System`、`HistorySet` 或 `AppendingSet`。

变量路径使用 `client.*`、`global.*`、`project.*`、`session.*`。`ctx.initial` 是 profile 创建输入，`ctx.invocation.payload` 是本轮结构化 payload；它们都不是浏览器状态。浏览器状态通过 `ctx.vars` / `client.*` 读取。

## 工作流

1. 读取目标 `.profile.tsx`。
2. 做最小 TSX 修改，不把当前对话临时要求硬编码成长期提示词。
3. 保存文件。
4. 修改单个 profile 后优先让用户在 Workbench 编译/预览，或用 Agent runtime `profile` CLI 验证；项目根 `scripts/` 是开发者脚本，不作为 Agent runtime 合同。
5. 用 `profile check` 做契约检查，`profile preview` 查看 prepare 后的 context，`profile compile` 写入 `.compiled` runtime artifact。
6. 如果涉及 Project Workspace 变量类型，给 `profile check/compile/preview` 传 `--project <projectPath>`；如果要把未注册 literal path 变成错误，传 `--strict-variables`。
7. 调坏 builtin 覆盖时，用工作台恢复系统版本。

保存成功不代表 profile 可运行。`.profile.tsx` 是源码真相源，`.compiled` 是 runtime 真相源；runtime catalog、创建 session 和 invoke 不会自动编译源码。

## 变量编辑补充

- Workspace Root/global definition 源码：`workspace/.nbook/agent/variables/definitions.ts`。
- Project definition 源码：`workspace/{project}/.nbook/agent/variables/definitions.ts`。
- definition 修改后运行 `variable definition check/compile/status`。
- 变量类型补全来自 generated `.d.ts`，只是 authoring aid；runtime 真相仍是 registry、schema 校验、variables.json 和 session JSONL。

## 安全边界

动态 profile 是可信本地代码，不做 sandbox。不要直接运行陌生来源 profile；如果用户要导入第三方 profile，先审查源码、工具权限、schema contract 和提示词行为。

不要把当前对话里的临时偏好、一次性路径或个人要求写进长期 profile / skill，除非用户明确要求长期保存。
