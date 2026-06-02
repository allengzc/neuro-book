# Config System

## User Request

- 统一 NeuroBook 的配置系统。
- 配置分为 Boot Config、Global Config、Project Config 和 Browser State。
- 前端每次获取配置都必须是最新的。
- 有些配置影响整个应用，不能被 Project Config 覆盖，例如 `auth.enabled`。
- 有些配置修改后需要重启服务，应从可热更新配置中拆开。
- 有些配置需要像 VSCode 一样允许当前 Project Workspace 覆盖全局默认值。
- 设置页按照 Global 和当前 Project Workspace 组织，接近配置文件的真实边界。
- 术语必须规范，避免混用 Workspace Root、Project Workspace 和 user-assets。

## Summary

本轮已经把配置真值源从旧 `config.yaml` / workspace settings / settings API 拆成新的四层模型：

- Boot Config：根目录 `config.yaml`，只保留启动/部署期配置，第一版不进设置页。
- Global Config：`workspace/.nbook/config.json`，保存单用户全局运行配置。
- Project Config：`workspace/{project}/.nbook/config.json`，保存当前 Project Workspace 覆盖配置。
- Browser State：Pinia / `localStorage` / `sessionStorage`，只保存临时 UI 状态。

新正式入口为 `/api/config/*`。旧 `/api/settings/*`、`/api/workspace-settings` 和 `agent.tools.allow/deny` 设置入口已删除，不做 adapter。模型 Provider / API Key / Agent profile model 已迁入 Global Config；Agent invocation 开始前读取最新 effective config，并在单次 invocation 内固定当时快照。

旧配置迁移入口为 `bun run config:migrate`。脚本会读取旧根 `config.yaml`，把业务配置写入 `workspace/.nbook/config.json`，并把根 `config.yaml` 收窄为 Boot Config；迁移过程不会把 secret 打印到终端。

## Terms

稳定术语见 [Workspace Terms](../../../reference/workspace/TERMS.md)。本任务遵守以下规则：

- Workspace Root：应用运行数据根目录，默认 `workspace/`。
- Workspace Root `.nbook`：全局控制区，默认 `workspace/.nbook/`。
- Project Workspace：单本小说或具体项目目录，默认 `workspace/{project}/`。
- Project Workspace `.nbook`：项目级控制区，默认 `workspace/{project}/.nbook/`。
- user-assets：前端用于编辑 Workspace Root `.nbook` 的入口，不是独立配置 scope。
- Bundled Workspace Template：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。

## Implemented Model

### Boot Config

- 位置：根目录 `config.yaml`。
- 作用：启动/部署期配置。
- 当前示例只保留 `server.host`、`server.port`、`database.url`。
- 设置页第一版不编辑 Boot Config。
- 模型 Provider、API Key、Agent Profile 默认模型、UI/editor 偏好不再写入这里。
- 旧根 `config.yaml` 可通过 `bun run config:migrate` 收窄为只包含 `server` / `database` 的 Boot Config。

### Global Config

- 位置：`workspace/.nbook/config.json`。
- 作用：单用户全局运行配置。
- 不存在时使用内置 defaults。
- GET snapshot 不自动创建文件；PUT 或部署初始化才创建。
- `bun run config:migrate` 会创建 `workspace/.nbook/config.json`。
- 保存内容包括：
    - `auth.enabled`
    - `models.default`
    - `models.providers`
    - `agent.defaultProfileKey.novel`
    - `agent.defaultProfileKey.userAssets`
    - `agent.profileModelDefaults`
    - `agent.profiles`
    - `ui.theme`
    - `editor.markdown`
    - `editor.monaco`

### Project Config

- 位置：`workspace/{project}/.nbook/config.json`。
- 作用：当前 Project Workspace 覆盖配置。
- user-assets 入口没有独立 Project Config；它直接编辑 Workspace Root `.nbook/config.json`。
- 只允许覆盖 registry 标记为 `global-workspace` 的字段。
- Project Config 会拒绝覆盖：
    - `auth.enabled`
    - `models.providers`

### Browser State

纯前端临时状态，不进入配置系统。

- 位置：Pinia persist / `sessionStorage` / `localStorage`。
- 示例：打开的 tab、drawer 展开状态、last session id、未保存编辑 buffer。

## Registry

配置项由 `server/config/registry.ts` 声明。每个配置项包含：

- `scope`：`boot` / `global` / `global-workspace`
- `effect`：`hot` / `next-run` / `next-session` / `restart-required`
- `merge`：`replace` / `deep-merge`
- `secret`
- `description`

当前规则：

- object 默认 deep-merge。
- array / primitive 默认 replace。
- `models.providers` 是 global-only。
- `auth.enabled` 是 global-only。
- `models.default`、`agent.defaultProfileKey`、`agent.profileModelDefaults`、`agent.profiles`、`editor.markdown`、`editor.monaco` 可被 Project Config 覆盖。
- `agent.tools.allow/deny` 已删除，工具权限继续由 profile/tool policy 控制。

## Secret Semantics

Provider API Key 使用结构化 secret 语义：

```ts
type SecretConfigValue = {
    configured: boolean;
    maskedValue: string | null;
    value?: string;
};
```

- GET / editor snapshot 返回 `configured` 与 `maskedValue`，不返回明文 `value`。
- PUT 时 `value` 缺失表示保留原值。
- PUT 时 `value: ""` 表示清空。
- PUT 时 `value` 为非空字符串表示覆盖。

## API

正式入口：

```http
GET /api/config/snapshot?workspaceKind=novel&novelId=...
GET /api/config/editor-snapshot?workspaceKind=novel&novelId=...
PUT /api/config/global
PUT /api/config/project
POST /api/config/models/provider-check
POST /api/config/models/provider-discover
POST /api/config/models/model-check
```

旧入口已删除：

- `/api/settings/models`
- `/api/settings/agent-profile-models`
- `/api/settings/agent-tools`
- `/api/workspace-settings`

保存配置后，后端直接返回最新 editor snapshot。前端不在本地猜合并结果。

## Runtime Resolution

Snapshot 是运行时使用的最新配置结果，不承担来源解释；只有设置页 editor snapshot 需要 raw global/project 文件内容。

Agent 读取规则：

- 创建 session / invocation 前读取最新 effective config。
- 单次 invocation 开始后固定当时 config snapshot。
- compaction、model command 和 report_result reminder 路径都使用 invocation 开始时的模型配置。

模型选择优先级：

1. explicit session override
2. Project `agent.profiles.<key>.model.modelKey`
3. Global `agent.profiles.<key>.model.modelKey`
4. Project `agent.profileModelDefaults.modelKey`
5. Global `agent.profileModelDefaults.modelKey`
6. Project `models.default`
7. Global `models.default`

Agent Profile 模型参数的通用合并层级：

1. hardcoded defaults：`modelKey: null`、`temperature: null`、`topK: null`、`reasoningEffort: "off"`、`stream: true`
2. Global `agent.profileModelDefaults`
3. Project `agent.profileModelDefaults`
4. Global `agent.profiles.<key>.model`
5. Project `agent.profiles.<key>.model`

## Settings UI

设置页已切到配置中心视图，并固定显示当前编辑目标：

- Dialog 顶部可在 `Global Config`、`Project Config`、`Browser State` 间切换。
- `Global Config` 写入 Workspace Root `workspace/.nbook/config.json`。
- `Project Config` 可选择任意 Project Workspace，写入 `workspace/{project}/.nbook/config.json`，不会切换当前 IDE 打开的小说。
- `Browser State` 只包含本地 UI 状态与编辑器显示偏好，不写入 config 文件。
- `user-assets` 入口只允许编辑 Global Config 与 Browser State，不提供 Project Config 目标。

Global Config 面板：

- 模型 Provider、API Key、模型白名单和 Global 默认模型保存到 Global Config。
- Agent 默认 Profile 保存到 Global `agent.defaultProfileKey.novel` / `agent.defaultProfileKey.userAssets`。
- Agent Profile 共同默认模型参数保存到 Global `agent.profileModelDefaults`。
- 单个 Agent Profile 模型参数覆盖保存到 Global `agent.profiles`。
- Secret 字段显示已配置/未配置与脱敏值；不会把脱敏值当明文写回。

Project Config 面板：

- Project 默认模型保存到 Project `models.default`；选择“跟随 Global 默认模型”会清除覆盖值。
- Project 默认 Profile 保存到 Project `agent.defaultProfileKey`。
- Project Agent Profile 共同默认模型参数保存到 Project `agent.profileModelDefaults`。
- Project 单个 Agent Profile 模型参数覆盖保存到 Project `agent.profiles`；留空字段按运行时合并规则回落上层默认。
- Provider/API key、Provider 列表仍是 Global-only，不在 Project Config 中编辑。

模型健康检查、Provider 检查、模型发现入口已移动到 `/api/config/models/*`。旧 Agent 工具 allow/deny 设置分区已从设置 Dialog 删除。

## Bundled Workspace Template

系统资源已收敛到：

```text
assets/
└── workspace/
    ├── .nbook/
    │   ├── agent/
    │   │   ├── profiles/
    │   │   └── skills/
    │   └── templates/
    │       ├── content-node-templates/
    │       └── novel-directory-templates/
    ├── global.config.example.json
    └── workspace.config.example.json
```

约定：

- `assets/workspace/.nbook` 是系统模板层。
- 运行时用户覆盖层是 `workspace/.nbook`。
- `assets/workspace/global.config.example.json` 对应 `workspace/.nbook/config.json`。
- `assets/workspace/workspace.config.example.json` 对应 `workspace/{project}/.nbook/config.json`。
- 示例文件不是运行时真值，不会被 resolver 当作自动覆盖层读取。

## Workspace Creation

- 部署脚本会创建 `workspace/`，并在首次部署时创建 `workspace/.nbook/config.json`。
- 应用启动时通过 server plugin 确保 Workspace Root `workspace/` 存在。
- 访问 user-assets 或同步系统 assets 时会确保 `workspace/.nbook/` 存在。
- GET snapshot 仍不自动创建配置文件；只有 PUT、部署初始化或 `bun run config:migrate` 会创建 `workspace/.nbook/config.json`。

## Decisions

- 不做多用户 User Config；单用户全局配置就是 Global Config。
- Boot Config 和可热更新业务配置拆开。
- Global Config 和 Project Config 都使用 JSON；Boot Config 继续使用 YAML。
- 第一版不实现动态 `workspace.root`；启动后只确保默认 Workspace Root `workspace/` 存在。
- GET snapshot 不自动创建配置文件。
- 写入接口使用 PUT，第一版不做 patch。
- 第一版不做写入原子锁、version conflict 或跨进程配置广播。
- 旧 settings API 立即删除，不做兼容 adapter。
- 运行时配置文件属于本机数据，继续由 `.gitignore` 忽略 `config.yaml`、`workspace/`、`.deploy/`。
- 示例文件保留在 `assets/workspace/*.example.json`，不忽略。

## Files Changed

- `shared/dto/config.dto.ts`
- `server/config/*`
- `server/api/config/*`
- `server/utils/app-config.ts`
- `server/utils/auth.ts`
- `server/agent/harness/model-resolver.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/session/*`
- `server/agent/http.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/assets/asset-resolver.ts`
- `server/workspace-files/novel-workspace.ts`
- `server/workspace-files/content-node-templates.ts`
- `server/openapi/route-map.ts`
- `app/composables/useConfigApi.ts`
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`
- `app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- `app/components/novel-ide/settings/NovelIdeAgentProfileDefaultSettingsPanel.vue`
- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/pages/index.vue`
- `app/pages/model-settings.preview.vue`
- `app/stores/novel-ide.ts`
- `assets/workspace/global.config.example.json`
- `assets/workspace/workspace.config.example.json`
- `config.example.yaml`
- `scripts/migrate-config-system.ts`
- `scripts/smoke-agent.ts`
- `scripts/neuro-book-deploy.mjs`
- `scripts/check-profile.ts`
- `scripts/prepare-profile-types.ts`
- `server/plugins/workspace-root.ts`

删除旧入口与旧 DTO：

- `server/api/settings/*`
- `server/api/workspace-settings/*`
- `server/workspace-settings/*`
- `shared/dto/workspace-settings.dto.ts`
- `shared/dto/app-settings.dto.ts` 中的 Agent tool settings DTO

## Verification

已通过：

- `bun test server/config`
- `bun test server/utils/app-config.test.ts`
- `bun test server/agent`
- `bun test server/workspace-files`
- `bun scripts/prepare-profile-types.ts --all`
- `bunx tsc --noEmit --pretty false`
- `node --check scripts/neuro-book-deploy.mjs`
- `node --check scripts/deploy.mjs`

本轮设置页重构追加验证：

- `bunx tsc --noEmit --pretty false`

已知非本轮业务失败：

- `server/api/workspace-files/download.get.test.ts`
- `server/api/workspace-files/events.get.test.ts`
- `server/api/workspace-files/write.put.test.ts`

这些 API 测试当前失败原因是测试环境里的 `vi.resetModules` / `vi.doUnmock` API 不存在，属于测试工具兼容问题，不是 Config System 迁移失败。

## TODO / Follow-ups

- 设置页后续可继续增强 raw/effective 差异展示，目前已支持 Global / Project 目标切换、Project selector 和核心覆盖项清除。
- Boot Config schema 后续继续细化，并决定是否把 `server` / `database` 字段接入真正的启动期读取链路。
- 写入原子锁、version conflict、跨进程配置广播后续再做。
- 修复 workspace-files API tests 的 Vitest mock API 兼容问题。
- 后续部署文档如有新增部署模式，继续保持 Provider/API Key 在 `workspace/.nbook/config.json`，根 `config.yaml` 只做 Boot Config。
