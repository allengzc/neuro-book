# World Engine 写作模式工作流

> 本文讲清"写作模式"下 World Engine（世界引擎）的整体工作流与各系统职责边界，是把所有概念串起来的宏观总览。读者是 leader 与 writer。
>
> 概念契约细节见同目录其它 reference；具体操作步骤是 skill 的职责，本文只讲原理、契约与"为什么"。

## 1. World Engine 在写作模式中的定位

World Engine 是项目内**动态世界状态 + 时间线的唯一真相源**。

它用事件溯源（event sourcing）表达世界演化：世界不存"当前状态"，只存按时间排列的 **slice（切面）** 序列。任意时刻的世界状态 = 该时刻之前所有 slice 按时间 reduce（归约）出来的结果。每个 slice 记录某个时间点上一组 **patch（变更）**，每条 patch 描述对某个 **subject（主体）** 的某个 JSON Pointer **path（路径）** 做某种 **op（操作）**。

关键术语在第一次使用时点明：

- **slice / 切面**：一个时间点 + 该时间点发生的一组变更。同一个时间点只能有一个 slice。
- **subject / 主体**：能独立演变状态的对象。不限于人物，地点、势力、王国、任务、重要物品都可以是 subject。
- **instant**：底层时间真相源，一个连续单调的整数刻。**对外永远用项目日历字符串表达**（见第 3 节）。
- **patch / 变更**：对某 subject 某个 path 的一次操作。
- **op / 操作**：patch 的动作类型，全集为 `replace` / `increment` / `remove` / `append`。
- **reduce / 归约**：把一段 slice 序列叠加算出某时刻状态的过程。

因为状态由 slice 序列 reduce 得来，**往时间线更早处插入一个 slice 就能补历史、补设定**：补一段人物过去、补一块大陆历史，都只是"在合适的时间点新增一个 slice"，后续状态会自然叠加上这条新变更。这是 World Engine 区别于"直接存一份当前状态"的根本能力。

## 2. 各系统职责边界

写作模式下，World Engine 与 Lorebook、Manuscript 三者职责互补、不重叠：

| 系统 | 职责 | 存什么 | 不存什么 |
| --- | --- | --- | --- |
| **World Engine** | 动态世界状态、时间线 | 随时间演变的状态与事件：谁在哪、HP 多少、何时发生了什么 | 静态世界观、最终正文 |
| **Lorebook** | 静态设定、世界观、规则 | 长期稳定的设定：身份、力量体系、地理、势力关系、规则 | 随剧情变化的瞬时状态、时间线 |
| **Manuscript** | 最终正文 | 读者会读到的章节 prose | 结构化状态、设定卡 |

Lorebook 与 World Engine 的互补关系最容易混淆，用一个例子点清楚：

- Lorebook 存**身份设定**："艾莉娜是凤凰骑士团成员"——这是稳定 canon，不随单章剧情改变。
- World Engine 存**时间线事件**："艾莉娜在 488 年加入骑士团"——这是发生在某个 instant 上、可被 reduce 的状态变化。

判断一条信息归谁：**它会不会随剧情时间演变？** 会演变（位置、HP、心理、当前关系、谁知道了什么）进 World Engine；不会演变的稳定 canon（人物底设、世界规则、地理）进 Lorebook。稳定下来的事实可以从 World Engine 整理回 Lorebook，但两者不互相替代。

> 边界提醒：World Engine 第一版**不接旧 simulation workflow**，也**不依赖 Plot 系统**。在写作模式的提示词层面，把这两个系统当做不存在，不要引导读者去用 plot / simulation 工具维护世界状态。

## 3. 技术细节透明原则

**用户只需要讲故事、设计角色、推进剧情，永远不需要理解 World Engine 的技术结构。** leader 负责把用户的自然语言自动映射到 slice / patch / reduce / instant / op / schema / calendar 这些技术概念，用户侧不应该看到它们。

时间是这条原则最硬的约束：**对外一律用项目日历字符串**（如 "星辉历312年 5月5日 14:00"）。Agent 工具与 HTTP 公开入参**禁止 raw instant**（`instant:<number>` 这类调试格式会被直接拒绝）。底层的连续整数刻只在引擎内部存在，leader 通过项目 Calendar 把日历字符串 parse / format 成 instant，用户和 writer 都不接触它。

应该对用户说的"人话" vs 不该暴露的术语对照：

| 应该用的人话 | 不该暴露的术语 |
| --- | --- |
| "薇洛丝现在在星陨遗迹，HP 80/100" | "reduce subject `weiluosi` 得到 `location=ref(...)`, `hp=80`" |
| "我把这段剧情记到时间线里了" | "写入了 4 个 slice，每个含若干 patch" |
| "我帮你补一段莉雅的过去" | "向更早 instant 插入一个 `kind=backstory` 的 slice" |
| "星辉历 312 年 5 月 5 日 14:00" | "instant: 9849600" |
| "薇洛丝学会了岩石魔法" | "对 `/skills` 做 `append` patch" |
| "她现在状态怎么样" | "execute_world_query 查询状态" |

leader 在回复用户时用左列，在调用工具时用右列。报告世界状态时给"时间线 + 当前状态"的人读摘要，不要把 slice id、patch JSON、op 名字甩给用户。

## 4. 写作模式整体流程

下面是写作模式的宏观流程原理，不是固定步骤清单——实际顺序随用户而变，关键是理解每个阶段在做什么、World Engine 在什么时机进入。

1. **灵感探索**：用户抛出题材、主角、大致走向。leader 确认理解、读取已导入的 lorebook、提出几个关键问题，用自然对话收敛方向。**此阶段不要急着初始化 World Engine、不写 Plot、不写正文。**
2. **项目初始化**：方向清晰后，建立项目骨架（lorebook 设定、人物卡等）。
3. **World Engine 初始化（合适时机引入）**：见下方时机判断。
4. **世界观扩展**：补充人物、地点、势力、规则。结构化设定进 lorebook，需要追踪状态的对象登记为 subject。
5. **剧情设计**：设计章节剧情，把状态变化推进进 World Engine（见第 5、6 节）。
6. **正文写作**：writer 基于设计好的世界状态写 prose（见第 6 节）。

**World Engine 初始化的时机判断**：

- 当项目有**明确时间线**、且有**需要追踪状态的角色**时引入。这通常出现在用户从"探索想法"转向"我要正经写这个故事了"的时刻，或用户明确说"建立 World Engine"。
- **纯灵感探索阶段不引入**。用户还在反复推翻设定、连主角身份都没定时，初始化 World Engine 只会制造需要反复推翻的结构化数据，得不偿失。

初始化时 leader 需要和用户确认：用什么纪年（Calendar）、故事"现在"是哪个时间点、开局要追踪哪些角色。然后建立 world subject 作为纪元锚点、登记初始角色、写入开局状态。这些技术动作对用户表现为"确认几个基础信息 → 世界引擎建好了 + 当前状态摘要"。

## 5. 两种剧情录入模式

World Engine 同时支持两种把剧情录入时间线的模式，两者可以混用：

**模式 A：先设计世界 / 状态，再写剧情（结构化）**

用户给出结构化设计要求（"设计主角薇洛丝和配角莉雅"）。leader 引导补全关键设定，把人物卡写进 lorebook，把需追踪的状态登记为 subject 并写入背景 slice。适合开局前准备，设定完整、细节明确。

**模式 B：先给剧情叙述，再补回 World Engine（自然）**

用户直接讲一段剧情（"薇洛丝转生到无名祭坛，遭遇邪教徒逃亡，进入遗迹见到被封印的莉雅……"）。leader 从自然语言里**提取时间、地点、事件、状态变化**，补齐缺失的关键信息（"大约第几天？遗迹叫什么？"），再按时间顺序写入若干 slice。适合剧情推进中，快速、自然。

两种模式的差异：

| 维度 | 模式 A：先设计 | 模式 B：先叙述 |
| --- | --- | --- |
| 用户输入 | 结构化设计要求 | 自然剧情叙述 |
| leader 行为 | 引导设计 → 确认细节 → 写入 | 提取信息 → 补齐细节 → 写入 |
| World Engine 侧重 | 补角色历史背景 | 记录剧情时间线事件 |
| Lorebook 侧重 | 创建人物卡 | 创建地点卡、补经历 |

无论哪种模式，录入都遵循**最少支持当前叙事**原则：群体角色先用单一 subject 表示整体（"邪教徒巡逻队"而不是逐个邪教徒），需要时再拆分重要个体；每个 subject 通常 1-2 条 slice（起因 + 当前状态）；临时龙套不建 subject，只在主角 slice 的事件文本里提及；背景按需补，不预先填满。

补设定走**向更早时间插入 slice**：剧情需要莉雅展现岩石魔法时，在她被封印之前的某个时间点插入一个 `kind=backstory` 的 slice 记录她何时学会魔法。可以用精确时间，也可以用一个代表时刻 + `summary` 文本表达模糊时间段（"星辉历 60-90 年间跟随导师学习"）。

## 6. Leader-Writer 协作模式

这是写作模式的核心协作契约。writer 拥有 World Engine **只读**查询能力，因此协作流程围绕"写作前 leader 已经把世界状态推进好"展开。

### 6.1 标准流程（推荐）

```
leader 设计剧情 → leader 推进 World Engine（写作前完成）→ leader 准备简化 brief → writer 自主查询 World Engine 写正文 → leader 检查成果
```

关键原则是**先演化世界 + 设计剧情，然后再调用 writer**。leader 在调用 writer 之前，就把本章涉及的剧情事件按时间顺序写入 World Engine（解封、交流、追入、对峙……）。这样世界状态先行，writer 看到的永远是一致的、已推进到位的状态，而不是滞后于正文的状态。

### 6.2 Brief 简化原则

因为写作前 leader 已经推进好世界状态、writer 又能自己查询，brief 应当**简化**：只传剧情框架，不传可查询的状态细节。

| brief 应该传 | brief 不需要传 |
| --- | --- |
| 章节目标 / 关键剧情点 | 详细角色状态 |
| 信息控制要求 | 完整世界状态 |
| 写作约束（视角、节奏、章节如何收尾） | HP / 位置等细节 |
| 建议读取的 lorebook 路径 | 完整时间线记录 |
| World Engine 查询提示（查哪些 subject、哪个时间范围） | mutation 细节 |

不传 HP、位置这类细节，是因为 writer 会自己用 `execute_world_query` 查到当前真值。把状态都塞进 brief 既冗余、又会让 writer 退化成纯执行者、还浪费了它的查询能力。brief 给框架，状态留给 writer 查。

### 6.3 Writer 能力边界

| 能力 | 说明 |
| --- | --- |
| 查询 World Engine | `execute_world_query`（**只读**，CodeAct 沙盒） |
| 读取 lorebook | 角色设定、地点描述、规则 |
| 自主查询状态 | 按需查角色 HP、位置、心理等 |
| 写作自由度 | 可在 brief 框架内发挥细节 |
| 写入 World Engine | **不能**，不可写入切面 |
| 创建 subject | **不能**，首次写入由 leader 负责 |
| 主线剧情设计 | **不应承担**，剧情设计权在 leader |

writer 的典型工作流：读 brief 指定的 lorebook → 用 `execute_world_query` 查相关 subject 在章节时间范围的状态 → 构思并写入正文 → 报告结果。leader 在 writer 完成后检查成果，确认 writer 的细节发挥（环境描写、角色反应、内心独白等）是否在合理范围内；通常这些细节不改变世界状态，不需要补回 World Engine。

### 6.4 自由发挥模式（可选，默认不推荐）

```
leader 给大致方向 → writer 自由发挥（含剧情细节）→ leader 事后把偏离 brief 的状态变化补回 World Engine
```

当**用户明确允许 writer 自由发挥**时使用：leader 只给方向（"薇洛丝和莉雅遭遇邪教徒发生战斗，战斗细节你自由发挥"），writer 可以增加新角色、改变受伤程度、使用未预设的能力。写作后 leader 读取正文、提取状态变化，把它们补进 World Engine（创建新角色 subject、更新 HP、补能力溯源）。

此模式文字生成快、即兴感强，但 writer 承担了部分剧情设计职责、World Engine 滞后于正文、需要更多后处理，因此**默认不推荐**，只在探索性 / 实验性写作且用户明确同意时使用。需要严格控制剧情走向时不要用。

## 7. 信息控制

leader 在 brief 中必须明确**谁知道什么、谁不知道什么**，writer 严格按角色视角写，不泄露角色不该知道的设定。

信息控制写进 brief 的形式是按 subject 视角分别说明知识边界，例如：

- 薇洛丝视角：不知道莉雅的真实身份、被封印的原因、项链的意义。
- 莉雅视角：失忆，不知道自己被封印了多久、不知道外面的世界。
- 反派视角：从教会典籍见过古代魔女项链的记载，认出标志，但不确定眼前的女孩是谁。

writer 写每个角色的言行、心理时只能基于该角色已知的信息。读者层面的悬念由"角色不知道、读者也暂时不知道"共同维持。注意 World Engine 的 `execute_world_query` 是上帝视角真值源——writer 能查到莉雅的真实状态，但在薇洛丝视角的叙述里不能让薇洛丝"知道"这些 writer 查到的设定。查询能力服务于写作一致性，不等于授权角色越界知情。

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口。
- [recording-principles.md](recording-principles.md)：最少支持当前叙事原则——记录什么、记录到什么粒度。
- [schema-system.md](schema-system.md)：schema、kind、op、ref、default 契约。
- [subject-lifecycle.md](subject-lifecycle.md)：subject 注册、切面演化、reduce、issues、查询契约。
- [calendar-system.md](calendar-system.md)：Instant、纪元锚点、Calendar 与时间入参边界。
- [docs/tasks/56-world-engine/README.md](../../docs/tasks/56-world-engine/README.md)：World Engine 模型与 Decisions 定论（契约真相源）。
