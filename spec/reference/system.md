# 统一引用系统规范 v0.3

## 定位

本文档定义文件化工作区内的引用写法。当前阶段不再使用 `chapter://`、`lorebook://`、`db://` 或 `vfs://` 作为规范引用目标；这些旧协议不做兼容 fallback，如果进入 workspace 引用校验会按解析错误处理。

相关文档：

- [Inline 引用规范](./inline-reference.md)
- [内容校验与规范化规范](../content/middleware.md)

## 目标

- 引用写法与 Markdown 文件系统一致，方便人和 AI 直接阅读。
- 结构化 `refs` 与正文 inline 引用使用同一套 target 规则。
- 内容节点引用指向目录，普通文件引用指向具体文件。
- 校验脚本负责断链、旧协议和路径逃逸检查。

## 合法引用目标

引用目标是工作区相对路径。

```text
../location/孤儿院/
../../manuscript/第一卷/第一章/
./draft.md
location/孤儿院/
```

规则：

- 内容节点 target 指向目录并保留结尾 `/`。
- 普通文件 target 指向具体文件名，例如 `./draft.md`。
- 相对路径以当前 Markdown 文件所在目录为基准。
- 不以 `./` 或 `../` 开头的工作区路径，以配置的引用基准目录解析；第一版默认是 `workspace/` 根目录。
- 外部 URL 只作为普通 Markdown 链接处理，不进入工作区 refs 校验。

## Inline 引用

inline 引用是正文里的自然提及，适合表达“出现过、提到过、场景发生在、普通相关性”。

```markdown
她在 [孤儿院](../location/孤儿院/) 门前停下。
这段伏笔会在 [第一章](../../manuscript/第一卷/第一章/) 回收。
补充草稿见 [设定草稿](./draft.md)。
主角在 [荒野祭坛](lorebook/location/initial-stage/) 醒来。
```

inline 引用的真相源是原始 Markdown 文本。系统可以从文本中派生引用列表，但不应把 inline 引用自动塞进结构化 `refs`。

## 结构化 refs

结构化 `refs` 用来表达系统需要理解的显式稳定关系，例如定义、约束、依赖、父子归属、伏笔/回收、直接因果、冲突或来源。

```yaml
refs:
  - relation: foreshadows
    target: ../note/主角地球死亡原因/
    note: 该设定仍为 pending。
```

字段约定：

- `relation`：关系类型，自由字符串；推荐值包括 `defines`、`constrains`、`depends_on`、`part_of`、`contains`、`foreshadows`、`pays_off`、`conflicts_with`、`derived_from`。
- `target`：工作区相对路径。
- `note`：可选说明。

结构化 `refs` 只表达关系，不表达叙事披露或谁知道这条信息。角色之间的信息差写入内容节点同级 `state.md`；读者知道什么由叙事模块处理。

不要把章节中登场的人物、地点、机制批量写成结构化 `refs`。如果只是“本章出现了某角色”“场景位于某地点”“正文提到了某规则”，优先使用正文 inline 引用。`features`、`mentions`、`related_to` 这类泛关系通常不应进入结构化 `refs`。

## 状态与 pending

`pending` 不再是一种引用协议，而是内容节点状态。

- `draft`：草稿中，尚未确认，不应作为稳定事实强依赖。
- `pending`：待定问题或未决设定，例如“主角地球死亡原因：意外、谋杀、与龙族身份有关，还是灵魂牵引副作用？”。
- `active`：已确认事实，可作为写作和检索的稳定依据。
- `archived`：历史保留，不再作为当前默认事实。

未决设定应写入 `status: pending` 的内容节点，或集中放在 `lorebook/note/pending-questions/`。

## 校验规则

`bun scripts/workspace.ts node validate WORKSPACE_TARGET` 至少检查：

- 相对路径是否能解析到工作区内。
- target 是否存在。
- 内容节点 target 是否使用目录路径。
- 旧协议 `chapter://`、`lorebook://`、`db://`、`vfs://` 是否进入 workspace 引用校验。
- `status=deprecated` 是否仍存在。
- `ext.character` 是否仍存在。

旧协议属于 P1 迁移问题，不做 fallback。

## AI 写作流程

创建内容节点时：

1. 在目标小说 workspace 内调用脚手架，例如 `bun scripts/workspace.ts node new lorebook/character/苏雪 --type character --title 苏雪`。
2. 读取生成的 `index.md` 模板。
3. 编辑 frontmatter 与正文。
4. 运行 `bun scripts/workspace.ts node validate lorebook/character/苏雪`。

AI 不应手写空模板，也不应跳过脚手架直接创建角色结构。
