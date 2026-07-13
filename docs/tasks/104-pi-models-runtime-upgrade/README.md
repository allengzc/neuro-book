# Pi Models Runtime Upgrade

> Status: Implemented（升级与合同收口完成；真实 Provider / Docker / 浏览器验证未执行）
>
> Target baseline: `@earendil-works/pi-ai@0.80.6` and `@earendil-works/pi-agent-core@0.80.6`

## Relative documents refs

- [Task 02 Pi Agent Harness Migration](../02-pi-agent-harness-migration/README.md)
- [Task 03 Config System](../03-config-system/README.md)
- [Task 86 Pi Request Observability](../86-pi-request-observability/README.md)
- [Pi Agent Harness Research](../../research/pi-agent-harness.md)
- [Project Status](../../../PROJECT-STATUS.md)
- [Pi v0.75.4...v0.80.6](https://github.com/earendil-works/pi/compare/v0.75.4...v0.80.6)
- [Pi old global API migration](https://github.com/earendil-works/pi/blob/v0.80.6/packages/ai/README.md#migrating-from-the-old-global-api)

## User Request / Topic

- 将 NeuroBook 当前锁定的 Pi 依赖从 `0.75.4` 系统性升级到 `0.80.6`。
- 不通过 `@earendil-works/pi-ai/compat` 留下临时兼容层。
- 方案必须基于真实调用面，不脱离现有 Config、Agent Harness、Provider 多实例和 Product 打包结构。
- 不用 hack 绕过新版 Provider 所有权模型，不破坏类型系统，不留下待清理的双轨运行时。
- 不顺手扩张成 Pi OAuth、Pi CredentialStore 或 Pi 高层 AgentHarness 重构。
- 重要产品边界或体验取舍在实施前交给用户决策。

## Post-implementation hardening audit（2026-07-12）

首轮实施完成后的全链路审查确认主体迁移可运行，但发现以下合同缺口，本任务重新打开并在原 walkthrough 内收口，不新建碎片任务：

- runtime 选择只检查显式 API override，导致 `providerConfigId !== model.provider` 且 API 继承 registry 的本地连接误走共享 builtin runtime。
- Agent turn、compaction 与健康检查各自维护 request options 白名单，且会静默丢弃配置字段。
- Pi `streamSimple` 不会转发任意 API 专用 options；正式合同收紧为 `0.80.6` 中已确认实际生效的 JSON-safe simple options，未知或 runtime-owned 字段明确失败。
- 自定义 OpenAI-compatible 空 API key 需要在 NeuroBook/Pi 边界显式适配无认证端点；Bedrock API key 需要映射为 `AWS_BEARER_TOKEN_BEDROCK` provider env。
- app logger 已有独立日志脱敏，原始 `Error` cause 不是已确认泄漏；真正缺口是 Provider sanitizer 与日志脱敏规则分裂，以及 `sidecar_error` SSE 直接暴露原始错误文本。
- 价格覆盖数据合同已完成，但继承状态尚未展示 registry 的实际基础价格与 tiers 摘要。

本轮冻结语义沿用 Task 18：单个 RunFrame 及其 turn/tool loop/compaction/sidecar 使用同一 binding；waiting/resume 沿用同一逻辑 `invocationId`，但 resume 重新进入 `prepareRun` 并读取当前配置。`Models`、API key 和 request options 不跨进程持久化。

### Hardening implementation results

- runtime 选择已收敛为唯一分类函数：只有正式 builtin 配置（`providerConfigId === model.provider`、无显式 API override、builtin Provider 支持 resolved API）复用进程级 `Models`；本地同类连接、override、未知 Provider 或 builtin 不支持的 API 均创建 invocation 私有 runtime。
- 新增共享 `PiSimpleRequestOptionsSchema` 与统一解析器，Agent turn、sidecar、自动/手动 compaction、健康检查和 runtime hook 共用同一合同。正式支持 `temperature`、`headers`、`websocketConnectTimeoutMs`、`maxRetries`、`maxRetryDelayMs`、`metadata`、`env`、`transport`、`cacheRetention`、`thinkingBudgets`；未知、类型错误、runtime-owned 或 Pi `streamSimple` 不会转发的字段均明确失败。
- 自定义 OpenAI completions/responses 在 API key 为空时使用仅存在于当前请求内的 no-auth 占位 key，以兼容无认证端点；Bedrock API key 映射到 `AWS_BEARER_TOKEN_BEDROCK` provider env，空 key 保留 AWS ambient credential chain。Anthropic、Google 等 adapter 的无 key 行为保持明确失败。
- app logger 与 Provider error sanitizer 共用无副作用的敏感文本清洗底座；Bearer、Basic、authorization、cookie、set-cookie、API key、token、secret 和常见裸 `sk-*` 均覆盖。Provider 错误继续执行 4,000 字符上限，`sidecar_error` SSE 也只发送清洗后的文本。
- 模型设置父组件继续作为 Pi catalog/effective metadata 的唯一解析者；Dialog 在继承状态展示四项实际价格和逐 tier 摘要，registry 缺失时明确显示无可用继承价格，不再用 0 冒充继承值。
- 未增加第二套 Provider seam、测试生产后门、持久化 runtime binding 或兼容分支；Faux 测试仍通过正式 runtime resolver 注入 suite 私有 `Models`。

## Goal

将 NeuroBook 的 Pi LLM 边界从 `0.75.4` 的全局 API 完整迁移到 `0.80.6` 的 `Models + Provider` 模型，验证内置 Provider、自定义 OpenAI-compatible Provider、同类 Provider 多连接、Agent turn、compaction、模型健康检查、请求观测和 Product runtime 均可工作；同时完整承接 `max` thinking 和长上下文价格 tier。迁移完成后，生产代码和测试不得导入 `/compat`，不得继续依赖全局 provider registry，旧 API guard 必须阻止回归。

如果新版 Provider API 无法在不破坏当前“Global Config 是 Provider 真相源、invocation 固定配置快照、同类 Provider 可多连接”的前提下表达需求，则停止实现，记录最小复现、受影响边界和可选设计，交由用户决策，不以类型断言或隐藏分支绕过。

## Success Criteria

- `package.json` 与 `bun.lock` 中两个 Pi 包版本一致，固定为经本任务审计的目标版本。
- 生产代码不再使用以下旧全局 API：
  - `stream` / `streamSimple` / `complete` / `completeSimple`
  - `getModel` / `getModels` / `getProviders`
  - `registerApiProvider` / `registerFauxProvider`
- 全仓不得导入 `@earendil-works/pi-ai/compat`。
- Provider catalog 使用新版内置 catalog，能暴露 Ant Ling、NVIDIA、Z.AI Coding CN 等 `0.80.6` 实际正式显示名。
- 同一个 Pi Provider 的两份本地连接使用各自 API key/base URL，不串配置、不共享错误状态。
- 自定义 OpenAI-compatible Provider 仍能使用当前 Config 中的 `api`、`baseURL`、headers、timeout、reasoning 和 compat 配置。
- `max` thinking 能通过 DTO、配置、session command、前端选择器和 provider request 全链路传递。
- `cost.tiers` 不会在 catalog、Config、模型解析或费用计算过程中丢失。
- Faux 测试使用实例化 `Models`，测试之间没有全局 provider registry 污染。
- Pi trace 继续捕获 payload、响应元数据和 TTFT，但新版错误响应正文经过统一清洗和长度限制。
- Nitro build、Docker runtime 和 Windows Portable 均包含新版 Pi 运行依赖闭包。

## Non-goals

- 不把 NeuroBook Agent 主循环替换成 Pi `Agent` 或高层 `AgentHarness`。
- 不迁移 NeuroBook JSONL session、approval、sidecar、linked agent 或 Profile DSL 语义。
- 不在本任务加入 Pi OAuth 登录 UI、订阅 Provider 登录或持久化 `CredentialStore`。
- 不重做模型设置页整体布局。
- 不为了理论上的 bundle 最小化，为每个 Provider 建立一套手写动态 import 框架。
- 不保留旧/新两套 Pi runtime 供配置切换。
- 不使用 `/compat` 作为“先升级再说”的中间正式状态。

## Current State

### Dependency baseline

- `package.json`：
  - `@earendil-works/pi-agent-core: ^0.75.4`
  - `@earendil-works/pi-ai: ^0.75.4`
- `bun.lock` 实际锁定两个包为 `0.75.4`。
- `^0.75.4` 在 `0.x` semver 下不会跨越到 `0.76.0`，因此当前不会自动获得后续 Provider/model 更新。
- 当前开发机：Node `24.13.0`、Bun `1.3.14`；Pi `0.80.6` 要求 Node `>=22.19.0`，运行时版本不是当前阻塞项。

### Production API usage

旧全局 API 的生产调用集中在四个边界：

1. `server/agent/observability/traced-provider.ts`
   - 统一包装 `streamSimple` / `completeSimple`。
   - Agent turn 与 compaction 都经过该入口。
2. `server/agent/harness/model-resolver.ts`
   - 从 Global/Project effective config 解析具体 Pi `Model`。
   - 使用 `getModel()` 继承 Pi catalog metadata。
   - 用 `providerConfigId` 区分本地 Provider 实例与 Pi Provider ID。
3. `server/utils/model-settings.ts`
   - Provider/model 健康检查。
   - 内置模型目录 metadata 合并。
4. `server/api/config/models/pi-catalog.get.ts`
   - 返回设置页可添加的内置 Provider/model catalog。

其他生产文件主要消费 Pi message/event/tool/type，不直接依赖旧全局 registry。

### Test usage

- 当前至少 9 个测试文件使用 `registerFauxProvider()`。
- Faux provider 注册在全局 registry，测试需要手工 unregister。
- 新版推荐 `fauxProvider() + createModels() + models.setProvider()`，应借升级消除全局可变测试状态。

### Existing NeuroBook invariants

- Global Config 是 Provider/API key 真相源；Pi `auth.json` 不是 NeuroBook 运行时配置源。
- Project Config 只能覆盖默认模型/Profile 模型参数，不能覆盖 Provider 列表/API key。
- invocation 开始时冻结 effective config；运行中保存配置只影响后续 invocation。
- Session 持久化具体模型选择，但不得持久化 Provider 函数对象或 `Models` 实例。
- 一个 Pi Provider 可以在 Global Config 中添加多份本地连接。
- `providerConfigId` 负责定位本地 API key；`model.provider` 当前表达 Pi Provider 类型。
- Agent turn、compaction 和健康检查必须走统一可观测入口。
- Product 构建通过 `patch-nitro-runtime-deps.mjs` 复制 runtime package dependency closure。

## Upstream Changes Relevant to NeuroBook

### Breaking API change

- `0.80.0` 将旧全局 API 移出包根入口。
- `/compat` 只用于迁移，官方明确会在未来删除。
- 新主路径是 `Models` collection 持有 Provider，由 Provider 拥有 model catalog、auth 和 stream 行为。

### Model and Provider changes

- 新增 Ant Ling、NVIDIA NIM、ZAI Coding Plan (China)。
- `zai` 显示名改为 ZAI Coding Plan (Global)。
- 新增 Claude Opus 4.8、Claude Fable 5、Claude Sonnet 5、GPT-5.6 系列等 metadata。
- OpenAI 默认模型、上下文窗口、reasoning metadata 和 Codex transport 有多轮调整。

### Contract changes

- Thinking level 新增 `max`。
- Model cost 新增 request-wide `tiers`。
- Provider HTTP error 开始包含响应正文。
- `Usage.reasoning` 可记录 provider 返回的 reasoning token。
- Provider-scoped `env`、request auth、headers 与 timeout 行为增强。
- Streaming content block 允许交错；NeuroBook 已按 `contentIndex` 合并，当前方向正确。

## Target Architecture

### 1. Static catalog and runtime execution are separate

- 内置 Provider/model 目录只读使用 `getBuiltinProvider(s)` / `getBuiltinModel(s)` 或等价新版 catalog API。
- Catalog API 不依赖当前用户 API key，也不创建业务配置。
- Runtime streaming 不再通过 catalog 静态函数隐式调度，必须由明确的 `Models` 实例执行。

### 2. Resolve a runtime binding, not only a Model object

模型解析结果从单一 `ResolvedPiModel` 扩展为运行时 binding，概念形态：

```ts
type PiModelBinding = {
    model: Model<Api>;
    models: Models;
    providerConfigId: string;
    apiKey?: string;
    timeoutMs?: number;
    requestOptions: Record<string, JsonValue>;
};
```

边界要求：

- `Models` 是当前进程内运行对象，不进入 session JSONL、DTO 或 Config。
- Session 继续保存可序列化的具体模型和本地 model key。
- invocation frame 持有 binding；同一次 turn、tool loop 和 compaction 使用同一冻结配置来源。
- `traced-provider` 接收 `Models` 或 binding，不能再自行读取 Global Config。

最终类型名以实现时现有领域语言为准，不为了与示例一致额外造层。

### 3. Built-in Provider execution

- 内置 Provider 使用 Pi 官方 provider factory 或 `builtinModels()` 注册结果。
- NeuroBook 仍显式传入 Config 中解析出的 `apiKey`、base URL、headers、timeout 和 request options。
- 对同一个 Pi Provider 的多份本地连接，调用时使用各自冻结的 binding；不得把 API key 写入共享 Provider 对象。
- `model.provider` 保持 Pi 可识别的 Provider ID；本地连接身份继续由 `providerConfigId` 表达。

### 4. Custom Provider execution

- 自定义 Provider 使用 `createProvider()` 注册到独立 `Models` collection。
- 当前支持的 Pi API adapter 必须形成显式、类型化的 API 映射；遇到未知 API 直接返回配置错误。
- 不以 `as any` 把任意字符串塞进 Provider API map。
- `baseURL` 和 compat 继续以最终 resolved model 为准。
- 一个 custom binding 只服务当前冻结配置；不建立可变的进程级 custom provider registry。

### 5. Observability remains the single provider call seam

- `tracedStreamSimple` / `tracedCompleteSimple` 保留为业务统一入口。
- 它们改为委托 `models.streamSimple()` / `models.completeSimple()`。
- `onPayload`、`onResponse` 合并语义不变。
- Provider error body 进入 trace 前统一：
  - 清除 bearer/API key/secret/cookie 等显著凭据。
  - 设置合理字符上限。
  - 明确标注截断。
- 不在多个 caller 各自复制清洗规则。

### 6. Test runtime is instance-scoped

- 建立小型 test fixture，返回 `faux` handle、`Models` 和 model。
- 每个测试或测试 suite 独立创建实例。
- Harness/compaction/trace 测试通过正常依赖注入传入 `Models`，不提供“测试专用全局后门”。
- 删除所有 `registerFauxProvider()` / `unregister()` 全局注册模式。

## Design Constraints

- 不改变 Task 03 的配置分层和 secret 语义。
- 不让 Provider runtime 反向读取前端草稿或未保存 Config。
- 不把 API key 放进 model、session entry、trace request context 或错误日志。
- 不让 catalog 请求触发 OAuth、远程模型刷新或 Provider 网络请求。
- 不把 runtime binding 混入 shared DTO。
- 不为只调用一次的简单转换过度抽函数；真正复用的 Provider 构造、API 映射和错误清洗才建立公共边界。
- 不重新实现 Pi 已提供的 Provider/model catalog、cost calculation、thinking clamp 或 auth option 合并。
- 遇到 Pi 新类型无法表达现有自定义 Provider 能力时停止并报告，不使用 `unknown`/`any` 隐藏设计问题。

## Decisions / Discussion

### D1 — Upgrade strategy

Decision: 直接迁移到新版 `Models` API，不使用 `/compat`。

Reason:

- `/compat` 已声明未来删除。
- NeuroBook 已有统一 provider seam，迁移范围可控。
- 使用 `/compat` 只会把同一迁移推迟并形成双重测试成本。

### D2 — Runtime ownership

Decision: NeuroBook 拥有 `Models` runtime binding；Pi 不读取 NeuroBook Config。

Reason:

- Config snapshot、Provider 多实例和 Project override 是 NeuroBook 领域规则。
- Pi Provider 负责协议和 stream，不负责决定当前 Project 使用哪个本地连接。

### D3 — No Pi OAuth in this task

Decision: 本任务继续只使用 NeuroBook Global Config 中的 API key/endpoint，不接入 Pi OAuth、订阅登录或持久化 CredentialStore。

Reason:

- OAuth 是独立的产品、存储和交互设计。
- 它不是完成依赖升级的必要条件。
- 把 OAuth 混入本任务会显著扩大设置页、secret storage 和 refresh lock 范围。

### D4 — Cost tier editing surface

Decision: 本轮完整支持 `cost.tiers` 的读取、保存、继承、运行时计算和逐 tier 可视化编辑。

Reason:

- 数据不丢失和费用正确是升级必须项。
- 用户需要在模型编辑 Dialog 中直接新增、删除和修改 tier，避免必须手工编辑配置文件。
- 价格覆盖采用原子完整覆盖：`cost: null` 完整继承 Pi registry；启用覆盖时复制当前有效基础价与 tiers；覆盖状态下四个基础价格全部必填；恢复继承时一次清除基础价和全部 tiers。
- tier threshold 必须唯一、保存时升序排列，并保持 Pi 的“input tokens 严格大于 threshold”匹配语义。

### D5 — Custom API support

Decision: 自定义 Provider 只允许 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 和 `bedrock-converse-stream`。

Reason:

- 新版 Provider API map 是显式协议合同，不应继续接受无法验证的任意字符串。
- 历史未知值可以读取，但保存或运行时必须明确报“不支持的 Pi API”，不得猜测或回退。
- 设置页移除任意 API 字符串输入，改为受支持 adapter 的有限选择。

### D6 — Version selection

Decision: 本任务按 `0.80.6` 精确版本实施，不使用浮动 `latest` 或 caret 范围。

If implementation begins after a newer Pi release exists, first append a delta audit to this task; do not silently change target.

## Implementation Plan

### Phase 0 — Baseline and contract tests

- 记录 `0.75.4` 当前聚焦测试结果，避免升级后把既有失败误判为回归。
- 为以下现有行为补最小契约测试，只补当前缺口：
  - 同一 Pi Provider 的两份本地连接分别解析 API key。
  - 自定义 provider base URL/model compat 保留。
  - catalog 不读取 secret、不发网络请求。
  - invocation 内配置冻结。
- 不为简单类型重导出增加无价值快照测试。

### Phase 1 — Upgrade dependencies and migrate the runtime as one compile batch

- 使用 Bun 同时安装两个 `0.80.6` 精确版本，不单独升级其中一个包。
- 在现有 `server/agent` / `server/utils` 边界中选择一个唯一归属位置建立 runtime binding。
- 依赖升级、runtime 适配和首批调用迁移必须作为同一可编译批次完成；`Models` 在 `0.75.4` 不存在，不能先基于旧依赖实现新版 binding。
- 审查 lockfile 中新增的 runtime dependencies，重点包括 `@opentelemetry/api`、`@smithy/node-http-handler` 和 Mistral SDK。

- 将 builtin catalog lookup、builtin runtime provider lookup、custom provider creation 收敛到该边界。
- 建立受支持 API adapter 的显式映射和错误类型。
- 修改 model resolver 返回 model + runtime executor/binding。
- 保持 session DTO 与 JSONL 序列化结构不含运行时对象。

Exit criteria:

- 新依赖下 runtime resolver、traced provider 和至少一个调用入口可编译。
- 没有第二套平行业务入口，也没有 `/compat` 过渡层。

### Phase 2 — Migrate streaming and observability

- `traced-provider` 改用 `Models` 实例方法。
- Agent turn、compaction、健康检查统一传 binding。
- 保持事件迭代、`result()`、abort、TTFT、payload hook 语义。
- 增加 provider error body 清洗与截断测试。
- 更新 unified entry guard：禁止旧全局调用和 `/compat`。

Exit criteria:

- 生产 provider call 只存在一个入口。
- trace 开/关两种模式行为一致。

### Phase 3 — Migrate catalog and model metadata

- Catalog API 切到新版 builtin catalog。
- Provider name 使用官方显示名，不再固定等于 ID。
- 新 Provider 自动进入设置页 preset。
- 模型合并保留：
  - `thinkingLevelMap`
  - `cost.tiers`
  - compat
  - input/context/maxTokens
- 检查被 upstream 删除的 model alias 不会作为新配置继续加入。
- 已保存的历史 model ID 不做 silent rewrite；失效时沿用 Task 03 的明确 fallback/error 语义。

### Phase 4 — Extend NeuroBook contracts

- `ThinkingLevelSchema` 增加 `max`。
- 同步 session command、DTO、Config types、设置 UI、Composer、翻译和测试。
- Model cost 类型增加 tier；同步：
  - shared DTO
  - config types/normalizer/serializer
  - catalog DTO
  - model resolver merge
  - model settings save/restore
  - cost display/calculation consumers
- 检查 `Usage.reasoning` 是否需要在 DTO/trace/UI 中保留；没有消费者时允许只透传 Pi message，不新增装饰 UI。

### Phase 5 — Migrate Faux tests

- 用 `fauxProvider()` 建立实例化 fixture。
- 迁移现有 9 个全局 faux suite。
- 测试并行运行时不得互相消费 response queue。
- 删除旧 unregister 清理逻辑和全局 registry reset。
- 保留黑盒 Harness、compaction、trace、tool loop 的现有断言强度。

### Phase 6 — Integration cleanup

- 解决剩余真实类型错误，不通过全局 module augmentation 或宽泛类型断言压制。
- 更新 guard，禁止生产代码导入 `/compat` 或调用旧全局 registry API。
- 检查 package subpath exports 在 Nuxt/Nitro 中的解析。

### Phase 7 — Verification and packaging

按风险从小到大验证：

1. Pi runtime/model resolver/catalog 单测。
2. Faux provider、traced provider、compaction 聚焦测试。
3. Agent Harness 聚焦测试。
4. Agent/server 相关全量测试。
5. `bun run typecheck`。
6. `bun run nuxt:build`，确认 Nitro runtime vendor closure。
7. Product stage / Windows Portable packaging smoke。
8. Docker build smoke。
9. 用户批准后进行真实 Provider smoke；不自动浏览器验证。

真实 Provider smoke 至少覆盖：

- 一个官方内置 API-key Provider。
- 一个自定义 OpenAI-compatible endpoint。
- 同类 Provider 两份本地连接。
- 一次有 thinking 的流式回复。
- 一次 tool call。
- 一次 compaction。
- 单模型健康检查与取消。
- trace 开启/关闭各一次。

## Expected File Impact

核心生产文件：

- `package.json`
- `bun.lock`
- `server/agent/harness/model-resolver.ts`
- `server/agent/observability/traced-provider.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/compaction.ts`
- `server/utils/model-settings.ts`
- `server/api/config/models/pi-catalog.get.ts`
- `shared/dto/app-settings.dto.ts`
- `shared/dto/agent-session.dto.ts`
- `server/config/types.ts`
- `server/config/normalizer.ts`
- 模型设置和 Agent Composer thinking 选项相关 Vue/i18n 文件
- `scripts/build/patch-nitro-runtime-deps.mjs`（仅当验证证明现有闭包复制不足时修改）

测试文件：

- `server/utils/model-settings.test.ts`
- `server/agent/observability/traced-provider.test.ts`
- Harness/compaction/file-change/subject-memory 中使用 Faux provider 的测试
- catalog、config normalizer、session command 相关测试

不得因为升级顺手修改无关 Agent/Profile/Plot/World Engine 代码。

## Verification Matrix

| Surface | Required evidence | Main regression protected |
| --- | --- | --- |
| Built-in catalog | catalog API test | Provider/model 更新可见，正式名称正确 |
| Local Provider multi-instance | resolver/runtime test | API key/base URL 不串线 |
| Custom Provider | stream smoke with local faux API | 自定义 OpenAI-compatible 不失效 |
| Thinking | DTO + resolver + request payload test | `max` 不被 schema/UI 丢弃 |
| Pricing | catalog/config round-trip + cost test | `cost.tiers` 不丢失，长上下文费用正确 |
| Streaming | traced provider tests | 事件、abort、result、TTFT 不回归 |
| Agent turn | Harness faux tests | tool loop、approval、sidecar 不受影响 |
| Compaction | compaction faux tests | summary 仍用冻结模型配置 |
| Error safety | sanitizer tests | Provider response body 不泄露凭据/无限落盘 |
| Runtime packaging | Nuxt/Product/Docker smoke | lazy provider modules 和依赖闭包完整 |
| Real provider | approved smoke | SDK/协议真实兼容性 |

## Rollout / Failure Policy

- 本项目快速开发，不保留旧 runtime feature flag，也不做数据双写。
- 实施分阶段提交补丁，但主分支最终状态必须一次性切到新版 Models API。
- 如果某阶段发现 upstream API 缺陷：
  1. 先写最小复现。
  2. 判断能否通过官方公开扩展点表达。
  3. 不能表达时停止，报告 upstream 限制和候选方案。
  4. 不复制 Pi 内部私有实现，不 monkey patch package，不修改 `node_modules`。
- 依赖升级失败时可在未发布前恢复 task 分支，但不在生产代码保留旧版本 fallback。

## Risks

### High

- Custom Provider 的 Provider/API ownership 与当前任意 `Model` 分发方式不同。
- 同一 Pi Provider 多本地连接如果错误共享 auth 状态，会造成凭据串线。
- `cost.tiers` 若只改类型、不改 resolver merge，会继续静默丢失。
- Faux 测试若部分保留全局 registry，会形成难定位的并行污染。

### Medium

- Provider error body 进入 trace/session/log 的隐私风险。
- Nitro 对新版 package subpath/lazy module 的 externalization。
- 新增 Provider 和被删除 model alias 对已保存配置的影响。
- `max` thinking 对旧前端 exhaustive switch 和 DTO 的影响。

### Low

- `pi-agent-core` 当前使用的事件、工具类型和 token estimate 根导出仍存在。
- 当前前端已按 `contentIndex` 处理交错 streaming block。
- Node/Bun 版本满足要求。

## Initial Research Walkthrough

- 确认当前依赖与 lockfile 均为 `0.75.4`。
- 阅读 `v0.75.4` 至 `v0.80.6` release/change log。
- 对比新版 provider catalog，确认新增 Ant Ling、NVIDIA NIM、ZAI Coding Plan (China)。
- 阅读新版 `pi-ai` README 的旧全局 API 迁移说明。
- 定位 NeuroBook 4 个生产旧 API 边界和 9 个 Faux 测试文件。
- 确认 Task 03 的 Config snapshot/multi-provider/secret 规则必须保持。
- 确认 Task 86 的 traced provider 是正确的统一迁移 seam。
- 确认当前 `ThinkingLevelSchema` 缺少 `max`。
- 确认当前 Model cost DTO/resolver 会丢弃 `tiers`。
- 确认当前 streaming projection 已覆盖 content block 交错。
- 确认 Product runtime dependency closure 设计上可递归复制新增依赖，但仍需真实构建验证。

## Plan vs Actual

- 依赖已精确升级到 `@earendil-works/pi-ai@0.80.6` 与 `@earendil-works/pi-agent-core@0.80.6`；`package.json` 不使用 caret，`bun.lock` 锁定同版本。
- 新增唯一 `pi-runtime-resolver`：内置 Provider 共用进程级 `builtinModels()`；显式 API override、未知 Provider 或内置 Provider 无法执行的 API 使用独立 `createModels() + createProvider()`。
- `resolvePiModelFromConfig()` 保持纯 metadata resolver；`PreparedRun`、`RunFrame`、`TurnSnapshot`、sidecar 与 compaction 携带非持久化 `Models`。settleRun sidecar 改为复用 invocation 冻结 runtime，不再结束时重新读取连接配置。
- `tracedStreamSimple` / `tracedCompleteSimple` 已改为 `Models` 实例方法，健康检查也走相同 runtime 与 traced seam；统一 guard 禁止 `/compat`、旧全局 registry API 和绕开 traced seam 的生产调用。
- 新增统一 Provider error sanitizer，覆盖 trace、health-check、Run Kernel error、session lifecycle、compaction 和最终 assistant 展示/持久化边界；保留 `reasoning` / `cacheWrite1h` usage。
- Catalog 改用 `builtinProviders()`；实际 `0.80.6` 显示名为 `Ant Ling`、`NVIDIA`、`Z.AI Coding CN`，与早期 release 文案中的 “NVIDIA NIM / ZAI Coding Plan (China)” 不完全一致，实现以包内公开 Provider metadata 为准。
- `max` thinking 已进入 DTO、Config、session command、Composer、Profile 设置和中英文文案；服务端使用 `clampThinkingLevel()`。
- `cost.tiers` 已贯通 DTO、Config、normalizer、catalog、resolver、草稿往返和 Pi 费用合同；设置 Dialog 提供新增/删除/编辑 tier，执行原子完整覆盖、基础价格必填、重复阈值拒绝和保存升序排列。
- Faux 测试迁移为 suite 私有 `fauxProvider() + createModels()` fixture，移除全局 unregister/reset，并增加并行 response queue 隔离测试。
- hardening 审查后，custom connection 判定从“是否显式 override API”修正为同时检查 `providerConfigId`、override 与 builtin API 支持能力，避免同类本地连接误共享 builtin runtime。
- `requestOptions` 没有按原审查初稿透传 `serviceTier`、Bedrock 顶层 `region/profile/bearerToken` 等 API 专用字段。阅读 Pi `0.80.6` 源码确认 `Models.streamSimple()` 不会转发这些字段后，实际实现只接受可生效的 `SimpleStreamOptions` 子集；Bedrock region/profile 使用正式 `env` 表达，Config API key 单独映射为 `AWS_BEARER_TOKEN_BEDROCK`。
- 错误安全实际实现复用了 app logger 已有脱敏职责，没有把保留原始 `Error`/stack 诊断信息误判为确认泄漏；新增的是共享清洗底座、Provider 长度限制和 sidecar SSE 错误边界。
- 曾尝试增加完整 sidecar SSE 集成测试，但 Faux sidecar response queue 无法稳定表达该独立断言，测试会在业务路径前耗尽响应。最终删除该不可靠测试，没有引入测试后门；sidecar 边界由直接代码合同和共享 sanitizer 单测覆盖。
- 与计划的实现偏差：为让价格草稿测试进入正式测试矩阵，`vitest.config.ts` 新增 settings test include；Nuxt 首次构建被 `server/.agent` 下一个测试生成的旧 World Engine cache 文件拦截，删除该生成物后完整 `bun run nuxt:build` 通过，未放宽 Product portability guard。

## Verification Results

- `bun run typecheck`：通过；hardening 收尾于 2026-07-12 再次复核通过。
- Pi/runtime/model/cost/usage/trace/health-check/compaction/guard 聚焦测试：通过。
- hardening 最终聚焦组合：`8` files / `229` tests 通过，覆盖 request options、runtime resolver、Provider sanitizer、app logger、compaction、主 Harness、black-box 与 harness trace。
- Harness 聚焦：主 Harness `165/165` 通过；一次较宽 Harness 组合为 `239/239` 通过。后续高并发组合中 black-box steer 时序用例出现非确定性失败并伴随测试目录提前清理，记录为既有测试时序问题，没有修改业务代码掩盖。
- Config / model settings / shared DTO：`138/138` 通过。
- 全量 Vitest：`1698` 通过、`9` 失败、`3` 跳过。失败集中在 auth 环境开关、Profile artifact compiler 版本断言、Profile build/publisher 超时、leader assets 超时和 Harness steer 时序；均不在 Pi 变更面。独立复跑后 auth 两项与 compiler version 断言稳定复现，其他为时序性失败。
- `bun run nuxt:build`：通过；Nitro vendor 已核实包含五个 lazy API subpath、`@opentelemetry/api`、`@smithy/node-http-handler`、`@mistralai/mistralai@2.2.6`。
- `bun run product:stage`：初次升级与 hardening 收尾均通过；hardening 产物再次核实包含五个 lazy API subpath和上述 runtime dependencies。
- Windows Portable：初次升级与 hardening 收尾均通过；本轮产物位于 `.agent/workspace/task-104-hardening/neuro-book-windows-x64.zip`，zip 内再次核实包含五个 Pi lazy API 与上述 runtime dependencies。
- Docker build smoke：未执行，当前环境没有 `docker` 命令。
- 真实 Provider smoke：未执行，未获得使用现有凭据的明确授权。
- 浏览器验证：按项目约束未自动执行。

## TODO / Follow-ups

- [x] D3 已锁定：本轮不加入 Pi OAuth、订阅登录或持久化 CredentialStore。
- [x] D4 已锁定：本轮实现 `cost.tiers` 完整数据支持与逐 tier 可视化编辑，并采用原子完整价格覆盖。
- [x] D5 已锁定：自定义 Provider 仅允许五种受支持 Pi API adapter，未知值明确失败。
- [x] D6 已锁定：精确目标版本为 `0.80.6`，不随最新版本漂移。
- [x] Phase 0 baseline 与缺口测试。
- [x] Phase 1 dependency + runtime binding 同批迁移。
- [x] Phase 2 streaming/observability 迁移。
- [x] Phase 3 catalog/model metadata 迁移。
- [x] Phase 4 thinking/cost contracts。
- [x] Phase 5 Faux tests。
- [x] Phase 6 integration cleanup 与 guard。
- [x] Phase 7 typecheck / Nuxt / Product / Windows Portable 验证。
- [ ] 用户授权后执行真实 Provider smoke。
- [ ] 在具备 Docker CLI 的环境执行 Docker build smoke。
- [x] 同步 `PROJECT-STATUS.md` 并记录最终验证与残余风险。
