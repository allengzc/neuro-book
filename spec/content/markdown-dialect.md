# NeuroBook Markdown Dialect

本文档写给 Agent 和作者。它定义 NeuroBook 中 Markdown 正文可以使用的扩展格式，以及这些格式与文件工具路径、内容节点引用的边界。

## Scope

适用范围：

- `manuscript/**/index.md` 正文。
- `lorebook/**/index.md` 的说明正文。
- 草稿、批注、审稿文件和可被 Markdown Studio 打开的普通 Markdown 文件。
- Agent 在回复中给出的可粘贴正文片段。

不适用范围：

- 工具调用路径。
- `writer.chapterPaths`、`writer.lorebookEntries`、`create_agent.input` 等结构化参数。
- Plot / SQL / variable tool 的 JSON 参数。

工具调用和结构化参数必须继续使用对应工具要求的路径格式；不要把正文内部相对链接当成工具路径。

## Workspace Links

正文内部 Markdown link 可以使用相对链接：

```md
主角在 [荒野祭坛](../../lorebook/location/initial-stage/) 醒来。
```

规则：

- 内容节点链接指向目录并保留结尾 `/`，例如 `../../lorebook/character/foo/`。
- 普通文件链接指向具体文件名，例如 `notes.md`。
- 可以链接计划或执行记录等普通 Markdown 文件，例如 `[实施计划](.agent/thread-id/plan.md)`。
- `http:`、`https:`、`mailto:`、`tel:`、`#` 和其他 scheme 按普通链接或非工作区引用处理。

正文内部链接和工具路径不同：

| Context | Path Form |
| --- | --- |
| 正文内部 Markdown link | 相对当前 Markdown 文件，例如 `../../lorebook/character/foo/` |
| Agent 文件工具 / bash | Workspace Root cwd-relative，例如 `project-slug/lorebook/character/foo/` |
| `writer.lorebookEntries` | Workspace Root cwd-relative 内容节点路径，例如 `project-slug/lorebook/character/foo/` |
| Plot tool `projectPath` | Project Path，例如 `workspace/project-slug` |

不要把正文内部的相对链接直接复制到工具调用参数中。

## Inline Comment

Inline comment 用于局部批注：

```md
<inline-comment body="需要核对">原文</inline-comment>
```

可选 `id`：

```md
<inline-comment id="draft:1" body="需要核对">原文</inline-comment>
```

使用原则：

- 只在批注已有草稿、指出需要用户确认、核对或后续处理的局部文本时使用。
- 正式小说正文不要主动塞 comment，除非用户明确要求保留写作批注、审稿意见或待确认标记。
- `body` 应短而具体，不承载长篇分析；长分析放在回复、报告或单独说明文件中。

## Mark Highlight

高亮：

```md
<mark>文本</mark>
<mark style="background-color: #fce7f3">文本</mark>
```

使用原则：

- 无特殊颜色要求时优先使用无 `style` 的 `<mark>`。
- 需要色彩语义时使用安全、清晰的背景色。
- 不要用高亮表达稳定设定关系；稳定关系用内容节点正文、frontmatter refs 或 Plot System 表达。

## Text Color

文本颜色：

```md
<span style="color: #ef4444">文本</span>
```

使用原则：

- 只用于明确需要视觉区分的局部文本。
- 不要把颜色当作唯一语义来源；必要语义仍应写入文字。

## Superscript And Subscript

上标和下标：

```md
<sup>上标</sup>
<sub>下标</sub>
```

适合公式、注记、术语标号和特殊排版。

## Alignment

对齐块：

```md
<align value="center">...</align>
```

`value` 支持：

- `center`
- `right`
- `justify`

左对齐保持普通 Markdown 即可。

## Agent Rules

Agent 生成或修改 Markdown 时：

- 正文内部引用优先使用相对链接；工具调用路径仍使用工具要求的 cwd-relative 或 Project Path。
- 内容节点链接指向目录并保留 `/`。
- 不要把 Markdown 扩展标签写进 frontmatter 字段名或工具 JSON。
- 不要为了展示功能而使用扩展格式；只有用户目标、正文需要或审稿需要时才使用。
- 修改已有 Markdown 时，尽量保留原有链接和扩展标签，不要无关重写。
