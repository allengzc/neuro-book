# World Engine — Subject 生命周期

本文讲清 **subject（主体）** 在 World Engine（世界引擎）里的生命周期：什么是 subject、如何注册、init slice 怎么落、状态如何随切面演化、reduce 如何把切面序列算成任意时刻的状态。读者是需要在世界引擎里管理主体状态的 Agent。本文只讲原理与契约，不讲"第一步、第二步"的操作流程；理解契约后如何操作由 skill 层指引。

> 边界提示：World Engine 第一版**不接旧 simulation workflow，也不依赖 Plot 系统**。本文涉及的状态记录全部走世界引擎工具，不要把 subject 状态写进 `simulation/` 文件或 plot 工具。

## 1. 什么是 subject

**subject 是参与世界模拟、能独立演变状态的主体。** 它不限于人物——王国、大陆、物品、任务、阵营都可以是 subject。

判断一个东西要不要建 subject，标准只有一条：**它有没有"独立的、需要随时间追踪的状态"。**

- 主角艾莉娜会移动、受伤、改变心理 → 是 subject。
- 凤凰王国有国库、有都城、会立国会衰亡 → 是 subject。
- 一个任务有 status / progress / log，会从 active 走到 done → 任务本身就是 subject。
- 一把会附魔、会损坏、有持有人差异的剑 → 是 subject。
- 三瓶普通血药、一根火把、十枚金币 → **不是** subject，它们只是某个角色 `inventory` collection 里的元素。

口诀沿用 simulation entity 规则：**三瓶普通血药是 inventory 计数；一瓶被下毒的血药才是 subject。** 关系（"在哪""属于哪个阵营""被谁装备"）不是独立的第三种东西，而是某个 subject 上一个值为 `ref` 的属性，随切面演化，不需要单独建模。

subject 的类型由项目 schema（`world-engine/schema/index.ts`）按"类型"声明：`character` / `quest` / `location` / `item` / `faction` / `world`…。一个类型是一份模板，100 个 NPC 共享一份 `character` schema。引擎本身不预设世界观，只认识抽象概念（subject / slice / instant / patch / op / reduce）；"hp""国库"是什么，全部由项目 schema 表达。

## 2. subject 创建：首次写入自动创建

subject 不需要单独注册。**首次对某个 subject 写入切面时，World Engine 会自动创建该 subject**。这意味着"注册身份"和"写入首条状态"合并成一个操作：

```typescript
// 首次写入 erina 时自动创建 subject：在某条 patch 上声明 type（必填）+ name（可选）
write_world_slice(projectPath, {
    time: "星辉历312年 5月5日 14:00",
    title: "艾莉娜转生到祭坛",
    patches: [
        { subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100 },
        { subjectId: "erina", path: "/location", op: "replace", value: "subject://altar-01" },
    ],
})
```

关键契约：

- **`subjectId` 全局唯一，不能为空白。** 首次出现某个 subjectId 时会创建 subject。重复 id 会复用已有 subject（不会创建第二个）。
- **`type` 必须是 schema 已声明的类型。** 首次写入时必须在该 subject 的某条 patch 上明确指定 `type` 字段（如 `{ subjectId: "erina", type: "character", ... }`），可选附 `name`。subject 已存在后再写时 type/name 被忽略，可省略。
- **`time` 用项目日历字符串，不传 raw instant。** 写成 `instant:<number>` 这类调试格式会被公开入参直接拒绝。
- **schema default 会自动应用。** 如果 schema 为该 type 声明了非空 default，创建 subject 时会自动生成初始值（作为 init patch 写入）。

**与旧 `create_world_subject` 的差异**：

- 旧版需要先调用 `create_world_subject` 注册，再用 `write_world_slice` 写入状态。
- 新版合并为一步：首次 `write_world_slice` 时自动创建 subject。
- 好处：减少一次 API 调用，避免"忘记注册导致 dangling-ref"的错误。

## 3. 切面是状态变更，不是快照

subject 注册后，它的状态变化全部由**切面（slice / 切面）**承载。一个 slice = **一个时间点 + 一组 patch**：

```typescript
interface Slice {
    id: string;
    instant: string;       // BigInt 时间戳（唯一时间真相源，持久化为 string）
    kind?: string;         // timeline 分类标签，默认 event，不参与 reduce
    title: string;
    summary?: string;
    patches: Patch[];      // 这一刻发生的所有变更
}

// 一条 patch：对某 subject 的某个 JSON Pointer path 做某 op
interface Patch {
    subjectId: string;     // 改谁
    path: string;          // JSON Pointer，如 /hp、/equipment/weapon
    op: string;            // replace / increment / remove / append
    value?: unknown;       // 普通 remove 省略；collection remove 可提供 value 按 stable JSON 值删除元素
    summary?: string;      // 人类可读摘要
}
```

关键性质：

- **切面是增量（delta），不是全量快照。** 世界不存"当前状态"，只存切面序列。这个选择是被需求锁定的：核心诉求是"往前插切面补历史/补设定"。全量快照在往前插时会让所有后续快照失效；增量模型则让后续变更自然叠加，对补历史天然友好。
- **同一 instant 只能有一个 slice。** 同一刻发生的多 subject / 多 path 变化，必须放进同一个 slice 的 `patches` 数组。`write_world_slice` 遇到目标 instant 已存在会报错；Agent 的 `write_world_slice` 没有编辑/覆盖已有切面的能力，要补同一时刻的内容就改用相邻时间点（整块编辑已有切面是 Workbench/HTTP `editSlice` 的能力，不在 Agent 写工具里）。
- **补过去与写当前是同一个工具。** 给 `write_world_slice` 传一个比当前最新切面更早的 `time`，timeline 自动按底层时间戳归位。这就是"溯源"——为角色补一段早年经历，就是在更早的 instant 上插一条切面。

**整块替换已有切面（Workbench / HTTP `editSlice`，非 Agent 写工具）**：用完整的切面数据（含 `sliceId`）整块替换原切面：

```typescript
// 注意：这是 HTTP / Workbench 能力；Agent 的 write_world_slice 不接受 sliceId、不能编辑切面
editSlice(projectPath, sliceId, {
    time: string,          // 完整重传
    title: string,
    summary?: string,
    kind?: string,
    patches: Patch[],      // 整块替换：这条切面替换后保留的所有 patch
}) -> { issues: WorldIssue[] }
```

语义是**整块替换**：提交后这条切面的 `patches` 就是这次传进去的那一组，**没带上的旧 patch 会被丢弃**。因此"在已有切面上补一条 patch"的正确做法不是只传新增那条，而是：先用 `execute_world_query` 的 `world.slices()` 读出原切面的完整 patches，把新 patch 合并进去，再整组提交。只传一条新增 patch 会把原有 patch 全部覆盖丢失。

## 4. reduce 语义

**任意时刻的世界状态 = 该时刻前所有切面，按 `instant` 升序、同一 slice 内按 patch 顺序 reduce 出来的结果。** 这是经典 event sourcing。

- **截断时间 `at`**：reduce 只叠加 instant ≤ `at` 的切面，更晚的切面不参与。倒叙、回忆 = 把 `at` 设到更早的时间点。
- 例：主角的出生切面在复兴历 470 年。查询 `at = 复兴历 200 年` 时，出生切面被截断，主角**尚不存在有效状态**——"倒叙看 200 年时主角还没出生"天然成立。
- **reduce 永远只算单个 subject，引用不自动展开。** `reduce(艾莉娜).equipment.weapon` 返回 `subject://sword-01` 这个 ref 值本身，**不**把剑的状态嵌进来。要剑的状态，调用方自己再 reduce 一次 sword-01。原因是自动解引用会引发递归、循环引用、"解到哪层停"的难题。谁要关联视图，谁自己组合多个 reduce 结果。

同一批切面，传不同 `at` 就 reduce 出不同时代的世界；reduce 出"当前值"和 reduce 出"历史轨迹"用的是同一批数据，只是聚合方式不同。这是模型的核心价值。

## 5. 状态演化的典型形态

每个属性在 schema 里绑定一个 **kind**，kind 决定它接受哪些 op、reduce 怎么叠加。属性的演化形态因此分三类：

**scalar（标量）——用 `replace` / `increment` / `remove`。**
- `replace` 是绝对值："等级升到 5""status 改成 done""hp 设为 80"，后写覆盖前值。
- `increment` 是相对增量（仅数值有效）："扣 30 血"写 `/hp increment -30`，在当前值上累加。
- `increment` 的价值是**架构性的**：它可交换，对"往前插切面"稳定——前面再插一条扣血切面，本条 `increment -30` 不用改，reduce 自动正确。`replace` 是绝对值、对插入敏感。所以日常数值变化优先考虑 `increment`。

**list（有序流）——用 `append`（也支持整组 `replace`）。**
- `append` 是**只增的有序流**追加，语义对齐经历流（events）、任务日志（quest.log）。
- list **故意不支持中间插入**：要往"过去"补一条经历，正确做法是**往更早 instant 插一个切面**，而不是在现有 list 中间塞元素，否则破坏"events 顺序 = 切面 instant 顺序"的不变量。

**collection（无序集合）——用 `append` / `remove`（也支持整组 `replace`）。**
- 集合元素可增可删、无序、按 stable JSON 值去重，语义对齐背包物品、附魔列表、宗门弟子。
- `append` 按值去重追加；`remove` 不带 value 时删除指定 path，带 value 时只对 collection 有效，按 stable JSON 值删除匹配元素，找不到时幂等。list 不支持按值删。

**object（嵌套结构）——对子路径做 `replace` / `remove`，或整体 `replace`。**
- 有 `fields` 是固定结构（如 `equipment.head` / `equipment.weapon`），无 `fields` 只有 `itemType` 是开放字典（如 `memory.师门`，key 运行时增减）。
- 日常优先打**细路径**（`replace /equipment/weapon`）保留逐槽位历史；整体 `replace /equipment = {...}` 留给"换一整套装备"这类真整体操作。

**历史轨迹不需要专门存储。** "hp 随时间的曲线"= 遍历所有打在 `/hp` 上的 patch（每条带 instant + op + 值），从切面序列直接得出。不存在"track 旧值"的机制，也不需要为成长史单独建表。

## 6. 回退能力

删除切面是 Workbench / HTTP 的 `deleteSlice` 能力（Agent 的 2 个工具里没有删除入口）：

```typescript
// 注意：HTTP / Workbench 能力；Agent 不能删除切面
deleteSlice(projectPath, sliceId) -> { issues: WorldIssue[] }
```

- **物理删除，不可恢复。** 删除某条切面后重新 reduce。没有旧值字段做 O(1) 逆操作，也没有可恢复的撤销。
- **第一版没有通用 rollback / revert slice。** 也不自动补写、不自动改写后续切面。
- 删除会返回受影响 subject 重新 reduce 后的 E issues。如果删掉的是某个相对 op 的基准切面，下游的 `increment` / `append` 可能因缺基显形 `broken-relative`（见 §7）。
- 删除切面**不会**自动删除 subject 身份。例如删掉"捡到剑"那条切面，`sword-01` 这个 subject 仍然存在，只是不再被任何切面引用。

## 7. issues 反馈通道

写入、编辑、删除、查询都会通过 `issues` 暴露两类问题。Agent 必须区分对待，并向用户用人话解释，**不要把 `broken-relative` 这类术语直接抛给用户**。

**E issues（持久数据错误，读时现算，必须修）：**

- `broken-relative`：相对 op 缺少有效基准。例如某个 `/hp increment -30` 前面没有任何给 `/hp` 设过初值的切面；或基准切面被删掉了。也包括 `increment` 的累加结果溢出 / 非有限数。
  - 向用户解释："某条数值变化缺少起始值，得先补一条设定初始值的记录。"
- `dangling-ref`：schema 声明的 ref 值目标缺失或类型不符。例如 `equipment.weapon` 指向 `subject://sword-99`，但这个 subject 根本不存在。
  - 向用户解释："某处引用了一个不存在的对象，需要先建它或改引用。"

E issues 是数据里的真实错误，`execute_world_query` 查询时也会返回相关的 E issues，必须处理。

**A issues（一次性提醒，写/编辑时返回，确认语义即可）：**

- `base-shifted`：本次对过去的绝对修改，改变了下游某个相对 op 的累加基准。
- `masked`：本次修改会被下游一个绝对 op 覆盖。

A issues **不落库**，也不要求改数据；它们只是在你"往过去插切面"或"编辑旧切面"时，提醒你确认语义是否符合预期。

- 向用户解释（`base-shifted`）："你改了过去的一个数值，后面那条'加减'的起点也跟着变了，确认一下这是你想要的。"
- 向用户解释（`masked`）："你这条改动后面会被另一条覆盖，可能看不出效果，确认一下。"

## 8. 查询契约：`execute_world_query`

查询世界状态使用 `execute_world_query`，在 CodeAct 沙盒中执行 JavaScript 代码。沙盒提供 `world` API：

```javascript
// 查询单个 subject（本质是 reduce）
const erina = await world.get("erina");

// 查询并自动解引用
const erina = await world.get("erina", { deref: true, derefDepth: 1 });

// 批量查询
const states = await world.getMany(["erina", "phoenix-faction"]);

// 列出某类型的所有 subject
const characters = await world.list("character");

// 反向查找引用
const refs = await world.findRefs("phoenix-faction", "character");

// 向量搜索
const results = await world.searchText("遗迹封印", { k: 5, types: ["event"] });

// 查询时间轴切面
const slices = await world.slices({ limit: 10 });
```

防全量倾倒是硬契约——成熟世界有几百 subject、每个几十属性：

- Agent 的 CodeAct API 不提供裸 `queryState({})` 入口；使用 `world.get` / `world.getMany` / `world.list(type)` / `world.slices()` 等收窄方法查询。HTTP `POST /state/query` 公开入口同样必须传 `subjectIds` 或 `type` 至少其一；都省略会报错要求收窄。完整世界状态导出只走 UI / debug 专用的 `GET /state`，内部复用 `queryState({at})`，不暴露给 Agent。
- `subjectIds` 若传，必须是非空数组且每项唯一；空数组或重复 id 返回 400。
- `attrs` 若传，必须是非空数组且每项唯一；用它**投影**只取关心的属性，省下无关字段。
- `type` 若传，必须是 schema 已声明的类型，拼错会被拒绝。
- `at` 用项目日历字符串做时间截断（倒叙/回忆）；省略取最新。
- `listLimit` 控制 list / collection 属性最多返回多少条，避免长 events 流把上下文撑爆。
- 返回的 `issues` 是当前 reduce 显形的 E 问题；如果传了 `attrs`，issues 也跟随投影范围收窄（查 `hp` 不会带回 `location` 的 `dangling-ref` 噪音）。

典型用法：

- 「主角现在什么状态」→ `{ subjectIds: ["erina"] }`
- 「主角的血量和位置」→ `{ subjectIds: ["erina"], attrs: ["hp","location"] }`
- 「所有角色现在在哪」→ `{ type: "character", attrs: ["location"] }`
- 「倒叙：主角 200 年时」→ `{ subjectIds: ["erina"], at: "复兴历200年 1月1日 00:00:00" }`

## 9. writer 的只读边界

writer 角色拥有 World Engine **只读**查询能力（`execute_world_query`），用于读取世界状态辅助写作，**不能写入**。写入切面、修改切面、删除切面都不属于 writer 的权限范围。需要改变世界状态时，由具备写入能力的角色承担。

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口。
- [schema-system.md](schema-system.md)：schema、kind、op、ref、default 契约（决定 subject 有哪些属性、怎么叠加）。
- [recording-principles.md](recording-principles.md)：记录什么、记录到什么粒度（最少支持当前叙事）。
- [calendar-system.md](calendar-system.md)：时间真相源与时间入参边界。
- [workflow.md](workflow.md)：写作模式整体工作流与 leader/writer 协作。
