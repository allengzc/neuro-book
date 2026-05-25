# Agent Variable System Refactor

## User Request

- 系统性重构 Agent 变量系统，不用临时 hack 修 ProjectReminder。
- Profile / Agent 能访问前端状态，例如 client state、编辑器字体、当前面板、选中文件等，并且能修改前端状态。
- 变量系统需要统一、易扩展，后续增加变量不应再散落修改 DTO、profile DSL、harness 和前端状态映射。
- 支持用户自定义变量，至少分为 Workspace Root 级、Project 级、Session 级。
- `invoke` 请求的业务 input 暂时不走变量系统；harness 可以直接从 invocation 接口拿到。`ctx.invocation` 可以保留为 invocation 接口参数的直接映射，即使其中部分数据也会被归入变量系统。
- 希望通过 `defineXXX` 风格定义变量 scope；前端 state 也可以归为一个内建 scope；用户后续可定义自己的变量，例如“好感度”。
- `ctx` 与变量系统要明确区分：`ctx` 是 harness 注入给 profile 的完整上下文容器，变量系统只是 `ctx` 可以持有的一项能力；`catalog`、`input` 等可读数据不应被强行归入变量系统。
- 提供给 profile 的变量对象应能绑定 session 或 entry，使变量读写跟随 active path 回退；同时提供 `get`、`put` 等实用方法，让 `Reminder` / `Watch` 可以基于统一变量路径实现，而不是各自写特殊逻辑。
- 持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`，暂不拆成多个 JSON 文件。
- Profile 注入变量时优先通过新增 TSX Node / Helper，让 profile 作者不用手写底层 `ctx.vars.get()`。
- Profile 可以通过 TSX Helper 显式暴露变量系统中的某个 JSON object，并给它一个稳定 `id`；Agent 后续通过专门工具按这个 `id` 找到目标对象并提交 JSON Patch。
- Agent 修改变量使用 JSON Patch 工具；后续调研 LLM 友好的 JSON Patch 生成/修复库，记录候选：JSON-Whisperer（https://github.com/emnlp2025/JSON-Whisperer，https://arxiv.org/html/2510.04717v1）。
- 变量系统本次硬切，不做 legacy 兼容；不保留 `ctx.workspace` alias。
- `VariableObject` 承载的是每轮可能变化的 JSON object，只允许放在 `ModelContext`；不能放入 `System`、`HistorySet`、`AppendingSet`，避免 provider system prompt、首轮历史或 session appending 被动态变量污染。
- 变量系统第一版要一次性把心智模型做好：宁愿硬切旧概念，也不要让 profile 作者同时理解多套别名、fallback 和历史兼容规则。外部 API 要少而稳定，复杂性藏在 harness / registry 内部。

## Goal

- 建立一个统一变量模型，让 profile、harness、工具和前端 UI 都通过同一套 scope / schema / storage / sync 合同读写变量，同时保留 `ctx` 作为 harness 注入上下文容器的更大边界。
- 把 `ctx.input` 从“浏览器状态临时载体”中解放出来，保留为 profile 静态 input 或一次性 invocation 业务 input。
- 让 ProjectReminder 这类“依赖当前 Project Workspace 的运行时提醒”读取本轮最新 frontend/client snapshot，而不是读取 session 创建时的旧 input。
- 为后续用户自定义变量、低代码 profile、前端状态修改、跨 session/project 状态复用留下稳定扩展点。
- 让变量访问对象统一绑定 entry anchor，默认 anchor 是当前 active leaf，确保回退、分支切换、retry 时变量视图和消息历史一致。
- 降低 profile 作者和 Agent 使用变量的心智负担：常用读变量走 TSX helper，常用改变量走 `VariableObject.id` + patch 工具，高级 `ctx.vars` API 只作为逃生口。

## Current State

- `ProfilePrepareContext` 当前包含 `session`、`input`、`catalog`、`skills`、`runtime`。
- DSL `watchPath` 只允许 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace` 四个 root。
- `ctx.workspace` 不是 `ProfilePrepareContext` 的真实字段，而是 `profile-dsl.ts` 中手动拼出来的虚拟 root：
  - `root` 来自 `ctx.session.workspaceRoot`。
  - `currentProject` 来自 `ctx.input.studio.workspace`。
  - `novelId` 来自 `ctx.session.novelId`。
- 前端 `buildClientVariables()` 当前只在创建 session 时作为 `createSession.input` 写入 `SessionMetadata.input`。
- 后续 `invokeSession()` 请求不携带最新 client variables，所以长 session 切换 Project 后，profile 仍看到创建 session 时的旧 `ctx.input`。
- `variable_change` session entry 已存在，但 reduce 后只进入 `ctx.session.customState["variable:<key>"]`，尚未成为统一变量系统。
- 工具执行上下文 `ToolExecutionContext` 当前只有 `sessionId`、`workspaceRoot`、`workspaceKey`、`novelId` 等，不包含统一变量读写入口。
- 当前 `profileState.${profileKey}` 是 profile runtime state，只保存 TSX DSL 内部的 `ReminderState` / `WatchState`：
  - `reminders[id].fingerprint`
  - `reminders[id].injectedAtTurn`
  - `watches[key].hasValue`
  - `watches[key].value`
  - `watches[key].fingerprint`
- 当前 session 状态主要散在 `custom` entry 中，例如 `agent.tasks`、`plot.selection`、`agent.planMode`、`ui.planMode.active`、`profileState.${profileKey}`；`variable_change` 只是额外 reduce 到 `customState["variable:<key>"]` 的薄入口。

## Requirement Complexity Ranking

从低到高：

1. **本轮 frontend snapshot 注入 profile ctx**
   - 难度低到中。
   - 主要是给 invoke DTO / harness 增加 `clientState` 输入，并把 `ProjectReminder` 改到新 `client.*` root。
   - 风险是命名和 source-of-truth 要一次定好，否则会继续和 `ctx.input` 混淆。

2. **统一变量访问入口并挂到 `ctx`**
   - 难度中。
   - 需要把 DSL `readPath()`、TSX profile context、preview/workbench context 一起改成同一套变量访问对象。
   - 这是避免后续 hack 的核心。

3. **Workspace Root / Project / Session 持久变量**
   - 难度中到高。
   - 需要定义 storage location、合并优先级、schema 校验、读写 API、并发写入策略。
   - Project 级必须使用 Project Workspace 术语和路径，不再把 Project Workspace 简写成 workspace。

4. **Agent 修改前端状态**
   - 难度高。
   - 后端不能直接改浏览器内存，需要通过 session entry / SSE command / frontend apply pipeline 投递 patch。
   - 还要定义哪些 browser state 可写、写失败如何反馈、刷新页面后哪些状态持久化。

5. **用户自定义变量定义系统 `defineXXX`**
   - 难度高。
   - 不只是存 JSON，还要支持 schema、默认值、scope、权限、UI 暴露、profile 类型提示、迁移与冲突处理。
   - 做得太早会过度设计；应该先做最小可运行 registry，再扩 UI。

6. **端到端低代码 / Workbench 可视化编辑变量**
   - 难度最高。
   - 需要把变量 registry 暴露给 Workbench 物料、Inspector、自动补全、preview 和 round-trip。
   - 本任务第一阶段只记录接口，不强行完成完整 UI。

## Proposed Design

### 1. 概念拆分

`ctx` 与变量系统分层：

- **`ctx` 是 harness 注入给 profile 的上下文容器**
  - 它可以包含 `session`、`input`、`invocation`、`catalog`、`skills`、`runtime`、`vars` 等。
  - 其中很多内容只是只读上下文，不属于变量系统，例如 `catalog`、`skills`、profile `input`。

- **变量系统是 `ctx` 持有的一项能力**
  - 它负责可扩展变量的定义、读取、写入、持久化、前端同步、分支回退。
  - 变量系统不应该吞掉整个 `ctx`，否则会把静态 catalog、schema input 和运行状态混成一团。

对 profile 作者的推荐心智模型只保留三句话：

1. `ctx.input` 是这个 profile 的固定输入合同。
2. `<Variable />` / `<VariableObject />` 把变量放进模型上下文。
3. Agent 通过变量 patch 工具按 `VariableObject.id` 修改被显式暴露的 JSON object。

`ctx.vars.get()`、entry anchor、scope storage、fingerprint、frontend patch command 都是高级机制，普通 profile 不需要先理解。

变量相关数据分四类来源，不能再混进同一个 `ctx.input`：

- **Profile Input**
  - `ctx.input`
  - 来源：创建 profile/session 时的静态参数，或专门的 agent/profile 调用参数。
  - 用途：profile 自己定义的业务输入，例如 writer 的写作要求、chapterPaths。
  - 不承载浏览器状态。
  - 类型由 profile 的 `TInput` / `inputSchema` 决定，是 profile 的长期合同。

- **Invocation Input**
  - `ctx.invocation.input` 或 `ctx.runtime.invocationInput`
  - 来源：本次 invoke HTTP body。
  - 用途：用户本轮调用 harness 的一次性参数。
  - 本次先不并入变量系统。
  - 不改变 profile `TInput`，适合一次性调用参数，例如本轮 override、临时模式、外部调用 payload。
  - `ctx.invocation` 可以保留与 invocation HTTP body 接近的形状；即使 `clientState` 会被 harness 归一化进 `client.*` 变量，也允许在 `ctx.invocation.clientState` 中保留原始输入，方便高级 profile 读取本轮调用参数。

- **Variable Accessor**
  - `ctx.vars`
  - 来源：harness 根据 session、entry anchor、Workspace Root、Project Workspace 和 invocation client state 创建的变量管理器。
  - 用途：Profile / DSL / tool 读取和写入当前系统状态、用户自定义状态和前端状态。
  - 它不是一份裸 JSON snapshot；可以提供 `get`、`put`、`patch`、`delete`、`watch` 等方法，并能绑定 active path。

- **Session Context**
  - `ctx.session`
  - 来源：session JSONL reduce。
  - 用途：消息历史、profileKey、model、linkedAgents、plan mode、customState 等 session 运行事实。

### 2. `ctx` 新形态

建议把 `ProfilePrepareContext` 调整为：

```ts
type ProfilePrepareContext<TInput = JsonValue> = {
    session: NeuroSessionContext;
    input: TInput;
    invocation?: {
        input?: JsonValue;
        clientState?: ClientStateSnapshot;
    };
    vars: ProfileVariableAccessor;
    catalog: AgentCatalogSnapshot;
    skills: SkillCatalogItem[];
    runtime: {
        now: string;
        promptUserTurnCount: number;
        pendingUserMessage?: Message;
    };
};
```

`ctx.workspace` 不再保留。新 profile 必须使用 `ctx.vars`、`ctx.session` 或 TSX variable helper；本次重构硬切，不做 legacy alias。

`ctx.vars` 命名比 `ctx.variables` 更强调它是一个变量管理器，不是一份普通对象。当前先直接把 `ProfileVariableAccessor` 给 profile 使用；未来如果需要收紧副作用，可以再包装出只读版本。若后续希望 profile 写法更直观，可以同时提供 snapshot alias：

```ts
ctx.vars.snapshot.client.currentProjectWorkspace
```

但推荐 profile 运行逻辑和 Reminder / Watch 使用方法式 API：

```ts
await ctx.vars.get("client.currentProjectWorkspace")
await ctx.vars.put("session.planMode.lastReminder", value)
```

文档和模板中默认不展示 `ctx.vars.put()`。写变量优先引导到 `VariableObject` + Agent patch tool；直接 `ctx.vars.put()` 只给高级 profile / tool 作者使用。

### 3. 变量 scope

公开变量 scope 固定为四个：

- `client`
  - 当前客户端/前端运行态。
  - 默认 volatile，每次 invoke 由前端传最新 snapshot。
  - 示例：theme、activePanel、editorFont、selectedFilePath、selectionVersion、currentProjectWorkspace。
  - 写入时不直接改后端文件，而是生成前端 patch，由浏览器 apply。

- `global`
  - Workspace Root 级持久变量，对用户心智表达为全局变量。
  - 存储位置：`workspace/.nbook/agent/variables.json`。
  - 示例：全局用户偏好、跨 Project 共享变量、用户自定义全局状态。

- `project`
  - Project Workspace 级持久变量。
  - 存储位置：`workspace/{project}/.nbook/agent/variables.json`。
  - 示例：当前小说/project 的自定义状态、角色好感度、项目阶段。

- `session`
  - 当前 agent session 级变量。
  - 存储位置：session JSONL entry。
  - 示例：本 session 临时偏好、profile runtime state、当前 agent 任务状态。
  - 必须绑定 active path；当用户切换分支、retry 或 move tree 时，变量视图要跟随 entry 回退。

### 4. 变量定义 API

建议使用 registry + define 风格：

```ts
export const browserStateScope = defineVariableScope({
    key: "client",
    level: "client",
    storage: "volatile",
    writableBy: ["frontend", "agent"],
});

export const projectVariablesScope = defineVariableScope({
    key: "project",
    level: "project",
    storage: "project-workspace",
    writableBy: ["frontend", "agent", "user"],
});

export const affectionVariable = defineVariable({
    scope: projectVariablesScope,
    key: "affection",
    schema: Type.Record(Type.String(), Type.Number()),
    defaultValue: {},
});
```

第一版只需要 runtime registry，不强求生成完整类型文件。后续再把 registry 输出给 Workbench / LSP / profile 类型提示。

为了降低使用成本，推荐提供几个内建 helper：

```ts
defineWorkspaceRootVariable(...)
defineProjectVariable(...)
defineSessionVariable(...)
defineClientState(...)
```

它们内部仍然调用统一的 `defineVariable()`，但 profile / app 代码不必每次手写 scope、storage 和 writable policy。

### 5. 变量访问对象

提供给 profile 的变量系统不是裸对象，而是绑定当前 session/entry 的 accessor：

```ts
type ProfileVariableAccessor = {
    anchor: {
        sessionId: number;
        leafId: string | null;
        entryId?: string;
    };
    snapshot: VariableSnapshot;
    get<T = JsonValue>(path: VariablePath<T>): T | undefined;
    require<T = JsonValue>(path: VariablePath<T>): T;
    put<T = JsonValue>(path: WritableVariablePath<T>, value: T): Promise<void>;
    patch<T = JsonValue>(path: WritableVariablePath<T>, patch: Partial<T>): Promise<void>;
    delete(path: WritableVariablePath): Promise<void>;
};
```

绑定策略：

- **统一使用 Entry-bound accessor**
  - 不再设计两套 session-bound / entry-bound API。
  - 默认用于 profile prepare、tools、ingest 的 accessor 绑定当前 active leaf。
  - 读 session 变量时 reduce 到 anchor entry；如果 anchor 是当前 leaf，就等价于当前 session active path。
  - 写 session 变量时追加到 anchor 之后的新 leaf，因此自然参与分支和回退。
  - preview、retry、tree move 后 invoke 可以显式传入目标 entry anchor，避免再引入第二套读取语义。

- **Workspace Root / Project-bound accessor**
  - 读写持久文件，不随 session branch 回退。
  - 适合全局偏好、Project 自定义状态、用户定义长期变量。

### 6. Writable Policy

`writableBy` 用来表达变量定义允许哪些主体写入：

```ts
writableBy: ["frontend", "agent", "user"]
```

含义：

- `frontend`
  - 前端 UI 可以写入，通常用于设置面板、编辑器状态、用户交互产生的状态。
  - 示例：编辑器字体、主题、面板布局。

- `agent`
  - Agent / profile / tool 可以写入，通常通过变量 patch 工具或 `ctx.vars.patch()`。
  - 示例：任务状态、角色好感度、项目阶段、agent 自己维护的 session 变量。

- `user`
  - 用户可以直接编辑变量文件或通过 user-assets / 低代码界面修改。
  - 示例：自定义项目变量、手动设定世界观状态、全局偏好。

第一版 `writableBy` 主要用于：

- 运行时写入校验，拒绝未授权主体修改变量。
- UI 决定哪些变量可编辑、哪些只读。
- Workbench / profile editor 给出可写提示。
- 后续审计和冲突提示，例如 Agent 修改了用户可编辑变量。

它不是安全沙箱；本项目的本地 Agent 代码仍是受信任代码。它的重点是合同表达、UI 行为和避免误写。

### 7. 读写模型

读取：

- Harness 在每次 invoke 前创建 `ProfileVariableAccessor`。
- 组装顺序：
  1. 读取 Workspace Root 级 `global` 变量。
  2. 按当前 Project Workspace 读取 Project 变量。
  3. 从 session active path reduce Session 变量。
  4. 合并本次 invocation 携带的 client snapshot。
- Profile 和 DSL 通过 `ctx.vars` 读取变量；只读插值可使用 `ctx.vars.snapshot.*`。

写入：

- 后端写持久变量时追加明确 entry 或调用变量服务：
  - `ctx.vars.put(path, value)`
  - `ctx.vars.patch(path, patch)`
  - `ctx.vars.delete(path)`
- Session 级变量写入 session JSONL。
- Workspace Root / Project 级变量写入对应 `.nbook/agent/variables` 文件，并发写入需要走同一个 service。
- Client 级变量写入不直接改文件；后端追加 `frontend_variable_patch` 或通用 `ui_command` session entry，经 SSE 投递给前端，前端 apply 后再在下一轮 invoke 回传最新 snapshot。

变量 patch：

- Agent 变量 patch 工具第一版使用 JSON Patch（RFC 6902）作为操作格式。
- 工具输入包含目标 scope/path 和 patch operations。
- Patch 前后都经过变量定义 schema 校验。
- 后续调研 LLM 友好的 JSON Patch 生成、约束和修复库；候选记录：
  - JSON-Whisperer: https://github.com/emnlp2025/JSON-Whisperer
  - Paper: https://arxiv.org/html/2510.04717v1

### 8. Reminder / Watch 与变量系统

`Reminder` / `Watch` 应改为建立在 `ctx.vars` 的通用 path resolver 上。

目标：

- `Watch` 可以监听几乎所有可读变量路径，例如：
  - `client.currentProjectWorkspace`
  - `client.selectedFilePath`
  - `session.planMode.active`
  - `project.affection.hero`
  - `global.userPreferences.editorFont`
- `Reminder` 可以用同一套 `ctx.vars.get()` 计算 fingerprint，不再单独理解 `ctx.input`、`ctx.workspace` 等特殊来源。
- 需要读非变量上下文时，仍可显式使用 `ctx.session.*`、`ctx.input.*`、`ctx.runtime.*`，但这是 ctx path，不是 variable path。

为了降低心智负担，字符串 `watchPath` 只接受变量路径：

- `client.*`
- `global.*`
- `project.*`
- `session.*`

如果确实需要监听 `ctx.input`、`ctx.runtime` 或其他非变量上下文，使用函数形式：

```tsx
<Watch watch={(ctx) => ctx.input.foo} />
```

这样普通 profile 作者只需要学习一种字符串路径。

### 9. Profile 注入变量的 TSX Node / Helper

Profile 作者不应该必须手写底层 `ctx.vars.get()` 才能把变量放进 prompt。第一版新增 TSX Node / Helper：

```tsx
<Variable path="client.currentProjectWorkspace" />
<Variable path="project.affection.hero" fallback="unknown" />
<Variable title="Project variables" paths={["project.affection", "project.stage"]} render="block" />
<VariableObject id="hero-affection" path="project.affection.people1" title="People 1 affection" writable />
```

建议能力：

- `Variable`：读取一个或多个变量；单个变量默认渲染为 string，多变量或 `render="block"` 时渲染为稳定 JSON / Markdown block。
- `VariableObject`：暴露一个 JSON object，渲染当前值，并注册一个可由 Agent 工具更新的 object binding。
- `VariableWatch` 或扩展现有 `Watch`：监听变量路径变化。
- `VariableReminder` 或扩展现有 `Reminder`：基于变量 fingerprint 触发提醒。

底层仍然使用 `ctx.vars.get()`；TSX Node 只负责让 profile 书写更直观。

第一版对普通 profile 推荐只使用两个节点：

- `Variable`：读一个或一组变量。
- `VariableObject`：暴露一个可由 Agent 修改的 JSON object。

`VariableWatch` / `VariableReminder` 可以先作为 `Watch` / `Reminder` 的变量 path 能力存在，不急着增加新的节点名，避免节点数量膨胀。

放置规则：

- `Variable` 可放在 `ModelContext`；如果变量来源稳定，也可以按需放在普通 message 区域。
- 不推荐把变量 helper 放入 `System` / `HistorySet`，除非作者明确知道该变量不会频繁变化。
- `VariableObject writable` 第一版只允许放在 `ModelContext`。
- `VariableObject writable` 不允许放在 `System`、`HistorySet`、`AppendingSet`。
- 原因：`VariableObject` 几乎每轮都会变化，且会注册本轮可写 binding；放进 provider system prompt、首轮历史初始化或 session appending 都会破坏缓存、污染历史或造成重复动态消息。

`VariableObject` 设计：

```tsx
<VariableObject
    id="people1-affection"
    path="project.affection.people1"
    title="People 1 affection"
    writable
/>
```

渲染时做两件事：

1. 把当前 JSON object 注入 prompt / model context，例如稳定 JSON block。
2. 在本轮 `ctx.vars` 或 turn plan 中注册 binding：
   - `id`: profile 内稳定 id，例如 `people1-affection`。
   - `path`: 真实变量路径，例如 `project.affection.people1`。
   - `scope`: `project` / `session` / `global` / `client`。
   - `schema`: 从变量定义或 helper props 推导。
   - `writable`: 是否允许 Agent 更新。
   - `fingerprint` / `revision`: 当前值 hash，用于防止基于旧 JSON 误 patch。

Agent 工具不直接接收任意变量 path，而是接收 helper binding id：

```json
{
  "targetId": "people1-affection",
  "patch": [
    {"op": "replace", "path": "/score", "value": 42}
  ],
  "baseFingerprint": "..."
}
```

这样 profile 作者能控制哪些变量暴露给 Agent 更新，也能在同一个 profile 中放多个 helper。规则：

- 同一轮 render 内 `VariableObject.id` 必须唯一；重复 id 直接 profile contract error。
- 允许多个 helper 指向不同变量 path。
- 允许多个 helper 指向同一个 path，但需要不同 id；用于给同一对象提供不同 prompt 视图时仍能明确目标。
- 可写 `VariableObject` 必须有 schema；schema 来自变量定义或 helper props，缺失时报 profile contract error。
- 工具执行时必须校验 binding 仍存在、`writable` 为 true、变量定义允许 `writableBy: ["agent"]`。
- Patch 前后都要跑 schema 校验；失败时返回 tool error，不写变量。
- 如果提供 `baseFingerprint`，当前值已变化时拒绝 patch，让 Agent 重新读取后再改。

优化点：

- `VariableObject` 不应成为变量真相源；它只是“把变量暴露给模型并注册可写 handle”。真相仍在 `ctx.vars` 和变量 storage。
- 工具目标应优先使用 helper `id`，不要让 Agent 默认 patch 任意 path；后续可以给高级模式开放 path，但默认不推荐。
- 大对象需要支持 `render="summary"` 或 `pick={["score", "notes"]}`，避免把整个变量树塞进 prompt。
- 对 client 变量的 `writable` 要更谨慎：工具 patch 后应产出 frontend patch command，由前端 apply，而不是后端假装已改成功。

### 10. Frontend State 同步

前端需要有一个统一的 snapshot builder：

```ts
buildAgentClientState(): ClientStateSnapshot
```

它不再叫 profile input，也不直接塞进 `ctx.input`。invoke 请求增加：

```ts
{
    mode: "prompt",
    message: {text},
    clientState: buildAgentClientState()
}
```

`continue`、tool approval、user input resolution、tree next invoke 也必须携带同样的 `clientState`，否则 prepare 看到的仍可能是旧 UI 状态。

### 11. DSL Path

DSL `watchPath` 建议支持：

- `ctx.session.*`
- `ctx.input.*`
- `ctx.invocation.*`
- `ctx.runtime.*`
- `ctx.vars.client.*`
- `ctx.vars.global.*`
- `ctx.vars.project.*`
- `ctx.vars.session.*`
- `ctx.vars.snapshot.*`

不保留 `ctx.workspace.*` alias。需要 Project Workspace 时使用变量系统：

- `ctx.vars.client.currentProjectWorkspace`
- `ctx.vars.get("client.currentProjectWorkspace")`

### 12. ProjectReminder 修复目标

`ProjectReminder` 不应继续读 `ctx.input.studio.workspace`。

目标改为：

```ts
watchPath: "client.currentProjectWorkspace"
```

不提供 `ctx.workspace.currentProject` legacy fallback。

## Implementation Plan

1. 建立变量术语和类型
   - 新增 `VariableScope`、`VariableDefinition`、`VariableSnapshot`、`ProfileVariableAccessor`、`ClientStateSnapshot`。
   - 明确 `ctx.input`、`ctx.invocation`、`ctx.vars` 的职责边界。
   - Accessor 统一为 entry-bound，默认 anchor 当前 active leaf。
   - 同步 profile 作者心智模型：固定输入用 `ctx.input`，读变量用 TSX helper，写变量用 `VariableObject.id`。

2. 改 invocation DTO 与前端同步
   - `AgentInvokeRequestDto` 增加 `clientState`。
   - `NovelAgentDrawer` 所有 invoke 入口传最新 `buildAgentClientState()`。
   - 先不把业务 input 并入变量系统。

3. 改 harness prepare context
   - 每轮 invoke 前创建绑定当前 session active path 的 `ProfileVariableAccessor`。
   - `ProfilePrepareContext` 增加 `vars` 和 `invocation`。
   - snapshot system prompt 若没有当前 invocation，则使用空 browser state 或最后已知 browser state，避免 snapshot 有副作用。

4. 改 DSL path resolver
   - `watchPath` 字符串只支持变量路径：`client.*`、`global.*`、`project.*`、`session.*`。
   - 删除 `ctx.workspace.*` 支持。
   - `ProjectReminder` 迁到新 path。
   - 新增 `Variable` TSX Node Helper，支持单变量和多变量 block 渲染。
   - 新增 `VariableObject`，但第一版只允许在 `ModelContext`。

5. 落 session 级变量写入
   - 收口现有 `variable_change`，决定是否重命名为 `variable_set`。
   - reduce 后进入 `ctx.vars.snapshot.session`，不再只藏在 `customState["variable:<key>"]`。
   - Reminder / Watch 的 `profileState.${profileKey}` 第一版不并入 session variables；后续单独评估。

6. 落 Workspace Root / Project 持久变量服务
   - 新增变量文件读写 service。
   - 支持 schema 校验和默认值。
   - Workspace Root 级变量第一版写入 `workspace/.nbook/agent/variables.json`。
   - Project 级变量第一版写入 `workspace/{project}/.nbook/agent/variables.json`。
   - 暂不做复杂 UI。

7. 前端状态写回
   - 新增后端到前端的 UI patch/session entry。
   - 前端 apply 后更新本地 store。
   - 下一轮 invoke 回传最新 client state。

8. Agent 变量 patch 工具
   - 新增 JSON Patch 变量修改工具。
   - 默认通过 `VariableObject.id` 定位目标变量 binding，不鼓励 Agent 直接 patch 任意 path。
   - Patch 前后执行 schema 校验。
   - 支持 `baseFingerprint` / revision 防止 stale patch。
   - 记录 JSON-Whisperer 等 LLM JSON Patch 相关资料，后续决定是否引入。

9. 文档和测试
   - 更新 harness/profile 文档。
   - 增加 ProjectReminder 跨 Project 触发测试。
   - 增加 invoke clientState 传递测试。

## Decisions

- `ctx.input` 不再承载浏览器状态。
- `invoke` 的业务 input 本次先不进入变量系统。
- `client` state 是变量系统的一个内建 volatile scope。
- `ctx` 与变量系统不等价；`ctx` 是 harness 注入容器，变量系统以 `ctx.vars` 的形式被持有。
- 提供给 profile 的变量系统统一为 entry-bound accessor，而不是裸 JSON snapshot。
- `TInput` 是 profile 的长期输入合同；`invocation.input` 是本次 invoke 的一次性输入，不应混用。
- Workspace Root 级持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`。
- Project 级持久变量第一版使用单文件 `workspace/{project}/.nbook/agent/variables.json`。
- 对外变量根使用 `global.*` 表达 Workspace Root 级变量，降低用户心智负担；存储位置仍是 Workspace Root `.nbook`。
- 变量写权限用 `writableBy` 表达，第一版用于合同、UI 和运行时写入校验，不作为安全沙箱。
- Profile 注入变量通过新增 TSX Node / Helper 提供易用入口，底层仍使用 `ctx.vars`。
- 变量读取 helper 只保留 `Variable`；`VariableBlock` 合并为 `Variable render="block"` / `paths` 模式。
- `VariableObject` helper 可以暴露可写 JSON object；Agent 通过 helper id 和 JSON Patch 工具修改变量。
- 可写 `VariableObject` 必须有 schema，不能无 schema 写入。
- `VariableObject writable` 第一版只允许放在 `ModelContext`，不允许放在 `System`、`HistorySet`、`AppendingSet`。
- Agent 修改变量通过 JSON Patch 工具完成。
- Project Workspace 相关变量必须使用 Project Workspace 术语，不把它简写成 workspace。
- Agent 修改前端状态必须通过显式 patch/event 管线，不能在后端假装直接修改浏览器内存。
- 不保留 `ctx.workspace` legacy alias；本次变量系统重构硬切。
- `profileState.${profileKey}` 当前只保存 Reminder / Watch 内部 runtime state；第一版不迁入 session variables。
- 对外心智模型要一次性收紧：不保留 legacy alias，不推荐直接 patch 任意 path，不让普通 profile 作者理解 runtime state。

## Files Changed

- `docs/tasks/10-agent-variable-system/README.md`

## Verification

- 本次只创建设计任务文档，未改运行代码。

## TODO / Follow-ups

- 根据本文档继续 grill frontend writable state 权限。
- 决定 `variable_change` 是否保留名称，还是硬切为更明确的 `variable_set` / `variable_patch`。
- 调研 JSON Patch 与 LLM 结构化编辑库，包含 JSON-Whisperer。
- 后续评估是否把 `profileState.${profileKey}` 迁入 `session.profileState.*`。
