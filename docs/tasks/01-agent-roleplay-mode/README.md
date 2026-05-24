# Agent RP Mode

## User Request

- 为当前项目的 Agent 设计 RP（Role Play）模式。
- 先讨论 skill 设计，不急着实现 runtime、变量系统或复杂游戏引擎。
- 参考 `.agent/workspace/cards` 中的 SillyTavern 卡片样本，以及 `.agent/workspace/tavern2agent` 的转换思路，但不要被其 pi-native 架构绑定。
- RP 模式要和现有小说写作模式共存。
- 先把已讨论内容整理为计划文档。

## Goal

- 增加一组 RP 相关 skill，让用户能理解本系统如何运行 RP、如何初始化当前小说 workspace 的 RP 目录、如何导入或分析 SillyTavern 角色卡。
- 第一阶段优先支持纯文字或轻量文本卡，不复刻重前端卡的 UI、脚本、API 请求和复杂变量系统。
- 保持当前项目的文件化 workspace 心智：稳定设定进入 `lorebook/`，外部原始素材进入 `reference/`，RP 会话和编排配置进入当前 workspace 下的 `roleplay/`。
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
3. 讨论 RP 模式定位：RP 不是替代写作模式，而是在当前 novel workspace 之上增加一个运行层。
4. 讨论轻量 RP 与配置型 RP：
   - 轻量 RP：Leader 直接承担 GM、旁白和多角色代入，参考 `剧情规划流程` 中的旁白式代入、多角色代入和世界模拟式因果推导。
   - 配置型 RP：Leader 仍作为 Leader/GM 统筹，根据 RP 配置把角色、旁白、天道、势力等分配给不同 subagent。
5. 讨论 SillyTavern 导入边界：第一阶段保留原始素材、生成检查报告和转换计划，先支持文本设定导入，不执行前端脚本或复杂变量系统。
6. 讨论泛用自然语言编辑工具：它不只服务 RP state，也可作为未来 Agent 记忆系统和常规文件编辑减负工具。

## Decisions

- RP 相关能力先拆成至少三个 skill：
  - `RP模式`：介绍本系统如何运行 RP、如何进入轻量 RP、如何理解 GM/Leader/subagent 分工、如何引用 RP 文档和导入流程。
  - `RP目录初始化`：在当前小说 workspace 下创建或维护 RP 目录结构，增强默认 workspace，而不是改全局项目结构。
  - `SillyTavern角色卡转换`：提取或读取角色卡原始 JSON，生成检查报告和转换计划，并在用户确认后把文本设定拆入当前 workspace 推荐结构。
- RP 目录建议使用更可读的 `roleplay/`，而不是缩写 `rp/`。
- `roleplay/` 是当前小说 workspace 的一部分，可以被用户资产、workspace 覆盖 agent/profile 机制自然配合。
- 初始 `roleplay/` 建议结构：

```text
roleplay/
|-- AGENTS.md
|-- GM.md
|-- README.md
|-- sessions/
|   `-- current.md
|-- cast/
|   `-- mapping.md
`-- imports/
    `-- silly-tavern/
```

- 外部原始素材建议结构：

```text
reference/silly-tavern/{card-slug}/
|-- raw/
|   |-- card.json
|   `-- source.png
|-- inspect.md
`-- conversion-plan.md
```

- 导入到项目稳定结构时，按内容语义进入：

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/rule/...
lorebook/note/...
roleplay/imports/silly-tavern/...
```

- 变量系统暂不实现。第一阶段先把纯文本卡导入做好；复杂数值、好感度、背包、任务进度、状态栏等后续专门设计。
- 泛用自然语言编辑工具先记录为 TODO。该工具不是 state 专用，参数方向暂定为：目标文件、自然语言操作说明、可选携带上下文消息数量，后续可接轻量模型。

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
- `docs/tasks/01-agent-roleplay-mode/README.md`：新增本计划文档。
- `.agent/workspace/cards/*/*.raw.json`：从三张 PNG 样本卡提取原始内嵌 JSON，供后续分析使用。

## Verification

- 已用 `jq` 校验三张 `*.raw.json` 能正常解析。
- 已确认 `命定之诗Kemini5-3.8.json` 是预设 JSON，不再重复 extract。
- 本轮尚未实现 skill、脚本或 runtime 行为，因此不运行项目测试。

## TODO / Follow-ups

- 起草 `RP模式` skill。
- 起草 `RP目录初始化` skill，并确定 `roleplay/` 是否需要通过 workspace CLI 创建模板。
- 起草 `SillyTavern角色卡转换` skill，明确 inspect、conversion-plan、raw archive 和用户确认后的写入流程。
- 为三张样本卡生成更细的 inspect 报告，尤其区分 worldbook 条目的角色、地点、势力、规则、事件、格式约束和脚本逻辑。
- 设计泛用自然语言编辑工具：输入目标文件、自然语言操作说明和可选上下文消息数量，由轻量模型辅助修改文件；后续可用于 Agent 记忆系统、RP 状态维护和常规文件编辑减负。
- 单独讨论 RP 变量系统：如何表示数值、列表、背包、好感度、任务、世界时钟，以及它和 `state.md`、`roleplay/sessions/` 的关系。
