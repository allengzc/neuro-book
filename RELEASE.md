# Release Notes

## 0.5.1-canary - 2026-06-30

这次 patch 主要是性能和工具体验打磨，适合在 0.5.0 canary 的基础上继续验证。

1. 项目列表速度优化
`/api/projects` 增加了 5 秒短缓存和分层统计缓存。Novel IDE 主入口不再发会绕过缓存的 include-only 查询，项目列表热请求可以直接命中缓存；接口也加了 `Server-Timing` 分段，方便之后继续定位慢点。

2. 项目列表后台预热
服务启动后会后台渐进预热 Project manifest、Agent session count 和单项目统计缓存，不阻塞服务启动，也不会把第一个真实请求绑进全量预热。

3. llmlint 命令行更像一个真正的稿件工具
`llmlint check/fix` 支持 tinyglobby glob 输入，例如 `manuscript/**/*.md` 和 `!drafts/**`；输出在终端下会有颜色，在 JSON、管道或 Agent 抓取时保持纯文本。

4. llmlint 依赖自包含
llmlint skill 目录声明并安装自己的运行依赖，部署副本也能直接解析 `tinyglobby` / `picocolors`，减少产品环境里“根依赖碰巧存在”的隐患。

5. llmlint 评测体系进入第一阶段
评测 harness 的消费侧和数据获取文档已落地：支持 reference / brief / rendition / plot group 这套语料合同，后续可以用 AI vs 人类配对 lift、检测器 AUC 和模型“最像人类”排名来治理规则质量。

6. 文档与发布纪律
`AGENTS.md` 已补充发布流程：发布前读 tasks、更新 `RELEASE.md`，canary 发布命令统一带 `--no-watch`，创建 GitHub Release 后不再等待 GitHub Actions。

验证记录来自对应任务：Task 83 记录了 5 files / 19 tests passed 与 typecheck passed；Task 77 记录了 llmlint CLI、glob、颜色、自包含依赖和 user-assets 同步验证；Task 82 记录了 M1 consumer/acquisition 的 fixture 自检与 reference 输入策略。本次发布不等待 GitHub Actions release workflow。

## 0.5.0-canary - 2026-06-30

这次更新是"写作模式"第一版的收尾，把剧情系统、世界设定、AI 助手、AI 痕迹检测工具这几块核心功能做稳定了。

1. 剧情系统大幅简化
以前写剧情要进一个单独的界面，现在直接在正常写作界面里就能写。剧情结构也砍简单了——只保留"场景（Scene）"这一个概念，原来那套"故事线 /
剧情节拍"废弃了。每个场景靠"什么时间、在哪、有谁出场"跟世界设定挂钩。

2. 场景能联动世界设定了
写场景时能直接查到对应的世界设定和角色当时的状态。剧情工作台加了新功能：编辑场景与设定的关联、选角色/地点、看上下文。AI
也能拿到"这一章该怎么写"的简报。

3. AI 助手的配置更可靠
配置编译后的存储方式改了，保证绝不会用到过期或编译失败的旧配置。设置页能看到编译状态，而且这套机制不再拖慢编辑器。

4. AI 助手的工具交互更顺
"AI 向你提问"的功能独立成了专门的问答机制。读文件、改文件、审批、计划模式这些操作在中断后能更好地恢复，还加了行号定位和预检查。

5. llmlint（AI 痕迹检测工具）增强
- 检测规则从目录里自动加载，新增了整篇稿件级别的检测
- 命令行能扫多文件/整个目录，能自动修掉零宽字符、重复标点这类"一看就是 AI 写的"机械痕迹
- 搭好了单独发布到 GitHub 的骨架（独立命令行工具 + Agent Skill）
- 设计完了一套评测方法：拿 AI 写的和人写的对比，看检测器能不能区分、哪个模型写得"最像人"

6. AI 助手的 MCP 配置方案
第一版架构设计定了，关键点是 MCP 配置不会拖慢编译。

7. 文档同步
相关文档都更新到了最新状态。
