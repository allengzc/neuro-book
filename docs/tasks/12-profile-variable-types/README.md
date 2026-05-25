# Profile Variable Types

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## User Request

- 为 Agent 变量系统设计类型自动生成方案，让 TSX Profile 编辑时能获得变量 path 补全和返回值类型提示。
- 重点覆盖已经存在的 `client/global/project/session` scope：
    - `client.*` 内建前端状态变量。
    - `global.*` Workspace Root 级自定义变量。
    - `project.*` Project Workspace 级自定义变量。
    - `session.*` profile 自定义变量。
- 评估是否借鉴 TSX Profile `.compiled` 的方式，为变量 definition 生成 `.d.ts` 或类似 `.compiled` 的类型产物。
- 明确用户可以得到什么，以及后续方向是什么。

## Goal

- 让 profile 作者在 `.profile.tsx` 中写变量 path 时有自动补全，减少字符串拼错、scope 混用和 schema 误解。
- 让 `ctx.vars.get("...")` / `ctx.vars.read("...")` 对已知变量返回更具体的 TypeScript 类型；未知动态 path 仍保留 `JsonValue | undefined` fallback。
- 让 `<Variable path="...">`、`<VariableSchema paths={[...]}>`、`watchPath="..."` 这类 DSL 属性获得同一套变量 path 类型提示。
- 保持运行时真相源不变：变量 definition、registry、storage 和 runtime schema 校验仍是真相；generated type 只是 authoring aid。
- 支持 scope-aware 类型生成：builtin/client、Workspace Root/global、Project Workspace/project、profile/session 可以分层生成和组合。

## What You Get

- **Profile 写作体验更稳**：输入 `client.`、`project.`、`session.` 时能看到已注册变量 path，避免靠记忆写字符串。
- **返回值类型更准**：`await ctx.vars.get("client.currentProjectWorkspace")` 可以推导为 `string | null | undefined`，而不是笼统的 `JsonValue | undefined`。
- **自定义变量也能提示**：`workspace/.nbook/agent/variables/definitions.ts`、`workspace/{project}/.nbook/agent/variables/definitions.ts` 和 profile 内 `variableDefinitions` 里的变量都可以进入类型索引。
- **错误更早暴露**：拼错 path、引用未注册变量、把 `project.*` 写成 `global.*` 这类问题，可以在编辑期或 profile check 阶段提前发现。
- **不牺牲动态能力**：运行时仍允许高级 profile 用动态字符串访问变量；这类访问只降级为通用类型，不阻塞编译。
- **Workbench / Profile Editor 可复用**：同一份类型索引后续可以驱动变量选择器、schema 面板、补全列表和 profile diagnostics。

## Current State

- 变量 namespace 已固定为 `client/global/project/session`。
- 变量定义入口已经存在：
    - `defineClientVariable`
    - `defineWorkspaceRootVariable`
    - `defineProjectVariable`
    - `defineSessionVariable`
- 运行时 registry 已能合并：
    - 内建 `client.*` definitions。
    - Workspace Root `.nbook/agent/variables/.compiled` 中的 `global.*` definitions。
    - 当前 Project Workspace `.nbook/agent/variables/.compiled` 中的 `project.*` definitions。
    - profile artifact 中的 `session.*` `variableDefinitions`。
- 变量 definition 已有 `.compiled` 合同：runtime 只加载 hash 匹配的 artifact，不自动编译源码。
- `ProfileVariableAccessor` 当前仍是字符串 API：
    - `get(path: string): Promise<JsonValue | undefined>`
    - `read(path: string): Promise<VariableReadResult>`
    - `catalog(query?: VariableSchemaQuery): VariableSchemaResult`
- `client.studio` / `client.ide` 当前在 registry 中是 `Record<string, Unknown>`，但前端 `buildAgentClientState()` 实际有更具体字段，例如 `selectedFilePath: string | null`。

## Design

### 1. 类型生成是派生产物

- 不新增第二套变量真相源。
- 类型生成从现有 definition registry / compiled artifact / profile `variableDefinitions` 派生。
- 生成物可以删除并重新生成；runtime 不依赖 generated `.d.ts`。
- `profile check` / `profile compile` 可以在必要时读取 generated types，但不能因为 type 文件缺失而改变 runtime registry 语义。

### 2. 生成 Path -> Value Map

推荐核心类型形态：

```ts
export interface ProfileVariableValueMap {
    "client.currentProjectWorkspace": string | null;
    "client.studio.selectedFilePath": string | null;
    "project.affections": Record<string, number>;
    "session.draftGoal": string;
}

export type ProfileVariablePath = keyof ProfileVariableValueMap & string;
```

然后让 `ProfileVariableAccessor` 支持 overload：

```ts
get<P extends ProfileVariablePath>(path: P): Promise<ProfileVariableValueMap[P] | undefined>;
get(path: string): Promise<JsonValue | undefined>;
```

`read()` 第一版可以只把 `value` 字段类型化：

```ts
read<P extends ProfileVariablePath>(path: P): Promise<TypedVariableReadResult<ProfileVariableValueMap[P]>>;
read(path: string): Promise<VariableReadResult>;
```

### 3. 分层生成

- **Builtin/client types**
    - 从 `builtinVariableDefinitions()` 和前端 `ClientStateSnapshotDto` / `NovelIdeClientVariablesInput` 生成或手动维护第一版。
    - 建议先把常用 leaf 显式注册为内建变量，避免 `client.studio` 的 `Record<string, Unknown>` 吞掉具体类型。
- **Workspace Root/global types**
    - 从 `workspace/.nbook/agent/variables/.compiled/manifest.json` 与 artifact 导出的 definitions 生成。
    - 产物位于 `workspace/.nbook/agent/variables/.compiled/types.d.ts` 或类似路径。
- **Project Workspace/project types**
    - 从 `workspace/{project}/.nbook/agent/variables/.compiled/manifest.json` 与 artifact 生成。
    - 产物位于 `workspace/{project}/.nbook/agent/variables/.compiled/types.d.ts`。
    - 只有在编辑某个 Project Workspace 绑定的 profile 或执行 project-aware check 时注入。
- **Profile/session types**
    - 从 profile artifact 的 `variableDefinitions` 生成。
    - 产物可以随 profile compiled artifact 放在 profile `.compiled` 下，也可以在 profile check 时临时生成。

### 4. TSX Profile 编译注入

- `profile check` / `profile compile` 在构造 TypeScript Program 前准备一个 generated type entry。
- 对 builtin profile：注入 builtin/client + profile/session 类型，默认不注入某个 Project Workspace 的 project types。
- 对 Project Workspace 里的编辑场景：可以额外注入当前 Project Workspace 的 project types。
- 对 user-assets profile：注入 Workspace Root/global + profile/session；除非有明确 current project，否则不注入 project types。

### 5. DSL 属性也复用 path 类型

- 为 `Variable`、`VariableSchema`、`Reminder.watchPath` 等声明泛型或 typed prop：
    - `path?: ProfileVariablePath | string`
    - `paths?: readonly ProfileVariablePath[] | readonly string[]`
- 第一版以补全为主，不强制禁止动态字符串。
- 后续可在 `profile check --strict-variables` 中把 literal path 未注册提升为 error。

## Implementation Plan

### Phase 1. 类型基础设施

- 新增 `server/agent/variables/generated-types.ts` 或同等模块：
    - 将 `VariableDefinition[]` 转成 `ProfileVariableValueMap` 文本。
    - 支持 TypeBox 常用子集到 TypeScript type 的转换。
    - 对无法稳定转换的 schema 降级为 `JsonValue` 或 `unknown`，并在 diagnostics 中提示。
- 为 `ProfileVariableAccessor` 增加可扩展 map 类型和 overload。
- 增加测试覆盖：
    - `Type.String()` -> `string`
    - `Type.Union([Type.String(), Type.Null()])` -> `string | null`
    - `Type.Record(Type.String(), Type.Number())` -> `Record<string, number>`
    - object / array / literal / boolean / number 的基础转换。

### Phase 2. 变量 definition 类型产物

- 扩展 variable definition compile 流程：
    - 在 `.compiled/manifest.json` 旁生成 `types.d.ts`。
    - manifest 记录 type artifact hash / bytes，便于 stale 检查。
- 更新 `scripts/variable.ts definition compile`：
    - 编译 runtime artifact。
    - 同步生成 type artifact。
    - `status` 输出 type artifact 是否缺失或过期。
- Workspace Root/global 与 Project/project definition 共用同一套生成器。

### Phase 3. Profile session types

- 扩展 profile artifact compiler：
    - 读取 profile 导出的 `variableDefinitions`。
    - 为当前 profile 生成 session variable type map。
- `defineAgentProfile` 类型不强制用户手写复杂泛型，优先让 compiler 从实际导出对象提取 definitions。
- `profile check` 对同一 profile 源码注入它自己的 session variable types。

### Phase 4. Profile authoring 接入

- 更新 profile check / compile CLI 的 TypeScript Program root：
    - 加入 generated variable `.d.ts`。
    - 加入 workspace/global type artifact。
    - 在 project-aware 模式加入 project type artifact。
- 更新 DSL public types：
    - `Variable`
    - `VariableSchema`
    - `Reminder.watchPath`
    - `ProfileVariableAccessor`
- 更新 Workbench：
    - 变量面板使用同一 registry/type source。
    - Inspector 中 path 字段可提供补全候选。
    - diagnostics 展示 missing/stale type artifact，但不和 runtime artifact 混淆。

### Phase 5. Strict diagnostics

- 增加可选 strict mode：
    - literal path 未注册时报错。
    - `project.*` 在无 current Project Workspace 的 check 场景中提示不可解析。
    - `client.studio.*` 这类落在 `Unknown` record 下的 leaf path 提示类型不精确。
- 默认模式保持温和：提供补全和 warning，不破坏动态 profile。

## TypeBox Mapping Policy

- 稳定支持：
    - `String` -> `string`
    - `Number` / `Integer` -> `number`
    - `Boolean` -> `boolean`
    - `Null` -> `null`
    - `Literal` -> literal type
    - `Array<T>` -> `T[]`
    - `Object` -> object literal type
    - `Record<string, T>` -> `Record<string, T>`
    - `Union` -> `A | B`
    - `Intersect` -> `A & B`，仅限简单 object / record
- 保守降级：
    - recursive schema
    - conditional schema
    - complex `$ref`
    - unsupported patternProperties
    - transform / custom keywords
- 降级时仍注册 path，但 value type 使用 `JsonValue` 或 `unknown`，并把原因写入 type generation diagnostics。

## Decisions

- 类型补全不改变变量系统运行时真相源。
- 不把 generated `.d.ts` 当成 runtime 依赖；runtime 仍只读 registry 和 `.compiled` runtime artifact。
- 第一版保留动态字符串 fallback，不强制所有变量访问都必须是 literal path。
- `project.*` 类型是 Project Workspace 相关的；通用 profile 默认不绑定具体 project type。
- `session.*` 类型来自 profile 自己的 `variableDefinitions`，最适合优先实现。
- `client.*` 要补全到 leaf path，需要把内建 client definition 变细，或额外注册常用 leaf variable。

## Open Questions

- 是否把常用 `client.studio.*` leaf 全部注册为内建变量，而不是只保留 `client.studio: Record<string, Unknown>`？
    - 推荐：先注册高价值 leaf，例如 `client.studio.selectedFilePath`、`client.studio.selectionVersion`、`client.studio.selectedStoryThreadId`、`client.studio.selectedStorySceneId`。
- Project-aware profile editing 的 current project 从哪里来？
    - 推荐：Workbench / IDE 打开 profile 时如果有 `client.currentProjectWorkspace`，则注入该 project 的 type artifact；CLI 增加 `--project <projectPath>`。
- `ctx.vars.read()` 是否要深度类型化整个 result？
    - 推荐：第一版只类型化 `value`；`issue` / `fingerprint` 保持现状。
- 严格模式默认开不开？
    - 推荐：默认不开。先用 warning 和补全建立信任，再按 profile 或 CLI 参数启用。

## Future Direction

- **变量选择器**：Workbench 中不再手写 path，而是从 registry/catalog 中选择变量。
- **schema-aware patch builder**：根据变量类型辅助生成 JSON Patch，减少 Agent 写错 patch path 或 value 类型。
- **profile diagnostics 增强**：在保存时提示变量 definition stale、project type 缺失、literal path 未注册。
- **client state 精细化**：把 `client.ide` / `client.studio` 从宽松 record 逐步拆成稳定 leaf definitions。
- **project package 自描述**：Project Workspace 打包时携带 project variable definitions、runtime artifact 和 type artifact，迁移后仍能补全。
- **Agent prompt 精简**：Leader profile 不必注入大段变量 schema，更多依赖工具查询和编辑期补全。

## Files Changed

- `docs/tasks/12-profile-variable-types/README.md`

## Verification

- 文档任务，无运行时验证。

## TODO / Follow-ups

- 实现 TypeBox -> TypeScript type 生成器。
- 扩展 variable definition compile 输出 type artifact。
- 为 `ProfileVariableAccessor`、`Variable`、`VariableSchema`、`Reminder.watchPath` 接入 typed path。
- 为 profile check / compile 注入 generated variable type file。
- 决定并实现高价值 `client.studio.*` leaf 内建变量定义。
