# Agent Mode Layout

## User Request

- 当前项目主界面截图中的布局称为 IDE 模式，核心体验聚焦中间 Markdown Studio / 编辑区域。
- 需要新增一个 Agent 模式，让 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 从右侧抽屉升级为中间主体。
- Agent 模式左侧改为 session 列表。
- Agent 模式右侧改为文件 / studio 面板，命名暂不确定。
- 右侧文件面板内部仍然需要支持在右侧展开文件树。

## Goal

新增一个 Agent 模式主界面规划：用户可以在 IDE 模式与 Agent 模式之间切换；Agent 模式以 Agent 对话为中心，左侧承担当前 Project Workspace 内的 session 导航，右侧承担 Studio 辅助工作区，并保留文件树展开能力。实现完成后应通过前端结构检查和实际页面验收确认：IDE 模式现有编辑体验不回退，Agent 模式能正常显示 session 列表、主体 Agent 对话和右侧 Studio 面板。

## Current State

- 现有 IDE 模式是左侧文件树、中间编辑器、右侧 Agent 抽屉。
- [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 当前作为右侧 Agent 面板存在，用户希望它在 Agent 模式成为主工作区。
- 顶部导航已有 `AGENT` 入口视觉，但当前任务尚未核对它的真实路由 / 状态切换实现。
- session 管理已存在相关能力，但本任务尚未核对其组件边界与能否直接复用到左侧栏。
- 右侧“文件 / studio 面板”的准确命名与内部层级暂未定稿。
- 现有 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 不只是聊天组件，它还承担 session 恢复 / 列表刷新、SSE 连接状态、linked agent、模型选择、composer、Plan Mode、审批恢复等抽屉级 glue。Agent 模式实现前需要拆清“Agent 主体聊天”和“抽屉外壳 / 导航状态”。
- 当前 IDE 模式的 Studio 和文件树组件是复用目标。本任务不应该为 IDE 模式和 Agent 模式新建两套不同的 Studio / 文件树组件。

## Reference: Codex Agent Mode

- 用户提供的 Codex Agent 模式参考图显示为三块工作区：
  - 左侧是会话 / 项目导航：新对话、搜索、技能、插件、自动化、置顶会话、项目会话列表。
  - 中间是 Agent 对话主体：当前会话内容、运行状态、输入框、权限 / 模型等运行控制。
  - 右侧是项目上下文工作区：编辑器 tab、文档内容、文件树和打开方式入口。
- 对 NeuroBook 的启发：
  - Agent 模式不应只是“把右侧抽屉放大”，而应把 Agent 作为主工作台，中间区域承载完整运行循环。
  - 左侧 session 列表应成为 Agent 模式的一等导航，而不是继续藏在弹窗中。
  - 右侧 Studio 面板应能承载 Project Workspace 上下文：文件树、已打开文件、Markdown Studio 或后续 Plot / Reference 等辅助视图。
  - 右侧文件树可以作为右侧 studio 面板内的可展开区域，不必复用 IDE 模式的左侧文件树位置。

## Walkthrough

- 2026-06-01：根据用户截图和描述创建本任务，先记录布局目标、现状假设、实现边界和待决问题；本轮不开始实现。
- 2026-06-01：根据 Codex Agent 模式参考图补充空间分工：左侧会话导航、中间 Agent 运行主体、右侧项目上下文 / 文件工作区；确认后续需要先拷问产品边界再实现。
- 2026-06-01：第一轮拷问确认：不做跨项目切换；左侧仍需要置顶等 session 操作；IDE 右侧 Agent 抽屉退场为同一 Agent chat surface 的布局槽位复用；Agent 模式中间始终只给 Agent；右侧正式命名为 Studio，并直接复用当前 Studio 和文件树组件。
- 2026-06-01：第二轮拷问确认：模式状态可作为主界面 layout mode 保存；切换模式时不允许因重挂载导致流式输出、SSE、滚动位置或 session 状态丢失；IDE 模式仍可隐藏右侧 Agent；Agent Mode 的关闭行为回到 IDE Mode；session 置顶第一版是本机 UI 偏好；左侧列表默认只显示 leader sessions；窄屏优先保护中间 Agent，Studio 可收起；动画服从状态稳定性。
- 2026-06-01：第三轮拷问确认：接受把 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 改成薄壳并拆出可复用 Agent Chat Surface；Agent Mode 左侧常驻 session 列表是主要入口，现有 session 弹窗在 Agent Mode 中退为筛选 / 高级管理或暂不出现；Studio 默认显示当前打开文件，文件树作为 Studio 内可展开栏；进入 Agent Mode 时若 IDE Agent 隐藏，也应自动打开并恢复最近 session；新对话沿用当前 workspace 默认 leader profile 解析逻辑。

## Decisions

- 使用“IDE 模式”指代现有以中间编辑器为核心的布局。
- 使用“Agent 模式”指代新增以 Agent 对话为核心的布局。
- Agent 模式的主体复用现有 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 中的会话、消息、输入和工具入口能力，而不是重新实现一套 Agent chat。
- IDE 模式右侧 Agent 抽屉作为独立产品形态退场；更准确地说，同一个 Agent chat surface 在 IDE 模式位于右侧，在 Agent 模式移动到中间。切换时可以做整体水平滑动动画：进入 Agent 模式时界面向左滚动，回到 IDE 模式时向右回收。
- Agent 模式左侧 session 列表不做项目切换，只服务当前 Project Workspace；但需要支持置顶等 session 管理操作。
- Agent 模式中间区域只承载 Agent 主体，不放编辑器 tab。
- Agent 模式右侧正式命名为 Studio。
- Studio 和文件树直接复用当前 IDE 模式的组件和状态；本任务不新建两套 IDE / Agent 专用组件。
- 参考 Codex Agent 模式时只吸收工作区分工，不默认照搬 Codex 的全局产品导航项。
- `AGENT` 顶部入口应切换当前主界面的 layout mode，而不是进入新的项目路由；刷新页面可以保留上次模式。
- 模式切换必须保护 Agent Chat Surface 的运行状态：正在流式输出时不应因为切换 IDE / Agent 模式而销毁组件、重连 SSE、清空滚动位置或丢失输入草稿。
- IDE 模式仍允许隐藏右侧 Agent 槽位；在 Agent Mode 中关闭 Agent 的语义是回到 IDE Mode。
- session 置顶第一版是本机 UI 偏好，作用域为当前 Project Workspace 的 session list；不要写入 Agent session JSONL。
- Agent Mode 左侧 session 列表默认只展示 leader sessions；linked agents 后续再作为独立能力进入左侧列表。
- 窄屏时优先保护中间 Agent 主体，Studio 可以收起或压缩。
- 进入 / 退出 Agent Mode 的水平滑动动画只作为布局容器表现，不能为了动画牺牲运行状态稳定性。
- 接受把 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 改成 IDE 右侧槽位薄壳，并拆出可被 IDE Mode 和 Agent Mode 共同承载的 Agent Chat Surface。
- Agent Mode 左侧常驻 session 列表是主要 session 入口；现有 [AgentSessionDialog.vue](../../../app/components/novel-ide/agent/AgentSessionDialog.vue) 在 Agent Mode 中不再作为主入口，可后续退为筛选 / 高级管理入口。
- Studio 在 Agent Mode 中默认显示当前打开文件；文件树作为 Studio 内的可展开栏。
- 切换进入 Agent Mode 时，即使 IDE Mode 下 Agent 右侧槽位隐藏，也要自动打开 Agent Chat Surface 并恢复最近可用 session。
- Agent Mode 左侧“新对话”沿用当前 workspace 的默认 leader profile 解析逻辑，不新增 profile 选择器。

## Grill Questions

- 已确认：Agent 模式左侧 session 列表不做项目切换，但仍需要置顶等 session 操作。
- 已确认：IDE 右侧 Agent 抽屉不作为第二套长期 UI 并存；同一个 Agent chat surface 在模式切换时移动槽位。
- 已确认：右侧 Studio 直接复用当前 Studio 和文件树组件，本次不为 IDE / Agent 新建两套不同组件。
- 已确认：Agent 模式中间主体永远只给 Agent。
- 已确认：右侧面板命名为 Studio。
- 已确认：模式状态可以作为当前主界面的 layout mode，而不是新路由。
- 已确认：切换模式时应尽量保持同一个 Agent Chat Surface 实例或同一份 session state，不允许打断流式运行状态。
- 已确认：IDE 模式右侧 Agent 仍可隐藏；Agent Mode 的关闭动作回到 IDE Mode。
- 已确认：session 置顶先做本机 UI 偏好，不写 Agent session JSONL。
- 已确认：左侧 session 列表默认只显示 leader sessions，linked agent 后续再做。
- 已确认：窄屏优先保护 Agent 主体，Studio 可收起。
- 已确认：动画优先级低于状态稳定性。
- 已确认：可以把 `NovelAgentDrawer.vue` 改为薄壳，拆出可复用 `AgentChatSurface`。
- 已确认：Agent Mode 左侧常驻 session 列表是主要入口，现有 session 弹窗不作为 Agent Mode 主入口。
- 已确认：Agent Mode 的 Studio 默认显示当前打开文件，文件树在 Studio 内可展开。
- 已确认：进入 Agent Mode 时自动打开并恢复 Agent session。
- 已确认：Agent Mode 新对话沿用当前 workspace 默认 leader profile。

## Files Changed

- [docs/tasks/27-agent-mode-layout/README.md](README.md)
- [../../../PROJECT-STATUS.md](../../../PROJECT-STATUS.md)

## Verification

- 已完成：创建 active task walkthrough。
- 已完成：把任务加入 `PROJECT-STATUS.md` Recent Tasks。
- 未执行：前端实现与浏览器验收，本轮只做任务建档。

## TODO / Follow-ups

- 核对当前顶部 `AGENT` 入口是路由、tab 还是局部状态，并决定 IDE / Agent 模式切换的状态归属。
- 核对 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue) 与 session 管理组件的拆分边界，判断如何把同一个 Agent chat surface 放入 IDE 右侧槽位和 Agent 中间槽位。
- 设计 Agent 模式三栏布局：左侧 session 列表、中间 Agent 主体、右侧 Studio 面板。
- 明确 Studio 内部第一版职责：文件树、编辑器辅助区、Studio 工具集合，还是可切换的组合面板。
- 设计 session 置顶的本机持久化位置，避免污染 Agent session JSONL。
- 设计 layout mode 切换的组件挂载策略，确保流式输出、SSE、滚动位置和输入草稿不因动画或槽位移动丢失。
- 拆分 [NovelAgentDrawer.vue](../../../app/components/novel-ide/NovelAgentDrawer.vue)：抽出可复用 Agent Chat Surface，让 IDE 右侧槽位和 Agent Mode 中间槽位共享同一套聊天能力。
- 设计 Agent Mode 左侧 session 列表，复用现有 session 查询 / 筛选能力，但让常驻列表成为主入口。
- 设计 Studio 默认显示当前打开文件，并把文件树放入 Studio 内部可展开栏。
- 进入 Agent Mode 时自动 ensure session ready；新建 session 沿用当前 workspace 默认 leader profile。
- 保留右侧面板内展开文件树的交互，并避免和 IDE 模式左侧文件树产生状态冲突。
- 实现后补前端验收：确认 IDE 模式不回退，Agent 模式下 session 切换、Agent 输入、文件树展开、编辑器打开路径都能工作。
