# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Core Rules

- 使用 *中文* 为默认语言与用户交互
- 安装新依赖时，使用 bun 安装最新版本的依赖
- 当前是沙盒环境，执行 bun 命令时，提权在沙盒外执行
- 执行命令时注意 PowerShell 路径转义
- Windows 下通过 PowerShell 管道传中文路径给 `workspace node ... --stdin` 时，必须保证三层 UTF-8 初始化：`chcp 65001`、`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`、`$OutputEncoding = [System.Text.Encoding]::UTF8`。Agent 的 `execute_shell` 工具应默认注入该初始化；如果手工在终端运行，使用同样前缀。
- Agent 文件工具读取当前小说 workspace 时，优先传 `lorebook/...`、`manuscript/...` 或 `workspace/...`；这些路径应映射到活跃小说 workspace，不应按项目根解析。
- 如果遇到性能与复杂度权衡问题，报告、解释、给出你的建议、交给用户做最终决定
- **Important: 永远不要用 shell 工具代替文件编辑工具。当你想这样做的时候，停止你的行为，请求用户同意**
- **不要自动进行浏览器验证，你可以建议用户让你进行浏览器验证**

## 文档索引

- `PROJECT-STATUS.md`：仓库级现状、当前重点、模块状态、风险和近期任务。
- `docs/README.md`：文档体系入口，说明 `docs/` 目录分工。
- `spec/README.md`：稳定规范索引，按模块链接到 `spec/<module>/`。
- `docs/modules/README.md`：模块文档索引，链接模块说明、需求整理和开发参考。
- `docs/tasks/README.md`：重大任务 walkthrough 规则和维护要求。
- `docs/tasks/TEMPLATE.md`：新任务 walkthrough 模板。

## 文档规范

- `PROJECT-STATUS.md` 是仓库级现状报告。重大任务结束后，如果代码行为、架构决策、模块状态或长期 TODO 发生变化，必须同步更新该文件。
- `docs/tasks/<task-slug>/README.md` 是重大任务的持续 walkthrough。每个重大任务都应有一个任务目录，记录用户需求、目标、执行过程、关键决策、变更文件、验证结果和后续 TODO。
- 同一功能后续调节时，继续更新原任务 walkthrough。例如新增“拆书功能”后，后续所有拆书功能调节都更新同一个 `docs/tasks/book-splitting/README.md`，不要每轮新建碎片文档。
- `spec/` 只放稳定规范和实现契约，按模块分组，例如 `spec/agent/`、`spec/editor/`、`spec/plot/`、`spec/reference/`。
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
- 尽量不使用 any/unknown。如果使用 any/unknown 请在代码旁边写明原因。
- 不要过度设计。先尝试在现有组件基础上修改，实在不行才建立新组件。
- **不要过度创建函数，如果某处逻辑只有一处复用的地方，不要抽函数，优先 inline**
- 实现需求时先考虑使用第三方库
- 先查看 package.json，是否有些需求能用现有库
- getter/setter is better then getXXX/setXXX
- 命名推荐：名字尽量不超过 5 个单词。同时不要有这种名字：`getMessagesByChannel(channelKey: string)`，因为 ByChannel 的含义已经在参数中包涵了
- 当使用 optional 属性（例如 { result:? string }）时，使用注释标注何时为空、非空表示什么
- 当你编写代码的时候遇到项目设计等问题，不要用 hack 绕过问题、制造技术债、破坏类型系统。先停止编写代码告知用户问题
- 不要一次性应用 800 行以上的超大补丁（防止出错）。可以考虑拆分多次进行应用（例如按照脚本逻辑 script、模板 template、样式 style）。或者提醒用户规划拆分为多个文件。
- 简单逻辑不要主动写测试文件，复杂逻辑需要写测试
- 只有在复杂、大型功能编写后才运行测试。简单的小功能不要主动测试

## Others

- 进行提示词工程的时候不要把当前对话用户提到的要求带进提示词中，也不要假定对方拥有和你一样的知识（上下文）

### HTML/Vue

- HTML 容器附近使用注释标注，以便后续修改时能快速指认位置
- 组件化：为了防止出现 800 行以上的大型单文件组件。编写代码时考虑拆分组件。
- 通用组件路径：app/components/common
- 通用组件索引：
  - app/components/common/NotificationViewport.vue
  - app/components/common/Dialog.vue

## Coding Style

- JS/TS 代码缩进 4 空格，遵循现有代码格式风格
- HTML 标签尽量保持一行，开闭标签尽量保持在一行

## 信息、文档获取

- 可读取 node_modules 下的源代码
- 可以使用 get_file_contents、search_code、issue_read 搜寻 github 项目
- .agent/workspace 为你可随意操作的目录，你可以再此编写临时文件、clone 代码等
- 可以通过编写测试脚本并运行来测试数据
