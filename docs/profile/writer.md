# Writer

`writer` 是正式正文写作 agent。它的任务是把已经明确的写作目标、Plot 上下文、设定引用和写作约束落实到本轮指定的 Markdown 文件。

它不是 planner，不是 retrieval，不是 RP writer，也不维护 `simulation/`、Plot System 或 subject memory。

## 长期 Writer Session

普通 `writer` 是可复用写作工位。创建时使用空 initial：

```json
{
  "profileKey": "writer",
  "initial": {}
}
```

每轮调用通过 `invoke_agent.message` 写清自然语言任务，通过 `invoke_agent.input` 指定唯一目标文件和建议读取清单：

```json
{
  "message": "请续写这一章，从主角推开档案室门开始，到她发现账册缺页并决定隐瞒为止。写完后润色一次并 report_result 汇报实际修改路径和约 100 字剧情摘要。",
  "input": {
    "path": "my-novel/manuscript/001-volume/003-chapter/index.md",
    "context": {
      "threadIds": ["1"],
      "sceneIds": ["2"],
      "plotIds": ["3"],
      "lorebookEntries": ["my-novel/lorebook/character/protagonist/"],
      "readablePaths": ["my-novel/manuscript/001-volume/002-chapter/index.md"]
    }
  }
}
```

`message` 必须可独立表达本轮任务：写什么、范围、约束、结束条件和交付要求。`input.context` 只是结构化引用清单，不能替代任务说明。

## Writer 能看到什么

writer prepare 阶段只注入：

- `input.path` 对应的唯一目标文件。
- 可推导的 `projectPath`、`projectSlug` 和可选 `chapterPath`。
- `threadIds`、`sceneIds`、`plotIds`、`lorebookEntries`、`readablePaths` 清单。

writer 不自动读取 Plot、lorebook 或普通文件正文。它需要按本轮 `message` 判断是否主动调用工具：

- `get_story_thread`：读取 Thread。
- `get_story_scene_context`：读取 Scene、所属 Thread 和可选 Chapter Plot。
- `get_story_plot_context`：读取 Plot、所属 Scene 和所属 Thread。
- `get_chapter_plot`：读取整章 scenes / plots，仅在整章写作、续写整章或检查覆盖度时使用。
- `read`：读取目标文件、lorebook 节点 `index.md` / `state.md` 或 `readablePaths`。

第一版不在文件工具层做硬权限限制；writer prompt 会要求只写 `input.path`，并只按需读取 `message` 和 `context` 指向的材料。

## 写作前的准备

调用 writer 前，leader 应尽量准备好：

- `input.path`：唯一目标 Markdown 文件，必须是 `project-slug/.../*.md`。
- `message`：本轮正文任务、范围、重点、禁忌和结束条件。
- Plot 引用：需要落地的 Thread / Scene / Plot id。
- 设定引用：建议读取的 lorebook entries 或 readablePaths。
- 禁止改动的事实和边界。

如果剧情状态尚未裁决，先使用世界运行态流程，而不是让 writer 自己判断世界怎么变。

## RP Writer 不同

`rp.writer` 只用于 RP Tick 的可见文本渲染。它的 profile initial 为空，只消费上级注入的 Writer Brief。普通 `writer` 用于正式正文文件，不承担 RP Tick 主持或世界状态维护。

## 继续阅读

- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/reference/agent/novel-writing-workflow.md)
- [写出前三章](/tutorials/04-first-three-chapters)
- [Leader 协作协议](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md)
