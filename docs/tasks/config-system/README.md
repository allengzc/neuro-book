# Config System

## User Request

- 统一 NeuroBook 的配置系统。
- 配置分为启动配置、全局配置、当前 workspace 配置。
- 前端每次获取配置都必须是最新的。
- 有些配置影响整个应用，不能被 workspace 覆盖，例如 `auth.enabled`。
- 有些配置可能修改后需要重启服务，应从可热更新配置中拆开。
- 有些配置需要像 VSCode 一样允许当前 workspace 覆盖全局默认值。
- 设置页按照 Global 和各个 Workspace 组织，接近配置文件的真实边界。
- 术语需要规范：现有文档经常混用 `workspace`、`user-assets` 和单本项目 workspace。

## Goal

- 建立一个 registry 驱动的配置系统，让每个配置项明确声明：
    - 所属配置层
    - 是否允许 workspace 覆盖
    - merge 语义
    - 生效时机
    - 是否是敏感字段
- 把当前散落的 `config.yaml`、`workspace/.nbook/settings.json`、Pinia persisted settings 收敛为清晰的配置模型。
- 为后续前端设置页改造提供稳定 contract。

## Current State

- 根目录 `config.yaml` 当前同时承担部署私有配置、Provider 配置、Agent tools、Agent profile model、`auth.enabled` 等运行时配置。
- `server/utils/app-config.ts` 负责读取、解析、缓存并写回 `config.yaml`。
- `server/workspace-settings/workspace-settings.ts` 当前读取 `<workspaceRoot>/.nbook/settings.json`，只暴露 `agent.defaultProfileKey`。
- `NovelIdeSettingsDialog.vue` 已经是设置总入口，但把本地 UI 偏好、系统级 `config.yaml`、workspace 默认 profile 混在一个 Dialog 内。
- 前端 UI/editor 偏好主要由 `app/stores/novel-ide.ts` 通过 Pinia persist 写入 `sessionStorage`，这类状态不是配置系统的一部分。
- 当前没有多用户 User Config。NeuroBook 先按单用户应用设计。
- assets 目录正在迁到新的 workspace 资源模板结构：系统内置 workspace 资源位于 `assets/workspace`，其中 `assets/workspace/.nbook` 映射到运行时 `workspace/.nbook`。用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`。

## Proposed Model

## Terms

稳定术语见 [Workspace Terms](../../../spec/workspace/TERMS.md)。本任务遵守以下规则：

- `workspace` 表示 Workspace Root。
- `project` 表示 Project Workspace。
- Project Workspace 不再缩写为 workspace。
- user-assets 只是把当前 Studio 挂载到 Workspace Root `.nbook` 的入口，不是独立配置 scope。

### Boot Config

启动配置，不参与覆盖链。修改后通常需要重启服务。

- 位置：根目录 `config.yaml`。
- 作用：决定应用进程如何启动、连接什么基础设施、使用什么根目录。
- 设置页第一版不编辑 Boot Config。
- 第一版不在 schema 中实现动态 `workspace.root`；项目启动后确保默认 Workspace Root `workspace/` 存在。

候选字段：

- `server.host`
- `server.port`
- `database.url`
- `security.sessionSecret`
- `logging.level`
- 文件 watcher 根目录或未来 worker pool 启动参数。
- `workspace.root` 作为后续 TODO，不进入第一版 schema。

### Global Config

单用户全局运行配置，是应用默认行为。

- 位置：`workspace/.nbook/config.json`。
- 作用：替代现在 `config.yaml` 中大部分可热更新业务配置。
- 设置页按 Global 文件组织显示与编辑。
- 不存在时使用内置 defaults。
- GET snapshot 不自动创建 `workspace/.nbook/config.json`；第一次保存 Global 设置或初始化脚本才创建文件。
- `auth.enabled=false` 时设置页仍可访问；`auth.enabled=true` 时只有管理员可以修改。
- Global Config 与 Project Config 都只使用 JSON。Boot Config 继续使用 YAML，面向部署和手写启动配置。

候选字段：

- `auth.enabled`
- `models.default`
- `models.providers`
- `agent.defaultProfileKey.novel`
- `agent.defaultProfileKey.userAssets`
- `agent.profiles`
- `ui.theme`
- `editor.markdown`
- `editor.monaco`

### Project Config

当前 Project Workspace 覆盖配置，类似 VSCode workspace settings。

- Project Workspace `.nbook` 位置：`workspace/{project}/.nbook/config.json`。
- user-assets 入口没有独立 Project Config；它直接编辑 Workspace Root `.nbook`，也就是 `workspace/.nbook/config.json`。
- 设置页按 Workspace Root `.nbook` 和当前 Project Workspace `.nbook` 文件组织显示与编辑。
- 只允许覆盖 registry 中声明为 workspace-overridable 的配置项。
- GET snapshot 不自动创建 Project Config；第一次保存 Project 设置或创建 Project Workspace 时才创建文件。

候选字段：

- `models.default`
- `agent.defaultProfileKey`
- `agent.profiles.<profileKey>.model`
- `editor.markdown`
- `editor.monaco`
- 后续写作风格、写作参考、profile 相关 workspace 默认值。

### Bundled Workspace Template

系统可覆盖资源从旧的 `assets/.nbook` / `assets/server/workspace` 继续收敛到 `assets/workspace`。其中 `assets/workspace/.nbook` 是运行时 Workspace Root `.nbook` 的系统模板层，映射到 `workspace/.nbook`。

```text
assets/
└── workspace/
    ├── .nbook/
    │   ├── agent/
    │   │   ├── bin/
    │   │   ├── profiles/
    │   │   └── skills/
    │   └── templates/
    │       ├── content-node-templates/
    │       └── novel-directory-templates/
    ├── global.config.example.json
    └── workspace.config.example.json
```

约定：

- `assets/workspace` 是 Bundled Workspace Template 根。
- `assets/workspace/.nbook` 到运行时 `workspace/.nbook` 是系统模板层到 Workspace Root `.nbook` 的映射。
- Workspace Root `.nbook` 中的 user assets 可以覆盖 Bundled Workspace Template。
- 同名 skill 目录按目录整体覆盖。
- profile 按 key 覆盖；builtin key 覆盖仍遵守 schema contract 锁定规则。
- templates 按相对路径覆盖，复制到 Project Workspace 时只补缺失文件，不覆盖用户已经写过的项目文件。
- `assets/workspace/global.config.example.json` 是 Global Config 示例，对应运行时 Workspace Root `.nbook` 的 `workspace/.nbook/config.json`。
- `assets/workspace/workspace.config.example.json` 是 Project Config 示例，对应运行时 Project Workspace `.nbook` 的 `workspace/{project}/.nbook/config.json`。
- 示例文件不是运行时真值，不应被 resolver 当作自动覆盖层读取。

### Browser State

纯前端临时状态，不进入配置系统。

- 位置：Pinia persist / `sessionStorage` / `localStorage`。
- 示例：打开的 tab、当前 drawer 展开状态、last session id、临时选中项、未保存编辑 buffer。

## Registry

每个配置项都必须在 registry 中声明元数据。配置解析、写入校验、设置页展示都以 registry 为准。

```ts
type ConfigScope = "boot" | "global" | "global-workspace";
type ConfigEffect = "hot" | "next-run" | "next-session" | "restart-required";
type ConfigMerge = "replace" | "deep-merge";

type ConfigItemMeta = {
    key: string;
    scope: ConfigScope;
    effect: ConfigEffect;
    merge: ConfigMerge;
    secret: boolean;
    description: string;
};
```

约定：

- primitive 默认 `replace`。
- object 默认 `deep-merge`。
- array 默认 `replace`，不做 concat。
- `models.providers` 第一版为 `global`，不允许 workspace 覆盖。
- `auth.enabled` 为 `global`，不允许 workspace 覆盖。
- `models.default` 为 `global-workspace`。
- `agent.defaultProfileKey` 为 `global-workspace`。
- 删除 `agent.tools.allow` / `agent.tools.deny` 这组全局配置；第一版不再提供全局工具 allow/deny 设置。
- secret 字段在设置页 snapshot 中返回结构化状态，PUT 时只有显式提交新值才覆盖。

Secret 字段第一版使用统一结构：

```ts
type SecretConfigValue = {
    configured: boolean;
    maskedValue: string | null;
    value?: string;
};
```

约定：

- GET/editor snapshot 返回 `configured` 与 `maskedValue`，不返回明文 `value`。
- PUT 时 `value` 缺失表示保留原值。
- PUT 时 `value: ""` 表示清空 secret。
- PUT 时 `value` 为非空字符串表示写入新 secret。

## Snapshot

Snapshot 是运行时使用的最新配置结果，不承担来源解释。

```ts
type ConfigSnapshot = {
    version: string;
    effective: EffectiveConfig;
    meta: ConfigItemMeta[];
};
```

设置页需要额外的编辑视图，可以返回 raw global/workspace 文件内容和可编辑 metadata：

```ts
type ConfigEditorSnapshot = {
    version: string;
    global: GlobalConfig;
    project: ProjectConfig | null;
    effective: EffectiveConfig;
    meta: ConfigItemMeta[];
};
```

约定：

- 业务运行时只依赖 `effective`。
- 只有设置页需要知道 Global 文件与 Project 文件各自写了什么。
- 前端打开设置页时必须重新请求最新 snapshot。
- 保存后后端直接返回最新 snapshot。
- Agent 创建 session / invocation 前读取最新 effective config；单次 invocation 开始后固定当时的 config snapshot。

## API Shape

第一版保持简单，使用 PUT，不做 patch。

```http
GET /api/config/snapshot?workspaceKind=novel&novelId=...
GET /api/config/editor-snapshot?workspaceKind=novel&novelId=...
PUT /api/config/global
PUT /api/config/project
```

写入规则：

- `PUT /api/config/global` 写 Workspace Root `.nbook` 的 `workspace/.nbook/config.json`。
- `PUT /api/config/project` 写当前 Project Workspace `.nbook` 的 `config.json`。
- 后端根据 registry 拒绝把 `global` only 配置写进 Project Config。
- 第一版不做写入原子锁或 version conflict 检查。
- 写入仍应尽量保持 JSON 格式稳定，避免无关字段丢失。
- Provider API key 从根 `config.yaml` 迁入 Global Config 后，部署必须持久化整个 Workspace Root；根 `config.yaml` 不再承载 Provider key。
- 旧 `/api/settings/models`、`/api/settings/agent-profile-models`、`/api/settings/agent-tools`、`/api/workspace-settings` 立即删除，不做 adapter。

## Settings UI

设置页按文件边界组织：

- Global 设置：展示 Workspace Root `.nbook` 中的 `workspace/.nbook/config.json`。
- 当前 Project Workspace 设置：展示当前 Project Workspace `.nbook` 中的 `config.json` 覆盖配置。

配置项仍按功能分组显示，例如：

- Auth
- Models
- Agent
- Editor
- UI

显示策略：

- Global-only 配置只在 Global 设置中可编辑。
- Project-overridable 配置在 Global 和 Project 都可编辑。
- Project 设置页提供“清除覆盖”，本质是从 Project Config 中移除该字段。
- restart-required 配置如果未来开放编辑，保存后必须提示需要重启。
- Secret 字段显示已配置/未配置和脱敏值；不展示明文。

## Resolution Order

模型和 Agent profile 配置按普通 config 覆盖规则解析，不为 profile model 额外引入特殊处理。

约定：

- Project Config 可以覆盖 `agent.profiles.<profileKey>.model`。
- Project Config 不允许覆盖 `models.providers`，因此不能新增 provider、apiKey 或 baseURL。
- 明确 invocation/session override 的优先级高于配置文件。

模型选择优先级：

1. explicit invocation/session override
2. Project Config `agent.profiles.<profileKey>.model`
3. Global Config `agent.profiles.<profileKey>.model`
4. Project Config `models.default`
5. Global Config `models.default`

## Decisions

- 不做多用户 User Config。当前所谓 user config 收敛为 Global Config，位置是 Workspace Root `.nbook` 的 `workspace/.nbook/config.json`。
- Project Config 位于当前 Project Workspace `.nbook` 的 `config.json`。
- Boot Config 和可热更新业务配置拆开；根 `config.yaml` 后续只保留启动期/部署期字段。
- 第一版不实现动态 `workspace.root`；启动后初始化默认 Workspace Root `workspace/`。
- Global Config 和 Project Config 的 GET 不自动创建配置文件；保存或显式初始化才创建。
- Provider 配置与 API key 迁入 Global Config；部署侧接受持久化整个 `workspace/` 作为应用运行数据。
- 运行时配置文件属于本机数据，必须继续被 Git 忽略；示例文件留在 `assets/workspace/*.example.json`。
- `auth.enabled` 放在 Global Config；关闭鉴权时设置页仍可访问，开启鉴权时只有管理员可以改。
- `auth.enabled=false` 时保持现有 contract：整站和管理员接口都退化为无鉴权访问。
- `config.example.yaml` 拆为 Boot Config 示例；Global Config / Project Config 示例使用 `assets/workspace/global.config.example.json` 与 `assets/workspace/workspace.config.example.json`。
- Global Config 和 Project Config 都只用 JSON；Boot Config 继续用 YAML。
- Snapshot 是拿来运行的，不需要携带字段来源；只有设置页 editor snapshot 需要 raw global/workspace。
- 写入接口使用 PUT，第一版不做 patch。
- 第一版不做原子写锁、version conflict 或跨进程配置广播。
- 设置页按 Global 和各 Project 组织，也就是按配置文件边界组织。
- Secret 字段一次性做结构化状态与写回语义，不用空字符串兼容方案。
- UI/editor 偏好中明确属于长期偏好的配置迁入 Global Config；lastSessionId、打开的 tab、未保存 buffer、面板展开状态继续作为 Browser State。
- 第一版直接删除 `agent.tools.allow/deny` 配置，不做 workspace 工具覆盖。
- 旧 settings API 立即删除，不做兼容 adapter。
- 启动时不自动把 `assets/workspace/.nbook` 全量同步到 `workspace/.nbook`。启动只确保 Workspace Root 存在；系统 assets 通过 resolver 叠加读取，物理复制仍走显式“同步系统 assets”，只补缺失、不覆盖。
- 术语上区分 Workspace Root、Workspace Root `.nbook`、Project Workspace、Project Workspace `.nbook`、user-assets 和 Bundled Workspace Template，后续文档需要逐步清理旧混用。

## Files Changed

- `docs/tasks/config-system/README.md`

## Verification

- 本轮是设计文档更新，未运行测试。

## TODO / Follow-ups

- 实现 `server/config` registry/source/resolver/service。
- 增加 `/api/config/*`。
- 将当前 `server/utils/app-config.ts` 包装或迁移到新的 Boot/Global config source。
- 将当前 `workspace-settings.ts` 合并到 Project Config。
- 改造 `NovelIdeSettingsDialog.vue` 为 Global / Project 双入口设置页。
- 更新部署文档、`PROJECT-STATUS.md` 和 `config.example.yaml`。
- 同步更新 user assets / Bundled Workspace Template 覆盖机制文档与 resolver，实现新 `assets/workspace` 结构。
- 清理旧 `agent.tools.allow/deny` 相关 DTO、API 和设置页入口。
- 删除旧 settings API，并清理前端旧调用。
- 确认 `.gitignore` 覆盖运行时配置文件：`config.yaml`、`workspace/`、`.deploy/` 继续忽略；示例文件不忽略。
- 单独清理旧文档中的 workspace 术语混用，逐步引用 `spec/workspace/TERMS.md`。
