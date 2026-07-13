# Workspace Terms

本文件定义 NeuroBook 中 workspace 相关术语。后续文档、代码注释、API 命名和设置页文案都应优先引用这些词，避免把 `workspace` 同时用于多个层级。

## Terms

- **Installation Root**：NeuroBook 源码与 `.output`、`.runtime`、`.deploy` 组件的统一程序根；它不是 Workspace Root。
- **State Root**：运行状态的物理根。默认等于 Installation Root；Windows Portable 为 `Installation Root/data/`。
- **Workspace Root**：应用运行数据根目录，默认是 `workspace/`。它只是数据容器，不直接表示某本小说或某个项目。
- **Workspace Root `.nbook`**：Workspace Root 的全局控制区，默认是 `workspace/.nbook/`。它保存 Global Config、用户 assets、全局 Agent 资源覆盖层和后续全局运行状态。
- **Project Workspace**：一个具体内容项目的工作区，当前主要是单本小说，默认是 `workspace/{project}/`。它保存 manuscript、lorebook 等项目内容。
- **Project Slug**：Project Workspace 在 Workspace Root 下的单段目录名，例如 `ming-ding-zhi-shi-2`。
- **Project Path**：项目级 API 使用的稳定标识，形态固定为 `workspace/{project-slug}`；它不是文件工具的 cwd-relative 路径。
- **Project Workspace `.nbook`**：Project Workspace 的项目级控制区，默认是 `workspace/{project}/.nbook/`。它保存 Project Config、项目状态和项目私有元数据。
- **user-assets**：前端用于编辑 Workspace Root `.nbook` 的入口。它不是独立配置层，而是把当前 Studio 挂载在 `workspace/.nbook/`。
- **Bundled Workspace Template**：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。

## Path Mapping

- `assets/workspace/.nbook` 是系统模板层，映射到运行时 `workspace/.nbook`。
- `NEURO_BOOK_STATE_ROOT` 决定 State Root；Workspace Root、Boot Config、Product Env 和日志都从 State Root 解析。
- Windows Portable 的物理 Workspace Root 是 `data/workspace/`，但 Project Path 仍固定为 `workspace/{project-slug}`。
- 用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`。
- `assets/workspace/global.config.example.json` 对应运行时 `workspace/.nbook/config.json` 的示例。
- `assets/workspace/workspace.config.example.json` 对应运行时 `workspace/{project}/.nbook/config.json` 的示例。
- user-assets 入口直接编辑 `workspace/.nbook`，不再使用 `workspace/.nbook/assets` 作为嵌套资产根。
- 普通 Agent 的文件工具 cwd 是 Workspace Root。项目文件使用 `{project-slug}/manuscript/...`、`{project-slug}/lorebook/...`、`{project-slug}/reference/...`。
- Current Project Workspace 只表示模糊项目操作的默认焦点，不是权限或访问边界；所有 Project Workspace 都可通过显式 Project Slug 跨项目访问。
- 仓库源码根与仓库级 `reference/` 位于 Workspace Root cwd 外，使用 runtime reminder 提供的绝对路径访问。

## Naming Rules

- 不要把 Workspace Root 缩写成 workspace 来表达 Project Workspace。
- 不要把 Project Workspace 缩写成 workspace。
- 不要把 **Installation Root** 或 **State Root** 称为 Workspace Root；前者是程序组件根，后者是状态物理根，Workspace Root 是项目数据容器。
- 当讨论单本小说/项目的文件根时，使用 **Project Workspace**。
- 当讨论全局用户资产、全局配置、Agent profiles/skills 覆盖层时，使用 **Workspace Root `.nbook`**。
- 当讨论前端入口时，`user-assets` 只表示 Studio 挂载目标，不表示新的配置 scope。
