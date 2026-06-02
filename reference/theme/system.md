# 主题系统规范

## 概述

当前 IDE 主题系统采用“单一主题变量源 + JS 应用变量”的方式：

- 主题变量统一定义在 `app/utils/theme/theme-tokens.ts`
- 页面通过 `useIdeTheme` 把变量挂到 `.novel-ide-theme` 宿主元素上
- 页面与组件只消费 CSS 变量，不在组件内部定义主题值

## 主题来源

支持的主题：

- `sepia`
- `light`
- `dark`

主题状态保存在 localStorage，由 `useIdeTheme` 读取和写回。

## 应用方式

- 主题宿主元素类名固定为 `.novel-ide-theme`
- 切换主题时，通过 JS 对宿主元素执行 `style.setProperty("--token", value)`
- 不再使用 `data-theme` + 多段 CSS 规则切换颜色

## 变量分层

当前变量分为三组：

- 基础界面变量：`--bg-*`、`--text-*`、`--border-color`、`--accent-*`
- 编辑器变量：`--editor-*`、`--source-*`
- 区域变量：`--toolbar-bg`、`--prompt-bg`、`--prompt-border`、`--agent-bg`

新增主题时，必须在 `theme-tokens.ts` 中补齐全部变量。

## 自定义 CSS 约定

为了后续支持非原子 CSS，自定义样式优先挂在这些稳定类名上：

- `.novel-ide-theme`
- `.ide-shell`
- `.ide-panel`
- `.ide-sidebar`
- `.ide-toolbar`
- `.ide-editor-canvas`
- `.ide-editor-shell`
- `.ide-prompt-bar`
- `.ide-agent-drawer`

这些类名用于自定义覆盖，不承载主题值本身。

## 编辑器消费规则

- Monaco 从最近的 `.novel-ide-theme` 宿主读取 `getComputedStyle`
- Milkdown 通过外层 CSS 变量覆盖读取主题变量
- 两者都不得维护独立的第二套主题色源
