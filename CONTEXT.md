# NeuroBook Context

NeuroBook 是一个本地优先的小说创作工作台。该语境记录用户运行数据、配置和数据库运行时相关的稳定术语。

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

**Boot Config**:
启动和部署期配置，修改后需要重启服务才能可靠生效。
_Avoid_: settings, runtime preference

**Process Environment**:
进程启动时实际生效的环境变量集合，是数据库运行时配置的执行真值源。
_Avoid_: config mirror, settings

**Global Config**:
单用户全局运行配置，位于 Workspace Root `.nbook/config.json`。
_Avoid_: boot config, project config

**Database Kind**:
当前进程使用的数据库实现类型，第一版只允许 `sqlite` 或 `postgres`。
_Avoid_: database mode, provider

**SQLite Data File**:
SQLite 默认数据库文件，属于 Workspace Root `.nbook` 下的本机运行状态。
_Avoid_: project data file, deployment file

**Database-aware SQL Tool**:
根据当前 Database Kind 选择 SQL 方言、schema 摘要、连接实现和错误提示的 Agent 数据库工具。
_Avoid_: Postgres SQL tool, generic SQL tool

## Relationships

- **Workspace Root `.nbook`** belongs to exactly one **Workspace Root**.
- **Global Config** lives in **Workspace Root `.nbook`**.
- **SQLite Data File** lives in **Workspace Root `.nbook`**.
- **Boot Config** may mirror **Process Environment** with `${NAME}` templates but does not override it.
- **Database Kind** is selected by **Process Environment** and requires service restart to change.
- **Database-aware SQL Tool** depends on **Database Kind** for its behavior and user-facing description.
- **Project Workspace** is content data; it should not own global database runtime files.

## Example dialogue

> **Dev:** "Can users switch the Database Kind in the settings dialog?"
> **Domain expert:** "No. Database Kind is Boot Config. Changing it requires restart and migration, while Global Config remains hot or next-run application behavior."

## Flagged ambiguities

- "自由选择数据库" resolved: first version means choosing **Database Kind** between SQLite and Postgres, not arbitrary Prisma-supported databases.
