# World Engine Reference

`reference/world-engine/` 是 World Engine（世界引擎）的稳定参考书架。World Engine 是 NeuroBook 写作模式下**动态世界状态 + 时间线的唯一真相源**：用事件溯源（event sourcing）表达世界演化——世界不存「当前状态」，只存按时间排列的切面（slice）序列，任意时刻的世界状态由该时刻前所有切面 reduce 得来。

本目录只讲**原理与契约**（教 How：概念、约束、为什么）。具体操作步骤是 skill 的职责，不在这里。

## 阅读顺序

- 想先建立宏观图景、理解各系统职责和 leader/writer 协作：先读 [workflow.md](workflow.md)。
- 决定「在世界引擎里记录什么、记到什么粒度」：读 [recording-principles.md](recording-principles.md)。
- 设计或理解某个项目的 subject 模式：读 [schema-system.md](schema-system.md)。
- 管理主体状态、理解切面演化与 reduce：读 [subject-lifecycle.md](subject-lifecycle.md)。
- 理解时间如何表达、如何落盘、工具边界如何接受时间：读 [calendar-system.md](calendar-system.md)。

## 文档

- [workflow.md](workflow.md)：写作模式整体工作流、World Engine / Lorebook / Manuscript 职责边界、技术细节透明原则、两种剧情录入模式、Leader-Writer 协作契约、信息控制。
- [recording-principles.md](recording-principles.md)：最少支持当前叙事原则——群体角色、切片数量、按需溯源、模糊时间段、临时角色、记录边界。
- [schema-system.md](schema-system.md)：schema 定位、kind（scalar/list/collection/object）、4-op patch 全集、ref 规则、JSON Pointer path、default、校验宽松度、稳定 key 约束、典型奇幻 schema 示例。
- [subject-lifecycle.md](subject-lifecycle.md)：subject 定义、init slice、切面增量模型、reduce 语义、状态演化形态、回退能力、issues 反馈、`execute_world_query` 查询契约、writer 只读边界。
- [calendar-system.md](calendar-system.md)：唯一时间真相源 Instant、零点与纪元锚点（公元日）、Calendar 独立显示模块、calendar.ts 配置（支持 Simple / Gregorian / Custom 三种类型）、Agent/HTTP 时间入参边界。

## 核心边界（务必记住）

- **第一版不接旧 simulation workflow，也不依赖 Plot 系统**。在写作模式提示词层面把这两个系统当做不存在，记录世界状态只用 World Engine 工具，不要调 plot / simulation 工具。
- **时间对外一律用项目日历字符串**（第一版月份是数字，如 `星辉历312年 5月15日 14:00`）。Agent 工具与 HTTP 公开入参禁止 raw instant（`instant:<number>`）。
- **patch 不存旧值字段，后端不自动改写后续切面**。声明式 patch 序列是唯一真相源，状态永远由 reduce 得来。
- **同一 instant 只能有一个 slice**；写入冲突需要读取原 slice 后用 `patches` 整块编辑。
- **E issues**（`broken-relative` / `dangling-ref`）是持久数据错误，必须修；**A issues**（`base-shifted` / `masked`）是一次性提醒，确认语义即可。
- **writer 对 World Engine 只读**（`execute_world_query`），不能写入。

## 契约真相源

本目录是面向 Agent / 作者的稳定 reference。底层实现契约、所有 Decisions 定论与 Agent 工具完整签名见：

- [docs/tasks/56-world-engine/README.md](../../docs/tasks/56-world-engine/README.md)：核心模型与所有 Decisions 定论。
- [docs/tasks/56-world-engine/schema-design.md](../../docs/tasks/56-world-engine/schema-design.md)：schema 字段格式与完整示例。
- [docs/tasks/67-world-engine-zod-schema-codeact/README.md](../../docs/tasks/67-world-engine-zod-schema-codeact/README.md)：Zod schema 与 8→2 Agent 工具迁移来源。
- [docs/tasks/69-world-engine-tool-cleanup/README.md](../../docs/tasks/69-world-engine-tool-cleanup/README.md)：旧协议清理、`WorldPatch` 表名、collection 按值删与 P0-P3 收口。
- [docs/tasks/56-world-engine/sqlite-and-api.md](../../docs/tasks/56-world-engine/sqlite-and-api.md)：Project SQLite 表结构与 HTTP API 契约。
