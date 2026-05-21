# SillyTavern RP Tooling Research

本文整理本地参考仓库中与 RP 角色卡迁移相关的机制。资料来源全部来自 `.agent/workspace/` 下的本地仓库，不依赖在线文档。

参考仓库：

- `.agent/workspace/JS-Slash-Runner`
- `.agent/workspace/JS-Slash-Runner-Doc`
- `.agent/workspace/MagVarUpdate`
- `.agent/workspace/ST-Prompt-Template`

## 总览

当前三张 SillyTavern 样本卡都或多或少使用了以下机制：

- JS-Slash-Runner / Tavern-Helper：在 SillyTavern 中运行 JavaScript，提供变量、消息、角色卡、世界书、正则、预设、提示词注入和脚本按钮等 API。
- MagVarUpdate：基于 Tavern-Helper 的 MVU 状态维护脚本，把 LLM 输出中的更新命令解析成变量变更，维护 `stat_data`、`display_data`、`delta_data` 和 `schema`。
- ST-Prompt-Template：在生成前、楼层渲染时和世界书处理中执行 EJS 模板，支持 `getvar` / `setvar`、`@INJECT`、`[GENERATE:*]`、`[RENDER:*]`、`@@if`、`injectPrompt` 等动态提示词能力。

对 Neuro Book 的启发是：不要把这些插件逐字复刻为前端脚本运行环境。第一阶段应把它们理解为“卡片作者想表达的状态系统、动态提示词规则、世界书激活策略和 UI 状态栏”，再迁移成当前项目更自然的 `roleplay/`、`lorebook/`、`reference/`、`state.md` 和后续自然语言编辑工具。

## JS-Slash-Runner / Tavern-Helper

### 定位

JS-Slash-Runner 是一个 SillyTavern 第三方扩展，用 iframe 隔离执行外部 JavaScript，并向脚本提供 `TavernHelper` API。它的 README 明确提醒执行自定义 JS 有安全风险，脚本可能读取 API key、聊天记录、修改设置或发送请求。

本地入口：

- `.agent/workspace/JS-Slash-Runner/README.md`
- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/基本用法/如何正确使用酒馆助手.md`

### 变量系统

Tavern-Helper 扩展了 SillyTavern 原本较少的变量类型。文档和类型定义列出的变量作用域包括：

- `global`：用户存档级全局变量。
- `preset`：绑定到当前预设，可随预设导出。
- `character`：绑定到当前角色卡，可随角色卡导出。
- `chat`：绑定到当前聊天文件。
- `message`：绑定到某个聊天楼层，支持 `message_id`，负数表示深度索引。
- `script`：绑定到某个脚本，脚本内可省略 `script_id`。
- `extension`：绑定到指定扩展 ID。

核心 API：

- `getVariables(option)`
- `replaceVariables(variables, option)`
- `updateVariablesWith(updater, option)`
- `insertOrAssignVariables(variables, option)`
- `insertVariables(variables, option)`
- `deleteVariable(variable_path, option)`
- `registerVariableSchema(schema, option)`

源码引用：

- `.agent/workspace/JS-Slash-Runner/src/function/variables.ts`
- `.agent/workspace/JS-Slash-Runner/@types/function/variables.d.ts`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/变量类型.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/获取变量.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/替换或修改变量.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/注册变量结构.md`

迁移提示：

- `message` 变量接近 Neuro Book 未来“某一轮 RP 后的状态快照”。
- `chat` 变量接近当前 RP session 的全局状态。
- `character` / `script` 变量说明 ST 卡常把状态绑定在角色卡或脚本上；迁移时不要默认认为所有状态都属于单个角色。
- `registerVariableSchema` 只服务变量管理器 UI，不改变运行时校验；Neuro Book 后续如果做变量系统，需要把 schema 校验放在真实写入路径上。

### 脚本树和按钮

Tavern-Helper 可以读写脚本树和脚本按钮。文档里有：

- `replaceScriptTrees(script_trees, {type})`
- `updateScriptTreesWith(updater, {type})`
- `replaceScriptButtons(buttons)`
- `updateScriptButtonsWith(updater)`
- `appendInexistentScriptButtons(buttons)`
- `replaceScriptInfo(info)`

脚本树支持 `global`、`preset`、`character` 三类来源。角色卡可以带局部脚本、脚本按钮和脚本数据。

源码/文档引用：

- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/酒馆助手脚本/创建和修改脚本.md`
- `.agent/workspace/JS-Slash-Runner/@types/function/script.d.ts`

迁移提示：

- ST 卡里的 `extensions.tavern_helper.scripts` 与 `regex_scripts` 不能直接当作本项目可执行逻辑。
- 第一阶段转换应把脚本作为 `reference/silly-tavern/{card}/raw/` 和 `inspect.md` 中的“动态逻辑说明”保留。
- 如果脚本只是状态栏或按钮交互，迁移时可转成 `roleplay/README.md` 或后续 UI TODO；如果脚本含 API 请求、外部存储或记忆系统，必须单独审查。

### 提示词注入

Tavern-Helper 也提供直接注入提示词的 API：

```ts
injectPrompts(prompts: InjectionPrompt[], options?: {once?: boolean})
uninjectPrompts(ids: string[])
```

`InjectionPrompt` 包含：

- `id`
- `position: 'in_chat' | 'none'`
- `depth`
- `role: 'system' | 'assistant' | 'user'`
- `content`
- `filter`
- `should_scan`

引用：

- `.agent/workspace/JS-Slash-Runner/src/function/inject.ts`
- `.agent/workspace/JS-Slash-Runner/@types/function/inject.d.ts`
- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/注入提示词.md`

迁移提示：

- ST 的提示词注入类似“运行时临时上下文补丁”。Neuro Book 不应把它原样迁到永久 system prompt。
- 对 RP skill 来说，应该把稳定规则写入 `roleplay/GM.md` 或 lorebook/rule；临时 session 规则写入 `roleplay/sessions/current.md`。

## MagVarUpdate

### 定位

MagVarUpdate 是基于 Tavern-Helper 的变量状态维护脚本，目标是降低状态栏和变量更新对主模型注意力的消耗。它不再依赖每轮正则扫描所有历史楼层，而是在消息生成后解析变量更新块，把状态写到消息变量中。

入口：

- `.agent/workspace/MagVarUpdate/README.md`
- `.agent/workspace/MagVarUpdate/doc/tutorial.md`

### 基本工作流

典型安装包含：

1. 在角色卡中增加局部脚本，导入 MVU bundle。
2. 增加正则隐藏 `<UpdateVariable>...</UpdateVariable>`。
3. 增加正则隐藏 `<StatusPlaceHolderImpl/>` 或状态栏占位。
4. 在世界书中放 `[InitVar]` 条目作为初始变量。
5. 在提示词中要求 LLM 生成 `<UpdateVariable>` 块。
6. MVU 在 `MESSAGE_RECEIVED` 或 `MESSAGE_SENT` 后解析更新命令，并写回消息变量。

源码引用：

- `.agent/workspace/MagVarUpdate/src/function/update/index.ts`
- `.agent/workspace/MagVarUpdate/src/function/update/on_message_received.ts`
- `.agent/workspace/MagVarUpdate/src/function/update_variables.ts`
- `.agent/workspace/MagVarUpdate/src/function/initvar/variable_init.ts`

### 数据模型

MVU 的核心数据对象是 `MvuData`：

- `initialized_lorebooks: Record<string, any[]>`
- `stat_data`：实际状态数据。
- `schema`：根据状态数据生成的结构约束。
- `display_data`：显示用变更记录，例如 `旧值->新值 (原因)`。
- `delta_data`：本轮变更记录。

`stat_data` 支持嵌套对象、数组和 ValueWithDescription：

```ts
type ValueWithDescription<T> = [T, string]
```

即很多变量写成：

```json
{
  "好感度": [15, "[-100,100]之间，随互动更新"]
}
```

引用：

- `.agent/workspace/MagVarUpdate/src/variable_def.ts`
- `.agent/workspace/MagVarUpdate/src/function/schema.ts`

迁移提示：

- `stat_data` 可以作为 Neuro Book 后续 RP 变量系统的参考，但当前第一阶段不应直接实现完整 MVU。
- `display_data` / `delta_data` 对 RP 很有价值：它能解释“为什么状态变了”，比裸数值更适合作为 chat bubble 或 session log。
- ValueWithDescription 很适合让模型理解变量更新条件，但对手写 Markdown 不友好；后续可考虑 YAML frontmatter 或 `state.json`。

### InitVar

MVU 在新聊天加载或每条消息发送前检查变量是否初始化。它从启用世界书中读取名字包含 `[InitVar]` 的条目，解析 YAML/JSON，合并到 `stat_data`。

开场白也可以包含 `<initvar>...</initvar>` 覆盖初始变量。源码里 `loadInitVarData()` 会读取世界书条目，`initCheck()` 会处理第一条消息 swipes 的 `<initvar>`。

引用：

- `.agent/workspace/MagVarUpdate/src/function/initvar/variable_init.ts`
- `.agent/workspace/MagVarUpdate/tests/variable_init.test.ts`

迁移提示：

- ST 卡转换时应识别 `[InitVar]` / `<initvar>` / 初始变量世界书条目。
- 在 Neuro Book 中可先把它们归档到 `roleplay/imports/silly-tavern/{card}/initvar.md` 或转成 `roleplay/sessions/current.md` 的“初始状态草案”。

### 更新命令格式

MVU 从消息中解析类代码命令和 JSON Patch。常见命令：

- `_.set(path, oldValue, newValue);//reason`
- `_.set(path, newValue);//reason`
- `_.assign(...)`
- `_.insert(...)`
- `_.remove(...)`
- `_.unset(...)`
- `_.delete(...)`
- `_.add(path, delta);//reason`
- JSON Patch block：`<json_patch>...</json_patch>` 或 `<jsonpatch>...</jsonpatch>`

源码中 `extractCommands()` 使用状态机解析命令，避免简单正则被嵌套括号、字符串里的 `);` 搞坏。`parseCommandValue()` 会尝试解析 JSON、对象/数组字面量、布尔值、null、undefined、数学表达式、YAML，最后回退为字符串。

引用：

- `.agent/workspace/MagVarUpdate/src/function/update_variables.ts`
- `.agent/workspace/MagVarUpdate/tests/extractSetCommands.test.ts`
- `.agent/workspace/MagVarUpdate/tests/json_patch.test.ts`

迁移提示：

- 这是后续泛用自然语言编辑工具和 RP 变量系统的重要参考：让模型输出受限命令或 JSON Patch，比让模型直接改全文更容易校验。
- 第一阶段纯文字卡导入只需要识别这些块并解释其意图，不执行。

### 事件

MVU 暴露事件用于修正命令、限制更新、回调副作用：

- `mag_variable_initialized`
- `mag_variable_update_started`
- `mag_command_parsed`
- `mag_variable_update_ended`
- `mag_before_message_update`
- `mag_variable_updated`：已标记 deprecated。

引用：

- `.agent/workspace/MagVarUpdate/src/variable_def.ts`
- `.agent/workspace/MagVarUpdate/tests/export_globals.integration.test.ts`

迁移提示：

- 后续 Neuro Book 若做变量系统，可考虑类似生命周期：解析前、命令解析后、写入前、写入后。
- 但事件不应开放执行任意用户脚本；优先做受控 hook 或 profile/tool 配置。

### 额外模型解析

MVU 支持在主回复之后调用额外模型解析变量更新。模式包括：

- 随 AI 输出：直接从主回复中读取 `<UpdateVariable>`。
- 额外模型解析：只用最后两楼消息和相关世界书条目，让额外模型生成更新命令。
- 工具调用或格式化输出：如果模型支持 tools/function calling 或 OpenAI-compatible `response_format.json_schema`，可得到更稳的结构化结果。
- 请求策略支持依次重试、同时请求多次、先请求一次失败后并发。

引用：

- `.agent/workspace/MagVarUpdate/src/function/update/on_message_received.ts`
- `.agent/workspace/MagVarUpdate/src/function/update/invoke_extra_model.ts`
- `.agent/workspace/MagVarUpdate/src/panel/update/request_method.md`
- `.agent/workspace/MagVarUpdate/src/panel/update/prompt_toolcall.md`

迁移提示：

- 这和当前讨论的泛用自然语言编辑工具很接近：用低配模型处理状态更新，减轻主 Agent 的负担。
- Neuro Book 的版本应是后端工具，不应把 JS 插件式脚本跑在用户浏览器里。

## ST-Prompt-Template

### 定位

ST-Prompt-Template 用 EJS 扩展 SillyTavern 提示词处理。它在生成前处理提示词，在楼层渲染时处理输出，也能通过世界书条目和 `@INJECT` 改写消息结构。

入口：

- `.agent/workspace/ST-Prompt-Template/README_CN.md`
- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/docs/reference_cn.md`

### EJS 基本语法

在世界书、预设提示词、角色内容和消息中使用：

- `<% ... %>` 执行 JS。
- `<%- ... %>` 输出未转义内容。
- `<%= ... %>` 输出转义/格式化内容。

处理阶段：

1. SillyTavern 构建提示词。
2. 扩展执行 EJS，替换模板结果。
3. 发送给 LLM。
4. LLM 输出后，扩展在楼层渲染阶段再次处理可见 EJS。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/function/ejs.ts`

迁移提示：

- ST 卡里的世界书内容可能不是静态文本，里面的 `<% ... %>` 可能决定条目是否生效、输出哪段规则、读取哪些变量。
- 转换 skill 必须标记 EJS 片段，不要当普通设定导入。

### 变量函数

参考文档列出：

- `setvar`
- `getvar`
- `incvar`
- `decvar`
- `execute`
- `getwi`
- `getchar`
- `getpreset`
- `define`
- `getqr`
- `getCharData`
- `getWorldInfoData`
- `evalTemplate`
- `activewi`
- `activateRegex`
- `injectPrompt`
- `getPromptsInjected`
- `jsonPatch`
- `patchVariables`

引用：

- `.agent/workspace/ST-Prompt-Template/docs/reference_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/function/ejs.ts`

迁移提示：

- `getwi` / `activewi` 对应“动态召回世界书条目”，在 Neuro Book 中更接近 retrieval 或显式 read_file。
- `getchar` / `getCharData` 对应读取角色卡数据；转换后应变成读取 `lorebook/character/...` 或 `roleplay/cast/...`。
- `injectPrompt` / `getPromptsInjected` 表示提示词片段的依赖倒置，可参考为 `roleplay/GM.md` 中的命名片段，但第一阶段不需要实现动态注入。

### 内容注入

ST-Prompt-Template 支持世界书标题前缀：

- `[GENERATE:BEFORE]`
- `[GENERATE:AFTER]`
- `[RENDER:BEFORE]`
- `[RENDER:AFTER]`
- `[GENERATE:{idx}:BEFORE]`
- `[GENERATE:{idx}:AFTER]`
- `[InitialVariables]`
- `[GENERATE:REGEX:pattern]`

`[RENDER:*]` 只影响显示，不发给 LLM。`[InitialVariables]` 把条目内容作为变量树写入初始消息变量。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`

迁移提示：

- 转换时应把 `[GENERATE:*]` 看作“发送给模型的规则/上下文”，把 `[RENDER:*]` 看作“状态栏/UI”，把 `[InitialVariables]` 看作状态初始值。

### @INJECT

`@INJECT` 允许把世界书条目内容作为完整消息插入 prompt，支持：

- 绝对位置：`@INJECT pos=1,role=system`
- 目标消息：`@INJECT target=user,index=1,at=before,role=system`
- 正则匹配：`@INJECT regex=你好,at=before,role=system`

文档强调 system 消息最好放在开头，不同 API 对 role 和消息交替有不同限制。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/features/inject-prompt.ts`

迁移提示：

- 这类条目在 Neuro Book 中不应直接进入普通 lorebook 知识节点。它们是 prompt 结构控制，应转成 `roleplay/GM.md`、profile prompt、或等待后续 RP runtime 支持。

### 装饰器

ST-Prompt-Template 支持 `@@` 装饰器：

- `@@activate`
- `@@dont_activate`
- `@@message_formatting`
- `@@generate_before`
- `@@generate_after`
- `@@render_before`
- `@@render_after`
- `@@dont_preload`
- `@@initial_variables`
- `@@always_enabled`
- `@@only_preload`
- `@@private`
- `@@if`
- `@@iframe`
- `@@preprocessing`

其中 `@@if` 对转换很关键：它说明某条世界书不是稳定事实，而是条件触发内容。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`

迁移提示：

- `@@if` 条目可转为 `retrieval.trigger`、`roleplay` 条件规则或保留在 import report 中等待人工确认。
- `@@iframe` / `@@message_formatting` 多为 UI 状态栏，不应作为稳定设定导入。

## 对 Neuro Book RP 的设计影响

### 第一阶段应该借鉴的点

- 分离稳定设定、运行状态、显示状态和本轮变更原因。
- 外部卡先归档到 `reference/silly-tavern/{card}/raw/`，再生成 `inspect.md` 和 `conversion-plan.md`。
- 对 MVU/EJS/脚本条目标记风险和语义，不默认执行。
- 对纯文字条目优先导入 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/rule`、`lorebook/note`。
- 把 RP 运行口径放入 `roleplay/GM.md`，把当前局面放入 `roleplay/sessions/current.md`。
- 把角色到 agent/subagent 的映射放入 `roleplay/cast/mapping.md`。

### 第一阶段不应该做的点

- 不执行 SillyTavern 卡里的任意 JS。
- 不复刻 iframe、脚本按钮、状态栏 HTML、外部 API 请求或浏览器插件生命周期。
- 不把 `[GENERATE]`、`@INJECT`、`@@if` 等动态提示词控制直接塞进稳定 lorebook。
- 不把 MVU 变量系统一次性实现为完整 runtime。
- 不把预设 JSON 误判为角色卡。

### 后续值得做的点

- 泛用自然语言编辑工具：输入目标文件、自然语言操作说明、可选上下文消息数，由轻量模型产出受控 patch 或 JSON Patch。
- RP 变量系统：支持 `stat_data`、`delta_data`、schema、更新原因和人类可读显示。
- 受控生命周期 hook：类似 MVU 的 command parsed / before write / after write，但不允许任意用户 JS。
- ST 卡 inspect 工具：识别 worldbook 条目类别、MVU blocks、EJS blocks、regex scripts、tavern_helper scripts、prompt injection、render-only 状态栏。

## 转换检查清单

处理一张 ST 卡时，至少检查：

- `spec` / `spec_version` / `data.name`
- `data.description`、`scenario`、`first_mes`、`mes_example`
- `data.character_book.entries`
- 条目 `comment` 是否包含 `[InitVar]`、`[mvu_update]`、`[mvu_plot]`、`[GENERATE:*]`、`[RENDER:*]`、`@INJECT`、`@@`
- 条目内容是否包含 `<% ... %>`、`<UpdateVariable>`、`<initvar>`、`<json_patch>`
- `data.extensions.regex_scripts`
- `data.extensions.tavern_helper.scripts`
- `data.extensions.tavern_helper.variables`
- `data.extensions.depth_prompt`
- 预设 JSON 是否只包含 `SPreset`、`regex_scripts`、`tavern_helper`，而不是角色主体

## 推荐落地文档

后续 roleplay skill 可引用本研究文档，而不是把第三方插件细节全文塞进 skill 正文。推荐拆分：

- `RP模式` skill：只讲 Neuro Book 如何运行 RP。
- `RP目录初始化` skill：只创建和维护 `roleplay/` 结构。
- `SillyTavern角色卡转换` skill：读取本研究文档，执行 inspect 和转换计划。

