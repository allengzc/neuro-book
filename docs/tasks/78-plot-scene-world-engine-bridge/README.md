# Plot Scene / World Engine Bridge

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [reference/plot/system.md](../../../reference/plot/system.md): 旧 Plot System 合同，当前用于理解 Story / StoryPhase / Thread / Scene / Plot 的历史职责。
- [reference/world-engine/README.md](../../../reference/world-engine/README.md): World Engine 稳定参考入口，定义动态世界状态与时间线真相源。
- [reference/world-engine/workflow.md](../../../reference/world-engine/workflow.md): 写作模式中 World Engine / Lorebook / Manuscript 的职责边界。
- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md): World Engine 核心模型、API、Workbench 与阶段收尾记录。
- [docs/tasks/59-world-engine-workbench-redesign/README.md](../59-world-engine-workbench-redesign/README.md): World Engine 三栏 Workbench 设计记录。
- [docs/tasks/61-world-engine-workbench-real-api/README.md](../61-world-engine-workbench-real-api/README.md): World Engine 真实主 IDE Workbench 接入记录。
- [app/components/novel-ide/plot/NovelPlotPanel.vue](../../../app/components/novel-ide/plot/NovelPlotPanel.vue): 当前 Plot 面板入口。
- [app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue](../../../app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue): 当前 Plot Workbench Dialog。
- [server/plot/](../../../server/plot/): 当前 Plot 后端模块。
- [shared/dto/plot.dto.ts](../../../shared/dto/plot.dto.ts): 当前 Plot DTO。

## User Request / Topic

- 重新设计 Plot 工作台，使最近新做的 World Engine 与 Plot 剧情工作台结合。
- World Engine 继续负责动态世界状态、时间线和 patch 真相源。
- Plot 工作台以 Scene 为基础，Scene 成为连接 World Engine 的桥梁。
- Scene 通过时间范围连接 World Engine，并显式包含时间、地点、人物 subject 三要素。
- 保留 `Story -> StoryPhase -> Thread -> Scene` 层级；Chapter 独立于该层级，负责声明章内包含哪些 Scene。
- 暂不引入新的 canon / 草稿 / 待确认状态；保持现状，避免无用状态影响实现。
- 考虑删除 `Plot / Plot Beat`，让 Scene 成为 Plot 最小单位；Scene 可查询当前世界状态和当前时间范围内的 World Engine patches。
- Chapter 覆盖独立于 Scene，负责叙事节奏、POV、语气、章节收尾等 writer-facing 指令。

## Goal

设计并逐步落地一个以 Scene 为核心的 Plot / World Engine 桥接方案：Scene 通过时间范围、地点 subject 和出场 subject 连接 World Engine；Plot Workbench 从旧剧情节点编辑器转型为 Scene 编排器；Chapter 负责正文承载和 writer 指令覆盖层；World Engine 保持动态状态与时间线唯一真相源。

- Outcome: Plot 工作台能以 Scene 为最小叙事单位组织剧情，并能从 Scene 查询相关 World Engine 状态、slice 和 patch；Chapter 能按顺序承载 Scene 并提供 writer 指令。
- Verification surface: 先以设计文档和现有代码调研确认数据模型与 UI 路径；进入实现后用聚焦测试验证 Scene 时间字段、Chapter-Scene 关联、World Engine 查询桥接和旧 Plot Beat 退场路径。
- Constraints: 不让 Plot 保存第二份动态世界状态；不破坏 World Engine 的 slice / patch 真相源；不引入暂时无效的草稿 / canon 新状态；避免一次性重写所有 Plot UI。
- Boundaries: 优先调研和修改 `reference/plot/`、`server/plot/`、`shared/dto/plot.dto.ts`、`app/components/novel-ide/plot/` 以及必要的 World Engine 查询适配；不自动浏览器验证，除非用户明确要求。
- Iteration policy: 先细化模型和迁移策略，再做最小垂直切片；每轮记录实际结果、设计出入和后续 TODO。
- Blocked stop condition: 如果 Scene 时间范围与 World Engine instant / slice 查询语义无法在不制造双状态源的前提下对齐，停止实现并报告所缺契约与建议方案。

## Current State

- World Engine 已定位为写作模式动态世界状态与时间线唯一真相源。
- 当前 Plot System 仍保留 `Story / StoryPhase / StoryThread / StoryScene / StoryPlot / StorySceneRef`。
- 当前 Plot 文档中 `Plot` 是 Scene 内部节奏点，但新设计倾向删除 `Plot / Plot Beat`，由 Scene 直接作为最小剧情单位。
- 当前 Chapter 通过 `StoryScene.chapterPath` 与 Scene 关联，Scene 同时拥有 `threadSortOrder` 和 `chapterSortOrder`。
- 当前 World Engine slice 是时间点；Scene 新设计需要表达时间范围，并基于范围查询 slices / patches。
- World Engine 的底层时间类型是 `Instant = bigint`，Prisma 中 `WorldSlice.instant` / `WorldPatch.instant` 均为 `BigInt`；`WorldCalendar.format(instant)` / `parse(input)` 是统一转换入口。
- 当前 World Engine HTTP 公开边界只接收和返回项目日历字符串，不直接暴露 raw instant；Agent CodeAct 内部才直接使用 `bigint` instant。
- 当前 `worldEngineFacade.listSlices({from, to})` / repository 查询语义是闭区间：`instant >= from` 且 `instant <= to`。

## Decisions / Discussion

- Scene 是 Plot 与 World Engine 的主要桥梁。
- Scene 显式表达时间范围和出场 subjects；地点是可选的单个 subject。
- Scene 时间范围 `[startInstant, endInstant]` 允许 nullable：Scene 可以先创建（规划阶段），稍后再连接到 World Engine 时间线。`null` 表示"尚未确定时间"。
- Scene `subjectIds` 记录所有相关 subjects，不区分 POV/active/mentioned（简化第一版实现）。
- Scene 地点使用单个 `locationSubjectId`，通常 Scene 只涉及一个地点。
- 保留 `Story -> StoryPhase -> Thread -> Scene`，用于作者视角的剧情阶段、长期线索、因果线和场景组织。
- Chapter 独立于 Story 层级，负责正文呈现顺序和 writer-facing 指令；通常一章一个 Scene，但设计上允许一章包含多个 Scene。
- 暂不设计新增 `draft / pending / canon` 状态机。
- **`StoryPlot / Plot Beat` 立即删除**：事实推进由 World Engine patch 表达；叙事节奏、POV、语气、章节钩子等非事实指令放入 Chapter 覆盖或 Scene 字段。编写数据迁移脚本，将 Plot 的 `summary/effect/writingTip` 合并到对应 Scene。
- **Chapter 覆盖存储在 Project SQLite**：作为结构化数据，便于查询和编辑。后续设计 `ChapterOverride` 表或类似结构。
- **Scene 查询 World Engine 使用服务端封装 API**：`GET /api/plot/scenes/:sceneId/world-context`，封装查询逻辑，前端简单调用。
- **Scene 查询按时间范围 + subjects 收窄**：只返回涉及 `subjectIds` 或 `locationSubjectId` 的 patches，UI 提供"在 World Engine Workbench 中打开"查看完整上下文。
- Scene 底层时间字段对齐 World Engine：持久化使用 Prisma `BigInt`，服务层类型复用 `Instant = bigint`，不要自创 number / Date 时间源。
- Scene HTTP / 前端 DTO 不直接传 BigInt；主要展示字段使用项目日历字符串，若需要携带 raw instant 只用字符串形式，避免 JSON BigInt 序列化问题。
- Scene 时间范围第一期对齐现有 World Engine 查询能力，采用闭区间 `[startInstant, endInstant]` 查询相关 slices / patches；若后续要改成半开区间，应集中封装在 Scene / World Engine 桥接查询 Module 内，不让 UI 或 Agent 分散处理。
- 第一版实现重点：Plot Workbench 接入 World Engine，让 Scene 能查询和展示 World Engine 上下文。
- 后续设计问题先做本地文档与代码调研，再提出需要用户决策的问题。

## Open Design Questions

- ~~Scene 的 `startInstant` / `endInstant` 是否都必填？是否允许点状 Scene？~~ **已决策（2026-06-29）**：允许 nullable。Scene 可以先创建规划，稍后再连接到 World Engine 时间线。
- ~~Scene 出场 subject 是否区分 POV subject、active subjects、mentioned subjects？~~ **已决策（2026-06-29）**：不区分，只用一个 `subjectIds` 字段记录所有相关 subjects。
- ~~Scene 地点是单个还是多个？~~ **已决策（2026-06-29）**：单个地点，`locationSubjectId String?`。
- ~~第一版实现重点？~~ **已决策（2026-06-29）**：优先实现 Plot Workbench 接入 World Engine，让 Scene 能查询和展示 World Engine 上下文。
- ~~Chapter 覆盖存储位置？~~ **已决策（2026-06-29）**：存放在 Project SQLite，作为结构化数据便于查询和编辑。
- ~~删除 `StoryPlot` 的策略？~~ **已决策（2026-06-29）**：立即删除。编写数据迁移脚本，将 Plot 的 `summary/effect/writingTip` 合并到对应 Scene 字段。
- ~~Scene 查询 World Engine API 设计？~~ **已决策（2026-06-29）**：服务端封装专用 API `GET /api/plot/scenes/:sceneId/world-context`。
- ~~Scene 查询 World Engine 的收窄策略？~~ **已决策（2026-06-29）**：按时间范围 + `subjectIds / locationSubjectId` 收窄，UI 提供"在 World Engine Workbench 中打开"查看完整上下文。
- Writer brief 应由 Chapter 覆盖生成，还是由 Chapter 覆盖 + Scene + World Engine 查询结果共同组装？（留待后续迭代决策）

## Draft Data Shape

### Scene World Anchor

**设计决策（2026-06-29）**：

1. `startInstant/endInstant` 允许 nullable —— Scene 可以先创建（规划阶段），稍后再连接到 World Engine 时间线。
2. 只用一个 `subjectIds` 字段记录所有相关 subjects，不区分 POV/active/mentioned。
3. 地点只需要一个 `locationSubjectId`，通常 Scene 只涉及单个地点。

服务层使用 World Engine 的 `Instant` 类型：

```ts
import type {Instant} from "nbook/server/world-engine/types";

type SceneWorldAnchor = {
    /** World Engine 时间范围起点（nullable） */
    startInstant: Instant | null;
    /** World Engine 时间范围终点（nullable） */
    endInstant: Instant | null;
    /** 出场的所有 subjects */
    subjectIds: string[];
    /** 地点 subject ID（nullable） */
    locationSubjectId: string | null;
};
```

Prisma 持久化形态：

```prisma
model StoryScene {
  // ... 现有字段 ...
  
  // World Engine 桥接字段
  startInstant       BigInt?           // World Engine 时间范围起点（nullable）
  endInstant         BigInt?           // World Engine 时间范围终点（nullable）
  subjectIdsJson     String   @default("[]")  // 出场 subjects JSON array
  locationSubjectId  String?           // 地点 subject ID（nullable）
  
  // ... 其他字段 ...
  
  @@index([startInstant])  // 支持按时间范围查询
}
```

约束规则：

- `startInstant` / `endInstant` 为 `null` 表示 Scene 暂未连接 World Engine 时间线。
- 当两者都存在时，`startInstant <= endInstant`（服务层校验）。
- `subjectIdsJson` 是 JSON array，第一版使用 JSON 存储；后续若需要强查询、约束和引用完整性，再考虑拆独立 `StorySceneSubject` join table。
- `locationSubjectId` 为 `null` 表示该 Scene 未指定地点（如抽象场景、内心独白等）。

HTTP / 前端 DTO 使用项目日历字符串：

```ts
type StorySceneWorldAnchorDto = {
    /** 项目日历字符串（nullable） */
    startTime: string | null;
    /** 项目日历字符串（nullable） */
    endTime: string | null;
    /** instant 字符串形式（用于调试、排序或避免精度损失） */
    startInstant: string | null;
    /** instant 字符串形式（用于调试、排序或避免精度损失） */
    endInstant: string | null;
    /** 出场 subjects */
    subjectIds: string[];
    /** 地点 subject ID（nullable） */
    locationSubjectId: string | null;
};
```

DTO 规则：

- `startTime` / `endTime` 由 `worldEngineFacade.formatTime(projectPath, instant)` 生成；为 `null` 时表示未连接 World Engine。
- 写入请求接收项目日历字符串，由 `worldEngineFacade.parseTime(projectPath, input)` 转成 `Instant`。
- `startInstant` / `endInstant` 只作为调试、稳定排序或前端避免精度损失时的字符串字段；普通 UI 不展示 raw instant。

## UI/UX Design

### 整体布局

Plot Workbench 保持三栏布局（Sidebar + Scene List + Inspector），在现有基础上增加 World Engine 连接功能。

```
┌─────────────────────────────────────────────────────────────┐
│  剧本工作台 Header                                            │
├──────────┬──────────────────────────────┬───────────────────┤
│          │                              │                   │
│ Sidebar  │   Scene List (中栏)          │  Inspector (右栏) │
│ (左栏)   │                              │                   │
│          │   ┌──────────────────────┐   │                   │
│ Thread   │   │ Scene Card           │   │  Scene 详情       │
│ 列表     │   │ ┌──────────────────┐ │   │                   │
│          │   │ │ Title            │ │   │  ┌──────────────┐ │
│          │   │ │ Summary          │ │   │  │ World Engine │ │
│          │   │ │ ⏱ 时间: 18:00-20:00│ │   │  │ 上下文      │ │
│          │   │ │ 📍 地点: 祭坛    │ │   │  │             │ │
│          │   │ │ 👤 出场: 2人     │ │   │  │ [展开详情]  │ │
│          │   │ └──────────────────┘ │   │  └──────────────┘ │
│          │   └──────────────────────┘   │                   │
│          │                              │  基础信息编辑区    │
└──────────┴──────────────────────────────┴───────────────────┘
```

### Scene Card 改动（中栏）

**新增 World Engine 连接状态指示器**：

- **已连接状态**：
  - 🕒 时间范围：`公元2020年4月12日 18:00 ~ 20:00`
  - 📍 地点：显示 subject name（如果有）
  - 👤 出场：显示 subjects 数量（如 `出场 2 人`）

- **未连接状态**：
  - 🔗 图标 + "未连接到世界引擎" 灰色提示

### Inspector 面板改动（右栏）

**新增 Scene 编辑时的 World Engine 连接区域**：

1. **时间范围选择**：
   - 两个文本输入框：startTime / endTime
   - 支持项目日历格式（如 `公元2020年4月12日 18:00`）
   - 留空表示未连接 World Engine
   - 格式提示文本

2. **出场 Subjects 选择**：
   - 多选下拉列表（`SubjectMultiSelect` 组件）
   - 调用 API 获取项目所有 World Engine subjects
   - 显示 subject name + ID
   - 支持搜索过滤

3. **地点选择**：
   - 单选下拉列表（`SubjectSingleSelect` 组件）
   - 可选过滤 `type="location"` 的 subjects
   - 可留空

4. **World Engine 上下文预览**：
   - 按钮："查看 World Engine 上下文"（手动触发）
   - 点击后展开 `WorldEngineContextPanel` 组件
   - 展示时间范围内的 slices 和角色状态
   - 提供快捷跳转："在 World Engine Workbench 中打开"

### 新增组件

#### `WorldEngineContextPanel`

展示 Scene 查询到的 World Engine 上下文：

- **时间线 Slices**：列表显示时间范围内的所有 slices（时间、summary、patch 数量）
- **出场角色状态**：显示每个 subject 的当前状态（位置、HP、关键属性）
- **快捷跳转**：按钮跳转到 World Engine Workbench

#### `SubjectMultiSelect` / `SubjectSingleSelect`

Subject 选择器组件：

- 下拉列表展示所有 World Engine subjects
- 显示 subject name + ID
- 支持搜索过滤
- 多选（SubjectMultiSelect）或单选（SubjectSingleSelect）

### 交互流程

#### 流程 A：创建 Scene 并连接 World Engine

1. 用户点击 "创建 Scene" 按钮
2. 弹出 Scene 创建对话框（现有字段 + World Engine 连接字段）
3. 用户可以：
   - 立即填写时间范围（如果已知）
   - 留空时间范围（先规划，稍后填充）
4. 保存后，Scene Card 显示连接状态

#### 流程 B：编辑 Scene 并查看 World Engine 上下文

1. 用户点击 Scene Card，右侧 Inspector 展开
2. Inspector 显示 World Engine 连接区域
3. 用户点击 "查看 World Engine 上下文" 按钮
4. 触发查询，展示 `WorldEngineContextPanel`
5. 用户可查看 slices、角色状态，或跳转到 World Engine Workbench

### UX 决策

1. **Subject 选择器**：第一版使用下拉列表（适合 subjects < 100），后续可升级为自动完成输入框。
2. **World Engine 上下文展示**：第一版使用手动触发（点击按钮），节省性能，后续可改为自动加载。
3. **时间范围输入**：第一版使用文本输入框 + 格式提示，后续可升级为日期时间选择器。

## Verification / Test

- 当前仅完成设计阶段，尚未实现或运行测试。

## Implementation Walkthrough

- 2026-06-29: 根据用户确认创建本任务。当前只记录设计方向，不修改业务代码。
- 2026-06-29: 调研 World Engine 时间契约后同步设计：Scene 底层时间对齐 `Instant = bigint` / Prisma `BigInt`，HTTP / DTO 继续使用项目日历字符串，第一期 Scene 范围查询采用闭区间以复用现有 World Engine `from/to` 语义。
- 2026-06-29: 整体审查任务现状，识别关键阻塞点与技术风险。
- 2026-06-29: 完成 Scene World Anchor 数据结构设计决策：`startInstant/endInstant` 允许 nullable（先规划后连接）、只用 `subjectIds` 不区分角色、单个 `locationSubjectId`。
- 2026-06-29: 完成 TypeScript 类型、DTO schema、Prisma schema 设计。
- 2026-06-29: 完成 Plot Workbench UI/UX 设计：Scene Card 新增 World Engine 状态指示器、Inspector 新增连接编辑区域、新增 `WorldEngineContextPanel` 和 Subject 选择器组件。第一版 MVP 范围明确。设计阶段完成。

### 审查发现（2026-06-29）

#### 当前状态

- **已完成**：设计方向明确、时间模型对齐、数据模型草案、基础决策完成。
- **缺失**：实现路径不明确、Plot Beat 退场策略未定、Chapter 覆盖设计空白、Scene 查询 World Engine 的桥接逻辑未实现、UI 路径未明确。

#### 新发现的设计问题

1. **Scene 与 World Engine 的同步时机**：leader 是先推进 World Engine 再更新 Scene 时间范围，还是先设计 Scene 再写入 World Engine slices？影响工作流设计。
2. **Scene 时间范围的粒度**：是否允许跨天、跨月、跨年的 Scene？极端情况（如训练蒙太奇）如何处理？
3. **多地点 Scene 的 UI 复杂度**：数据模型是 `locationSubjectIds: string[]`，但文档说"默认引导一个主地点"。多地点场景（追逐、蒙太奇）的 UI 如何设计？
4. **Scene 查询结果的展示形态**：查询到的 slices/patches 是展示为时间线还是按 subject 分组？是只读展示还是允许跳转到 World Engine Workbench 编辑？

#### 技术风险

1. **Plot 系统使用面**：Plot 系统已有完整的 facade/repository/service 架构、前端组件和 Agent 工具。大幅改动 Scene 数据模型会影响现有工具、历史项目数据和用户工作流。
2. **World Engine 集成复杂度**：需要服务层桥接、时间转换、Subject 引用一致性校验、查询性能优化。
3. **迁移路径风险**：如果删除 `StoryPlot`，需要 Schema 迁移、数据迁移、Agent 工具更新、UI 改造、用户通知。一次性改动过大可能导致历史项目无法打开。

#### 建议实施路径（渐进式迁移）

- **Phase 0**：决策与细化设计（1-2 天）—— 确认 Open Design Questions、设计 Chapter 覆盖、明确查询 API、确定 `StoryPlot` 退场策略。
- **Phase 1**：最小垂直切片 - Scene World Anchor（3-5 天）—— Prisma schema 添加字段、迁移脚本、DTO/API 更新、服务端桥接、UI 增加"连接到 World Engine"区域。不删除 Plot Beat。
- **Phase 2**：Chapter 覆盖系统（2-3 天）—— 数据模型、CRUD API、UI 编辑器、与 Scene 关联。
- **Phase 3**：Plot Beat 退场（3-5 天）—— 数据迁移脚本、Agent 工具更新、UI 改造、保留 legacy 只读。
- **Phase 4**：体验优化与文档（2-3 天）—— Plot Workbench 改造、便捷路径、文档更新、用户验收。

总工作量估算：10-18 天。

## TODO / Follow-ups

- [ ] **决策 Open Design Questions**（阻塞）
- [ ] 梳理当前 Plot 数据模型、DTO、Prisma schema 与 UI 中 `StoryPlot` 的使用面。
- [ ] 设计 Chapter 覆盖的数据形态与 writer brief 生成路径。
- [ ] 决定 `StoryPlot` 删除、迁移或 legacy 只读策略。
- [ ] 设计 Scene 查询 World Engine 的服务端桥接 API。
- [ ] 设计第一期最小垂直切片的具体任务清单。
