# Inline 引用规范 v0.3

## 定位

本文档只讨论 Markdown 文本中的 inline 引用。结构化 `refs` 见 [统一引用系统规范](./system.md)。

## 存储写法

inline 引用使用普通 Markdown link，target 是工作区相对路径。

```markdown
[孤儿院](../location/孤儿院/)
[第一章](../../manuscript/第一卷/第一章/)
[草稿](./draft.md)
[孤儿院](location/孤儿院/)
```

规则：

- 内容节点 target 指向目录并保留结尾 `/`。
- 普通文件 target 指向具体文件名。
- 相对路径以当前 Markdown 文件所在目录为基准。
- 不以 `./` 或 `../` 开头的工作区路径，以配置的引用基准目录解析；第一版默认是 `workspace/` 根目录。
- 外部 URL 仍是普通 Markdown 链接，不进入工作区 refs 校验。

## 编辑体验

编辑器可以提供候选菜单、路径补全或引用选择器，但写回 Markdown 时必须写成相对路径链接。

例如：

```markdown
她在 [孤儿院](../location/孤儿院/) 门前停下。
```

## 旧写法

以下写法已经废弃：

```text
@chapter://1
@lorebook://101
```

```markdown
[第一章](chapter://1)
[孤儿院](lorebook://101)
```

当前文件化工作区不再做兼容 fallback。旧协议如果进入 workspace 引用校验，会按解析错误处理。

## 派生结果

inline 引用的真相源仍然是 Markdown 文本。系统可以派生：

```yaml
inlineRefs:
  - raw: "[孤儿院](../location/孤儿院/)"
    target: "../location/孤儿院/"
    title: "孤儿院"
    syntax: "markdown"
```

`inlineRefs` 不是作者手工维护字段，也不是结构化 `refs`。

## 一句话总结

> inline 引用就是 Markdown 链接；工作区目标使用相对路径；旧 URI 协议只作为迁移错误处理。
