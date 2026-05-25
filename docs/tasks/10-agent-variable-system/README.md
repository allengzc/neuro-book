# Agent Variable System Refactor

## User Request

- 系统性重构 Agent 变量系统，不用临时 hack 修 ProjectReminder。
- Profile / Agent 能访问前端状态，例如 browser state、编辑器字体、当前面板、选中文件等，并且能修改前端状态。
- 变量系统需要统一、易扩展，后续增加变量不应再散落修改 DTO、profile DSL、harness 和前端状态映射。
- 支持用户自定义变量，至少分为 Workspace Root 级、Project 级、Session 级。
- `invoke` 请求的业务 input 暂时不走变量系统；harness 可以直接从 invocation 接口拿到。
- 希望通过 `defineXXX` 风格定义变量 scope；前端 state 也可以归为一个内建 scope；用户后续可定义自己的变量，例如“好感度”。
- `ctx` 与变量系统要明确区分：`ctx` 是 harness 注入给 profile 的完整上下文容器，变量系统只是 `ctx` 可以持有的一项能力；`catalog`、`input` 等可读数据不应被强行归入变量系统。
- 提供给 profile 的变量对象应能绑定 session 或 entry，使变量读写跟随 active path 回退；同时提供 `get`、`put` 等实用方法，让 `Reminder` / `Watch` 可以基于统一变量路径实现，而不是各自写特殊逻辑。
- 持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`，暂不拆成多个 JSON 文件。
- Profile 注入变量时优先通过新增 TSX Node / Helper，让 profile 作者不用手写底层 `ctx.vars.get()`。
- Agent 修改变量使用 JSON Patch 工具；后续调研 LLM 友好的 JSON Patch 生成/修复库，记录候选：JSON-Whisperer（https://github.com/emnlp2025/JSON-Whisperer，https://arxiv.org/html/2510.04717v1）。

## Goal

- 建立一个统一变量模型，让 profile、harness、工具和前端 UI 都通过同一套 scope / schema / storage / sync 合同读写变量，同时保留 `ctx` 作为 harness 注入上下文容器的更大边界。
- 把 `ctx.input` 从“浏览器状态临时载体”中解放出来，保留为 profile 静态 input 或一次性 invocation 业务 input。
- 让 ProjectReminder 这类“依赖当前 Project Workspace 的运行时提醒”读取本轮最新 frontend/browser snapshot，而不是读取 session 创建时的旧 input。
- 为后续用户自定义变量、低代码 profile、前端状态修改、跨 session/project 状态复用留下稳定扩展点。
- 让变量访问对象统一绑定 entry anchor，默认 anchor 是当前 active leaf，确保回退、分支切换、retry 时变量视图和消息历史一致。

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

## Requirement Complexity Ranking

从低到高：

1. **本轮 frontend snapshot 注入 profile ctx**
   - 难度低到中。
   - 主要是给 invoke DTO / harness 增加 `clientState` 或 `variables.browser` 输入，并把 `ProjectReminder` 改到新 root。
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

- **Variable Accessor**
  - `ctx.vars`
  - 来源：harness 根据 session、entry anchor、Workspace Root、Project Workspace 和 invocation client state 创建的变量访问对象。
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

`ctx.workspace` 不再作为真实 source-of-truth。可以保留为兼容型 convenience alias，但其值应来自 `ctx.vars` 读到的 browser / project 变量，而不是 `ctx.input`。

`ctx.vars` 命名比 `ctx.variables` 更强调它是一个访问对象，不是一份普通对象。若后续希望 profile 写法更直观，可以同时提供只读 snapshot alias：

```ts
ctx.vars.snapshot.browser.currentProjectWorkspace
```

但推荐 profile 运行逻辑和 Reminder / Watch 使用方法式 API：

```ts
await ctx.vars.get("browser.currentProjectWorkspace")
await ctx.vars.put("session.planMode.lastReminder", value)
```

### 3. 变量 scope

内建 scope：

- `browser`
  - 当前浏览器/前端运行态。
  - 默认 volatile，每次 invoke 由前端传最新 snapshot。
  - 示例：theme、activePanel、editorFont、selectedFilePath、selectionVersion、currentProjectWorkspace。
  - 写入时不直接改后端文件，而是生成前端 patch，由浏览器 apply。

- `workspaceRoot`
  - Workspace Root 级持久变量。
  - 存储位置：`workspace/.nbook/agent/variables.json`。
  - 示例：全局用户偏好、跨 Project 共享变量、用户自定义全局状态。

- `project`
  - Project Workspace 级持久变量。
  - 存储位置建议：`workspace/{project}/.nbook/agent/variables/*.json` 或单文件 `workspace/{project}/.nbook/agent/variables.json`。
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
    key: "browser",
    level: "browser",
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
  1. 读取 Workspace Root 变量。
  2. 按当前 Project Workspace 读取 Project 变量。
  3. 从 session active path reduce Session 变量。
  4. 合并本次 invocation 携带的 browser snapshot。
- Profile 和 DSL 通过 `ctx.vars` 读取变量；只读插值可使用 `ctx.vars.snapshot.*`。

写入：

- 后端写持久变量时追加明确 entry 或调用变量服务：
  - `ctx.vars.put(path, value)`
  - `ctx.vars.patch(path, patch)`
  - `ctx.vars.delete(path)`
- Session 级变量写入 session JSONL。
- Workspace Root / Project 级变量写入对应 `.nbook/agent/variables` 文件，并发写入需要走同一个 service。
- Browser 级变量写入不直接改文件；后端追加 `frontend_variable_patch` 或通用 `ui_command` session entry，经 SSE 投递给前端，前端 apply 后再在下一轮 invoke 回传最新 snapshot。

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
  - `browser.currentProjectWorkspace`
  - `browser.selectedFilePath`
  - `session.planMode.active`
  - `project.affection.hero`
  - `workspaceRoot.userPreferences.editorFont`
- `Reminder` 可以用同一套 `ctx.vars.get()` 计算 fingerprint，不再单独理解 `ctx.input`、`ctx.workspace` 等特殊来源。
- 需要读非变量上下文时，仍可显式使用 `ctx.session.*`、`ctx.input.*`、`ctx.runtime.*`，但这是 ctx path，不是 variable path。

建议区分两类 path：

- `VariablePath`：`browser.*`、`workspaceRoot.*`、`project.*`、`session.*`
- `CtxPath`：`ctx.session.*`、`ctx.input.*`、`ctx.runtime.*`、`ctx.vars.*`

DSL `watchPath` 可以继续接受 `CtxPath`，但内部遇到 `ctx.vars.*` 或变量短路径时统一委托给 `ctx.vars.get()`。

### 9. Profile 注入变量的 TSX Node / Helper

Profile 作者不应该必须手写底层 `ctx.vars.get()` 才能把变量放进 prompt。第一版新增 TSX Node / Helper：

```tsx
<Variable path="browser.currentProjectWorkspace" />
<Variable path="project.affection.hero" fallback="unknown" />
<VariableBlock title="Project variables" paths={["project.affection", "project.stage"]} />
```

建议能力：

- `Variable`：读取单个变量，渲染为 string。
- `VariableBlock`：读取一组变量，渲染为稳定 JSON 或 Markdown block。
- `VariableWatch` 或扩展现有 `Watch`：监听变量路径变化。
- `VariableReminder` 或扩展现有 `Reminder`：基于变量 fingerprint 触发提醒。

底层仍然使用 `ctx.vars.get()`；TSX Node 只负责让 profile 书写更直观。

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
- `ctx.vars.browser.*`
- `ctx.vars.workspaceRoot.*`
- `ctx.vars.project.*`
- `ctx.vars.session.*`
- `ctx.vars.snapshot.*`

`ctx.workspace.*` 作为 convenience alias：

- `ctx.workspace.root` -> `ctx.session.workspaceRoot`
- `ctx.workspace.currentProject` -> `ctx.vars.get("browser.currentProjectWorkspace")`
- `ctx.workspace.novelId` -> `ctx.vars.get("browser.novelId") ?? ctx.session.novelId`

### 12. ProjectReminder 修复目标

`ProjectReminder` 不应继续读 `ctx.input.studio.workspace`。

目标改为：

```ts
watchPath: "ctx.vars.browser.currentProjectWorkspace"
```

或短期 alias：

```ts
watchPath: "ctx.workspace.currentProject"
```

但 alias 内部必须来自本轮 `clientState`，不是 session 创建时的 metadata input。

## Implementation Plan

1. 建立变量术语和类型
   - 新增 `VariableScope`、`VariableDefinition`、`VariableSnapshot`、`ProfileVariableAccessor`、`ClientStateSnapshot`。
   - 明确 `ctx.input`、`ctx.invocation`、`ctx.vars` 的职责边界。
   - Accessor 统一为 entry-bound，默认 anchor 当前 active leaf。

2. 改 invocation DTO 与前端同步
   - `AgentInvokeRequestDto` 增加 `clientState`。
   - `NovelAgentDrawer` 所有 invoke 入口传最新 `buildAgentClientState()`。
   - 先不把业务 input 并入变量系统。

3. 改 harness prepare context
   - 每轮 invoke 前创建绑定当前 session active path 的 `ProfileVariableAccessor`。
   - `ProfilePrepareContext` 增加 `vars` 和 `invocation`。
   - snapshot system prompt 若没有当前 invocation，则使用空 browser state 或最后已知 browser state，避免 snapshot 有副作用。

4. 改 DSL path resolver
   - `readPath()` 支持 `ctx.vars.*`。
   - `ctx.workspace.currentProject` 改为读取变量 alias。
   - `ProjectReminder` 迁到新 path。
   - 新增 `Variable` / `VariableBlock` TSX Node Helper。

5. 落 session 级变量写入
   - 收口现有 `variable_change`，决定是否重命名为 `variable_set`。
   - reduce 后进入 `ctx.vars.snapshot.session`，不再只藏在 `customState["variable:<key>"]`。

6. 落 Workspace Root / Project 持久变量服务
   - 新增变量文件读写 service。
   - 支持 schema 校验和默认值。
   - Workspace Root 级变量第一版写入 `workspace/.nbook/agent/variables.json`。
   - 暂不做复杂 UI。

7. 前端状态写回
   - 新增后端到前端的 UI patch/session entry。
   - 前端 apply 后更新本地 store。
   - 下一轮 invoke 回传最新 browser state。

8. Agent 变量 patch 工具
   - 新增 JSON Patch 变量修改工具。
   - Patch 前后执行 schema 校验。
   - 记录 JSON-Whisperer 等 LLM JSON Patch 相关资料，后续决定是否引入。

9. 文档和测试
   - 更新 harness/profile 文档。
   - 增加 ProjectReminder 跨 Project 触发测试。
   - 增加 invoke clientState 传递测试。

## Decisions

- `ctx.input` 不再承载浏览器状态。
- `invoke` 的业务 input 本次先不进入变量系统。
- `browser` state 是变量系统的一个内建 volatile scope。
- `ctx` 与变量系统不等价；`ctx` 是 harness 注入容器，变量系统以 `ctx.vars` 的形式被持有。
- 提供给 profile 的变量系统统一为 entry-bound accessor，而不是裸 JSON snapshot。
- `TInput` 是 profile 的长期输入合同；`invocation.input` 是本次 invoke 的一次性输入，不应混用。
- Workspace Root 级持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`。
- 变量写权限用 `writableBy` 表达，第一版用于合同、UI 和运行时写入校验，不作为安全沙箱。
- Profile 注入变量通过新增 TSX Node / Helper 提供易用入口，底层仍使用 `ctx.vars`。
- Agent 修改变量通过 JSON Patch 工具完成。
- Project Workspace 相关变量必须使用 Project Workspace 术语，不把它简写成 workspace。
- Agent 修改前端状态必须通过显式 patch/event 管线，不能在后端假装直接修改浏览器内存。

## Files Changed

- `docs/tasks/10-agent-variable-system/README.md`

## Verification

- 本次只创建设计任务文档，未改运行代码。

## TODO / Follow-ups

- 根据本文档继续 grill 变量命名、scope 存储路径和 frontend writable state 权限。
- 决定 `variable_change` 是否保留名称，还是硬切为更明确的 `variable_set` / `variable_patch`。
- 决定 `ctx.workspace` 是否长期保留 alias，还是迁移完 `ProjectReminder` 后逐步移除。
- 调研 JSON Patch 与 LLM 结构化编辑库，包含 JSON-Whisperer。
