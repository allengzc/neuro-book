# 工具

工具是 Agent 真正执行动作的接口。profile 会声明可用工具集合，Agent 只能使用当前 profile 允许的工具。

这页介绍工具类型和选择原则，不展开每个工具的底层 schema。

## 文件工具

常见文件工具包括：

- `read`：读取文件。
- `write`：新建文件或完整重写文件。
- `edit`：精确修改已有文件的一处或多处文本。
- `apply_patch`：使用 cohesive patch 修改当前已确认的内容。
- `bash`：执行搜索、检查、脚本、测试、构建等终端操作。

文件工具的基本原则：

- 读文件优先用 `read`。
- 搜索文本优先用 `bash` 里的 `rg`。
- 局部修改优先用 `edit` 或 `apply_patch`。
- 不要用 `bash` 拼接高风险写入命令替代文件编辑工具。

Agent 的普通工作目录是 Workspace Root。访问当前小说时，优先使用 `project-slug/lorebook/...`、`project-slug/manuscript/...` 这类路径。

## Task 工具

Task 工具用于执行跟踪，不用于保存小说事实。

适合创建 task 的情况：

- 多步骤任务。
- 跨轮任务。
- 会编辑文件或 Plot 数据的任务。
- 有明确验证标准的任务。

小说设定应该写入 lorebook，剧情决策应该写入 Plot System，不应该长期藏在 task 里。

## Agent 工具

Agent 工具用于创建、复用和调用 linked agent。

常见动作包括：

- 查看可用 profile。
- 创建新的 linked agent session。
- 调用已有 linked agent。
- 查询 session 元数据。
- 解除 linked agent 关联。

简单问答或当前 leader 能安全完成的小任务，不需要为了形式创建 linked agent。需要专门写作、检索、联网研究或 RP 调度时，再交给对应 profile。

## Plot 工具

Plot 工具用于读取和维护剧情结构。

常见用途：

- 查看剧情树。
- 读取某个 Thread 或 Scene。
- 获取某章关联的 Chapter Plot。
- 创建或更新 Thread、Scene、Plot。

Plot System 管理剧情结构，正文仍保存在 `manuscript/.../index.md` 中。不要用 SQL 或 Plot 工具直接写长正文。

## SQL 工具

`execute_sql` 用于当前 Project Workspace 的 Project SQLite。

它适合小范围结构化查询和元数据修改，不适合读写正文、设定长文或普通 Markdown 文件。

当前 SQL 工具只操作当前 Project Workspace 的 `.nbook/project.sqlite`，不能访问 App SQLite、用户表或其他项目数据库。

## Variable 工具

变量工具用于读取和修改 Agent runtime 可见变量。

常见流程：

1. 查询变量 schema。
2. 读取当前值。
3. 提交 JSON Patch。
4. 重要修改后再次读取验证。

变量适合表达 UI 状态、当前项目、当前选中文件、profile runtime state 等运行期信息。

## report_result

`report_result` 是 Agent 向调用方提交结构化结果的工具。

当 profile 声明了 `outputSchema` 并允许 `report_result` 时，调用方可以期待结构化 payload。writer、retrieval 或 sidecar 都可能使用它提交结果。

如果某个 profile 不允许 `report_result`，调用方就按普通最终消息理解结果。

## 继续阅读

- [Leader 操作协议](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)
- [Agent Harness](https://github.com/notnotype/neuro-book/blob/master/reference/agent/harness.md)
- [Project Workspace Agent 指南](https://github.com/notnotype/neuro-book/blob/master/reference/agent/neurobook-project-guide.md)
