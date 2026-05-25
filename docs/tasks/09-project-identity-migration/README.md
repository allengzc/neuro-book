# Project Identity Migration

## User Request

- 考虑当前数据库是否有必要删除 `Novel` 表。
- 评估能否用 Project path，或 `novel/{slug}/workspace.yaml` 这类项目元数据文件表达 `novelId`。
- 开一个 Project identity migration 任务，先把迁移目标、边界和风险记录下来。
- 任务目标调整为删除 `Novel` 表，并迁移现有相关代码到 Project identity。

## Goal

- 删除数据库里的 `Novel` 表，不再用 DB row 表达 Project identity。
- 将公开身份合同从 numeric `novelId` 迁移到稳定的 Project identity。
- 目标合同：
    - URL/API/前端主状态使用 `projectSlug`。
    - Agent / 文件工具 / 数据库记录使用 `projectPath`，第一版就是 Workspace Root 下的一级目录名。
    - Project Workspace 元数据文件使用 `project.yaml`，用 `kind: novel` 表达项目类型。
    - 新 API 合同使用 `/api/projects`；不做 `/api/novels` legacy 兼容。
    - Plot / Story / Agent / Config 只接受 Project identity，不再把 `novelId` 作为运行时锚点。
- 删除 `Novel` 表后，系统功能必须保持完整可用：项目列表、打开项目、创建项目、剧情系统、Agent session、配置中心和 SQLite/Postgres 双数据库都要能跑通。

## Current State

- `Novel` 表仍然是多个运行时路径的身份锚点：
    - `/api/novels` 列表和部分 route ID parsing。
    - `novelId -> workspaceSlug -> workspace/<slug>` 的 Project Workspace 解析。
    - 新项目创建流程。
    - 前端 `currentNovelId` / `currentNovel.workspaceSlug` 状态。
    - Plot / Story 数据库根外键。
    - Agent session / runtime context 中的当前小说定位。
- Workspace 术语必须继续按 `spec/workspace/TERMS.md`：
    - `workspace/` 是 Workspace Root。
    - `workspace/{project}/` 是 Project Workspace。
    - 这次迁移的目标是 Project identity，不是泛泛的 workspace 改名。
- 当前 SQLite-first 双数据库迁移不等于 Project identity migration；它只解决数据库运行时选择，不解决项目身份合同。

## Walkthrough

- 2026-05-25：开任务，记录删除 `Novel` 表前需要先完成 Project identity migration。
- 2026-05-25：用户将任务目标调整为 hard-cut：本任务直接删除 `Novel` 表，并迁移现有相关代码。
- 2026-05-25：grill-with-docs 第一轮确认：公开 DTO / 前端主状态用 `projectSlug`，Agent / 文件工具语境用 `projectPath`；新增 `/api/projects`，不保留 `/api/novels` legacy 兼容；`project.yaml` 是 Project existence 真值；Plot 根记录一次性迁到 `projectPath`。

## Decisions

- 删除 `Novel` 表，不再新增替代性的 DB-only project registry，除非实现时证明列表/查询性能或事务边界确实需要派生索引。
- 优先把外部可见合同从 `novelId` 迁到 `projectSlug`；Agent、文件工具和数据库根记录使用 `projectPath`。
- 旧 `novelId` 只作为需要清理的历史字段，不作为长期兼容合同保留。
- 不做 legacy API 兼容；迁移后前端和后端都不再保留 `/api/novels` 作为可用合同，更容易暴露未迁移 call site。
- `project.yaml` 是 Project existence 的唯一真值；缺失或非法 metadata 的目录不进入正常项目列表。
- Plot 根记录一次性使用 `projectPath @unique`，不先用 `projectSlug` 再二次迁移。
- Project identity 的领域定义写入 `CONTEXT.md`：Project identity 指向一个 Project Workspace，不再等同数据库自增 id。
- Project Workspace 元数据文件名倾向 `project.yaml`，而不是 `workspace.yaml` 或 `novel.yaml`：
    - `project.yaml` 更符合项目可扩展方向。
    - 小说项目用 `kind: novel` 表达，不把整个系统继续绑定到 novel-only 命名。

## Grill Questions

- Q1：Project identity 的 canonical 字段到底叫 `projectSlug` 还是 `projectPath`？
  - 决定：公开 DTO 和前端主状态使用 `projectSlug`；文件工具和 Agent prompt 使用 `projectPath`。第一版二者值可以相同，都是 Workspace Root 下的一级目录名，但命名要表达使用场景。
- Q2：`/api/novels` 是否改名为 `/api/projects`？
  - 决定：新增 `/api/projects` 作为新合同，不做 `/api/novels` legacy 兼容。未迁移 call site 应直接暴露为错误。
- Q3：`project.yaml` 是否是 Project existence 的唯一真值？
  - 决定：是。列表扫描 Project Workspace 并读取 `project.yaml`；缺失或非法 metadata 的目录不进入正常列表，可在诊断/修复工具中暴露。
- Q4：Plot 根记录应该存 `projectSlug` 还是 `projectPath`？
  - 决定：一次性做好，存 `projectPath`，字段名用 `projectPath` 并加唯一约束；第一版 projectPath 是 Workspace Root 下的一级目录名。
- Q5：删除 `Novel` 表时是否保留旧 session / selection 的 `novelId` 兼容？
  - 决定：不保留 legacy 兼容。旧 Agent session 和前端本地状态按可丢弃运行态处理，迁移后需要重新选择 Project Workspace；Plot selection 必须带 Project identity 才能复用。
- Q6：旧 `workspace.yaml` 怎么处理？
  - 决定：实现期提供一次性迁移：存在 `workspace.yaml` 时生成 `project.yaml`，随后运行时只读 `project.yaml`；模板和新建流程直接写 `project.yaml`。

## Migration Plan

- Phase 1：梳理并替换 Project identity 入口。
    - 全量列出 `novelId` / `workspaceSlug` / `Novel` call site。
    - 增加从 `projectSlug` / `projectPath` 解析 Project Workspace 的统一 helper。
    - 新建和读取 Project Workspace 时写入/读取 `project.yaml`。
- Phase 2：删除 `Novel` 表和 DB 外键依赖。
    - Prisma SQLite/Postgres 双 schema 同步删除 `Novel` model。
    - 将 `Story.novelId` 迁移为 `Story.projectPath @unique`。
    - migrations 同步处理 SQLite/Postgres fresh DB；不做旧 Postgres 自动导入。
- Phase 3：迁移 API / 前端 contract。
    - 新增 `/api/projects`，列表改为扫描 Project Workspace + `project.yaml`。
    - 删除 `/api/novels` legacy 路由与旧 DTO。
    - 新建项目流程不再创建 `Novel` row。
    - 前端 store 从 `currentNovelId` 收敛到 current project identity。
    - 设置中心的 Project Config 查询改为 Project identity。
- Phase 4：迁移 Agent / Plot scope。
    - Agent RuntimeContext 使用 Current Project Workspace 和 project identity 表达当前项目。
    - Plot / Story repository 直接接受 Project identity。
    - 跨 Project 操作显式传 Project identity，避免复用旧 selection 状态。
- Phase 5：清理旧合同。
    - 删除旧 `novelId` DTO、参数、类型和提示词注入。
    - 删除 `Novel` 相关 helper、测试 fixture 和文档说法。
    - 保留路由名时也要避免暴露 numeric `novelId` 心智。

## Files Changed

- `docs/tasks/09-project-identity-migration/README.md`
- `PROJECT-STATUS.md`

## Verification

- 本次只开任务文档，不改业务代码。
- 后续实现时至少验证：
    - 创建 Project Workspace 后 `project.yaml` 与列表 API 一致。
    - 前端打开、切换、保存 Project Workspace 不再依赖 numeric `novelId`。
    - Prisma SQLite/Postgres schema 中不存在 `Novel` model，fresh migrate 成功。
    - Plot thread / scene / plot 创建、更新、排序在 Project identity 下行为完整。
    - Agent session、SQL 工具、配置中心能定位当前 Project Workspace。
    - SQLite / Postgres 两种数据库下核心写作链路都保持可用。

## TODO / Follow-ups

- 梳理所有 `novelId` call site，分成 public contract、runtime context、DB foreign key 三类。
- 设计 `project.yaml` schema。
- 制定从旧 `Novel.workspaceSlug` 到 `project.yaml` / `Story.projectPath` 的本地数据迁移脚本。
- 删除 `/api/novels` 路由树并迁移所有调用到 `/api/projects`。
- 删除 `Novel` 表后补一次端到端回归清单。
