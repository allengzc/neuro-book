# Agent 工具

Agent 工具是模型能请求执行的能力。NeuroBook 的工具设计目标是让 Agent 在明确边界内读写项目、调用专用 agent、查询 Plot / SQL，并留下可追踪的 session 记录。

## 文件工具

常见文件任务优先使用文件工具：

- `read`：读取文件内容。
- `write`：新建文件或完整重写文件。
- `edit`：精确修改已有文件。
- `apply_patch`：适合一个 cohesive patch 的 Codex 风格补丁。
- `bash`：搜索、构建、测试、运行脚本和 workspace CLI。

原则很简单：读文件用 `read`，搜文件用 `rg`，修改文件用 `edit` / `write` / `apply_patch`。不要用 shell 拼接高风险写入命令替代文件编辑工具。

## Agent 协作工具

`leader.default` 可以创建或调用 linked agent：

- `get_agent_profile`：先看目标 profile 的能力、输入输出和工具权限。
- `create_agent`：创建新 linked session。
- `invoke_agent`：调用已有 linked agent。
- `get_agent` / `get_session`：查看当前 linked agent 或 session 元数据。
- `detach_agent`：解除 link，不删除 session。

实践上，简单任务不要为了形式创建 agent。只有当 writer、retrieval、researcher、RP actor 这类专门 profile 能明显降低上下文污染或职责混乱时，才创建或复用 linked agent。

协作工具当前合同：

- `get_agent_profile({ profileKey })` 返回 `InitialSchema`、`PayloadSchema`、`OutputSchema` 和 `toolKeys`；不返回 profile 源码或 report schema。
- `create_agent({ profileKey, initial })` 用 `InitialSchema` 创建 linked session；`initial` 必须是真实 JSON object。
- `invoke_agent({ sessionId, mode, message, input, title })` 调用已有 session；`message` 是自然语言字符串，`input` 是本轮 payload object，会按目标 `PayloadSchema` 校验。
- `prompt` / `steer` / `followup` 可以只传 `message` 或只传 `input`；`continue` 不接受 `message` 或 `input`。
- `invoke_agent` 返回统一 `result.message` / `result.data` 和简洁 `stats`；不要读取旧 `finalMessage`、`invocationId` 或原始 usage。

## 变量与 SQL

变量工具用于读写 `client`、`global`、`project`、`session` 变量：

1. `variable_schema`
2. `variable_read`
3. `variable_patch`

`execute_sql` 只操作当前 Project Workspace 的 `.nbook/project.sqlite`，用于 Plot / Story 等结构化数据。正文、世界书和普通 Markdown 文件仍必须通过文件工具读写。

## Subject 记忆工具

世界模拟 / RP 中，`simulator.actor` 的长期记忆由 sidecar 使用专用工具维护：

- `subject_rag_search`：检索当前 subject 的 `events.jsonl` 和 `memory.jsonl`。它要求配置 embedding 服务，未配置时会明确失败，不做关键词 fallback。
- `subject_event_append`：追加合法 `events.jsonl`，并标记对应 RAG source dirty。
- `subject_memory_update`：把本轮 subject-facing facts 数组交给 `memory.curator` profile，由它生成 JSON Patch，工具层校验并写回 `memory.jsonl`。

这些工具不用于完整 Project RAG，也不让 actor 读取其他 subject 的私有记忆。subject 侧 `events.md` / `knowledge.md` 是旧合同，当前工具不会读取或自动迁移。

## Skill 不是工具

当前没有独立 `skill` 工具。Agent 会在 `SkillCatalog` 中看到可用 Skill，需要使用时再用 `read` 打开对应 `SKILL.md`。

这让 Skill 保持为可读工作流程，而不是不可见黑箱脚本。

## 继续阅读

- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)
- [Project Workspace Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/project-workspace-guide.md)
- [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)
- [Subject RAG 记忆](./subject-rag-memory.md)
