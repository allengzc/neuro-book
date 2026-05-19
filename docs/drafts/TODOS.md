## TODOS

**T0 Task**


- [ ] 跑通剧情系统
- [ ] 跑通 Lore 系统，提及，mention，@
- [ ] Writer Subagent
- [ ] plan mode
- [ ] create_task 前端
- [ ] <system-reminder>
- [ ] 引用系统
- [ ] content node 表单
- [ ] AI 填表
- [ ]
- [ ] request_user_input 超级自定义大表单。或者表单文件
- [ ]
- [ ]
- [ ]
- [ ]

**Tasks**

- [x] dialog 点击空白关闭逻辑
- [ ] 剧情 summary
- [x] 世界书
- [ ] 记忆
- [ ] 不要让同一个 Agent 一边续写，一边决定大纲，一边评估质量。它会非常不稳定。
- [ ] Planner → Writer → Critic → Writer Revision → Memory Update
- [x] lorebook 与 novel 解绑

- [x] textarea min height
- [x] 优化：外联与节点、治理与来源
- [x] use TipTap https://chatgpt.com/c/69c9ee18-9338-832c-8cb1-c44f1c9bb93d

- [ ] openapi cache
- [ ] report_result data
- [x] 思维链保存
- [ ] 滚动条占位
- [ ] invoke_subagent 前端 bug
- [ ] 自动刷新章节、lorebook 等
- [ ] TProfile 类型限制
- [ ] 文档模块
- [ ] 词频
- [ ] 写作历史 statics
- [ ] dialog window 已经关闭了才弹 dirty 确认
- [ ] scope 系统重构优化降低心智负担
- [x] $skill 直接加载 skill.md
- [ ] json patch benchmark https://arxiv.org/html/2510.04717v1?utm_source=chatgpt.com
- [ ] 现代汉语规范词典
- [ ] config.yaml 支持 ${env.OPENAI_BASE}
- [ ] plan mode
- [x] 抛弃数据库，全面迁移到文件
- [x] request_user_input 问题切换。延迟。answers 中存在重复的 toolNodeId
- [ ] prompt，介绍数据存储
- [x] $ 报错
- [ ] execute_shell 字符集问题
- [ ] 手写变量系统
- [ ] 手写上下文系统
- [ ] tool schema description
- [ ] 简化 story 工具，有重复的 schema 定义（20k token）
- [ ] request_user_input 合并?
- [ ] 先报告在写（plan mode）
- [ ] editor setting 数字 input 无法正常输入
- [ ] 允许用户编辑提示词模板
- [ ] 面板允许调整宽度
- [ ] agent chat flow 动画调快，或者开局直接到底
- [ ] token statics，cache 添加缓存命中百分比
- [ ] write_file 这些 tool 前端气泡展示参数，结果部分添加滚动条
- [ ] 虚拟文件系统？docker，k8s
- [ ] novel 绑定 workspace
- [ ] h1, h2, h3
- [ ] request_user_input 允许用户直接输入，不提供选项
- [ ] request_user_input UI 调整，允许收起
- [x] markdown 方言介绍
- [ ] structure textarea 更新
- [ ] content node schema 简化 + $ref 简化
- [ ] 思维链，system 滚动条
- [ ] Markdown 表头列数 = 分隔行列数(|--|--|) = 每一行数据列数 优化(https://github.com/MAbdanM/markdown-table-repair/blob/main/markdown_table_repair/repair.py)
- [ ] frontmatter pendding refs
- [ ] API 请求状态栏
- [ ]  <system-reminder>
       Plan mode is active. The user indicated that they do not want you to execute yet
       -- you MUST NOT make any edits (with the exception of the plan file mentioned below),
       run any non-readonly tools (including changing configs or making commits), or otherwise
       make any changes to the system.
       </system-reminder>
- [ ] reminder 机制
- [ ] task_create，task_create 等工具返回 ok
- [ ] 不要一次 run 后再更新 token statics
- [ ] dynamic skill 和 watched 提示词有问题
- [ ] 取消后报错：请求失败：request_user_input 之后不能继续生成正文或调用其他工具，请等待用户回答后再继续。
- [ ] `****`语法支持
- [ ] 编辑器 dirty 检测
- [ ] md 表格 overflow
- [ ] 加强 relation: defines_protagonist 约束
- [ ] workspace schema 脚本
- [ ] edit file diff 缺失
- [ ] workspace ls 给出内容节点的子目录 例如 scene-note
- [ ] `` 光标定位格式不对
- [ ] mermaid
- [ ] 什么样子的条目要注入？例如主角就不用注入
- [ ] `[]()`

- [ ] 当前任务状态太频繁，前端没做处理
- [ ] 模板大于一切啊
- [ ] DeepSeek 思维链调节
- [ ] Markdown 无需列表有问题
- [x] request_user_input 前端只展示了一个问题
- [x] 提示词设定：要中立，不要夸，媚 user，情绪不要
- [ ] epub 转 Markdown
- [ ] 4. 关于 frontmatter 中 refs 的填写原则补充：如果涉及到大内容节点与小内容节点之间的联系。例如：冥渊教团和虚哭之露。refs 会出现两次
- [x] faction 有 character 字段？
- [ ]
- [x] skill 外貌，主角着重设计
- [x] 世界模拟 skill 范围不对，应该是世界范围内
- [x] 世界观初始化应该包含历史
- [ ] tiptap 保存 dirty 状态与文件目录自动刷新
- [ ] 使用 CodeMirror 实现 Live Preview 模式
- [ ] profile 的输入输出的 schema 希望能在本文件定义
- [ ] 删除初始剧情种子，因为已经有灵感（故事概念）了
- [ ] 文件删除同时删除引用
- [ ] 每章字数限定
- [ ] bio 工具

- [ ] 剧情设计先用理性分析，再填充内容
- [ ] 剧情设计给模拟世界，让用户决定
- [ ] 设计过程中可以引入新设定
- [ ] 多视角分析
- [ ] 素材很好，多提供一点，例如道具。AI描述环境。AI给出素材，用户拼装
- [ ] Markdown 有条目的用条目引用语法
- [ ] 剧情设计不负责细节,哪些细节？
- [ ] Prompt 自动压缩，去除缩进
- [ ] invoke writer subagent 调用要 validate 引用，plot 直接传引用
- [ ] subagent 前端显示。前端不能实时显示 subagent
- [ ] docker 部署脚本 oom 检测
- [ ] 迁移到 https://github.com/earendil-works/pi/tree/main/packages/ai
- [ ] epub 格式支持
- [ ] agent 创建工作区的tool
- [ ]
- [ ]

------

skills

- 热梗素材收集
- 评论分析
- 绘图
- 读者画像
- 同类作品

------

Planner 先产出卷纲/章纲
Critic 检查漏洞
Planner 修订
Writer 按单章计划写
Editor 做一致性和节奏审查
更新 story state / 伏笔表 / 角色状态


------

## 转生血族奴隶：创建理想乡

> 主角苏雪在读完《理想城》后直接转生到异世界。三岁的时候觉醒前世记忆。0-5岁一直生活在孤儿院。然后社会多么多么黑暗。然后孤儿院院长死了 + 国家被入侵。直接变为流浪儿。3个月后被侵略国奴隶商人抓起来。故事现在是6岁生日。

世界/大陆 -> 国 -> 城 -> 区域（皇宫、东市西市） -> 建筑 -> 房间
1. 神恩大陆
  - 王国 A（地点+势力）
  - 王国 B
      - B-a 城
        a. 孤儿院（地点）
