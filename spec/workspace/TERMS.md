# Workspace Terms

本文件定义 NeuroBook 中 workspace 相关术语。后续文档、代码注释、API 命名和设置页文案都应优先引用这些词，避免把 `workspace` 同时用于多个层级。

## Terms

- **Workspace Root**：应用运行数据根目录，默认是 `workspace/`。它只是数据容器，不直接表示某本小说或某个项目。
- **Workspace Root `.nbook`**：Workspace Root 的全局控制区，默认是 `workspace/.nbook/`。它保存 Global Config、用户 assets、全局 Agent 资源覆盖层和后续全局运行状态。
- **Project Workspace**：一个具体内容项目的工作区，当前主要是单本小说，默认是 `workspace/{project}/`。它保存 manuscript、lorebook 等项目内容。
- **Project Workspace `.nbook`**：Project Workspace 的项目级控制区，默认是 `workspace/{project}/.nbook/`。它保存 Project Config、项目状态和项目私有元数据。
- **user-assets**：前端用于编辑 Workspace Root `.nbook` 的入口。它不是独立配置层，而是把当前 Studio 挂载在 `workspace/.nbook/`。
- **Bundled Workspace Template**：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。

## Path Mapping

- `assets/workspace/.nbook` 是系统模板层，映射到运行时 `workspace/.nbook`。
- 用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`。
- `assets/workspace/global.config.example.json` 对应运行时 `workspace/.nbook/config.json` 的示例。
- `assets/workspace/workspace.config.example.json` 对应运行时 `workspace/{project}/.nbook/config.json` 的示例。
- user-assets 入口直接编辑 `workspace/.nbook`，不再使用 `workspace/.nbook/assets` 作为嵌套资产根。

## Naming Rules

- 不要把 Workspace Root 缩写成 workspace 来表达 Project Workspace。
- 不要把 Project Workspace 缩写成 workspace。
- 当讨论单本小说/项目的文件根时，使用 **Project Workspace**。
- 当讨论全局用户资产、全局配置、Agent profiles/skills 覆盖层时，使用 **Workspace Root `.nbook`**。
- 当讨论前端入口时，`user-assets` 只表示 Studio 挂载目标，不表示新的配置 scope。
