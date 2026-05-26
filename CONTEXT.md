# NeuroBook Context

NeuroBook 是一个本地优先的小说创作工作台。该语境记录用户运行数据、配置、Project Workspace 可携带性和数据库边界相关的稳定术语。

## Language

**Workspace Root**:
应用运行数据根目录，默认是 `workspace/`。
_Avoid_: workspace, project root

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

## Relationships

- **Workspace Root `.nbook`** belongs to exactly one **Workspace Root**.
- **Global Config** lives in **Workspace Root `.nbook`**.
- **App SQLite** lives in **Workspace Root `.nbook`**.
- **Project SQLite** lives in exactly one **Project Workspace `.nbook`**.
- **Project Path** locates exactly one **Project Workspace** under a **Workspace Root**.
- **Project Manifest** lives at the root of exactly one **Project Workspace** and stores display metadata.
- **Project Workspace File Index** belongs to one **Project Workspace** and is refreshed from file scans or file watcher events.
- **Project Workspace Issue Index** belongs to one **Project Workspace** and can be rebuilt from its files.
- **Project Workspace Issue Index** is derived from **Project Workspace File Index** plus validation rules.
- **Project SQLite** stores project data but does not define project identity or display metadata.
- **App SQLite** must not record Project Workspace identity, path, status, or recent project index.
- **Boot Config** may mirror **Process Environment** with `${NAME}` templates but does not override it.
- **Controlled SQLite Tool** targets the current **Project SQLite** only and must not access **App SQLite**.
- **Project Workspace** is portable project data; it may own **Project SQLite** but should not own users or authentication state.

## Example dialogue

> **Dev:** "If I zip a Project Workspace and move it to a new NeuroBook install, do I need the old App SQLite too?"
> **Domain expert:** "No. The Project Manifest, manuscript/lorebook files, Project Config, and Project SQLite travel together. The new App SQLite only keeps its own users and global settings, and the project is located by its Project Path."

## Flagged ambiguities

- "项目级数据库存 User 表" was used ambiguously. Resolved: **User** belongs to **App SQLite**; **Project SQLite** must not carry users, sessions, or administrator state.
- "NovelId" was used as both project identity and Plot anchor. Resolved: Project runtime identity is **Project Path**; Project SQLite is single-project and does not need a global `Novel` row or numeric `novelId`.
- "Project Index" was proposed as rebuildable App SQLite state. Resolved: **App SQLite** must not record Project Workspace identity or status; Project Workspace discovery scans `project.yaml`.
- "projectId" was proposed as immutable packaged identity. Resolved: no projectId is required in the current design; **Project Path** is the runtime locator and `project.yaml` carries display metadata.
- "workspaceIssues" was used as both UI state and validation truth. Resolved: known issues are a **Project Workspace Issue Index**, a rebuildable materialized index derived from Project Workspace files.
- "tree cache" and "validate table" were used to describe the same optimization. Resolved: file metadata belongs to **Project Workspace File Index**; validation results belong to **Project Workspace Issue Index**.
