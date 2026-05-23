# Leader Profile v2 Adaptation

## User Request

- 先制定实现计划，并把实现计划写到 task 文件夹。
- 后续要完整适配 v2 的 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`，目标落点是当前 v3 assets profile。
- 当前阶段继续更新计划文档，并用 `$grill-with-docs` 审问关键设计。
- 用户明确纠偏：harness 要改成刚刚决定的新架构，不能把现有 `PreparedTurn` 字段和当前实现顺序当作目标架构。
- 最新目标拆成四条主线：
  - 实现新设计的 harness 架构。
  - 改造 Profile 机制和 TSX DSL。
  - 迁移 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`。
  - 同步改造 TSX 可视化编辑器前端。

## Scope Update

本任务不再只是“把 v2 leader prompt 搬到 v3 profile”。它要把 `leader.default` 迁移作为 tracer bullet，一次性打通四个必须同时成立的面：

1. Harness 架构：按新 contract 重建 invoke、profile prepare、pre-loop session 写入、ReAct loop 输入组装、SSE 前端同步和 session 持久化边界。
2. Profile 机制：把 `.profile.tsx`、`defineAgentProfile`、TypeBox schema、allowed tools、TSX DSL、preview/check/catalog 统一成当前 v3 的正式 profile contract。
3. Leader 迁移：把 v2 `leader-default.profile.tsx` 的核心协作语义迁到当前 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，同时移除旧工具名诱导。
4. TSX 可视化编辑器：把 Workbench 从“辅助编辑 systemPrompt 字符串”升级为“围绕新 TSX Profile DSL 做源码真相源下的结构化辅助编辑”。

这四条线不能拆成互不相干的小修：如果 harness 不支持 pre-loop AppendingSet 写入，前端看不到 system reminder；如果 Profile DSL 不定，leader 迁移只能退化成大字符串；如果 Workbench 不跟着改，用户 profile 编辑入口会继续停留在旧 systemPrompt range 模型。

## Latest Harness Alignment

已按最新 [Agent Harness](../../modules/agent/harness.md) 重新校准本计划。这里记录本任务必须实现的目标语义，避免把当前代码里的过渡字段当成长期合同：

- 当前实现事实仍是 `PreparedTurn`：`systemPrompt`、`historyMessages`、`dynamicMessages`、`appendingMessages`、`toolKeys`、`sessionWrites`。
- 目标底层合同是 `ProfileTurnPlan`：`systemPrompt`、`historyInitMessages`、`appendingMessages`、`modelContextMessages`、`stateWrites`。
- `prepare()` / DSL compiler 不返回最终 `messages` / `contextMessages`，也不返回同时含 history 的 context 与单独 history seed。
- 工具集合不再通过 `prepare()` 返回；harness 只读 `profile.allowedToolKeys`，再按 runtime registry 和目标 profile 派生动态工具 schema。
- Pre-loop 写入由 harness 统一提交：`historyInitMessages` 只在未初始化时写入；`appendingMessages` 每轮写入 session；`stateWrites` 只写受控 profile/session state；随后 prompt invocation 的真实用户消息写入 session。
- 前端可见顺序必须保持：Profile 产生的可见 AppendingSet 消息先进入 session，然后是真实用户消息，然后才是 ReAct loop 的 streaming assistant/toolResult。
- ReAct loop 输入由 harness 在 pre-loop 写入后重新 reduce session 得到：`reduced session messages + modelContextMessages`。
- `modelContextMessages` 是旧 `dynamicMessages` 的目标形态：只影响本轮模型上下文，不进入 session，也不显示在前端历史里。TSX DSL 层直接硬切 `DynamicSet`，不提供公开迁移别名。
- Profile 生成的可见上下文写入 session 时使用 `custom_message visibleToModel: true`；`custom_message` 是 session entry 标记，内部仍必须携带 provider 可接受的 `user` / `assistant` / `toolResult` message。
- `ingest` 本阶段仍不负责 assistant/toolResult 归档策略；loop 内 `message_end` 继续由 harness 持久化，保证 SSE、waiting approval/input 和 resume 一致。

## Goal

- 以 [Agent Harness](../../modules/agent/harness.md) 文档为基础，把 invoke -> profile prepare -> pre-loop session 写入 -> ReAct loop -> SSE -> session 持久化的边界设计稳定下来。
- 借 `leader.default` 适配把当前 TSX Profile 机制完整定下来，而不是只把 v2 prompt 文案搬进现有 `prepare()` 返回值。
- 重新支持并优化 TSX Profile JSX DSL，让 v2 `ProfilePrompt` / `HistorySet` / `DynamicSet` / `AppendingSet` / `Reminder` / `Watch` / `SkillCatalog` / `ActivatedSkills` 等节点都有清晰的新规范和 active runtime 实现。
- 把 v2 `leader.default` 的核心协作、写作、workspace、多 agent 和提示词分层语义迁移到当前 Pi-based `server/agent` profile contract。
- 让 TSX Profile Workbench / 可视化编辑器从“只替换 systemPrompt 字符串”升级到围绕新 TSX DSL 做源码与结构化辅助编辑。
- 迁移后 `leader.default` 仍通过动态 profile catalog 从 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 加载，并允许 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 用户覆盖。
- 旧 v2 工具以后再迁移。本任务可以先定义 Plot System、task、SQL 等能力在 Profile DSL 中的表达边界，但不恢复不存在的旧工具调用。
- 在适配过程中持续发现当前 v3 profile/harness 的缺口，并把需要后续 runtime 支持的问题记录为 TODO，而不是用 prompt hack 掩盖。

## Current State Before This Task

- v2 源 profile：`server/agent-v2/profiles/builtin/leader-default.profile.tsx`。
- v3 系统 profile：`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`。
- v3 用户覆盖 profile：`workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，如果存在且内容仍是旧压缩版，需要同步，否则用户覆盖会遮蔽系统修复。
- 迁移前的 v3 profile contract 是 `defineAgentProfile({ manifest, inputSchema, outputSchema, allowedToolKeys, prepare, ingest? })`，`prepare(ctx)` 返回旧 `PreparedTurn`：
  - `systemPrompt`
  - `historyMessages`
  - `dynamicMessages`
  - `appendingMessages`
  - `toolKeys`
  - `sessionWrites`
- 以上字段只描述迁移前事实，不是本任务要保留的目标接口。新 harness 不应继续让 profile 直接返回 `toolKeys`、任意 `sessionWrites` 或已经混好历史的最终 `messages`。
- 当前 v3 runtime 不执行 v2 的 `ProfilePrompt` / `HistorySet` / `DynamicSet` / `AppendingSet` / `Reminder` / `Watch` JSX DSL；本任务需要把这些 TSX 节点重新设计为 active v3 Profile 规范的一部分。
- 当前 TSX 可视化编辑器第一版只从 `systemPrompt` / `renderSystemPrompt()` 源码 range 构造一个 System Prompt 占位节点；如果 TSX DSL 成为正式 profile 机制，前端需要重新围绕 `ProfilePrompt` / `System` / `History` / `Appending` 等节点做 AST round-trip。
- 当前 harness 行为：
  - `historyMessages` 只在 `profile.history.injected` 不存在时写入一次 session history。
  - `dynamicMessages` 只进入本轮模型上下文，不持久化。
  - `appendingMessages` 每轮都会追加到 session history。
  - Provider 级 system prompt 走 `systemPrompt` 字段，不通过 messages 内的 system message 表达。
- 当前 `leader.default` / `leader.assets` 默认可见工具：
  - `read`
  - `write`
  - `edit`
  - `apply_patch`
  - `bash`
  - `create_agent`
  - `invoke_agent`
  - `get_agent`
  - `get_session`
  - `detach_agent`
  - `request_user_input`
  - `enter_plan_mode`
  - `exit_plan_mode`
  - `skill`
- 当前不在 v3 registry 中的 v2 能力不能直接写进 active prompt 的工具指令：
  - `read_file` / `write_file` / `edit_file` / `execute_shell`
  - `create_subagent` / `list_subagents` / `invoke_subagent`
  - `task_create` / `task_set_status`
  - `execute_sql`
  - 旧 plot/story 工具，例如 `get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`。

## Adaptation Strategy

- 先定 TSX Profile DSL 规范，再迁移完整 `leader.default`。
- `prepare` 是 Profile 提供给 harness 的底层接口，但也要方便高级用户覆写；普通 profile 作者主要关心如何用 TSX DSL 直观构造上下文。
- 底层 `prepare` 不负责提供 tools；harness 从 `profile.allowedToolKeys` 获取本轮可见工具。`prepare` 只负责产出 ReAct loop 前的上下文分区，例如 provider `systemPrompt`、首轮稳定历史片段、本轮 appending 片段和本轮非持久动态片段。
- `prepare` 不应同时返回 `historySeed` 与已经包含 history 的 `contextMessages` 这类双真相源。最终 ReAct `messages` 应由 harness 在提交 pre-loop 片段后，从 session reduce 结果加上非持久动态片段统一组装。
- 进入 ReAct loop 前哪些消息写入 session，需要在 DSL 编译器和 harness 之间划清责任：TSX DSL 表达意图，harness 负责按统一规则落盘，避免 profile 自己随意写 session。
- `ingest` 未来可以负责 ReAct loop 结果的后处理，例如 title/summary 或选择性归档策略。但让 ingest 决定哪些 `AIMessage` / `ToolResult` 可以持久化会牵涉 live SSE、waiting 恢复和前端展示，本任务先不实现 ingest 改造。
- Profile 必须能够通过 TSX/XML 标签直观地 prepare 上下文；profile 作者可以直接写 JSX 标签，也可以用普通 TypeScript 函数返回 JSX tree 来复用片段。
- 不继续采用 v2 `SimpleProfile` class 继承设计。v3 profile 仍以 `.profile.tsx` 文件和 `defineAgentProfile` 为外层入口，TSX DSL 是该入口内的 prompt/context 声明能力。
- 稳定身份、协作模式、Markdown 扩展、内容节点、Lorebook、Manuscript、Plot System、工具使用原则、多 agent 协作说明应能通过 TSX Profile 节点表达，而不是只靠手写 `systemPrompt` 字符串。
- `HistorySet` 的历史迁移行为本次先不迁移到旧会话；先定义新规范和新会话语义，避免隐式改写 append-only history。
- `HistorySet` / `ModelContext` / `AppendingSet` / `Reminder` / `If` / `Watch` 必须迁移，并明确各自的上下文位置与持久化语义。旧 `DynamicSet` 在新 DSL 中硬切删除，不提供公开迁移别名。
- `AppendingSet` 是本轮向 session 增加消息的唯一途径：它内部产出的消息既进入本轮上下文，也写入 session。其他 set 不能绕过它直接追加 session 消息。
- TSX DSL 不支持 `<Message role="system">`。provider 级 system prompt、长期稳定约束、system reminder 等需要分别设计明确节点或编译规则，不把 `system` 当作普通 message role。
- `SkillCatalog` / `ActivatedSkills` 必须迁移，所有 TSX Node 都要纳入新规范；其中 catalog、activated skill、runtime reminders 的持久化边界需要重新定清楚。
- 旧 v2 工具以后再迁移。本任务不恢复 `read_file`、`execute_shell`、task、SQL、plot/story 等旧工具名，但 Profile DSL 可以为未来工具能力预留清晰扩展点。
- v2 plot/story 和 task 说明可以保留概念层表达，但所有具体工具调用必须等对应 v3 工具重建后再进入模型可见 active prompt。
- 前端可视化编辑器要跟随新 DSL：源码仍是真相源，但结构化编辑目标从 `systemPrompt` 字符串 range 改为可解析 TSX Profile tree。

## Target Architecture

## Terminology Clarification

### `context(ctx) => JSX`

这是普通 profile 作者优先使用的声明式入口。它返回 TSX DSL tree，例如：

```tsx
context(ctx) {
    return (
        <ProfilePrompt>
            <System>...</System>
            <HistorySet>...</HistorySet>
            <ModelContext>...</ModelContext>
            <AppendingSet>
                <Reminder id="workspace">
                    <Message role="user">...</Message>
                </Reminder>
            </AppendingSet>
        </ProfilePrompt>
    );
}
```

`context()` 不直接写 session，也不直接拼最终 model messages。它只是用 JSX/XML 标签描述 profile 本轮希望提供哪些上下文。runtime 编译这棵树，得到底层 `ProfileTurnPlan`。

### `prepare(ctx) => ProfileTurnPlan`

这是 profile 给 harness 的底层接口。高级 profile 可以绕过 TSX DSL，直接返回 `ProfileTurnPlan`。普通 profile 推荐写 `context()`，由 runtime 自动编译。第一版推荐 `context` 与 `prepare` 二选一；如果同时存在，应作为 profile contract 错误处理。

### `ProfileTurnPlan`

`ProfileTurnPlan` 是本轮 ReAct loop 前的“上下文施工单”，不是最终发给模型的 `messages`。它只告诉 harness：

- provider 级 system prompt 是什么。
- 首轮稳定上下文候选是什么。
- 本轮需要写入 session 的 AppendingSet 消息是什么。
- 本轮只给模型看的 model-only context 是什么。
- Reminder / Watch 这类节点需要更新哪些受控状态。

harness 会先按这个 plan 写入 session，再重新 reduce session，最后组装真正传给 ReAct loop 的 messages。

### `stateWrites`

`stateWrites` 是 Reminder / Watch / profile runtime 用来记录内部状态的受控 session entry。例如：

- 某个 `Reminder` 上一次注入的 fingerprint。
- 某个 `Watch` 上一次看到的值。
- 某个 `HistorySet` 是否已经为当前 profile 初始化过。

它不是给 profile 任意写 session 的逃生口；用户层要新增模型可见消息，只能通过 `AppendingSet`。

### `profile.history.injected`

这是当前旧 harness 里的全局 custom state key。旧逻辑是：如果 `context.customState["profile.history.injected"]` 不存在，就把 `historyMessages` 写入 session，然后写入这个 key，表示 HistorySet 已经首轮注入过。

这个名字的问题是它不按 profile 分区。未来如果一个 session 切换 profile，或者 fork 后使用不同 profile，全局 key 可能误判“已经注入”。本任务的目标是把它改成受控 profile state，例如 `profileState.${profileKey}.history.injected`。

### Target Harness Contract

目标不是把旧 `PreparedTurn` 字段换个名字，而是改成下面这条单一真相源链路：

```text
POST /api/agent/sessions/:id/invocations
-> 构造 pending user message，但暂不写 session
-> reduce 当前 session，传给 profile.prepare()
-> profile.prepare() 返回 ProfileTurnPlan，不返回最终 contextMessages
-> harness 统一提交 pre-loop 写入
   1. history init entries，仅新 session / 未注入时写入
   2. appending entries，本轮写入 session
   3. profile state entries，例如 Reminder / Watch baseline
-> prompt 模式写入 pending user message
-> 重新 reduce session
-> 用 reduce 后的 session messages + model-only context 组装 ReAct messages
-> 进入 ReAct loop
-> ReAct loop 的 assistant/toolResult message_end 由 harness 持久化并发 SSE
```

目标底层 `prepare` 返回值暂命名为 `ProfileTurnPlan`：

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

约束：

- `ProfileTurnPlan` 不包含 `contextMessages` / `messages` / `historySeed` 这类双真相源字段。最终 ReAct `messages` 只能由 harness 在 pre-loop 写入后重新 reduce session，再拼接 `modelContextMessages` 得到。
- `ProfileTurnPlan` 不包含 `toolKeys`。本轮工具集合由 `profile.allowedToolKeys` 与 runtime tool registry 决定。后续如果需要高级动态裁剪，必须单独设计，不借 `prepare` 偷渡。
- `stateWrites` 只允许 DSL runtime 为 Reminder / Watch / profile 状态更新生成受控 custom entry，不能让普通 profile 任意写 session。用户层向 session 增加模型可见消息的唯一通道是 `AppendingSet`。
- `appendingMessages` 必须在真实用户消息之前写入 session，这样前端能先看到 `<system-reminder>` / activated skill / plan mode reminder，再看到用户输入和 AI streaming。
- `modelContextMessages` 必须在 pre-loop 写入完成并重新 reduce 后才拼入 ReAct input，不能提前混进 `context.messages`，避免 AppendingSet 重复进入模型上下文。
- `ingest` 本任务先不改造成消息归档策略。assistant / toolResult 仍由 harness 在 ReAct loop `message_end` 时写回 session，保证 SSE、waiting 和 resume 语义稳定。
- `continue + resolution` 仍先把 resolution toolResult 写入 session，再进入 profile prepare。普通 `continue` 不自动伪造用户消息。

### Target Profile DSL

- `System` / provider system prompt：只影响 provider `systemPrompt`，不作为普通 message 写入 session，也不允许用 `<Message role="system">` 表达。
- `HistorySet`：首轮稳定上下文。只能初始化新 session 的稳定前缀，不做旧会话隐式回填或 profile 演化 patch。它可以产生多条 `custom_message visibleToModel: true`，内部 message role 必须是 provider 支持的普通 role，不允许 system role 偷渡。
- `ModelContext`：本轮 model-only context。它替代旧 `DynamicSet`，新 DSL 直接删除 `DynamicSet`。该分区不写 session，不被前端历史展示。
- `AppendingSet`：本轮向 session 追加模型可见消息的唯一用户层通道。它的输出必须在 ReAct loop 前写入 session，并通过 `session_entry` SSE 先展示给前端。
- `Reminder` / `Watch`：只能出现在 `AppendingSet` 内。它们决定本轮是否产出 appending message，同时产生受控 `stateWrites` 更新 profile/session state；不能伪装成普通 model-only context。继续使用现有 v2 形态：`<Reminder>...</Reminder>` 内部接受 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 这类消息节点。
- `SkillCatalog`：默认属于 `HistorySet` 的首轮稳定上下文，但不再要求包在 `<Message role="system">` 里；新 DSL 需要提供专门节点或编译规则。
- `ActivatedSkills`：属于本轮上下文，默认放在 `AppendingSet` 里靠近当前用户输入之前；它不应被永久塞进 skill catalog。
- `Message`：仅支持 provider 可接受的普通消息角色，例如 `user` / `assistant` / `toolResult` 或项目确定的别名。`role="system"` 非法。`HumanMessage` 是 `Message role="user"` 的更直观别名。
- `AIMessage` / `ToolCall` / `ToolResult`：作为历史样例或少量结构化上下文节点迁移，但必须遵守 provider message union 和 harness 持久化边界。
- `If`：保留为条件渲染节点，本身不产生分区，只展开合法子节点。

推荐 profile 形态：

```tsx
export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>...</System>
                <HistorySet>...</HistorySet>
                <ModelContext>...</ModelContext>
                <AppendingSet>...</AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

高级用户仍可覆写底层 `prepare(ctx): ProfileTurnPlan`，但普通 profile 推荐使用 `context(ctx) => JSX`。如果同时提供 `context` 与 `prepare`，应以 `prepare` 为高级覆写入口还是诊断为冲突，需要继续 grill 后定稿。

目标 Workbench 语义：

- 外层 host 决定用户能看到哪些 profile、当前编辑哪个 `fileName`、是否允许保存；Workbench 编辑器组件只编辑传入的受控 TSX 文件。
- 源码是真相源。解析失败时仍允许源码保存，并展示 diagnostics。
- 可视化编辑第一阶段只承诺处理新 DSL 中能稳定 round-trip 的节点和源码 range；复杂 TypeScript helper 继续通过源码编辑。
- Preview 展示 harness 编译结果，而不是只展示 `systemPrompt` 字符串：`systemPrompt`、HistorySet 初始化候选、AppendingSet pre-loop 写入、ModelContext model-only context、最终 ReAct messages 预览。

## Resolved Decisions From Latest Grill

- `prepare()` / `context()` 可以看到 pending user message 的只读视图，用于 skill 激活和条件上下文；真实用户消息仍由 harness 统一写入 session。
- 记录 TODO：后续可以研究把 steer / follow-up queue 也交给 profile 管理，而不是继续全部放在 harness。
- system reminder 继续使用现有 `<Reminder>` 形态，不新建 `<SystemReminder>` 节点。`Reminder` 只控制是否注入，内部 message 节点决定实际 role/content。
- TSX 自定义消息节点需要重新设计：`Reminder` 内部可接受 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 等消息节点；最终编译为 provider 可接受的 message，再包进 session `custom_message`。
- Profile 生成的 `HistorySet` / `AppendingSet` 可见消息写入 session 时使用 `custom_message visibleToModel: true`。
- 新 DSL 硬切删除 `DynamicSet`，公开只保留 `ModelContext`。
- Workbench 第一阶段 AST round-trip 先支持稳定节点和简单 `Reminder`，复杂 helper / `Watch.render` 保留源码编辑。
- v2 leader 中 Plot System / task / SQL 概念层可以保留，但旧工具名和调用旧工具的命令式说明不能进入 active prompt。
- 本任务暂不新增稳定 `spec/agent/profile-dsl.md`；先把设计记录在任务 README 与 harness 文档中。

## Open Decisions To Grill

这些问题会影响 runtime contract、TSX DSL 形状或前端编辑器模型，不能在实现时临时绕开：

1. `context(ctx) => JSX` 与底层 `prepare(ctx) => ProfileTurnPlan` 是否允许同时存在。推荐：二选一；同时存在时报错，避免两个上下文真相源。
2. 高级 `prepare()` 是否能直接返回 `stateWrites`。推荐：可以，但必须通过 validator 限制 entry 类型和 key prefix；普通 DSL 作者只通过 `Reminder` / `Watch` 触发。
3. `HistorySet` 注入标记是否改成按 profile key 分区。推荐：改成 `profileState.${profileKey}.history.injected`，避免同一 session 切 profile 或 fork 后误判。
4. `SkillCatalog` 在禁止 `<Message role="system">` 后的 DSL 表达方式。推荐：提供 `<SkillCatalog />` 作为 `HistorySet` 内专用节点，编译成首轮 `custom_message visibleToModel: true`。
5. `ActivatedSkills` 是否走 `AppendingSet`。推荐：是，作为本轮系统上下文写入 session，但不伪装成真实用户消息。
6. `Reminder` / `Watch` 的状态 key 与重复策略。推荐：`profileState.${profileKey}.reminders.${id}` 与 `profileState.${profileKey}.watches.${id}`；暂不加入 profile version，未来做显式 migration/version。
7. 用户覆盖 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 的同步策略。推荐：只在文件明显等同旧系统副本时覆盖；否则报告差异并保留用户文件。

## Implementation Plan

1. Harness architecture
   - 将 harness 目标接口改为 `ProfileTurnPlan`，淘汰旧目标中的 `PreparedTurn.toolKeys`、`sessionWrites` 和任何最终 `contextMessages`。
   - `profile.prepare()` 或 DSL compiler 只返回 system prompt、history init、appending、model-only context 和受控 state writes。
   - tools 不从 prepare 返回；由 `profile.allowedToolKeys` 决定。
   - 明确 pre-loop 写入顺序：history init、AppendingSet 片段、受控 profile state、当前用户消息。
   - AppendingSet 写入 session 后必须通过 `session_entry` SSE 让前端先看到 system reminder / appending context，再看到用户输入和 AI streaming。
   - 本阶段不改造 ingest 对 assistant/toolResult 的归档决策，继续由 harness 在 `message_end` 持久化 ReAct loop 产物。
   - 验证：补 harness 测试锁定 pre-loop entry 顺序、SSE entry 发布、最终 ReAct messages 来自 reduce 后 session + model-only context，且不重复包含 AppendingSet。

2. TSX Profile DSL spec
   - 定义 active v3 支持的 TSX nodes、合法嵌套、输出分层和持久化语义。
   - 覆盖所有 v2 核心节点或其新名称等价物：`ProfilePrompt`、`HistorySet`、`AppendingSet`、`Message`、`AIMessage`、`ToolCall`、`Reminder`、`Watch`、`If`、`SkillCatalog`、`ActivatedSkills`。
   - 将旧 `DynamicSet` 语义硬切为 `ModelContext`，不提供公开迁移别名。
   - 明确不支持 `<Message role="system">` 后，system prompt、system reminder、历史稳定上下文分别使用什么节点或编译规则表达。
   - 继续使用 `<Reminder>` 表达 system reminder；`Reminder` 内部通过 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 这类消息节点承载实际内容。
   - 明确 `AppendingSet` 是唯一 session append 通道，`HistorySet` 首轮稳定前缀和 profile/session state 更新不应伪装成本轮追加消息。
   - 明确哪些节点只影响 provider `systemPrompt`，哪些产出 history 初始化片段、AppendingSet 片段、model-only 片段和 profile state updates。
   - 验证：为节点合法性、空输出、顺序和持久化边界设计测试。

3. Profile runtime integration
   - 把 `prepare` / `ingest` 定位为底层接口；新增用户层 `context(ctx) => JSX` 构造入口，由 runtime 编译成底层 `ProfileTurnPlan`。
   - 设计 Profile 文件如何返回 JSX DSL：外层继续使用 `defineAgentProfile`，在其中提供直观的 TSX prepare/context builder；同时允许普通函数返回 TSX tree 作为复用片段。
   - 不恢复 `SimpleProfile` class 继承模型；把 v2 class profile 的有价值语义迁到函数式 `.profile.tsx` contract。
   - 接入 dynamic profile catalog、preview-prepare、check-profile 和 Workbench 可视化辅助编辑。
   - 验证：真实 `leader.default.profile.tsx` 能通过 JSX DSL 产出新 harness 可消费的 `ProfileTurnPlan`。

4. Harness ReAct loop contract
   - 明确 ReAct loop 输入参数：`sessionId`、`workspaceKey`、`workspaceRoot`、`systemPrompt`、`messages`、`model`、`apiKey`、`toolKeys`、`profileKey`、`thinkingLevel`、`abortSignal`、`invocationId`、`onEvent`。
   - 明确 ReAct loop 输出结果：`events`、`finalAssistant`、`reportResult`、`waiting`。
   - 明确 loop 内消息持久化来源：assistant / toolResult 的 `message_end` 事件会写入 session；进入 loop 前由 DSL/harness 决定写入的消息必须已经落盘。
   - 本任务先不改造 `ingest`；先保持 loop 内 `message_end` 由 harness 持久化，避免同时改动 live SSE、waiting 恢复和结果归档。

5. Prompt parity inventory
   - 对 v2 `leader-default.profile.tsx` 按区块列出要迁移、要改写、要暂缓的内容。
   - 输出迁移表：v2 section、v3 落点、处理方式、阻塞原因。
   - 验证：搜索迁移表中所有旧工具名，确认不会进入 active v3 prompt。

6. Rewrite v3 `leader.default` with TSX DSL
   - 扩展 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，优先使用新 TSX Profile DSL 表达提示词分层。
   - 保留当前 v3 工具名和 TypeBox contract。
   - 增加 v2 关键业务块：
     - System / 协作模式
     - Markdown 扩展写作格式
     - 工具使用与输出效率
     - 多 agent 协作
     - 目录介绍
     - 内容节点
     - Anatomy Lorebook
     - Anatomy Manuscript
     - Anatomy Plot System
     - Shell / workspace CLI 规则
     - Plan Mode 基础约束
   - 验证：测试断言这些 section 存在，旧工具名不存在。

7. Rebuild runtime context and reminders
   - 用 `ModelContext` / `AppendingSet` / `Reminder` / `Watch` 表达当前 runtime context，恢复 v2 重要行为。
   - 包含：
     - workspace root
     - profile key
     - plan mode active 状态
     - available agents
     - linked agents
     - profile input role，如果存在
   - 对每个节点明确是否持久写入，不把每轮重复提醒误写成无限历史膨胀。
   - 验证：单测读取 `prepared.dynamicMessages`，确认 linked agents / catalog profile 可见。

8. TSX visual editor and Workbench
   - 更新 Workbench 文档中过期的“只解析 systemPrompt range”决策，改为围绕新 TSX DSL 的可视化辅助编辑。
   - 后端源码解析从 System Prompt 占位节点升级为 TSX Profile tree AST；第一阶段优先解析 `context(ctx) { return (<ProfilePrompt>...</ProfilePrompt>) }` 或等价稳定源码区域。
   - 保留源码为真相源，解析失败时源码编辑仍可保存。
   - 前端组件库、画布和 Inspector 跟随新节点命名与合法嵌套规则。
   - 删除旧 `DynamicSet` 组件和物料，改为 `ModelContext`。
   - Preview/validate 展示 harness 编译后的分区结果：systemPrompt、history 初始化片段、AppendingSet pre-loop 写入片段、ModelContext 片段、最终 ReAct messages 预览。
   - 验证：补 Workbench service / parser / round-trip tests，必要时再补前端组件测试。

9. Sync user override when needed
   - 如果 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 存在，并且仍是系统 profile 的旧同步副本，则同步这次迁移。
   - 如果用户覆盖文件已经有明显人工改动，先报告差异，不直接覆盖。
   - 验证：分别检查 system root 和 user root 的 profile 是否能加载。

10. Tests
   - 更新 `server/agent/profiles/leader-assets-profile.test.ts`。
   - 保留现有断言：
     - allowed tools 使用 v3 工具名。
     - 不包含 v2 旧工具名。
     - `leader.default` 不默认允许 `report_result`。
     - 不使用 `historyMessages` 隐式回填。
   - 新增断言：
     - prompt 包含 v2 迁移后的核心 section。
     - dynamic context 包含 workspace、profile key、available agents、linked agents。
     - prompt 明确 `request_user_input` 只用于结构化选择、跨轮阻塞等待或审批式决策。
   - 验证命令：
     - `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
     - `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
     - 如同步用户覆盖，再运行 `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`

11. Documentation
   - 更新 `docs/tasks/pi-agent-harness-migration/README.md`，把“TODO：继续做更完整 prompt parity”改成当前实际完成范围与剩余缺口。
   - 更新 `docs/tasks/tsx-profile-workbench/README.md`，把可视化编辑器目标从 systemPrompt range 改到新 TSX DSL tree。
   - 更新 `docs/modules/agent/harness.md`，记录实现后的 harness pre-loop 提交流程。
   - 更新本文档 Walkthrough / Files Changed / Verification。
   - 本任务暂不新增稳定 `spec/agent/profile-dsl.md`；等 DSL 经实现验证后再考虑沉淀到 spec。
   - 如实际 runtime 行为或长期 TODO 变化，再更新 `PROJECT-STATUS.md`。

## Acceptance Criteria

- `leader.default` 从 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 加载成功。
- `leader.default` 使用新的 TSX Profile DSL 表达核心 prompt 分层和 runtime context。
- TSX Profile DSL 不依赖 `SimpleProfile` class 继承。
- TSX Profile DSL 支持直接 JSX 标签和函数返回 JSX tree 两种写法，并通过 `context(ctx) => JSX` 或底层 `prepare(ctx) => ProfileTurnPlan` 进入 runtime。
- `<Message role="system">` 被禁止或诊断为非法；相关 system 语义有明确替代节点或编译规则。
- `DynamicSet` 在新 DSL 中不可用；旧 model-only 语义统一由 `ModelContext` 表达。
- `Reminder` 继续作为 system reminder / runtime reminder 的注入节点，内部接受消息节点承载实际内容。
- Profile 生成的可见上下文通过 `custom_message visibleToModel: true` 写入 session，真实用户输入仍通过普通 `message role="user"` 写入。
- `AppendingSet` 是本轮向 session 追加消息的唯一通道，并有测试锁定。
- `prepare()` 产出 `ProfileTurnPlan`；harness 提交 pre-loop session 片段后再统一组装最终 ReAct `messages`，不返回重复包含 history 的 `contextMessages`。
- `prepare()` 不返回 `toolKeys`；运行工具集合来自 `profile.allowedToolKeys`。
- 前端在一次 prompt invocation 中能按顺序看到 pre-loop AppendingSet 消息、用户消息和后续 AI streaming。
- TSX 可视化编辑器能解析、展示、局部编辑新 DSL tree；保存仍以源码为真相源。
- prompt 中不出现 v2 旧工具名作为 active instruction。
- allowed tools 与当前 v3 registry 一致，不包含不存在的工具。
- v2 关键业务语义已经迁入或明确记录为 TODO。
- 测试覆盖 TSX Node 合法性、prompt section、工具命名、dynamic context、reminder/watch 触发和 history 不回填边界。
- 任务文档记录实际实现结果、验证结果和计划偏差。

## Risks

- v2 prompt 中部分剧情/Plot 能力依赖旧工具；如果只迁 prompt 不补工具，模型会被诱导调用不存在的能力。处理方式：概念可保留，工具级动作暂缓或改写。
- 当前 `appendingMessages` 会持久写入，不能直接模拟 v2 `Reminder` / `Watch`。处理方式：本任务必须先定新 DSL 和 harness 输出语义，避免迁移后造成历史膨胀。
- 用户覆盖 profile 可能遮蔽系统 assets。处理方式：实现阶段必须检查 user root 是否存在覆盖，并谨慎同步。
- 大 prompt 修改容易引入旧工具名残留。处理方式：测试和 `rg` 双重检查。
- `bun run typecheck` 当前可能受既有无关前端错误影响。处理方式：本任务优先跑 profile check 和相关 profile tests，若 typecheck 失败需标明是否为既有无关错误。

## Files Planned

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`（若需要同步用户覆盖）
- `server/agent/prompts/**` 或新的 TSX Profile DSL runtime 文件（具体路径待设计确认）
- `server/agent/profiles/**` 中的 DSL 编译/preview/check 接线（具体路径待设计确认）
- `server/agent/profiles/types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `app/components/profile-template-editor/**`
- `server/agent/profiles/workbench-service.ts`
- `shared/dto/agent-profile.dto.ts`
- `docs/tasks/leader-profile-v2-adaptation/README.md`
- `docs/tasks/tsx-profile-workbench/README.md`
- `docs/tasks/pi-agent-harness-migration/README.md`
- `docs/modules/agent/harness.md`
- `PROJECT-STATUS.md`（如长期 TODO 或模块状态变化）

## Verification Plan

- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`
- `bunx vitest run server/agent/profiles/workbench-service.test.ts`
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`（仅当同步用户覆盖）
- `rg -n "read_file|write_file|edit_file|execute_shell|create_subagent|invoke_subagent|list_subagents|task_create|task_set_status|execute_sql|get_plot_tree|get_story_thread|get_story_scene_context|get_chapter_plot" assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx server/agent/profiles/leader-assets-profile.test.ts`

## TODO / Follow-ups

- 设计并实现 active v3 TSX Profile DSL，不再把 `ProfilePrompt` 可执行语义只作为 Workbench 后续评估项。
- 迁移全部 v2 TSX Node：`ProfilePrompt`、`HistorySet`、`ModelContext`、`AppendingSet`、`Message`、`AIMessage`、`ToolCall`、`If`、`Reminder`、`Watch`、`SkillCatalog`、`ActivatedSkills`；新 DSL 删除 `DynamicSet`。
- 为 `Reminder` / `Watch` / `AppendingSet` 定义 v3 harness 写入语义，功能完整迁移，同时避免无意义重复历史膨胀。
- 为 `SkillCatalog` / `ActivatedSkills` 定义 v3 注入方式，保持“catalog 首轮稳定上下文”和“activated skill 本轮上下文”的边界。
- 记录后续方向：可以研究把 steer / follow-up 也交给 profile 管理，而不是继续全部由 harness 管理。
- 改造 TSX 可视化编辑器，使其围绕新 DSL tree 做解析、预览、局部写回和验证。
- 旧 Plot / task / SQL 等工具以后单独迁移；本任务不恢复旧工具名，但 DSL 和 leader prompt 不应阻塞未来工具补回。
- 后续完成实现后，回填本文档的 Walkthrough、Files Changed 和 Verification。
