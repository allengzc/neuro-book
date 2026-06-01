# Agent RP Mode

## User Request

- 为当前项目的 Agent 设计 RP（Role Play）模式。
- 先讨论 skill 设计，不急着实现 runtime、变量系统或复杂游戏引擎。
- 参考 `.agent/workspace/cards` 中的 SillyTavern 卡片样本，以及 `.agent/workspace/tavern2agent` 的转换思路，但不要被其 pi-native 架构绑定。
- RP 模式要和现有小说写作模式共存。
- SillyTavern 角色卡导入后应先服务基础写作模式，RP 模式作为写作项目之上的扩展层。
- 先把已讨论内容整理为计划文档。

## Goal

- 增加一组 RP 相关 skill，让用户能理解本系统如何运行 RP、如何初始化当前小说 workspace 的 RP 目录、如何导入或分析 SillyTavern 角色卡。
- 第一阶段优先支持纯文字或轻量文本卡，不复刻重前端卡的 UI、脚本、API 请求和复杂变量系统。
- 保持当前项目的文件化 workspace 心智：稳定设定进入 `lorebook/`，外部原始素材进入 `reference/`，RP 编排配置进入当前 workspace 下的 `roleplay/`；第一版不设计持久化 session 目录。
- 角色卡迁移首先是写作项目导入器，其次才是 RP 扩展生成器；写作模式和 RP 模式共享同一批 `lorebook/` 设定资产。
- 迁移脚本需要作为长期可迭代工具维护，后续会反复根据样本卡优化分类、拆分和写入策略。
- 后续再讨论变量系统、泛用自然语言编辑工具和更强的多 Agent RP 编排。

## Current State

- 当前 skill 通过 `assets/agent/skills/*/SKILL.md` 暴露，catalog 只读取 frontmatter 中的 `name` 和 `description`，正文按需加载。
- 用户 assets 已支持在 `workspace/.nbook/assets/agent/skills/*/SKILL.md` 创建或覆盖 skill。
- 动态 profile 已支持系统 assets 与用户 assets；workspace 可以创建或覆盖自己的 agent/profile，因此 RP 可以在单个小说 workspace 中拥有专属角色 agent、旁白 agent、GM agent 或其他角色化 agent，而不影响其他 workspace。
- 当前内容节点支持 `state.md`，适合小说创作中的当前状态维护，但对游戏化数值、变量、背包、好感度等频繁精确更新还不够方便。
- 已补充第三方工具研究文档：[SillyTavern RP Tooling Research](../../research/st-roleplay-tooling.md)，覆盖 JS-Slash-Runner、MagVarUpdate 和 ST-Prompt-Template 的本地源码/文档结论。
- `.agent/workspace/cards` 里当前样本包含三张 PNG 角色卡和一个独立 JSON 预设：
  - `公立育露学园/2.28_v1--reload.png`
  - `命定之诗/v4.2.1.png`
  - `碧蓝档案/V1.5_1.png`
  - `命定之诗/命定之诗Kemini5-3.8.json`
- 三张 PNG 已提取原始内嵌 JSON，文件名为 `*.raw.json`；预设 JSON 保持原文件，不再重复 extract 或归一化。

## Walkthrough

1. 熟悉当前 skill 机制和现有写作流程 skill，确认新增 skill 应继续遵守当前项目的 `SKILL.md` 最小 frontmatter 约定。
2. 检查 SillyTavern 样本卡，确认卡片不一定是“一个角色”，可能包含大规模 worldbook、regex scripts、tavern_helper 变量和状态栏逻辑。
3. 讨论 RP 模式定位：RP 不是替代写作模式，而是在当前 novel workspace 之上增加一个运行层；角色卡导入的基础产物应能直接用于写作模式。
4. 讨论轻量 RP 与配置型 RP：
   - 轻量 RP：Leader 直接承担 GM、旁白和多角色代入，参考 `剧情规划流程` 中的旁白式代入、多角色代入和世界模拟式因果推导。
   - 配置型 RP：Leader 仍作为 Leader/GM 统筹，根据 RP 配置把角色、旁白、天道、势力等分配给不同 subagent。
5. 讨论 SillyTavern 导入边界：第一阶段保留原始素材、生成检查报告和导入报告，先支持文本设定导入，不执行前端脚本或复杂变量系统。
6. 讨论泛用自然语言编辑工具：它不只服务 RP state，也可作为未来 Agent 记忆系统和常规文件编辑减负工具。
7. 讨论角色卡迁移脚本的长期维护方式：用三张样本卡做 fixtures，持续优化 worldbook 分类、MVU/EJS 识别、幂等写入和导入报告。

## Decisions

- RP 相关能力先拆成至少三个 skill：
  - `RP模式`：介绍本系统如何运行 RP、如何进入轻量 RP、如何理解 `leader.rp` / GM / actor / writer 分工、如何引用 RP 文档和导入流程。
  - `RP目录初始化`：在当前小说 workspace 下创建或维护 RP 目录结构，增强默认 workspace，而不是改全局项目结构。
  - `SillyTavern角色卡导入`：提取或读取角色卡原始 JSON，生成检查报告，并把稳定文本设定导入当前 workspace 的写作资产；RP 动态机制优先归档到 `reference/`，后续再转写为 `roleplay/` 编排文件。
- 角色卡导入分两层：
  - 基础写作层：默认执行，把可稳定复用的角色、地点、势力、规则、世界观、事件背景等导入 `lorebook/` 和 `reference/`。
  - RP 扩展层：可选执行，在基础写作层之上创建或更新 `roleplay/`，保存 GM 口径、角色映射、actor 指令、writer 规则、变量草案、MVU 更新规则和状态栏/UI 迁移说明。
- 不单独维护 `conversion-plan.md`。`inspect` 只输出临时 overview；稳定证据由 `unpack` 写入解包目录；导入过程以 unpack report 和 import report 记录本次写入、跳过、归档和需人工确认的内容。
- RP 目录建议使用更可读的 `roleplay/`，而不是缩写 `rp/`。
- `roleplay/` 是当前小说 workspace 的一部分，可以被用户资产、workspace 覆盖 agent/profile 机制自然配合。
- RP 目录模板不放进默认小说模板。它作为 `roleplay-directory-templates` 放在 Bundled Workspace Template 下，由同一个 `workspace project create` 命令安装：新建普通项目时默认使用 `novel-directory-templates`；传入 `--target <dir>` 时写入指定 Project Workspace 目录；目标 Project Workspace 已存在且显式传入 `--template roleplay-directory-templates` 时，只补齐缺失的 `roleplay/` 文件，不覆盖用户已有内容。不要新增第二套模板安装命令心智。
- 试用反馈后的 RP 交互决策：
  - `rp.writer` 可以开放 bash 与文件读写工具。它不再必须通过 `report_result.data.prose` 报告正文；可以直接写作或写入 GM 指定文件。后续实现要用 profile prompt 和输入参数约束写入范围。
  - `rp.writer` 只负责正文，不负责生成“选项”“下一步行动建议”或 GM 控制面内容。可选行动、提示、确认问题由 GM / `leader.rp` 生成和呈现。
  - GM / `leader.rp` 是直接面向用户的 RP 主控，需要承担一定旁白职责。开局时 GM 应能介绍玩家角色已知信息、当前处境和必要世界观背景；如果 GM 自己的文风不够好，可以先调用 `rp.writer` 代笔，再由 GM 转述给玩家，或引用文件让玩家自行打开阅读。
  - actor 目录应拆出 `mind.md` 与 `state.md`：`mind.md` 记录角色当前思维、判断、猜测和动机；`state.md` 记录角色当前状态，例如位置、持有物品、伤势、关系压力、短期目标等。
- RP 目录入口收束：删除 `roleplay/AGENTS.md`，避免它和 `gm.md` 形成双入口混淆；通用启动说明下放到 `RP模式` / `RP目录初始化` skill 和 `leader.rp` profile，作者主要修改 `roleplay/gm.md`。
- `knowledge.md` 是给 actor 看的角色视角资料，不写上帝视角；模板改为二级章节归类、三级标题作为条目，并新增 `## 世界观`。不再维护“信念与误解”“最近更新”“更新规则”章节；是否误解由 GM / leader 在后台判断，更新规则写在 profile prompt 中。
- lorebook 信息控制继续讨论：一个方向是在 lorebook frontmatter 中标注条目可见对象或可知条件，让 actor 的 `knowledge.md` 可以引用“这个角色可知道”的公开世界观/常识条目，避免每个 actor 重复维护通用世界观。但 canonical lorebook 仍默认是 GM / leader / 作者视角，actor 不能因为引用而自行读取完整 lorebook。
  - 暂定推荐方向：visibility 只是“谁能知道/何时能知道”的元数据，不代表 actor 可直接读取原文；`knowledge.md` 优先保存角色视角摘要或引用索引。混合公开常识和隐藏真相的 lorebook 条目后续应拆条目，或提供 actor-safe 摘要字段，由 GM / leader 注入。
- Tick / 过程产物目录命名为 `roleplay/playthrough/`，避免和 Agent Session 混淆；用于保存当前游戏进程、每个 Tick 的 user input、GM scratch、actor result、writer brief 和 writer 正文文件。
- GM 发给 actor 的消息不应使用 YAML / JSON / 字段任务单。内部可以结构化组织信息，但发送给 actor 时应改成第二人称自然语言，只描述角色合理可知、可见、可感受到的内容；不要发送 `not_known_to_you`、`task`、返回格式或 hidden facts。
- `report_result.walkthrough` 已严格改名为 `result`；模型可见 schema、工具执行和 harness 读取都使用 `result`。中期目标仍是用 sidecar result pass 整理 actor 主上下文的沉浸式回应。
- actor `knowledge.md` 引用 lorebook 的方式使用项目已支持的 Markdown 相对路径链接，例如 `[王都公共常识](../../lorebook/world/capital.md)`；链接是维护索引或可知来源，不代表 actor 可以自行读取完整 canonical 原文。
- 最新 `roleplay/` 目标结构收束为少量根文件 + actor 子目录：

```text
roleplay/
|-- config.yaml
|-- cast.yaml
|-- gm.md
|-- writer.md
|-- playthrough/          # current playthrough / tick artifacts
`-- actors/
    |-- player/
    |   |-- actor.md
    |   |-- knowledge.md
    |   |-- mind.md
    |   `-- state.md
    `-- {actor-id}/
        |-- actor.md
        |-- knowledge.md
        |-- mind.md
        `-- state.md
```

- 外部原始素材建议结构：

```text
reference/silly-tavern/{card-slug}/
|-- raw/
|   |-- card.json
|   `-- source.png
|-- overview.md
|-- inspect.json
|-- generated.json
|-- unpack-report.md
|-- import-report.md
|-- worldbook/
|   |-- entries.json
|   `-- entries/
`-- extensions/
    |-- extensions.json
    |-- regex_scripts.json
    |-- regex_scripts/
    |-- tavern_helper.json
    |-- tavern_helper.scripts.json
    |-- tavern_helper.variables.json
    `-- tavern_helper/
        |-- scripts/
        `-- variables/
```

- 导入到项目稳定结构时，按内容语义进入：

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/rule/...
lorebook/note/...
roleplay/cast.yaml
roleplay/gm.md
roleplay/writer.md
roleplay/actors/{actor-id}/actor.md
roleplay/actors/{actor-id}/knowledge.md
roleplay/actors/{actor-id}/mind.md
roleplay/actors/{actor-id}/state.md
```

- 角色卡导入流程建议使用三个阶段：

```text
inspect -> unpack -> import
```

  - `inspect`：只读取输入并在 stdout 输出 overview 给 AI 临时查看，不写入 Project Workspace。
  - `unpack`：识别 PNG 角色卡、JSON 角色卡或预设 JSON，保存原始素材、inspect JSON、overview、worldbook entries、regex scripts、tavern_helper scripts / variables 和 unpack report；worldbook 按 `insertion_order` 排序，文件名前缀使用 6 位补零的 `insertion_order`，逐条保存为 frontmatter + 正文 Markdown，并在 `st` 下保留除 `content` 外的原始字段，包括 `insertion_order`、`extensions` 和触发/排序字段；regex、tavern_helper scripts、tavern_helper variables 同时保留聚合 JSON 和逐条 JSON。
  - `import`：从解包目录读取 `raw/card.json` 和 `inspect.json`，按 `insertion_order` 和确定性分类规则把稳定 worldbook entry 写入 Project Workspace 的普通 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/rule`、`lorebook/item` 或 `lorebook/note` 文件；目录名前缀使用 6 位补零的 `insertion_order`，并在 `ext.sillyTavernWorldbook` 下保留原始 worldbook 元数据和本次 classification；动态 MVU / prompt 条目只归档和报告，不进入稳定 lorebook；可选 `--rp` 当前实现仍额外生成 legacy `roleplay/imports/silly-tavern/{card-slug}/` 动态机制归档，后续应迁向新的 `roleplay/` 扁平结构或保留在 `reference/`。

- 迁移脚本应按长期工具设计，模块边界暂定为：

```text
extractor      # PNG/JSON/preset 提取
normalizer     # 统一 chara_card_v2/v3/preset 数据结构
classifier     # worldbook entry 分类
mvu-detector   # InitVar / UpdateVariable / json_patch / _.set
ejs-detector   # EJS / @INJECT / @@if / GENERATE / RENDER
mapper         # ST 分类 -> Neuro Book 文件目标
writer         # 幂等写入 project
reporter       # overview.md / inspect.json / unpack-report.md / import-report.md
```

- 迁移脚本的工程要求：
  - 可重复运行，同一张卡优化规则后可以重新导入，不能随意覆盖用户手改内容。
  - 保留 source id，包括来源卡、entry uid、comment、原始路径，方便回溯。
  - 分类规则、目录映射、命名策略需要可配置。
  - 三张样本卡应作为 fixtures 或快照测试输入，后续每次优化脚本都验证不退化。
  - LLM 只做辅助总结和拆分建议；提取、分类、写入路径尽量 deterministic。

## Implemented V1

- 已新增系统 skill：`assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/SKILL.md`。
- 已新增系统 skill：`assets/workspace/.nbook/agent/skills/RP模式/SKILL.md`，作为用户进入 `leader.rp` / GM Tick 流程的可发现入口。
- 已新增系统 skill：`assets/workspace/.nbook/agent/skills/RP目录初始化/SKILL.md`，作为安装或补齐 `roleplay/` 运行目录模板的可发现入口。
- 已新增配套 CLI：`assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts`。
- 已新增 RP 目录模板：`assets/workspace/.nbook/templates/roleplay-directory-templates/roleplay/`，包含 `config.yaml`、`cast.yaml`、`gm.md`、`writer.md`、`actors/player/*` 和 `actors/sample-npc/*`。
- RP 目录模板已升级为混合模板：保留待填写位置，同时提供 fallback scene、profile 输入边界、Tick 清单、actor-facing message / response 约束、GM scratch、writer brief 缺失处理、playthrough 示例和 actor knowledge 更新规则，方便安装后直接试跑一轮 RP。
- 已扩展 `workspace project create`：目标不存在时仍创建完整 Project Workspace；支持 `--target <dir>` 指定实际写入目录；目标已存在且显式传入 `--template` 时，把模板缺失文件补入现有 Project Workspace，并在 `--json` 中返回 `mode: "updated"`、`createdFiles` 和 `skippedFiles`。
- 已更新 `leader.default` profile 的 Shell commands 提示词：RP 初始化 skill 后续应调用 `workspace project create <project> [--target <dir>] --template roleplay-directory-templates`，继续复用项目模板命令。
- CLI 当前支持：
  - `inspect <input>`：读取 `.json`、`.raw.json` 或 best-effort PNG 文本块，只在 stdout 输出临时 overview，不生成文件。
  - `unpack <input> --project <path>`：生成 `reference/silly-tavern/{slug}/` 解包目录，包含 raw、overview、inspect、worldbook、regex、tavern_helper 和 unpack report；worldbook 会逐条拆成 frontmatter + 正文 Markdown，regex/scripts/variables 会逐条拆成独立 JSON。
  - `import <unpackDir> --project <path>`：从解包目录读取数据，把稳定 worldbook entries 按 deterministic 分类写入 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/rule`、`lorebook/item` 或 `lorebook/note`，并在解包目录生成带 `Import Mapping`、`Skipped Dynamic Content` 和 `Needs Review` 的 `import-report.md`。
  - `import <unpackDir> ... --rp`：额外生成 legacy `roleplay/imports/silly-tavern/{slug}/dynamic-prompt.md`、`initvar.md`、`update-rules.md`、`status-ui.md`、`scripts.md`；这是当前已实现输出，不是下一版目标目录。
  - preset-like JSON 只归档和报告，不作为角色主体写入 lorebook。
  - `--project` 必须指向包含 `project.yaml` 的 Project Workspace，避免和 Workspace Root / `.nbook` 混淆。
  - `import` 会拒绝 unknown 解包目录；`inspect` / `unpack` 仍允许 unknown，用于查看和保存原始结构。
  - 解包目录根部有集中 `generated.json` 指纹清单；`--force` 只覆盖未被用户手改的脚本生成文件。
- 已实现 SillyTavern worldbook V2 映射：
  - 分类类别：`character`、`location`、`faction`、`rule`、`item`、`event`、`system`、`formatting`、`dynamic-mvu`、`dynamic-prompt`、`unknown`。
  - 动态类别优先级最高；命中 InitVar、UpdateVariable、json patch、EJS、`@INJECT`、`@@if`、`GENERATE`、`RENDER` 等 marker 时跳过稳定 lorebook 导入。
  - `event`、`formatting`、`unknown` 暂时保守进入 `lorebook/note`；`system` 暂时进入 `lorebook/rule`；unknown 会在 report 中列为 needs review。
  - `inspect --json` 和 `import --json` 都输出 `mappingSummary`，便于后续 Agent 或脚本继续优化分类规则。
- 已新增测试：`server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖三张样本 raw 卡、预设识别、动态 marker 统计、Windows 路径 slug、Project Workspace 校验、inspect 不写文件、unpack 目录结构、集中 `generated.json`、import 从解包目录读取和用户手改保护。

- 变量系统暂不实现。第一阶段先把纯文本卡导入做好；复杂数值、好感度、背包、任务进度、状态栏等后续专门设计。
- 泛用自然语言编辑工具先记录为 TODO。该工具不是 state 专用，参数方向暂定为：目标文件、自然语言操作说明、可选携带上下文消息数量，后续可接轻量模型。
- `SidecarProfilePass` 已记录在 `docs/tasks/23-agent-sidecar-profile-pass/README.md`，但本次 roleplay spike 先不实现。当前策略是 writer 由 GM 注入可写 lorebook 摘要，actor 可直接维护自己的 `knowledge.md`。
- 已新增第一版 RP builtin profiles：
  - `leader.rp`：用户进入 RP 模式后的 GM 主控 profile，读取 `roleplay/` 运行目录，初始化/复用 `rp.actor` 和 `rp.writer`，按 Tick 协议进行信息过滤、actor 调度、世界裁决和 writer brief 构造；GM 直接面向用户叙述，开局负责说明玩家已知信息、当前处境和必要背景。
  - `rp.actor`：通用角色扮演 profile，创建 input 绑定 `actor.md`、`knowledge.md`、`mind.md` 与 `state.md`，运行时自动注入这些文件；每轮只根据 GM packet 返回结构化 actor response packet。
  - `rp.writer`：RP Tick 正文渲染 profile，创建 input 绑定 `roleplay/writer.md`，每轮根据 GM writer brief 直接输出正文；可使用 bash 与文件工具，但只操作 GM 明确指定路径，不自主检索完整 lorebook。
- 当前 profile 工具边界：
  - `leader.rp` 只有只读文件、bash、agent 编排和用户询问工具，不直接写文件。
  - `rp.actor` 暂时开放 `read` / `write` / `edit` / `report_result`，用于维护自己的 `knowledge.md`、`mind.md`、`state.md`；现有工具系统尚不能 runtime-enforce path scope，因此第一版通过 profile prompt 严格约束只能操作 `knowledgePath`、`mindPath`、`statePath`。
  - `rp.writer` 开放 `read` / `write` / `edit` / `bash`，但提示词约束它只按 GM 明确路径读写；正文用普通 assistant 回复，不强制 `report_result`。
- 已更新 `leader.default` 的多 Agent 协作说明：进入 roleplay 模式时优先创建或切换到 `leader.rp`；`rp.actor` 和 `rp.writer` 通常只由 `leader.rp` 调用。
- 试用反馈已落地到 profile/template：
  - `rp.writer` 可使用 bash 与文件工具，并通过写文件或直接正文完成写作，不强制走 `report_result.data.prose`。
  - `rp.writer` prompt 删除“写选项/行动建议”职责，只写正文；选项由 GM 生成。
  - `leader.rp` prompt 加强直接面向用户的 GM 旁白职责，包括开局介绍玩家已知信息和背景。
  - actor 模板与 profile input 增加 `mind.md`、`state.md`，把角色认知、思维和可变状态从 `knowledge.md` 中拆开。
- 二轮提示词收紧已落地：
  - `leader.rp` 明确区分初始化、常规 Tick 和元指令；初始化后必须给用户可行动现场，不输出后台流程。
  - `leader.rp` 明确 cast 路径需要从 Project Workspace 相对路径转换为 Agent cwd 路径。
  - `rp.actor` 强化玩家 actor 不替用户新增行动、台词、情绪或目标；无真实变化时不要为了更新而改文件。
  - `rp.writer` 强化“正文代笔，不是 GM”，不输出标题、摘要、选项或解释，不替玩家角色补未输入的内心和关键动作。
  - roleplay 模板同步了 GM / writer / actor 的上述提示词边界。

## SillyTavern Sample Notes

当前样本卡数据概览：

| 文件 | 类型 | 名称 | worldbook entries | enabled | constant | 脚本/扩展 | 初步判断 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `公立育露学园/2.28_v1--reload.png` | `chara_card_v3` | `[2.28 尝鲜版v1]全裸登校-育露学园的第一天-reload` | 23 | 17 | 11 | regex 8 / tavern_helper scripts 2 | 中等复杂，适合作为第一版导入实验 |
| `命定之诗/v4.2.1.png` | `chara_card_v3` | `命定之诗与黄昏之歌v4.2` | 469 | 326 | 86 | regex 12 / tavern_helper scripts 6 / variables 2 | 超大世界书，适合作为压力测试 |
| `碧蓝档案/V1.5_1.png` | `chara_card_v3` | `在基沃托斯跟学生们涩涩的日子V1.5` | 244 | 215 | 48 | regex 10 / tavern_helper scripts 5 | 大型多角色 RP 卡，适合作为结构拆分样本 |
| `命定之诗/命定之诗Kemini5-3.8.json` | JSON 预设 | 无角色名 | 0 | 0 | 0 | SPreset / regex scripts / tavern_helper | 这是预设，不是角色卡，不应重复 extract |

已生成原始 JSON：

- `.agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json`
- `.agent/workspace/cards/命定之诗/v4.2.1.raw.json`
- `.agent/workspace/cards/碧蓝档案/V1.5_1.raw.json`

## Files Changed

- `PROJECT-STATUS.md`：新增泛用自然语言编辑工具 TODO。
- `docs/tasks/01-agent-roleplay-mode/README.md`：新增并持续更新本任务 walkthrough。
- `docs/tasks/01-agent-roleplay-mode/roleplay-runtime-structure.md`：新增并持续更新 RP 运行目录和 Tick 协议设计。
- `assets/workspace/.nbook/templates/roleplay-directory-templates/roleplay/*`：新增 RP 目录模板。
- `.gitignore`：放行 RP 目录模板中的 `roleplay/config.yaml`，避免模板配置被全局 `config.yaml` 忽略规则漏掉。
- `assets/workspace/.nbook/agent/scripts/workspace.ts`：`project create` 支持 `--target` 指定写入目录，并支持给已有 Project Workspace 补入显式模板。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：更新 `workspace project create` 与 RP 模板安装提示词。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`：新增 RP GM 主控 profile。
- `assets/workspace/.nbook/agent/profiles/builtin/rp.actor.profile.tsx`：新增通用 actor profile。
- `assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx`：新增 RP Tick writer profile。
- `server/agent/profiles/builtin-contracts.ts`：新增 `LeaderRp*`、`RpActor*`、`RpWriter*` 输入输出 schema。
- `server/agent/profiles/rp-profiles.test.ts`：新增 RP profile 合同、工具边界和自动注入测试。
- `assets/workspace/.nbook/agent/skills/RP模式/SKILL.md`：新增 RP 模式入口 skill。
- `assets/workspace/.nbook/agent/skills/RP目录初始化/SKILL.md`：新增 RP 目录初始化入口 skill。
- `assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/SKILL.md`：新增角色卡导入 skill 入口说明。
- `assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts`：新增 inspect/unpack/import CLI。
- `server/agent/skills/silly-tavern-card-cli.test.ts`：新增 CLI helper 与 catalog 可发现性测试。
- `.agent/workspace/cards/*/*.raw.json`：从三张 PNG 样本卡提取原始内嵌 JSON，供后续分析使用。

## Verification

- 已用 `jq` 校验三张 `*.raw.json` 能正常解析。
- 已确认 `命定之诗Kemini5-3.8.json` 是预设 JSON，不再重复 extract。
- 已运行 `bun run test server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖三张样本 raw 卡、preset-like JSON、动态 marker、slug、v3 SkillCatalog 可发现性、inspect/unpack/import 三段式行为和用户手改保护。
- 已运行 `bunx vitest run server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖 V2 deterministic 分类映射、动态条目跳过、unknown review、`mappingSummary` JSON 输出和 legacy import 行为。
- 已运行 `bunx vitest run server/workspace-files/workspace-files.test.ts -t "roleplay 模板"`，确认 RP 目录模板可安装到已有 Project Workspace。
- 已用 YAML parser 校验 `roleplay/config.yaml` 和 `roleplay/cast.yaml` 可解析。
- RP profiles 验证命令：
  - `bun scripts/build/profile.ts check builtin/leader.rp.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/rp.actor.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/rp.writer.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/retrieval.profile.tsx --system`
  - `bun run profile:metadata`
  - `bunx vitest run server/agent/profiles/rp-profiles.test.ts`
- 已运行 `bunx vitest run server/agent/profiles/report-result-schema.test.ts`，确认 `report_result` schema 已严格使用 `result`。
- 已运行 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "report_result"`，确认 harness 读取 `report_result.result`。
- 已运行 `bunx vitest run server/agent/profiles/workbench-service.test.ts`，确认 profile workbench 的 report mode 文案仍可通过。
- 已运行 `bunx vitest run server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/run-frame-state.test.ts`，确认 report_result reminder / continuation 相关窄测试未回归。

## TODO / Follow-ups

- 真实试跑 `leader.rp` 初始化流程，检查 cast.yaml 到 actor session 的创建/复用提示是否足够清晰。
- 继续增强 SillyTavern worldbook 迁移脚本：基于更多真实样本优化分类规则，尤其是事件、系统、格式约束、角色别名和大型世界书目录名。
- 后续把 legacy `roleplay/imports/silly-tavern/...` 输出迁移为 `reference/` 归档或 `roleplay/gm.md` / `roleplay/writer.md` / actor 文件补丁。
- 扩展 PNG 提取能力：当前只 best-effort 读取 `tEXt` 文本块，后续按样本需要再支持 `iTXt` / `zTXt`。
- 设计泛用自然语言编辑工具：输入目标文件、自然语言操作说明和可选上下文消息数量，由轻量模型辅助修改文件；后续可用于 Agent 记忆系统、RP 状态维护和常规文件编辑减负。
- 单独讨论 RP 变量系统：如何表示数值、列表、背包、好感度、任务、世界时钟，以及它和 `state.md`、`roleplay/playthrough/` 的关系。
- 继续细化 `roleplay/playthrough/`：分支剧情、debug 信息、正式游玩时是否保留示例 Tick，以及 writer 正文文件命名规则。
- 后续设计 sidecar result pass，让 actor 主上下文沉浸回复，旁路上下文整理 `report_result.data` 与 playthrough result 文件。
