# Writer Brief 格式规范

> 本文定义 `get_chapter_writer_brief` 编译出的 writer brief 的**格式契约**:有哪些段、每段从哪来、两种防全知模式的差异。writer profile 的 `description` 指向本文;leader 用 `get_agent_profile("writer")` 发现后按需读。
>
> 这是「brief 应该长什么样」的真相源。brief 的**内容来源**由 Plot Scene / ChapterBrief / World Engine 决定;**简化 vs 投喂**由防全知模式决定(见 [reference/world-engine/workflow.md](../world-engine/workflow.md) §6.2)。

## 一句话

brief = **框架 + 信息控制 + 查询指引**,不是正文草稿,也不复述 lorebook。设定指向 lorebook、状态指向 World Engine、文风归 writer profile;brief 只留「本章特有」的东西。

## 两种防全知模式

| 模式 | writer 能力 | brief 里的世界状态 |
| --- | --- | --- |
| **autonomous(自主全知,默认)** | Plot 只读 + World Engine 只读 + lorebook 读 | **只给查询提示**(查哪些 subject、哪个时间窗),不展开状态;writer 自查 |
| **curated(受控投喂,当前 leader 手动使用)** | 读不到设定源 | **展开过滤后的状态摘要**;leader 投喂前按「必须隐藏」删减 |

调用:`get_chapter_writer_brief({projectPath, chapterId, mode})`,`mode` 默认 `autonomous`。

## brief 段落骨架(编译器产出顺序)

1. **本章目标与落点** ← ChapterBrief.goal + ending(结尾定句)。
2. **本章参数(覆盖 writer 默认)** ← ChapterBrief.pov / tone。只写覆盖项:writer profile 已有默认人称/字数/文风,brief 不重复,只写本章要改的。
3. **信息控制(必填)** ← ChapterBrief.readerKnows / protagonistKnows / mustHide / hintOnly。**四项全空则 brief status = `needs_chapter_brief`,阻断 handoff**——这是防全知唯一的按章控制面,writer 有上帝视角查询能力,缺它会越界泄露。
4. **节奏 / 下一章牵引** ← ChapterBrief.pacing / opening。
5. **禁写** ← ChapterBrief.doNotWrite。
6. **关键剧情点(按 Scene)** ← 每个 Scene 的 summary(本场做什么)/ purpose(本场目的)/ writingTip / 所属 Thread summary。粒度默认粗(框架级),精细分镜版暂不做。
   - autonomous:每场附 `World 查询提示`(subject 列表 + 地点 + 时间窗)。
   - curated:每场展开 `World slices` + `Subject states` 摘要(不 dump raw attrs/patch JSON)。
7. **建议读取** ← 由 Scene 的结构化 refs(content 类)编译,带 relation gloss。替代 leader 手写「设定复述」;writer 按需读,不必全读。

## status 阶梯

`needs_plot`(无 Scene)→ `needs_world_anchor`(Scene 缺时间范围)→ `needs_world_context`(subject 未接入 World Engine)→ `needs_chapter_brief`(信息控制四项全空)→ `ready`。非 `ready` 时 leader 应先补齐再交接。

## 不进 brief 的东西

- **设定复述**:角色底设、力量体系、世界规则——指向 lorebook,不抄进 brief(双真相源会漂移)。
- **可查询状态**:HP / 位置 / 属性数值——autonomous 由 writer 查;curated 由编译器展开,但仍不 dump raw attrs/patch JSON。
- **文风约束**:文风、避讳词、show-don't-tell、markdown 方言——全在 writer profile(`<writing_style>`/`<avoid_words>`/`<char_performance>`),brief 不重复。

## 相关文档

- [system.md](system.md):Plot 两棵树与 ChapterBrief 实体。
- [../world-engine/workflow.md](../world-engine/workflow.md) §6:防全知模式、简化 vs 投喂、Leader-Writer 协作。
- [../agent/leader-default.md](../agent/leader-default.md):leader 调用 writer 的协议。
