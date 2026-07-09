# NeuroBook Context

NeuroBook 是一个本地优先的小说创作工作台。该语境记录用户运行数据、配置、Project Workspace 可携带性和数据库边界相关的稳定术语。

## Language

**Workspace Root**:
应用运行数据根目录，默认是 `workspace/`。
_Avoid_: workspace, project root

**Portable Root**:
Windows release zip 解压后的程序根目录，初始只包含启动引导器和 Node.js runtime，并在首次启动时物化源码、`.git` 和 package-local Workspace Root。
_Avoid_: workspace, data root, install root

**Windows Release Zip**:
面向 Windows 用户的 GitHub Release 资产，解压后通过启动引导器联网安装依赖、clone 源码并运行本地网页服务，默认不携带源码或 `.git`。
_Avoid_: neuro-book-deploy mode, installer, offline portable app

**Windows Source Binding**:
Windows Release Zip 首次启动或更新时从 Git 拉取源码并把 Portable Root 转换为本机 Git 状态的过程。
_Avoid_: installer, deploy mode, zip extraction

**Windows App Checkout**:
Windows Source Binding 在 Portable Root 的 `app/` 子目录创建的 NeuroBook Git checkout。
_Avoid_: Portable Root, Workspace Root, install directory

**Windows Bootstrapper**:
Windows Release Zip 根目录中的启动与维护脚本集合，负责依赖安装、源码物化、更新、重建、迁移和本地服务启动。
_Avoid_: neuro-book-deploy, app server, installer

**Workspace Root `.nbook`**:
Workspace Root 的全局控制区，保存 Global Config、用户 assets、Agent 资源覆盖层和全局运行状态。
_Avoid_: assets folder, user workspace

**Project Workspace**:
一个具体内容项目的工作区，当前主要是单本小说。
_Avoid_: workspace

**Project Path**:
Project Workspace 相对 Workspace Root 的单段目录名，也是公开 API 和运行时定位项目的标识。
_Avoid_: projectId, novelId, database id

**Project Manifest**:
Project Workspace 根目录中描述项目类型、标题、摘要等展示元数据的 `project.yaml` 文件。
_Avoid_: Novel row, workspace.yaml, project metadata

**Project Workspace Issue Index**:
从 Project Workspace 文件派生出的校验问题索引，用于前端展示当前已知的问题状态。
_Avoid_: validation truth, workspace issues

**Project Workspace File Index**:
从 Project Workspace 文件系统构建的内存索引，保存文件节点、frontmatter、state、refs 和路径存在信息。
_Avoid_: tree cache, validation table

**Imported Reference**:
导入到 Project Workspace `reference/` 下的外部原始素材、解包结果、低置信迁移材料和报告。
_Avoid_: canon, lorebook, runtime state

**Canonical Lorebook Entry**:
Project Workspace `lorebook/` 下的稳定作品说明书条目，用于保存 canon、prototype、世界规则、角色设定、地点、物品、系统和作品级 AI 指令。
_Avoid_: imported reference, subject knowledge, runtime state

**Dynamic Migration Note**:
从外部系统导入但暂不能直接运行或稳定入库的动态机制迁移记录，例如 SillyTavern MVU、Prompt Template、regex、状态栏、Tavern Helper 脚本或变量规则。
_Avoid_: runtime implementation, canonical lorebook entry, subject knowledge

**Subject-facing Knowledge**:
`simulation/subjects/{id}/knowledge.md` 中记录的主体视角知识，只包含该 subject 已经知道、被告知、观察、推断或误解的信息。
_Avoid_: lorebook, omniscient context, imported reference

**Boot Config**:
启动和部署期配置，修改后需要重启服务才能可靠生效。
_Avoid_: settings, runtime preference

**Process Environment**:
进程启动时实际生效的环境变量集合，是数据库运行时配置的执行真值源。
_Avoid_: config mirror, settings

**Global Config**:
单用户全局运行配置，位于 Workspace Root `.nbook/config.json`。
_Avoid_: boot config, project config

**App SQLite**:
应用级 SQLite 数据库，位于 Workspace Root `.nbook`，保存用户、鉴权和 Global Config，不记录 Project Workspace。
_Avoid_: project database, SQLite Data File

**Project SQLite**:
Project Workspace-local SQLite 数据库，位于 Project Workspace `.nbook`，保存 Story、StoryPhase、Plot、Scene 和其他项目级结构化数据。
_Avoid_: app database, global database, Novel database

**Controlled SQLite Tool**:
Agent 使用的受控 SQLite 查询工具，只操作当前 Project Workspace 的 Project SQLite，并集中限制危险 SQL。
_Avoid_: Postgres SQL tool, generic SQL tool, bash-only database access

**Agent Steer**:
Agent 运行期间追加的带前缀纠偏消息，会在当前 assistant turn 和 tool results 完成后、下一次模型调用前进入上下文。
_Avoid_: interrupt, next turn, follow-up

**Agent FollowUp**:
Agent 运行期间追加的后续消息，会在当前 run 本来要停止时进入下一轮上下文。
_Avoid_: steer, continue, retry

**Agent ReAct Loop**:
一次 Agent 从当前上下文开始，交替生成 assistant message、执行 tool results，并在无后续 tool calls 时停止的运行循环。
_Avoid_: invocation, session, queue

**Agent Continue**:
不新增用户消息、从当前 session 尾部继续运行的 Agent 调用。
_Avoid_: follow-up, prompt, resume message

**Agent Queued Message**:
尚未被 harness drain 的 Agent Steer 或 Agent FollowUp 消息。
_Avoid_: optimistic chat message, command

**Agent Queue Event**:
Agent Queued Message 入队时通过 session event hub 广播的运行态事件。
_Avoid_: session entry, consumed event, chat message

**Agent Dialogue Content**:
Agent session active path 中用户和 assistant 的可见正文文本，用于派生 session 展示元数据。
_Avoid_: tool result tokens, thinking tokens, raw context tokens

**Agent Summarizer Profile**:
用于维护另一个 Agent session 展示标题和摘要的后台 profile。
_Avoid_: linked agent, visible subagent, user-facing agent

**Agent Summarizer Session**:
运行 Agent Summarizer Profile 的后台 session，绑定一个源 Agent session 但不作为 linked agent 展示。
_Avoid_: linked session, child agent, visible agent

**History-Frozen Agent Session**:
有 session 身份和初始化历史，但运行过程中不持久化 assistant/toolResult transcript 的 Agent session。这是观察到的会话行为，不是 runtime public API enum；实现上由 runtime hooks 组合表达。
_Avoid_: sessionless agent, no-session profile, normal transcript session

**Agent Summarizer ModelContext**:
Agent Summarizer Profile 每次模型调用时使用的上下文，由 summarizer system prompt 和从源 session 当前 active path 提取的 Agent Dialogue Content 组成。
_Avoid_: summarizer history, diagnostic transcript, incremental summary context

**Agent Summarizer Trigger**:
源 Agent session 完成后请求后台维护展示标题和摘要的运行信号。
_Avoid_: leader invocation, user prompt, linked agent call

**IDE Mode**:
NeuroBook 主界面中以 Studio 编辑体验为中心的布局模式，Agent chat surface 位于右侧辅助槽位。
_Avoid_: editor page, normal mode

**Agent Mode**:
NeuroBook 主界面中以 Agent chat surface 为中心的布局模式，左侧显示当前 Project Workspace 的 session 导航，右侧显示 Studio。
_Avoid_: agent drawer, chat-only page

**Agent Chat Surface**:
承载一个 Agent session 的消息流、输入框、运行状态、模型 / Plan Mode / 审批恢复等交互的可移动界面表面；它可以在 IDE Mode 的右侧槽位或 Agent Mode 的中间槽位展示。
_Avoid_: drawer-only component, separate chat implementation

**Agent Session Pin**:
当前客户端对某个 Agent session 的本机列表排序偏好，用于在当前 Project Workspace 的 Agent Mode session 导航中置顶会话。
_Avoid_: session metadata, durable conversation fact, linked agent relation

**Studio**:
Project Workspace 的文件化创作工作区表面，包含文件树、已打开文件和 Markdown Studio 等编辑能力；在 IDE Mode 中是中心，在 Agent Mode 中是右侧辅助区。
_Avoid_: files-only panel, workspace switcher

## Relationships

- **Workspace Root `.nbook`** belongs to exactly one **Workspace Root**.
- **Portable Root** may contain one package-local **Workspace Root**, but it is not itself a **Workspace Root**.
- A **Windows Release Zip** extracts into one **Portable Root**.
- **Windows Source Binding** materializes source files and `.git` inside one **Portable Root** before the Windows local service can start.
- A **Windows App Checkout** lives inside exactly one **Portable Root** and is the process cwd for the local service.
- The Windows portable v1 **Workspace Root** lives inside the **Windows App Checkout** at `app/workspace/`.
- A **Windows Bootstrapper** lives in **Portable Root** and may be refreshed from the **Windows App Checkout** after updates.
- **Global Config** lives in **Workspace Root `.nbook`**.
- **App SQLite** lives in **Workspace Root `.nbook`**.
- **Project SQLite** lives in exactly one **Project Workspace `.nbook`**.
- **Project Path** locates exactly one **Project Workspace** under a **Workspace Root**.
- **Project Manifest** lives at the root of exactly one **Project Workspace** and stores display metadata.
- **Project Workspace File Index** belongs to one **Project Workspace** and is refreshed from file scans or file watcher events.
- **Project Workspace Issue Index** belongs to one **Project Workspace** and can be rebuilt from its files.
- **Project Workspace Issue Index** is derived from **Project Workspace File Index** plus validation rules.
- **Imported Reference** may be transformed into **Canonical Lorebook Entry** only after classification and confidence checks.
- **Dynamic Migration Note** belongs in **Imported Reference** until a later migration step turns it into simulator, writer, subject, entity, Plot, or lorebook material.
- **Subject-facing Knowledge** must not be generated by directly copying a full **Canonical Lorebook Entry** or **Imported Reference**.
- A **Canonical Lorebook Entry** is omniscient project material; visibility to a subject requires filtering into **Subject-facing Knowledge** or a simulator leader message.
- **Project SQLite** stores project data but does not define project identity or display metadata.
- **App SQLite** must not record Project Workspace identity, path, status, or recent project index.
- **Boot Config** may mirror **Process Environment** with `${NAME}` templates but does not override it.
- **Controlled SQLite Tool** targets the current **Project SQLite** only and must not access **App SQLite**.
- **Project Workspace** is portable project data; it may own **Project SQLite** but should not own users or authentication state.
- **Agent Queued Message** is either an **Agent Steer** or an **Agent FollowUp**.
- **Agent Steer** affects the next model call inside an active **Agent ReAct Loop**.
- **Agent FollowUp** starts or continues work after an **Agent ReAct Loop** would otherwise stop.
- **Agent Continue** must not create an **Agent Queued Message**.
- An **Agent Queue Event** announces an **Agent Queued Message** before it becomes a session message.
- A consumed **Agent Queued Message** becomes a normal user message in session history.
- Pending **Agent Steer** messages are all consumed together at the same steer point.
- Pending **Agent Steer** messages prevent the current **Agent ReAct Loop** from stopping and cause another model call in the same loop.
- Pending **Agent FollowUp** messages are consumed one at a time only after an **Agent ReAct Loop** has no tool calls and no pending **Agent Steer** messages.
- **Agent Dialogue Content** excludes tool calls, tool results, and thinking content.
- **Agent Dialogue Content** excludes harness reminders, profile/model-context injected messages, and custom messages unless the content boundary is explicitly expanded later.
- An **Agent Summarizer Session** belongs to exactly one source Agent session.
- An **Agent Summarizer Session** must not create a linked-agent relationship with its source Agent session.
- An **Agent Summarizer Session** is a **History-Frozen Agent Session**, not a sessionless profile.
- An **Agent Summarizer Profile** reports session display metadata; it must not change the source Agent session's conversation history.
- An **Agent Summarizer Trigger** is transparent to the source Agent session's user-facing result.
- Concurrent **Agent Summarizer Triggers** for the same source Agent session coalesce into latest-only background work.
- An **Agent Summarizer Session** rebuilds **Agent Dialogue Content** from the source session's current active path for each run.
- An **Agent Summarizer Session** does not persist its own assistant messages, tool calls, or tool results as conversation history.
- An **Agent Summarizer ModelContext** uses an empty AppendingSet and receives freshly rebuilt **Agent Dialogue Content** from the source session.
- An **Agent Summarizer Session** is created by the harness as a background system session, not by the normal linked-agent `parentSessionId` creation path.
- **Agent Dialogue Content** includes compaction messages when they are on the source session's active path.
- **Agent Dialogue Content** should be rendered as a stable transcript with explicit source labels before it is summarized.
- An **Agent Summarizer Session** reuses the source session's compaction result indirectly because compaction entries are part of **Agent Dialogue Content**.
- **IDE Mode** and **Agent Mode** are alternate layouts of the same current **Project Workspace**; switching modes must not imply project switching.
- **Agent Chat Surface** is shared by **IDE Mode** and **Agent Mode** rather than implemented as two separate chat UIs.
- In **IDE Mode**, **Studio** is the primary center workspace and **Agent Chat Surface** occupies the right-side support slot.
- In **Agent Mode**, **Agent Chat Surface** is the primary center workspace and **Studio** occupies the right-side support slot.
- Switching between **IDE Mode** and **Agent Mode** must preserve the active **Agent Chat Surface** state, including streaming output, SSE recovery state, input draft, and scroll position.
- An **Agent Session Pin** belongs to local UI preference for the current client and must not be written as an Agent session JSONL history fact.

## Example dialogue

> **Dev:** "If I zip a Project Workspace and move it to a new NeuroBook install, do I need the old App SQLite too?"
> **Domain expert:** "No. The Project Manifest, manuscript/lorebook files, Project Config, and Project SQLite travel together. The new App SQLite only keeps its own users and global settings, and the project is located by its Project Path."

> **Dev:** "The Agent is running and I type another instruction. Is that Continue?"
> **Domain expert:** "No. If it should affect the next model call, it is Agent Steer; if it should wait until the run would stop, it is Agent FollowUp. Agent Continue adds no new user message."

> **Dev:** "Should the session summarizer show up as a linked agent?"
> **Domain expert:** "No. It is an Agent Summarizer Session: a background system session that reads Agent Dialogue Content and reports display metadata."

## Flagged ambiguities

- "项目级数据库存 User 表" was used ambiguously. Resolved: **User** belongs to **App SQLite**; **Project SQLite** must not carry users, sessions, or administrator state.
- "NovelId" was used as both project identity and Plot anchor. Resolved: Project runtime identity is **Project Path**; Project SQLite is single-project and does not need a global `Novel` row or numeric `novelId`.
- "Project Index" was proposed as rebuildable App SQLite state. Resolved: **App SQLite** must not record Project Workspace identity or status; Project Workspace discovery scans `project.yaml`.
- "projectId" was proposed as immutable packaged identity. Resolved: no projectId is required in the current design; **Project Path** is the runtime locator and `project.yaml` carries display metadata.
- "workspaceIssues" was used as both UI state and validation truth. Resolved: known issues are a **Project Workspace Issue Index**, a rebuildable materialized index derived from Project Workspace files.
- "tree cache" and "validate table" were used to describe the same optimization. Resolved: file metadata belongs to **Project Workspace File Index**; validation results belong to **Project Workspace Issue Index**.
- "引导", "队列", and "continue" can sound like the same running-session action. Resolved: **Agent Steer** changes the next model call, **Agent FollowUp** waits until the run would stop, and **Agent Continue** adds no user message.
- "queued event" was used like a durable chat entry. Resolved: an **Agent Queue Event** is only runtime state; a consumed **Agent Queued Message** becomes durable history when it is written as a normal user message.
- "steer priority" was used too broadly. Resolved: **Agent Steer** is checked before loop stop; pending **Agent Steer** keeps the current **Agent ReAct Loop** alive, while **Agent FollowUp** only runs after the loop has no tool calls and no pending steer.
- "steer text" was treated as raw user text. Resolved: **Agent Steer** must carry a model-visible prefix aligned with the Codex harness convention.
- "one at a time" was used ambiguously for queues. Resolved: **Agent Steer** uses all-at-steer-point drain; **Agent FollowUp** uses one-at-a-time drain after the loop stops.
- "摘要 agent" was used like a normal visible agent. Resolved: session title/summary maintenance uses an **Agent Summarizer Profile** and **Agent Summarizer Session**, not a linked agent.
- "会话正文 Token" mixed content boundary with token measurement. Resolved: **Agent Dialogue Content** names the content boundary; token counts are a measurement over that content.
- "summary" can mean session display summary, compaction summary, or branch summary. Resolved: **Agent Summarizer Profile** only owns session display metadata.
- "摘要上下文 append-only" was used too broadly. Resolved: source session history remains append-only, but **Agent Summarizer Session** rebuilds Agent Dialogue Content from the current active path each run.
- "摘要者诊断历史" conflicted with history-frozen summarizer semantics. Resolved: **Agent Summarizer Session** does not persist its own ReAct transcript; diagnostics come from state, lifecycle, source session, and runtime logs.
- "sessionless summarizer" was too imprecise. Resolved: summarizer has a session identity and initialization history, but behaves as a **History-Frozen Agent Session** after initialization.
- "portable workspace" can mix program files with user data. Resolved: **Portable Root** names the extracted program directory; **Workspace Root** names runtime data, currently package-local for Windows portable v1.
- "Windows portable" sounded like another `neuro-book-deploy` mode. Resolved: **Windows Release Zip** is a release asset with its own startup bootstrapper, not a `neuro-book-deploy` deployment mode.
- "带源码 zip" conflicted with not carrying `.git`. Resolved: **Windows Release Zip** starts as a bootstrap zip; **Windows Source Binding** materializes source and `.git` during first startup.
- "clone into Portable Root" conflicted with bootstrap files already living there. Resolved: **Windows App Checkout** is always `Portable Root/app/`, while bootstrap files stay at Portable Root.
- "启动脚本" was too vague for update ownership. Resolved: **Windows Bootstrapper** names the root-level scripts; source copies live in the repo and are synced back to Portable Root after update.
