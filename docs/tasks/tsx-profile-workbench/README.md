# TSX Profile Workbench

## User Request

- 继续推进 TSX profile 这一块：先制定实现计划，再用 `$grill-with-docs` 对计划做术语和架构边界审问。
- 本阶段先立刻建立当前任务文档，把旧低代码 profile 工作台和当前 TSX profile runtime 的关系说清楚。

## Goal

- 为新的 TSX Profile Workbench 建立当前任务真相源。
- 跑通自定义 profile / agent 闭环：用户和 Agent 都能创建、编辑、校验、预览并运行自定义 `.profile.tsx`。
- 让 user-assets 入口重新具备 profile 管理能力，但不把旧 `profile-templates` / `user-profile-templates` 写入 API 作为新实现合同。
- 第一版采用 TSX 源码优先：外层入口负责 profile 可见性、选择、新建和 runtime 状态；Workbench 编辑器组件只负责编辑调用方传入的 TSX profile 文件路径，提供源码编辑、`ProfilePrompt` 可视化辅助编辑和真实 prepare 预览。通用文件导航、tab 和保存冲突处理继续复用 user-assets 文件树与编辑器基础设施。

## Current State

- 当前 Agent 主链路已切到 Pi-based `server/agent`，profile runtime 使用 `defineAgentProfile({ manifest, inputSchema, outputSchema, allowedToolKeys, prepare, ingest? })`。
- 当前 active v3 profile 的 `prepare(ctx)` 直接返回 `PreparedTurn`：`systemPrompt`、`historyMessages`、`dynamicMessages`、`appendingMessages`、`toolKeys` 和可选 `sessionWrites`。`ProfilePrompt` / `HistorySet` / `DynamicSet` / `AppendingSet` 是 v2 以及迁移文档中的重要提示词 DSL 经验，但还不是 `server/agent` active profile 的可执行 JSX API。
- Profile 真相源是完整 `.profile.tsx` 单文件：
  - 系统 profile root：`assets/workspace/.nbook/agent/profiles`
  - 用户 profile root：`workspace/.nbook/agent/profiles`
- `user-assets` 是前端入口，挂载目标是 Workspace Root `.nbook`，即 `workspace/.nbook/`；它不是新的配置 scope，也不是嵌套资产根。
- `leader.default` 和 `leader.assets` 只是系统内置 agent key/name，不再表达 leader/subagent 架构分层。
- `InputSchema` / `OutputSchema` 使用 TypeBox / JSON Schema；旧文档中基于 Zod 的 Schema Builder 设计不是当前实现真相。v3 `InputSchema` 表示创建 agent/session 时传入的实例初始化参数，不承载每轮任务 prompt；每轮任务输入通过 `invoke_agent` 或 `/api/agent/sessions/:sessionId/invocations` 传递。profile contract 仍要求 `inputSchema` 字段存在；产品语义中的“InputSchema 为空”指 `InputSchema = Type.Object({})` 这类空对象 schema，表示这是普通 agent，没有特殊实例配置，创建后直接通过 invoke 对话即可。
- 当前保留并扩展的 profile API：
  - `GET /api/agent/profiles/catalog`
  - `POST /api/agent/profiles/detail`
  - `POST /api/agent/profiles/preview-prepare`
  - `GET /api/agent/profiles/files`
  - `GET /api/agent/profiles/templates`
  - `POST /api/agent/profiles/source`
  - `POST /api/agent/profiles/save`
  - `POST /api/agent/profiles/create`
  - `POST /api/agent/profiles/delete`
- 已按用户要求从 git 恢复旧 TSX profile preview 页面和关联组件：
  - `app/pages/tsx-profile-editor.preview.vue`
  - `app/components/profile-template-editor/**`
  - `shared/dto/profile-template.dto.ts`
  - `server/api/agent/profile-templates/**`
  - `server/api/agent/user-profile-templates/**`
- 恢复后的旧 route 文件在当前 HEAD 中仍是 `throwAgentV2Removed()` tombstone，不是真实可用实现；旧 AST/结构编辑服务在 `server/agent-v2/profile-templates/profile-template-service.ts` 归档中。实现时旧 API 直接删除，不做兼容层。
- 旧 `ProfileTemplateVisualEditor` 仍是当前 UI 基底：页面布局、视觉样式和主要交互已经调好，后续基于这个页面调整，而不是另起一套全新 UI。它依赖旧 `ProfilePrompt` tree、Zod Schema Builder、`leader/subagent` kind 和旧写入 API 的部分必须迁到新的 TypeBox / `.profile.tsx` / `server/agent` profile API。
- 旧版界面截图中的三栏布局继续作为 UI 基底：左侧组件库，中间 `ProfilePrompt` 可视化画布，右侧源码/属性/变量/运行时/Agent 面板，顶部保留 profile 选择、预览、验证、新建、保存等动作区。后续只围绕新 runtime contract 微调，不重做视觉结构。

## Walkthrough

- 已检查 `docs/tasks/pi-agent-harness-migration/README.md`，确认当前 profile runtime、assets root、TypeBox contract 和 user-assets 入口定义。
- 已检查旧 `docs/tasks/user-assets-workspace/README.md` 与 `docs/tasks/tsx-profile-template-editor/README.md`，发现其中仍保留旧 root、Zod、leader/subagent、低代码画布和旧 API 设计，只能作为历史背景。
- 当前计划先建立新的 focused walkthrough，然后继续 grill 以下决策：
  - Workbench 第一版是源码优先，还是恢复低代码画布。
  - Workbench 是否自己内置源码编辑器，还是复用 user-assets 文件编辑器。
  - 系统 profile 的“编辑”语义是直接修改系统文件，还是复制为用户覆盖。
  - 新建 profile key 是否继续限制 `leader.*` / `subagent.*`。
  - 默认 profile 设置是否属于 Workbench。
  - 坏 TSX 文件是否允许保存。
  - Schema Builder 是否进入第一版。
- 已恢复并阅读旧 `tsx-profile-editor.preview` 相关代码，结论：
  - 独立 preview 页面只挂载 `ProfileTemplateVisualEditor mode="system-template"`。
  - `UserProfileWorkbenchDialog` 会挂载 `ProfileTemplateVisualEditor mode="user-profile"`，但当前 Header/Page 挂载点仍未恢复。
  - `ProfileTemplateVisualEditor` 的 user-profile 模式已经尝试接入新 `/api/agent/profiles/catalog/detail/preview-prepare`，但仍调用旧 `/api/agent/user-profile-templates/*` 保存、创建、恢复和 schema 更新接口。
  - 当前 `shared/dto/agent-profile.dto.ts` 已移除旧 `AgentProfileSchemaFieldDto`、`AgentProfileDetailDto.root` 和旧 template variable DTO 继承；旧编辑器若直接进入 active build 会出现类型/运行合同不匹配。
  - “旧画布编辑”改称 `ProfilePrompt` 可视化辅助编辑：它指 `ProfileTemplateVisualEditor` 左侧组件库 + 中间拖拽节点树 + 右侧 Inspector 对 `ProfilePrompt` JSX 的查看和编辑能力。它只适用于能稳定解析出 `ProfilePrompt`/节点树的源码区域；不适用于任意 TypeBox profile 的全部 TSX 逻辑。
- 已按用户要求复查旧 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`、`spec/agent/context.md` 与 `docs/tasks/pi-agent-harness-migration/README.md`：
  - v2 旧 leader 的 `buildLeaderDefaultPrompt(ctx)` 通过局部变量构造 `historySet`、`dynamicSet`、`appendingSet`，最后返回 `<ProfilePrompt>{historySet}{dynamicSet}{appendingSet}</ProfilePrompt>`。
  - v2 `ctx.input.prompt` / `<Message source="input">` 是旧直接 prompt 模式的输入写入策略；v3 已把 `InputSchema` 收窄为 agent 实例初始化参数，不能把它当作默认模板的每轮任务 prompt。
  - v3 prompt / continue 的用户消息由 session invocation 入口写入，profile 负责围绕 session history 生成 system / dynamic / appending 上下文，不默认伪造或搬运 `ctx.input.prompt`。
  - 因此模板不能默认声明 `{ prompt: string }`，也不能默认把 `ctx.input.prompt` 放进 appending 区；是否把实例初始化字段渲染进上下文由 profile 作者决定。
- 已核对 TypeBox 当前行为：`Type.Object({})` 默认允许额外字段，`Value.Check(Type.Object({}), { extra: "x" })` 为 true，`Value.Parse` 会保留额外字段。只有显式写 `Type.Object({}, { additionalProperties: false })` 时才拒绝额外字段。对 Workbench 来说，`Type.Object({})` 更像“无已知字段约束”，不是“禁止传任何字段”。
- 已核对当前 `report_result` 工具 schema 仍要求 `result: string` 并允许可选 `data`；这和本任务新决策中的“空 OutputSchema + report_result 只要求 walkthrough”还不一致。后续实现阶段需要同步调整 `report_result` 工具 schema、collector 和 profile 输出校验，不把当前工具合同当作最终设计。
- 已实现第一版 `report_result` 动态 schema：模型可见工具参数由目标 profile 的 `OutputSchema` 派生；空 `OutputSchema = Type.Object({})` 只暴露 `walkthrough`，非空 `OutputSchema` 暴露 `walkthrough + data`，并在工具执行时用 TypeBox 校验 `data`。
- 已实现第一版用户 profile 源码 API：runtime catalog 只返回可加载 profile，坏文件通过 `files/source/save` 按 `fileName` 读取、保存和诊断。
- 已实现两个系统模板：`assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx` 与 `report-agent.profile-template.tsx`。模板只做 key/name/description/systemPrompt 占位替换，不引入模板引擎。
- 已把 `ProfileTemplateVisualEditor mode="user-profile"` 切到新 `/api/agent/profiles/*` 写入 API。旧 `profile-templates` / `user-profile-templates` tombstone route 仍保留 501 helper，避免开发服务器启动期 import 崩溃；普通 user profile 工作台不再依赖这些旧写入 API。
- 第一版可视化辅助编辑没有恢复完整旧 `ProfilePrompt` AST round-trip；后端只从推荐模板中的 `systemPrompt` / `renderSystemPrompt()` 源码 range 构造一个 System Prompt 占位节点。源码仍是真相源，复杂 prompt/helper/schema/工具逻辑继续走源码编辑。
- 已把 user-assets 顶部 Header 的 Agent 按钮旁接入 Profile 工作台入口，挂载 `UserProfileWorkbenchDialog`；默认打开用户资产中的 `builtin/leader.assets.profile.tsx`。
- 已把 `/tsx-profile-editor.preview` 调试页切到 `ProfileTemplateVisualEditor mode="user-profile"`，不再默认触发旧 `profile-templates` tombstone API。
- 已把 user-profile 模式下的源码解析、预览和显式验证改为基于当前编辑器源码：服务端在 `.agent/profile-source-check/*` 临时 user profile root 中覆盖当前文件，再走真实 catalog/detail/prepare 链路，不污染 `workspace/.nbook/agent/profiles`。
- 已修复第一版可视化辅助编辑的写回边界：画布编辑只替换已定位的 editable `systemPrompt` 文本源码 range，不再尝试把旧 `<ProfilePrompt>/<Message>` 片段写入 active v3 `.profile.tsx`。
- 坏 profile 文件按 `fileName` 读取时会尽量保留 catalog loader 的真实 diagnostics；只有没有匹配 issue 时才回落到 `load_failed`。

## Decisions

- 新任务真相源是本文档；旧 `user-assets-workspace` 和 `tsx-profile-template-editor` 文档只作为历史背景，后续如引用必须先对照本文档和 `pi-agent-harness-migration`。
- Profile Workbench 第一版不恢复旧低代码写入 API；旧 `profile-templates` / `user-profile-templates` API 直接删除，后续根据 v3 profile 经验重新设计新的 `/api/agent/profiles/*` 写入 API。
- Profile Workbench 编辑器是 profile 专用编辑器；它只编辑调用方传入的 TSX 文件路径，可以直接源码编辑，也可以通过 `ProfilePrompt` 可视化辅助编辑查看、编辑 TSX 文件中可解析的 prompt 区域。后续如接 LSP，类型信息可能不完整，不能把 LSP 当作第一版必需前提。
- Workbench 编辑器不决定“用户能看到哪些 profile”，也不内置系统 profile 扫描策略；profile 列表、可见性、默认选择和入口权限由调用方/外层容器负责。实现时需要拆分外层 host 与可复用编辑器组件，避免把 catalog 选择逻辑塞进编辑器。
- Profile Workbench 不复制一套通用文件 IDE；通用文件树、tab、Monaco 承载和保存冲突处理继续复用 user-assets 既有基础设施。
- Workbench 编辑器不允许编辑系统 profile。user-assets 同步会自动把需要的系统 profile 复制到用户资产，因此正常情况下 `leader.assets` 这类 profile 会以用户资产文件形式出现；不再提供显式“创建用户覆盖”动作。
- Profile Workbench 不承担默认 profile 配置；默认 profile 仍归 Config/设置页。
- 保存文件和 profile 可运行性分离：允许保存编译失败或契约失败的 TSX 文件，catalog/detail/preview 展示 issue，运行同 key profile 时阻止执行。
- Runtime profile catalog 面向可被 profile/runtime 使用的 agent 列表，不承担“坏文件浏览器”职责。坏 `.profile.tsx` 文件不进入运行时 catalog；外层入口如需修复坏文件，应通过文件清单/diagnostics 按 `fileName` 调用 Workbench 编辑器打开源码。
- 自定义 profile / agent 是第一版成功标准，不再只做 builtin profile 浏览或系统 profile 覆盖。
- 保留 `tsx-profile-editor.preview` 独立 debug page，并基于当前已调好的 `ProfileTemplateVisualEditor` 页面继续调整。
- 第一版需要 UI 新建自定义 profile，生成 TypeBox `defineAgentProfile` 骨架。新建入口推荐 `agent.<slug>` 命名，但不强制限制 profile key 必须符合该格式。
- 新建 profile 默认文件名使用 `<profileKey>.profile.tsx`，例如 `agent.my-helper.profile.tsx`；目录只作为人为分组，不默认把点号拆成目录层级。
- 自定义 profile 创建后必须能立即创建 session 并运行，含义是新文件 contract 正确时可立刻进入真实 runtime 链路：文件写入 `workspace/.nbook/agent/profiles` 后，catalog 能发现并加载它，detail/preview 能按该 `profileKey` 读取 schema 与 prepare 结果，随后 `POST /api/agent/sessions` 可用同一个 `profileKey` 和可选 `input` 创建 session。UI 新建成功后不自动创建 session。
- Workbench 的 profile 写入、保存等变更 API 统一使用 `fileName` 定位文件，避免坏 TSX 缺失 `manifest.key` 时无法修复。运行和 preview 仍使用已加载 profile 的 `profileKey`。
- Workbench 编辑器不接受绝对路径。调用方只能传受控 profile root 下的相对 `fileName`；开发调试入口也应通过受控 source/root + relative fileName 打开。
- TypeBox Schema Builder 后续重新设计；第一版只做 schema 只读展示和骨架生成，不恢复旧 Zod Schema Builder，也不做旧 builder 兼容迁移。
- `ProfilePrompt` 可视化辅助编辑保留为可复用 UI 能力，用于查看、编辑 TSX 文件中可解析的提示词区域；第一版不能依赖它覆盖完整 `.profile.tsx`。
- `ProfilePrompt` 可视化辅助编辑以源码为真相源；解析失败时源码编辑仍可保存，可视化区降级为空态或最近一次成功解析结果。
- 可视化辅助编辑保存时只局部替换已定位的提示词源码 range，参考旧可视化编辑器与旧任务文档的 AST/round-trip 经验；helper function、schema、imports、allowed tools 和 prepare 外围逻辑保留源码编辑。若后续模板采用 v3 `systemPrompt` 字符串或对象 DSL，则替换边界应落在该结构的源码 range，而不是强行寻找不存在的 `<ProfilePrompt>`。
- 第一版提供模板 TSX 文件用于新建 profile。所有模板都显式导出 `InputSchema`、`OutputSchema`、`Input` 和 `Output`；“空 OutputSchema”用 `OutputSchema = Type.Object({})` 表达，不省略 schema 常量。普通 agent 的 `OutputSchema = Type.Object({})` 且不允许 `report_result`；通用报告 agent 的 `OutputSchema = Type.Object({})` 且允许 `report_result`。
- 第一版模板必须清楚展示 `InputSchema` 语义，但普通模板默认使用空对象 schema。`profile.inputSchema` 不应为空；`InputSchema = Type.Object({})` 是“无特殊实例配置”的源码表达，UI/API 可以不传 `input`，运行时会按 `{}` 校验。
- 模板不创建特殊 TSX 节点来表达 system prompt，也不把 system prompt 写进 JSX `<Message role="system">`。推荐先复用 active v3 的 `prepare(ctx) -> PreparedTurn` 合同：简单模板可写 `const systemPrompt = "...";`，长模板可写 `function renderSystemPrompt(): string { return `...`.trim(); }`，然后在 `prepare()` 中返回 `{ systemPrompt: renderSystemPrompt(), ... }`。可视化编辑器可以把这个字符串源码 range 当作“System Prompt”编辑区，但这只是 UI 节点，不是新的 runtime TSX 节点。
- 不使用 `<Message role="system">` 表达 provider 级 system prompt 的原因：Pi/当前 v3 的 provider 入口是 `Context.systemPrompt?: string`；迁移文档已决定不 fork Pi 的 message union 去加入中间 `SystemMessage`。如果后续重新引入 JSX DSL，也应先设计一个 active runtime 可执行的 `SystemSet` / prompt builder，而不是在模板里临时创造特殊节点。
- 模板固定导出 `profileManifest`，推荐形态是 `export const profileManifest = {...} as const`，再传入 `defineAgentProfile({ manifest: profileManifest, ... })`。这样 Workbench 能稳定定位并辅助编辑 key、name、description，不需要在 `defineAgentProfile()` 的对象字面量里做脆弱匹配。
- 模板固定导出顶层 `allowedToolKeys` 数组，推荐形态是 `export const allowedToolKeys = [...] as const`。工具 checklist 第一版只编辑这个稳定数组；如果用户改成复杂表达式，Workbench 降级为只读展示和源码编辑，不尝试重写表达式。
- 模板默认 `prepare(ctx)` 保持最小，只返回 `systemPrompt` 和 `toolKeys`，不默认塞入 `dynamicMessages` / `appendingMessages`。是否把 Workspace、history、实例 input 或 invocation 内容渲染进上下文由 profile 作者决定。
- `ProfilePrompt` 可视化辅助编辑第一版只承诺编辑稳定源码 range：`profileManifest`、`systemPrompt` 和顶层 `allowedToolKeys`。`dynamicMessages`、`appendingMessages`、helper function 和条件逻辑先只读预览或源码编辑，避免把任意 TypeScript 逻辑误当成可视化节点树。
- `InputSchema` 和 `OutputSchema` 产品语义上都可以为空，但源码模板仍显式导出 schema 常量：
  - `InputSchema` 为空表示源码中导出的 `InputSchema = Type.Object({})`，也就是普通 agent，没有特殊实例配置；创建 session 时可不传 `input`，任务通过 invoke 对话传入。
  - `OutputSchema` 为空表示源码中导出的 `OutputSchema = Type.Object({})`。
  - `OutputSchema = Type.Object({})` 且允许 `report_result`，表示该 agent 仍走 report 完成协议，但 `report_result` 参数只有一个通用 `walkthrough`，没有特别结构化参数限定。
  - `OutputSchema = Type.Object({})` 且不允许 `report_result`，表示不走 report 完成协议，`invoke_agent` 按普通 completion / finalMessage 处理。
  - `OutputSchema` 非空时，`report_result` 的结构化 payload 按该 schema 校验。
- 空 `OutputSchema` 不等于 warning。是否要求 report 完成协议由 `allowedToolKeys` 是否包含 `report_result` 决定；`OutputSchema` 只决定 report payload 是否有额外结构约束。
- `report_result.data` 可以做类型标注：实现阶段应按当前运行目标 profile 的 `OutputSchema` 动态派生模型可见 tool schema。`OutputSchema = Type.Object({})` 时 schema 只有 `{ walkthrough: string }`；非空 `OutputSchema` 时 schema 是 `{ walkthrough: string, data: OutputSchema }`，其中 `data` 必填并由 TypeBox 校验。这样模型在调用工具时能看到 `data` 的 JSON Schema，而不是依赖提示词描述。
- 模板必须导出 `OutputSchema`，即使它是 `Type.Object({})`。不推荐导出的是另一份手写的 `report_result` 参数 schema 或 `ReportResultSchema`：`report_result` 的模型可见参数应由当前目标 profile 的 `OutputSchema` 和 `allowedToolKeys` 动态派生，避免 `OutputSchema`、工具 schema 和 UI 展示形成多个真相源。
- `/tsx-profile-editor.preview` 面向开发者和调试，不作为普通用户主入口。
- Workbench 编辑器本身不内置 profile 文件清单；user-assets 外层入口如需提供列表，只扫描用户 profile 根 `workspace/.nbook/agent/profiles`，不扫描系统级 profile。调用方可以直接指定一个受控相对文件打开，用于开发调试或特定入口。
- Profile Workbench 是通用 TSX 低代码编辑器的产品化调用方；已调好的旧可视化编辑器 UI 作为基底，只做适配新 TypeBox profile/runtime 的微调，不重新设计 UI。所谓“复用旧解析服务”只是实现层是否迁移旧 AST/round-trip 逻辑的问题，不改变 UI 基底。
- “文件源码详情”是区别于 runtime detail 的概念：坏 `.profile.tsx` 无法作为 runtime profile 加载时，仍可以按 `fileName` 读取源码、展示 diagnostics，并尝试解析可视化 `ProfilePrompt` 片段。
- 模板 TSX 文件放在系统 assets 的非 runtime profile 目录，例如 `assets/workspace/.nbook/agent/profile-templates/*.profile-template.tsx`；模板不是可运行 profile，不进入 `agent/profiles` catalog。
- 新建 profile 从模板生成时只做少量占位替换：`profileManifest.key`、`name`、`description` 和初始 system prompt 文本；不引入复杂模板引擎。
- 新建模板优先贴合 active v3 `PreparedTurn` 合同，同时让 system prompt 与动态/appending 消息源码 range 尽量稳定，便于可视化辅助编辑做局部 round-trip。纯函数式 `prepare()` 的好处是 TypeScript 逻辑更自由、类型推导更直接、对复杂动态 prompt 更自然，也更适合未来 LSP/代码审查；缺点是无法天然得到旧 `ProfilePrompt` 节点树。第一版先不为 system prompt 创造特殊 TSX 节点；是否重新引入 JSX DSL 作为 active v3 prompt builder，后续单独评估。
- 模板文案默认使用中文；变量名、profile key、文件名和 TypeScript 标识符保持英文。
- 第一版模板数量先收敛为两个：普通 `basic-agent` 与结构化 `report-agent`。
- `basic-agent` 模板默认只允许读取能力，避免用户刚创建的普通 agent 默认获得写文件或 shell 权限；后续再通过工具权限选择器扩展。
- `report-agent` 模板默认使用 `OutputSchema = Type.Object({})` + `report_result`，表示只要求通用 `walkthrough`。结构化输出示例可以作为后续单独模板或示例，不放进默认 `report-agent`，避免普通 report agent 一开始就被 schema 概念干扰。它可以保留必要的读取能力，但不默认给写文件工具。
- Prepare preview 的 input 编辑第一版使用 JSON textarea/editor，不根据 InputSchema 生成表单；schema 表单留给后续 TypeBox Schema Builder / preview helper。
- `allowedToolKeys` 第一版仍以源码为真相源。Workbench 可以提供 checklist 辅助编辑，但只在能稳定定位 `const allowedToolKeys = [...]` 或等价数组 literal 时做局部替换；找不到稳定数组时只读展示，不重写复杂表达式。
- 工具权限选择器第一版不按危险等级做复杂分组，保持简单 checklist。模板默认只勾选读取能力；`report-agent` 额外勾选 `report_result`。
- `bash` 默认不选。用户勾选时显示强警告，说明它允许执行命令，风险高于普通读写工具。
- `report_result` + `OutputSchema = Type.Object({})` 在 UI 中命名为“通用报告模式”，说明该 agent 需要通过 `report_result` 完成，但只提交必填 `walkthrough`。
- `OutputSchema` 非空但没有选择 `report_result` 时不阻止创建或保存，只展示轻 warning：结构化输出 schema 当前没有提交工具，运行时不会校验输出。
- `OutputSchema` 非空但没有选择 `report_result` 时的 warning 文案应明确表达“schema 已定义但当前没有提交点”，而不是把它描述为错误。该状态合法，只是运行时不会强制收集或校验结构化输出。
- 新建模板始终导出 `export type Input = Static<typeof InputSchema>` 与 `export type Output = Static<typeof OutputSchema>`。即使 `OutputSchema = Type.Object({})`，也导出 `Output`，保证 typegen 和 profile 模块骨架一致。
- 如果 `profileManifest.key` 与文件名不一致，编辑器只展示 warning，不自动移动、重命名或改写文件名。
- 保存源码后不自动跑完整 typecheck/profile check。保存后只做轻量 source diagnostics 和必要的当前文件状态刷新；显式“验证”按钮再跑 profile check 或 prepare preview。
- 显式“验证”按钮第一版跑三类检查：源码/契约检查、真实 `prepare()` preview、以及当前 profile 派生出的模型可见 `report_result` 参数 schema preview。验证结果应让用户同时看到“能不能加载”“prepare 会产出什么”“模型实际会看到什么工具参数”。
- 暂不为本任务单独建立 ADR；当前 walkthrough 足够记录这些实现边界。若后续正式改变 runtime catalog 的坏文件语义，再评估 ADR。
- 用户 profile 文件清单若由外层提供，应包含 runtime loader 支持的 `.profile.tsx`、`.profile.ts`、`.profile.mjs`、`.profile.js`；新建模板默认生成 `.profile.tsx`。

## Implementation Plan

1. 文档对齐
   - 新建本文档作为当前任务 walkthrough。
   - 在旧相关任务文档顶部标注过期方向，链接到本文档。
   - 后续实现阶段继续更新 `PROJECT-STATUS.md`。

2. Workbench UI 第一版
   - 在 user-assets Header 或侧边入口恢复 Profile Workbench 入口。
   - 基于恢复后的 `app/pages/tsx-profile-editor.preview.vue` 与 `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` 调整，不重做一套完全独立 UI。
   - 保留旧版三栏 UI 骨架：左侧组件库，中间可视化画布，右侧源码/属性/变量/运行时/Agent tabs，顶部工具栏放 profile 选择和主要动作。
   - 拆分外层 host 与 Workbench 编辑器组件：host 决定可见 profile、当前文件和入口权限；编辑器组件只编辑传入的受控 TSX fileName。
   - Runtime catalog 列表展示可加载 profile 的 key、来源、覆盖状态、load status、schema locked、canEdit/canRestore；坏 profile 文件不放进运行时 catalog。
   - Workbench 编辑器不内置 profile 文件清单；user-assets host 如需列表，只扫描用户 profile 根，不扫描系统级 profile。调用方可以直接指定受控相对文件打开。
   - Workbench 另行提供按 `fileName` 定位的文件源码详情或 diagnostics 入口，用于打开、保存和修复坏 `.profile.tsx`。
   - Detail 面板展示源码摘要、manifest、allowed tools、InputSchema/OutputSchema JSON、issues。
   - 保留源码编辑面板作为主编辑路径；同时保留 `ProfilePrompt` 可视化辅助编辑，用于查看和编辑可解析 prompt 区域。第一版如果模板使用 active v3 `systemPrompt` / messages 数组，则可视化编辑器先解析这些稳定源码片段，不强依赖 `<ProfilePrompt>` JSX。
   - 可视化辅助编辑解析失败时，源码编辑仍是唯一真相源；可视化区只做降级展示，不阻止保存。
   - 保存冲突不在编辑器内重造弹窗，优先调用外层或共享保存 wrapper，复用 user-assets 既有保存冲突处理。
   - 如复用旧 `ProfileTemplateVisualEditor`，必须先去掉旧 tombstone API 依赖和旧 `leader/subagent` / Zod Schema Builder 假设。

3. 最小写入 API
   - 删除旧 `profile-templates` / `user-profile-templates` API，不做旧合同兼容。
   - 基于当前 v3 runtime 重新设计新的 `/api/agent/profiles/*` 写入 API。
   - 写入 API 统一使用 `fileName` 定位 profile 文件；不要要求坏文件先能解析出 `profileKey`。
   - 写入 API 默认只写用户 profile 根；不提供系统 profile 编辑能力。
   - 新建 profile：从系统 profile template 复制生成标准 TypeBox `defineAgentProfile` 骨架；推荐 key 为 `agent.<slug>`，但不强制。
   - Profile template 放在非 runtime profile 目录，扩展名使用 `.profile-template.tsx`，避免 runtime catalog 扫描。
   - 模板占位替换保持简单，只替换 key、name、description 和初始提示词。
   - 第一版模板只提供 `basic-agent` 和 `report-agent`。两者都导出 `InputSchema = Type.Object({})`、`OutputSchema = Type.Object({})`、`Input` 和 `Output`；`basic-agent` 默认只给读能力，`report-agent` 默认允许 `report_result`，表示只要求通用 `walkthrough`。
   - 模板固定导出 `profileManifest` 和顶层 `allowedToolKeys`，方便 Workbench 做稳定源码 range 辅助编辑。
   - 模板不额外导出手写的 `report_result` 参数 schema；运行时和预览面板统一从目标 profile 的 `OutputSchema` 派生工具参数。
   - 工具权限 checklist 只做稳定数组的局部辅助替换；复杂 `allowedToolKeys` 表达式保留源码编辑。`bash` 默认不选，勾选时提示高风险。
   - 恢复系统版本：删除用户覆盖文件。
   - 写入后刷新 profile catalog，不自动恢复坏文件。

4. 自定义 profile / agent 闭环
   - 新建 profile contract 正确时能出现在 runtime catalog 中。
   - `POST /api/agent/profiles/detail` 能返回源码、manifest、schema、allowed tools 和 issues。
   - `POST /api/agent/profiles/preview-prepare` 能用自定义 input 预览真实 `prepare()` 输出。
   - `POST /api/agent/sessions` 能使用自定义 `profileKey` 和可选 `input` 创建 session；默认空实例配置的 profile 可以不传 `input`。UI 不在新建成功后自动创建 session。
   - 对新建后立即可运行的验证是链路验证，不是自动启动：文件落盘 -> catalog 加载 -> detail/preview 正常 -> sessions API 可创建。
   - 用户能通过 Profile Workbench 的源码编辑和 `ProfilePrompt` 可视化辅助编辑查看、编辑 TSX 文件。
   - Agent 可通过普通文件工具编辑 `workspace/.nbook/agent/profiles/**/*.profile.tsx`，修改后由 catalog/check/preview 验证。

5. Prepare Preview
   - 继续使用真实 `profile.prepare()` 预览。
   - 第一版支持 JSON input、简单 history 和当前 workspace context；这里的 input 是 agent 实例初始化参数，不是每轮任务 prompt。input 编辑器先用 JSON textarea/editor，不从 InputSchema 自动生成表单。
   - 不调用 LLM、不创建真实 session、不写 session metadata。
   - 显式验证同时展示 runtime profile 契约检查、prepare preview 和动态 `report_result` 参数 schema preview。

6. 后续辅助编辑
   - TypeBox Schema Builder 基于当前 v3 profile 经验重新设计；只在 TypeBox schema 可稳定定位时做局部辅助替换。
   - 复杂 prompt/helper/schema 都保留源码编辑或 Agent 辅助编辑。
   - 第一版不把 TypeBox Schema Builder 写入验收；只要求新建模板解释 `InputSchema = Type.Object({})` 与 `OutputSchema = Type.Object({})` 的语义，模板始终导出 `Input` / `Output` 类型。
   - 后续实现 `report_result` 新语义时，需要把当前 `result/data` 工具参数调整为按目标 profile 派生的动态 schema：`OutputSchema = Type.Object({})` 只暴露并校验 `walkthrough`，非空 OutputSchema 暴露并校验 `walkthrough + data`，其中 `data` 的模型可见类型来自 `OutputSchema`。
   - `ProfilePrompt` 可视化辅助编辑写回后是否自动跑 prepare preview、源码保存后是否自动刷新 runtime catalog/detail，先调研旧编辑器节奏、当前 dynamic import/cache 行为和 UI 成本后再决定。

## Files Changed

- `docs/tasks/tsx-profile-workbench/README.md`
- `docs/tasks/pi-agent-harness-migration/README.md`
- `assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx`
- `assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx`
- `app/components/profile-template-editor/ProfileTemplateHeader.vue`
- `app/components/profile-template-editor/ProfileTemplateInspectorPanel.vue`
- `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue`
- `app/components/profile-template-editor/UserProfileWorkbenchDialog.vue`
- `app/components/novel-ide/NovelIdeHeader.vue`
- `app/pages/index.vue`
- `app/pages/tsx-profile-editor.preview.vue`
- `server/api/agent/profiles/*`
- `server/agent/profiles/profile-source-check.ts`
- `server/agent/profiles/workbench-service.ts`
- `server/agent/profiles/report-result-schema.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/agent/tools/tool-registry.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `shared/dto/agent-profile.dto.ts`
- `shared/dto/profile-template.dto.ts`
- `server/agent/test/setup.ts`

## Verification

- `bunx vitest run server/agent/profiles/workbench-service.test.ts server/agent/profiles/report-result-schema.test.ts server/agent/profiles/catalog.test.ts` 通过，覆盖模板发现、受控 `fileName`、新建 profile 加载、临时源码覆盖不写入真实用户 profile 文件、runtime catalog 与 report_result schema 派生。
- `bun run typecheck` 仍失败，但剩余错误来自本轮前已存在的无关 Novel IDE/settings/index 类型问题：
  - `app/components/novel-ide/NovelAgentDrawer.vue` 的 `modelKey`
  - `NovelIdeAgentProfileDefaultSettingsPanel.vue` / `NovelIdeAgentProfileModelSettingsPanel.vue` 的 `defaultProfileKey`
  - `app/pages/index.vue` 的 `workspaceKind/currentNovelId`
- 未自动做浏览器验证；按项目规则需要用户明确要求后再打开浏览器检查 UI。

## TODO / Follow-ups

- 后续补 TypeBox Schema Builder，只在能稳定定位 `InputSchema` / `OutputSchema` 源码 range 时做局部替换。
- 后续补完整 `allowedToolKeys` checklist 局部替换；当前 UI 只读展示工具权限，源码仍是真相源。
- 后续补完整 `ProfilePrompt` / messages AST round-trip；当前只提供 System Prompt 占位节点。
- 后续按用户要求做浏览器交互验收：新建、保存坏文件、验证、创建 session、preview debug route。
