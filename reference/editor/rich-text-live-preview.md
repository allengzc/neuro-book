# Markdown Studio 富文本规范 v0.2

## 定位

Markdown Studio 的唯一真相是 Markdown 字符串。TipTap / ProseMirror 只作为运行时富文本编辑表面；源码模式由 Monaco 直接编辑同一份 Markdown 文本。

主编辑器只支持两种模式：

- `rich`：Notion-like 富文本编辑体验。
- `source`：Markdown 源码编辑体验。

`StructuredTextEditor` 是表单场景包装层，底层复用 `TipTapMarkdownEditor` 与 `MarkdownSourceEditor`，只暴露 `rich` / `source` 两种模式。

## 核心原则

- 不再为 Markdown Studio 主编辑器实现 Obsidian Live Preview 式“源码弱显 + decoration/widget 预览”。
- 图片、行内代码、表格、工作区引用等语法在富文本侧应进入真实 ProseMirror node / mark。
- 保存、同步、撤销和源码模式切换都以 Markdown 字符串为边界；不要把 TipTap JSON 当成持久化格式。
- frontmatter 继续由项目层拆分、编辑和合并，不进入 ProseMirror schema。

## 当前组件

- `TipTapMarkdownEditor.vue`：Markdown 富文本主编辑器。
- `MarkdownSourceEditor.vue`：Markdown 源码编辑器。
- `StructuredTextEditor.vue`：表单包装层，提供工具栏、模式切换和紧凑尺寸，不维护独立 Markdown schema。
- `WorkspaceReference.ts`：领域 Markdown link 的 inline atom node，支持 workspace path 与 thread/scene/plot 等 scheme，序列化为 `[label](target)`。
- `InlineComment.ts`：inline comment mark，序列化为 `<inline-comment body="...">text</inline-comment>`。
- `MarkdownCode.ts`：inline code mark，沿用 Tiptap Code 解析和序列化。
- `@tiptap/extension-image`：图片节点，序列化为 Markdown image。
- `@tiptap/extension-table` / `TableKit`：GFM 表格节点，序列化为 Markdown table。

## 交互约定

- 富文本模式点击正文对象时，不展示 Markdown 源码弱显态。
- 工作区引用以 chip 呈现；双击或 Ctrl/Meta 点击打开目标。
- Backspace/Delete 紧邻工作区引用时，先退化成 Markdown link 文本，便于用户继续编辑源码。
- inline code 和 highlight 的 mark 边界不自动向外扩展；只有光标实际位于 mark 内部时才继承该 mark。

## 不做的事

- 不恢复 `mixed` / Obsidian Live Preview 作为 Markdown Studio 或表单编辑器模式。
- 不用 decoration 隐藏 Markdown 图片源码、行内代码反引号或工作区引用源码。
- 不在富文本模式中提供“选中源码”按钮；需要源码编辑时切换到 `source`。
