# AGENTS.md

## Core Rules

- 使用 *中文* 为默认语言与用户交互
- 安装新依赖时，使用 bun 安装最新版本的依赖
- 当前是沙盒环境，执行 bun 命令时，提权在沙盒外执行
- 执行命令时注意 PowerShell 路径转义
- Agent runtime 中内容节点 CLI 的稳定入口是 `workspace node ...`，由 `.nbook/agent/bin` 注入 `bash` PATH；不要提示 Agent 直接调用项目根 `scripts/workspace.ts`。手工在 PowerShell 管道传中文路径给 `workspace node ... --stdin` 时，必须保证三层 UTF-8 初始化：`chcp 65001`、`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`、`$OutputEncoding = [System.Text.Encoding]::UTF8`。Agent 的 `bash` 工具第一版不负责 PowerShell 管道编码；如果手工在 PowerShell 运行，使用同样前缀。
- Agent 文件工具读取当前小说 workspace 时，优先传 `lorebook/...`、`manuscript/...` 或 `workspace/...`；这些路径应映射到活跃小说 workspace，不应按项目根解析。
- 如果遇到性能与复杂度权衡问题，报告、解释、给出你的建议、交给用户做最终决定
- 任务完成后不要主动运行 git 命令查看变更
- **Important: 永远不要用 shell 工具代替文件编辑工具。当你想这样做的时候，停止你的行为，请求用户同意**
- **不要自动进行浏览器验证，你可以建议用户让你进行浏览器验证**
- **代码审查报告使用直白的话语再解释一次**
- 任务完成后的 walkthrough 要报告实际结果与任务计划的出入
- **Important: 目前项目已经很大了，所以在开始任务前，你可以读取相关文档和相关的 tasks**
- 代码修复、代码重构设计的时候需要考虑这些问题：
  1. 这个修复或者重构是否系统性？还是说本次修复是 hack？
  2. 这次修复或重构，能否在代码设计上约束 Agent 以后不会犯这种错误？
  3. 本次重构或修复会导致那些测试出问题？哪些测试没用了考虑删除。哪些应该修改优化？

## 文档索引

- `PROJECT-STATUS.md`：仓库级现状、当前重点、模块状态、风险和近期任务。TODO 也记录在这里，注意 TODO 完成后记得删除
- `docs/README.md`：文档体系入口，说明 `docs/` 目录分工。
- `reference/README.md`：NeuroBook Reference Bookshelf，按模块链接到 `reference/<module>/`。
- `reference/workspace/TERMS.md`：Workspace Root、Workspace Root `.nbook`、Project Workspace、Project Workspace `.nbook`、user-assets、Bundled Workspace Template 的标准术语。涉及 workspace / project / user-assets / assets 覆盖时必须优先引用这里，不要把 Project Workspace 缩写成 workspace。
- `docs/modules`：模块文档索引，链接模块说明、需求整理和开发参考。在你直接查询 node_modules 前先看看这个文件，可能有 research 或者库的本地 git 仓库位置
- `docs/tasks/README.md`：重大任务 walkthrough 规则和维护要求。
- `docs/tasks/TEMPLATE.md`：新任务 walkthrough 模板。

## 文档规范

- `PROJECT-STATUS.md` 是仓库级现状报告。重大任务结束后，如果代码行为、架构决策、模块状态或长期 TODO 发生变化，必须同步更新该文件。
- `docs/tasks/<order>-<task-slug>/README.md` 是 active 重大任务的持续 walkthrough；归档任务在 `docs/tasks/archived/<task-slug>/README.md`。每个重大任务都应有一个任务目录，记录用户需求、目标、执行过程、关键决策、变更文件、验证结果和后续 TODO。
- 同一功能后续调节时，继续更新原任务 walkthrough。例如新增“拆书功能”后，后续所有拆书功能调节都更新同一个 active 编号任务目录，不要每轮新建碎片文档。
- `reference/` 只放稳定参考和实现契约，按模块分组，例如 `reference/agent/`、`reference/content/`、`reference/editor/`、`reference/plot/`。
- `docs/` 放文档入口、模块说明、调研、草案、归档和任务 walkthrough。调研资料放 `docs/research/`，未定稿草案放 `docs/drafts/`，过期但仍有参考价值的内容放 `docs/archived/`。
- 移动文档或改名时，必须同步更新交叉链接，避免留下绝对路径链接和旧路径引用。
- 纯问答、只读探索、无状态变化的失败尝试，不强制更新 `PROJECT-STATUS.md` 或任务 walkthrough。

### JS/TS

- 不要使用相对路径导入，使用 `import {Sessions} from "nb/types/session"`
- async 函数优先：尽量避免回调函数。try catch 优先。尽量避免 Promise API
- 日志使用规范：this.logger.debug({ kind: message.kind }, "自然语言描述，不要用 tui.adapter.emit");
- 目前项目处于快速开发阶段，可以直接激进地修改项目代码，不需要对老代码做兼容。数据库结构、数据可以随意变更，不用兼容。
- 有时候 throw 比 try catch 更好
- 后端代码（gateway、runtime 等需要高领域表达力的）推荐使用 class 模式，前端代码 web/ 下推荐使用 Functional Programming 模式
- 代码多使用中文注释。设计接口和类时，要为接口和每一个函数写规范
- 多使用注释，函数必须添加注释
- 不要过度设计。先尝试在现有组件基础上修改，实在不行才建立新组件。
- **不要过度创建函数，如果某处逻辑只有一处复用的地方，不要抽函数，优先 inline**
- 实现需求时先考虑使用第三方库
- 先查看 package.json，是否有些需求能用现有库
- getter/setter is better then getXXX/setXXX
- 命名推荐：名字尽量不超过 5 个单词。同时不要有这种名字：`getMessagesByChannel(channelKey: string)`，因为 ByChannel 的含义已经在参数中包涵了
- 当使用 optional 属性（例如 { result:? string }）时，使用注释标注何时为空、非空表示什么
- Important: 当你编写代码的时候遇到项目设计等问题，不要用 hack 绕过问题、制造技术债、破坏类型系统。立刻终止任务，并告知用户问题
- 不要一次性应用 800 行以上的超大补丁（防止出错）。可以考虑拆分多次进行应用（例如按照脚本逻辑 script、模板 template、样式 style）。或者提醒用户规划拆分为多个文件。但是要注意：强耦合，高相关的逻辑还是可以放在一个文件内的。（不要为了为拆而拆）
- 简单逻辑不要主动写测试文件，复杂逻辑需要写测试
- 只有在复杂、大型功能编写后才运行测试。简单的小功能不要主动测试。不要过度测试，只在最常用，最复杂，最容易犯错的地方加测试即可
- 类型覆盖非常重要，你设计的每一个组件都尽可能地标注类型。不要用 Record<string, unknown>，unknown，any 这些类型。如果使用 any/unknown 请在代码旁边写明原因。

## Others

- 进行提示词工程的时候不要把当前对话用户提到的要求带进提示词中，也不要假定对方拥有和你一样的知识（上下文）

### HTML/Vue

- HTML 容器附近使用注释标注，以便后续修改时能快速指认位置
- 组件化：为了防止出现 800 行以上的大型单文件组件。编写代码时考虑拆分组件。
- 通用组件路径：app/components/common
- 通用组件索引：
  - app/components/common/NotificationViewport.vue
  - app/components/common/Dialog.vue
  - app/components/common/DialogWindow.vue（非模态浮动窗口：无遮罩、标题栏拖动、毛玻璃；模态确认继续用 Dialog）
  - app/components/common/form/FormColorField.vue（取色字段：色块弹层调色盘 + 原生 EyeDropper 吸管）
- Novel IDE 颜色一律消费 `app/utils/theme/README.md` 登记的 CSS 主题变量，禁止新增 Tailwind 调色板类（如 `bg-gray-*`、`text-amber-*`、`border-rose-*`）和 `dark:` 变体；明暗差异由当前主题变量承载。
- 状态语义映射口诀：草稿/待审/未保存/占位用 `warning`，完成/已同步用 `success`，错误/删除/冲突用 `danger`，运行中/引用/说明用 `info`，选中/当前项/主操作用 `accent`。
- World Engine `--we-*` 仍是局部别名层，唯一映射源在 `app/styles/theme-vars.css` 的 `.world-engine-workbench-theme`；真实 Dialog 与 preview 必须挂这个 class，不要在 preview 或 scoped style 中反向覆盖全局主题变量。
- Plot / Workspace / Reference chip 分类色板是类别识别色例外，不迁移为状态色；`ReferenceChip.vue` 只输出 `is-chapter` / `is-character` 等语义 class，chip 外观统一在 `app/styles/reference-chips.css`，不要在 TipTap 或业务组件里重复写色。
- Profile template 节点类型 accent、Markdown 正文颜色选择器、JsonViewer/Monaco 语法色属于内容/第三方编辑器色板例外；只清理它们周边普通 UI 的状态色、阴影和文本色。
- 新增组件层主题变量前必须先确认无法用背景/文本/边框/强调/状态/编辑器变量表达，并同步登记到 `app/utils/theme/README.md`、`reference/theme/system.md` 与 8 套内置主题。
- 前端 API 错误文案统一使用 `app/utils/api-error.ts` 的 `resolveApiErrorMessage(error, fallback)` 解析，不要在业务组件里重复解析 `$fetch` 错误结构。
- 前端错误展示按入口归属：当前 Dialog/Panel 内可恢复的表单或加载错误写入该入口自己的局部 error state；跨入口、后台动作、复制/剪贴板/文件操作等即时反馈使用 `useNotification()`；不要把 A 入口触发的错误写进只有 B 入口能看到的 error state。
- 如果同一业务函数会被多个入口复用，必须在函数内按调用入口显式选择错误出口，或拆成入口级 wrapper，避免隐藏宿主、Dialog、侧边栏之间错误不可见。
- 可拖拽调整尺寸的面板统一使用 `app/composables/useResizablePanel.ts`；不要在组件里重复手写 `mousemove` / `mouseup` / pointer 监听。尺寸状态放在宿主或 store，组件只通过 `update:width` / `update:height` 回传。

## Coding Style

- JS/TS 代码缩进 4 空格，遵循现有代码格式风格
- HTML 标签尽量保持一行，开闭标签尽量保持在一行

## 信息、文档获取

- 可读取 node_modules 下的源代码
- 可以使用 get_file_contents、search_code、issue_read 搜寻 github 项目
- .agent/workspace 为你可随意操作的目录（.agent 目录不是），你可以再此编写临时文件、clone 代码等
- 可以通过编写测试脚本并运行来测试数据
