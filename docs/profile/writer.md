# Writer

writer 是正文写作专用 profile。

它采用“一章节一 agent”的心智模型：一个 writer session 负责一个章节。后续继续写、局部润色、按反馈修改，都应复用这个 writer session。

## Writer 负责什么

writer 负责把已有设定、章节 Plot、写作约束和风格参考转化为章节正文。

它不负责大范围检索整个 Project Workspace，也不负责决定长期剧情结构。需要这些内容时，leader 应先调用 retrieval 或 Plot 工具，把稳定输入整理好再交给 writer。

## 输入边界

writer 的章节输入使用 `chapterPaths`。

当前约定：

- `chapterPaths` 必须且只能包含一个章节目录。
- 路径应是 Agent cwd-relative Project 路径，例如 `my-novel/manuscript/001-volume/001-chapter/`。
- writer 会读取该章节的 Chapter Plot。
- writer 只写这个章节的 `index.md`。

不要把整部作品、多个章节或临时大纲一股脑交给 writer。这样会让写作边界变模糊。

## 和 retrieval 配合

retrieval 负责召回候选设定，writer 负责写正文。

推荐流程：

1. leader 判断当前章节需要哪些设定。
2. retrieval 检索并返回候选内容节点。
3. leader 从候选中选择合适的 `entries[].path`。
4. leader 把路径作为 `writer.lorebookEntries` 传给 writer。
5. writer 根据章节 Plot、正文现状和 lorebook entries 写作。

这样可以避免 writer 自己做大范围搜索，也让作者更容易检查“写作参考从哪里来”。

## 什么时候复用 writer

复用同一个 writer：

- 同一章节继续写。
- 同一章节局部润色。
- 同一章节按反馈调整。
- 创建 input 的章节、设定输入、风格预设没有语义变化。

新建 writer：

- 切换到另一章。
- 换了一组稳定设定输入。
- 换了写作风格或参考预设。
- 创建 input 的语义已经变成另一个写作任务。

更多协作规则见 [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/reference/agent/leader-default.md#writer-collaboration)。
