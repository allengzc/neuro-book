# 用户 Assets 工作区

## 需求

用户维护 skill 或其他可覆盖 assets 时，不应修改仓库源码。系统需要提供一个全局用户 assets 目录，并让前端复用现有 Novel IDE 文件树、tab、Markdown/Monaco 编辑器和保存冲突处理。

## 决策

- 用户 assets 固定放在 `workspace/.nbook/assets`。
- 覆盖优先级是 `workspace/.nbook/assets/...` > 仓库内置 `assets/...`。
- novel workspace 不参与覆盖关系，避免把单本小说内容和全局工作法混在一起。
- 用户 assets 使用独立入口 `/assets`，不放进小说下拉框。
- `/assets` 页面和 novel 页面允许同时打开，workspace 编辑会话按 `novel:<id>` 与 `user-assets` 隔离。

## 实现记录

- workspace-files API 增加 `workspaceKind: "user-assets"`，服务端固定解析到 `workspace/.nbook/assets`。
- skill catalog 同时扫描用户 skill 和内置 skill，同名时用户版本覆盖内置版本。
- `leader-default` prompt 增加用户 assets 目录和 skill 覆盖规则说明。
- 前端新增用户资产入口和 `/assets` 页面，复用工作区文件面板和主编辑器。
- `novel-ide` store 增加 workspace session 快照，避免两个浏览器界面互相覆盖 tabs 和当前文件。

## 验证

- 计划运行 skill catalog、workspace-files API、typecheck 相关验证。
- 不做浏览器自动验证；如需确认页面交互，可后续手动打开 `/assets` 或再请求浏览器验证。

## 后续

- 设计系统 assets 更新后的用户覆盖冲突提示。
- 如果未来需要单本小说专属 assets，应单独设计 `workspace/<novel>/.nbook/assets` 语义，不在当前版本隐式支持。
