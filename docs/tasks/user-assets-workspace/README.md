# 用户 Assets 工作区

## 需求

用户维护 skill 或其他可覆盖 assets 时，不应修改仓库源码。系统需要提供一个全局用户 assets 目录，并让前端复用现有 Novel IDE 文件树、tab、Markdown/Monaco 编辑器和保存冲突处理。

## 决策

- 用户 assets 固定放在 `workspace/.nbook/assets`。
- 覆盖优先级是 `workspace/.nbook/assets/...` > 仓库内置 `assets/...`。
- `agent/skills/<slug>/` 按整个 skill 目录覆盖；用户 assets 中存在同名目录时，不再混合读取系统同名 skill 目录内的文件。
- 其他 assets 默认按同路径文件覆盖；例如 `server/workspace/content-node-templates/...` 中同路径模板文件由用户版本优先。
- `server/workspace/content-node-templates` 和 `server/workspace/novel-directory-template` 都进入覆盖体系。新小说目录模板会先合成系统模板与用户模板，再只补目标 workspace 缺失文件，不覆盖小说 workspace 中已经写过的内容。
- novel workspace 不参与覆盖关系，避免把单本小说内容和全局工作法混在一起。
- 用户 assets 使用独立入口，但复用主页面；入口以 `/?workspace=user-assets` 进入，不放进小说下拉框。
- 用户 assets 页面和 novel 页面允许同时打开，workspace 编辑会话按 `novel:<id>` 与 `user-assets` 隔离。
- 用户 assets Agent 使用独立 profile `leader.assets`，与小说默认 profile `leader.default` 的线程列表和提示词隔离。
- profile 覆盖采用渐进迁移：`workspace/.nbook/assets/agent/profiles/**/*.profile.tsx` 优先于 `assets/agent/profiles/**/*.profile.tsx`，再回落到源码 builtin 注册。用户覆盖 builtin key 时必须保留原 key、kind、InputSchema、OutputSchema，只允许调整 prompt 和工具列表等实现细节。
- 动态 profile 是可信本地 TSX 代码，运行时用 esbuild 编译后加载，不做 sandbox；旧 thread 下次运行时会重新从 profile registry 读取当前 profile。

## 实现记录

- workspace-files API 增加 `workspaceKind: "user-assets"`，服务端固定解析到 `workspace/.nbook/assets`。
- skill catalog 同时扫描用户 skill 和内置 skill，同名时用户版本覆盖内置版本。
- SkillCatalog prompt 说明覆盖规则：用户 assets 优先、skill 目录整体覆盖、其他 assets 同路径文件覆盖。
- 内容节点模板创建和新小说目录模板复制支持用户 assets 覆盖。
- 写作风格与参考样例资源迁入 `assets/agent/profiles/builtin/`，用户可通过同路径 assets 覆盖。
- 动态 profile registry 扫描系统 assets 与用户 assets 中的 `.profile.tsx`，按同相对路径用户优先，并对 builtin override 做 schema contract 校验。
- `create_subagent.profileKey` 与 `invoke_subagent.input` 不再写死 builtin 枚举；`invoke_subagent` 绑定工具时会把当前可用 subagent profile 的 InputSchema 注入给模型，执行时仍由目标 profile 的 inputSchema 做最终校验。
- 新增 `leader.assets` profile，聚焦用户 assets、skill 覆盖、模板和资源编辑；`leader-default` 保持小说协作提示。
- 前端用户资产入口复用主页面、工作区文件面板、主编辑器和 Agent 抽屉。
- Agent thread 创建和列表支持按 leader profile 过滤，用户资产界面只使用 `leader.assets` 线程，小说界面继续使用 `leader.default`。
- `novel-ide` store 增加 workspace session 快照，避免两个浏览器界面互相覆盖 tabs 和当前文件。
- Markdown 预览保留原始 frontmatter 文本，避免模板中的 `{{title}}` 被 YAML 解析为对象键时触发 stringified warning。

## 验证

- 已运行用户资产 profile、Agent thread 创建/过滤、AgentSystem 相关测试。
- 已运行 `bun run test server/agent/tools/builtin/invoke-subagent.tool.test.ts server/agent/services/thread-context.service.test.ts server/agent/profiles/profile-registry.test.ts server/agent/skills/skill-catalog.test.ts server/workspace-files/workspace-files.test.ts`。
- typecheck 当前仍有既有非本任务错误；本轮新增的 Agent thread profileKey 类型错误已修复。
- 不做浏览器自动验证；如需确认页面交互，可后续手动打开 `/?workspace=user-assets` 或再请求浏览器验证。

## 后续

- 设计系统 assets 更新后的用户覆盖冲突提示。
- 如果未来需要单本小说专属 assets，应单独设计 `workspace/<novel>/.nbook/assets` 语义，不在当前版本隐式支持。
- 删除源码 builtin fallback：profile TSX、写作风格、写作参考样例全部稳定迁入系统 assets 后，清理 `server/agent/profiles/builtin` 里的迁移期资源 fallback。
- 接入 profile 可视化编辑器：提示词预览需要读取当前 profile 的 InputSchema / OutputSchema，并支持动态 profile 的 schema catalog 展示。
- 增加 prepare/codegen：为开发者生成动态 profile 的 key/schema 类型增强，但运行时不依赖 prepare 才能加载用户 profile。
- 增加 profile catalog issue API/UI：当用户或系统动态 profile 声明了 key 但加载失败时，除运行时报错外，还应在用户资产界面集中展示加载错误。
