# Plot 规划层前端：承诺账本 / 决策记录 / 节奏字段 UI

> 状态：**设计定稿（2026-07-09 用户五点拍板），待实施**。本任务是 [Task 93 Plot 规划层](../93-plot-planning-layer/README.md) 暂缓项「workbench UI」的直读先行批次（路线 B）：不等 lint/ledger 消费点，先让人能看账本、能手工维护数据。lint 告警、体检报告、张力可视化仍留在 93 的消费点批次。

## Relative documents refs

- [docs/tasks/93-plot-planning-layer](../93-plot-planning-layer/README.md)：Promise/Decision/节奏字段的数据层与设计决策 D1-D29（本任务的唯一语义来源，勿重议）。
- [docs/tasks/97-plot-tool-surface-redesign](../97-plot-tool-surface-redesign/README.md)：Agent 工具面 15 工具形态；本任务是同一数据的人机 UI 侧。
- [docs/tasks/87-plot-two-trees-and-writer-modes](../87-plot-two-trees-and-writer-modes/README.md)：现有 Plot 前端（面板/工作台/编辑器）的来源任务；其遗留「workbench 空 tab」「refs 目标候选 demo 数据」「typed query 防再犯」由本任务部分收口。
- `shared/dto/plot.dto.ts`：StoryPromiseDto / StoryPromiseDetailDto / StoryDecisionDto 及请求 DTO（前端直接消费，已就绪）。
- `server/api/projects/plot/[...segments].ts`：promises / decisions HTTP 路由（已就绪）。
- `app/utils/theme/README.md`：主题变量清单；本任务不新增变量。

## User Request / Topic

用户盘点三个 plot 任务（87/93/97）现状后确认：后端 + Agent 工具面已全部落地，前端零改动。拍板走路线 B（最小前端接入先行），「现在直接来做前端的设计」。2026-07-09 设计五点拍板全部同意：

1. 信息架构：工作台砍成 3 个真 tab + 侧栏计数入口；
2. tab 中文命名用「承诺账本」「决策记录」；
3. Scene 侧节拍只读展示 + 跳账本（节拍管理单一入口在账本侧）；
4. 工作台 refs 目标候选硬编码 demo 数据本次顺手清（接 `useStructuredReferenceMenu` 真实数据）；
5. supersede（被新决策取代）v1 不做专门 UI，放 TODO。

## Goal

给规划层（StoryPromise / StoryPromiseBeat / StoryDecision + Scene/Thread 节奏字段）建人这一侧的完整直读 UI：剧本工作台重组为 3 个真 tab（线程规划 / 承诺账本 / 决策记录），侧栏加 open 计数入口，Scene/Thread 编辑器补三个节奏字段下拉，Scene 侧展示只读 promiseBeats。**纯前端增量，零后端改动**（HTTP/DTO 已全部就绪）。验证方式：`bun run typecheck` 全绿 + 用户浏览器验收（建 Promise → 打节拍 → 派生态/自动兑现正确显示 → Decision 拍板流程走通 → 计数入口与跳转联动正确）；浏览器验收可与 Task 93 遗留的真实项目实测合并执行。实施中若发现与现有面板架构冲突（如工作台 props 面不够、store 状态归属争议），停下报告而不是 hack 绕过。

## Current State（实施前盘点）

- **前端零命中**：`StoryPromise` / `promiseId` / `StoryDecision` / `decisionId` / `openPromiseCount` / `outcomeType` / `pacingRole` / `miceType` 在 `app/` 下均无任何引用。Promise/Decision 目前只有 Agent 能读写。
- **后端全就绪（本任务纯消费）**：
  - `GET/POST /api/projects/plot/promises`、`GET/PATCH/DELETE /promises/:id`、`PUT /promises/:id/beats`（upsert）、`DELETE /promises/:id/beats/:sceneId`；decisions 同型（无 beats）。
  - `PlotTreeDto.openPromiseCount / openDecisionCount`：主面板每次 `loadPlotTree` 已在拉，当前被丢弃。
  - `StorySceneDetailDto.promiseBeats`：随现有 scene 详情请求已返回，当前被丢弃。
  - `Create/UpdateStoryScene/ThreadRequestDto` 已接受 outcomeType/pacingRole/miceType（null=显式清空）。
  - 生命周期转换全走 PATCH status：Promise abandon/fulfill/reopen；Decision decide（status=decided + decision/motivation/risk + chosenOption）/ drop（status=dropped + note）/ supersede（status=superseded + supersededById，本次不做 UI）。
- **工作台 6 tab 是纯装饰**：`PlotWorkbenchDialog.vue` 的 `activeTab` 只切按钮高亮，主体（Sidebar+SceneList+Inspector）不随 tab 变化。tree/timeline/locator 视图组件只被 `app/pages/*.preview.vue` 演示页引用，与真实工作台无关，重组 tab 不影响它们。
- **refs 目标候选硬编码 demo**：`PlotWorkbenchDialog.vue` `buildRefTargetOptions()` 里三条假 lorebook 条目（初始舞台/奴隶少女/债务契约）。
- 表单基建齐全：FormField/FormInput/FormSelect/TagInput/StructuredTextEditor、FormAnnotationDialog（AI 批注）、Dialog、`useDialog().choose` 确认流、`resolveApiErrorMessage`。

## Decisions / Discussion

### A. 信息架构：工作台是规划层的家，侧栏只做入口（拍板 1）

- 工作台 tab 重组：`overview/chapter/draft/timeline/tree/thread` 六装饰 tab → **3 个真 tab**：`线程规划`（现有主体原样保留，默认）/ `承诺账本` / `决策记录`，主体真正随 tab 切换。砍除依据：草稿池=93 D22 拍板不做系统化；章节设计=侧栏已有芯片条+`PlotChapterEditorDialog`；总览/Timeline/Tree 无真数据（演示件另案，见 87 遗留）。
- 侧栏入口：`NovelPlotPanel` 头部加两个迷你计数 chip「承诺 N / 未决 N」（数据取自已有的 PlotTreeDto，零额外请求），点击打开工作台并定位到对应 tab。0 计数时弱化显示但不隐藏（入口可发现性）。
- 理由：账本行信息密度（状态+派生态+节拍统计+期限）需要横向空间，侧栏 240-320px 塞不下；顺手消掉装饰 tab 的债。

### B. 承诺账本 tab（拍板 2 命名）

左列表 + 右详情（master-detail，沿用工作台双栏习惯）：

- 列表行：状态点 + 标题 + 派生阶段 chip（derivedStage）+ importance + 四类节拍计数（planned/factual 分色）+ 期限章。筛选默认 `open`（状态/importance/tags），排序 importance → updatedAt。
- 详情：summary / payoffExpectation / cadenceChapters / tags / 期限章；**节拍时间线按章序排**（scene.chapterSortOrder 有值按章序，无值按创建序垫底），每行 = kind 图标 + 场景标题 + 所在章 + planned/factual/archived 三态 + note。
- 编辑对话框（新建/编辑共用）：name/title/importance/summary/payoffExpectation/cadenceChapters/期限章下拉/tags（TagInput 占位提示伏笔四词表 setup_payoff/prophecy/motif/mirror）。
- 节拍对话框：场景选择器（按 Thread 分组、显示挂章）+ kind 四选 + note + `kind=payoff` 时显示 autoFulfill 开关（默认开，文案「保存后承诺将自动标记为已兑现」）；选中已有节拍的场景时提示「该场已有节拍，将覆盖」（PUT 本就是 upsert）。
- 生命周期：兑现/放弃/重开 = PATCH status 带确认；**删除是物理删**（93 D4：物理删除只留 UI/人），danger 确认弹窗。

### C. 决策记录 tab（拍板 2 命名）

- 列表按 open 优先分组（open / decided / superseded+dropped 折叠），行 = 状态 pill + 标题 + question 截断 + 锚点 chip + 期限章。
- 详情按 ADR 分段：question → options →（decided）**decision / motivation / risk 三段，risk 用 warning 色块**（writer 刹车点的视觉语义）→ rejectedAlternatives（whyRejected 为空的骨架标「待补理由」）→ serves/dependsOn（`valid=false` 死引用删除线 + danger）→ supersededBy 链接 → note。
- **拍板对话框**（决策流核心）：从 options 单选 chosenOption 或选「全新方案（不在候选中）」；decision/motivation/risk 三字段客户端必填校验（服务层还有一道）；提示「未选中的候选将转为否决记录，理由可稍后补填」。
- 作废（drop）小对话框强制填失效原因（note）；重开 = PATCH status=open。
- 编辑对话框（open 态字段）：name/title/question/options 增删（option+note 行编辑）/anchor 选择器/deadline/serves/dependsOn（字符串行编辑，格式提示 `promise://{id}` 等）/note。
- anchor 选择器 = kind 下拉（story/act/chapter/thread/scene/promise/content）+ 按 kind 出实体下拉（chapters/threads/scenes 来自工作台 props；promise 用账本 tab 已加载数据或按需拉列表）或 content 相对路径输入。
- **supersede v1 不做专门 UI**（拍板 5）：需要选/建取代者，流程重；Agent 侧已可操作；放 TODO。

### D. Scene/Thread 编辑器补节奏字段

- `PlotThreadEditorDialog`：Scene 表单 + `outcomeType`（8 值 + 「未填写」）、`pacingRole`（5 值 + 「未填写」）；Thread 表单 + `miceType`（milieu 舞台/idea 谜题/character 角色/event 事件 + 「未填写」）。下拉选项带一句中文说明（如 `yes_but 得手但有代价`、`passive 只承受未尝试`）——93 D29 显式语义在人侧的对齐。
- 「未填写」= 空串选项，提交映射 null（显式清空）。
- `PlotWorkbenchInspector`（快速编辑）同步补齐；`FormAnnotationDialog` 的 draft 带上新字段。
- `PlotThreadDetailPanel`（底部快速面板）只做只读 chip 展示（面板已挤）。
- Scene 侧 promiseBeats（拍板 3）：底部详情面板与 Inspector scene 模式加一排**只读**芯片（`[埋设] 银钥匙之谜`），点击跳工作台账本 tab 并聚焦该 Promise；节拍增删单一入口在账本侧。

### E. 状态色语义（全用现有主题变量，不新增）

| 对象 | 映射 |
| --- | --- |
| Promise status | open=info（进行中债务）/ fulfilled=success / abandoned=muted |
| derivedStage | unplanted=warning（占位未落地）/ planted/echoed=info / paid_off=success |
| beat state | planned=warning（计划即草稿）/ factual=success / archived=muted |
| Decision status | open=warning（待审）/ decided=success / superseded·dropped=muted |
| 特殊 | risk 块=warning；死引用与「期限章已删」（deadlineChapterId 非空而 deadlineChapter 为 null）=danger |

遵守 CLAUDE.md：禁 Tailwind 调色板类与 `dark:` 变体，Novel IDE 一律消费主题变量。

### F. 文件计划与数据流

新建 `app/components/novel-ide/plot/planning/`（8 个新文件）：

1. `plot-planning.types.ts` —— 全部枚举中文标签表 + tone 映射（beatKind/derivedStage/beatState/promiseStatus/importance/decisionStatus/anchorKind/outcomeType/pacingRole/miceType）。
2. `plot-planning-api.ts` —— promises/decisions 全部端点的薄 typed client（typed query/body/response）。顺手落 Task 87「typed query 防再犯」follow-up 的一半：**只覆盖新端点，存量 23 个 `$fetch` 调用点不迁移**（另案）。
3. `PlotPromiseLedgerTab.vue` —— 自含数据加载（打开 tab 拉列表，watch `plotRefreshVersion` 刷新——Agent 改账本时打开着的工作台自动跟进）。
4. `PlotPromiseEditorDialog.vue`
5. `PlotPromiseBeatDialog.vue`
6. `PlotDecisionLedgerTab.vue`
7. `PlotDecisionEditorDialog.vue`
8. `PlotDecisionDecideDialog.vue`

改 6 个：

- `PlotWorkbenchDialog.vue` —— 真 tab 切换（v-if 按 activeTab 渲染主体）+ 初始 tab；顺手清 `buildRefTargetOptions` demo 数据（拍板 4：接 `useStructuredReferenceMenu` 真实内容节点数据）。
- `NovelPlotPanel.vue` —— 头部计数入口；**tab 组件自含数据加载，不从主面板传规划层状态**（主面板已 1850 行），props 只传 projectPath/chapters/threads/scenes（选择器与章序显示用）与跳转事件。
- `PlotThreadEditorDialog.vue` / `PlotWorkbenchInspector.vue` / `PlotThreadDetailPanel.vue` —— 节奏字段与 promiseBeats 芯片。
- `plot-thread-panel.types.ts` —— 本地 Thread/Scene 类型补 miceType/outcomeType/pacingRole（含 NovelPlotPanel 的 DTO→面板映射处透传）。

跳转联动状态放 novel-ide store（宿主）：`plotWorkbenchTab`（"thread"|"promises"|"decisions"）+ `plotPlanningFocusId`（跳账本时聚焦的 promise/decision id，tab 打开时消费一次）。

错误出口遵守 CLAUDE.md 入口归属：对话框内表单错误写对话框局部 error state；tab 列表加载错误写 tab 局部 error state；删除/生命周期转换等后台动作失败用 `useNotification()`。文案统一 `resolveApiErrorMessage`。

### G. 明确不做（与 93 拍板对齐）

- 逾期/停滞计算与显示（需 frontier 章序投影 = 93 D28 lint 批次）：**UI 只显示期限章，不算也不显示 overdue**。
- `get_promise_ledger` / `get_planning_report` 体检报告页。
- 张力折线图（pacingRole 序列可视化，数据已够，锦上添花）。
- Timeline/Tree 视图真数据化（87 遗留另案）。
- supersede 专门 UI（拍板 5）。
- i18n：plot 组件现状全部硬编码中文，保持一致，不进 locale 文件。

## 实施分片

- **分片 1 —— 基建 + 节奏字段**：`plot-planning.types.ts` + `plot-planning-api.ts`；`plot-thread-panel.types.ts` 与 DTO 映射补三字段；`PlotThreadEditorDialog` / `PlotWorkbenchInspector` 三个下拉 + AI 批注 draft；`PlotThreadDetailPanel` 只读 chip。
- **分片 2 —— 工作台重组 + 承诺账本**：`PlotWorkbenchDialog` 真 tab + store 的 `plotWorkbenchTab`/`plotPlanningFocusId`；侧栏计数入口；`PlotPromiseLedgerTab` + Promise 编辑/节拍两对话框。
- **分片 3 —— 决策记录**：`PlotDecisionLedgerTab` + Decision 编辑/拍板两对话框（含 drop 流程与 anchor 选择器）。
- **分片 4 —— 联动与收尾**：Scene 侧 promiseBeats 芯片 → 跳账本聚焦；账本节拍行点场景 → 切线程规划 tab 并选中该 Scene；refs demo 数据清理（拍板 4）；空态文案与 0 计数弱化。

每分片结束跑 `bun run typecheck`。组件保持 <800 行（超了就再拆子组件）。

## Verification / Test

- `bun run typecheck` 全绿。
- 前端组件不主动写测试（CLAUDE.md：简单逻辑不主动写测试；现有 plot 面板组件也无组件测试先例）。
- **浏览器验收交用户**（不自动执行）：建 Promise → 打 plant/advance/payoff 节拍 → 派生阶段与自动兑现提示正确 → abandon/重开 → Decision 建立/拍板（risk 必填生效）/作废 → 侧栏计数与跳转联动 → Scene 编辑器三下拉保存生效 → promiseBeats 芯片跳转。可与 Task 93 遗留的「真实项目实测」合并成一轮。

## Implementation Walkthrough

-（待实施后回写）

## TODO / Follow-ups

- supersede（被新决策取代）专门 UI 流程（拍板 5 延后；Agent 侧已可操作）。
- 逾期/停滞告警显示：随 93 消费点批次（frontier + lint）落地后回填账本列表与计数入口。
- 张力折线图（pacingRole 序列）。
- 存量 23 个 plot `$fetch` 调用点迁移到 typed client（87 遗留另一半）。
- Timeline/Tree 演示视图真数据化（87 遗留）。
- rejectedAlternatives 骨架「待补理由」的行内补填编辑（v1 只标注不提供行内编辑，走编辑对话框整体改）。
