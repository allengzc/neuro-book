# AI 表单批注规范（已废弃）

旧版 `%{...}%` / `%!{...}%` inline AI 批注已经废弃，不再作为编辑器语法实现。

当前项目统一使用 Markdown inline comment 表达轻量批注：

```md
<inline-comment body="这里需要改得更口语">被评论的文本</inline-comment>
```

## 当前规则

- `body` 是评论文本，通常是一句话。
- 标签包裹的内容是被评论正文。
- 评论直接存储在 Markdown 正文里，不再通过 frontmatter `comments` 或 id 索引。
- 本语法不绑定 AI；AI 后续如需参与，应先读写同一套 inline comment 语法。
- 不引入 Tiptap 官方 Comments / Thread / Cloud 能力。

## 迁移说明

- 新代码不要再生成 `%{...}%` 或 `%!{...}%`。
- 旧 AI 表单批注接口与 UI 后续应单独清理或重命名。
- 如果需要结构化“错别字修正/替换建议”，应另建 suggestion/diagnostic 模型，不复用本文件的旧 AI annotation 设计。
