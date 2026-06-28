# World Engine — Agent 工具契约

> 本文件是 [README.md](README.md) 的子文档，记录 World Engine 暴露给 Agent 的当前工具协议。
> 当前协议由 Task 67 / 69 / 71 收口而来：旧的固定 RPC 工具已退场，Agent 统一使用 `execute_world` CodeAct 工具。

## 1. 核心原则

- **单工具读写合一**：Leader / world.engine 使用 `execute_world` 在一个 JavaScript 脚本里查询、写入、精确编辑和删除切面。
- **writer 只读**：writer profile 也绑定 `execute_world`，但运行时使用 readonly 模式，不注入 `world.writeSlice` / `world.editMutations` / `world.deleteSlice`。
- **事务边界在脚本级**：一次 `execute_world` 调用运行在一个 deferred 事务中；脚本正常结束 commit，脚本 throw 或超时 rollback。
- **脚本只返回数据**：工具 details 永远是 `{data, issues}`。写方法返回的 issues 可供脚本自查，但运行时也会统一收集，不要在脚本 return 里重复塞 issues。
- **时间在沙箱内用 instant bigint**：写入前用 `world.parseTime("项目日历字符串")` 得到 `bigint`，需要给人看时用 `world.formatTime(instant)`。
- **路径统一 JSON Pointer**：读写两侧都使用 `/hp`、`/memory/师门` 这类 JSON Pointer；`findRefs` / `searchText` 返回的 attr 也是 JSON Pointer。

## 2. 工具入口

```ts
execute_world({
    projectPath: string,
    code: string,
}) -> {
    data: unknown,
    issues: WorldIssue[],
}
```

- `code` 必须是 inline JavaScript，不支持从路径读取脚本。
- 返回数据上限 10KB；查询时只 return 摘要或必要字段，不要倾倒完整世界。
- `undefined` / 无 return 会被转成 `"执行完成"`。
- BigInt 在最终工具 details 中会序列化为字符串。

## 3. 沙箱 World API

### 3.1 时间

```ts
world.parseTime(calendarText: string): bigint;
world.formatTime(instant: bigint): string;
world.now(): bigint;
```

`world.now()` 是脚本开始时的最新切面时间快照。写入时间必须显式传入，不要依赖 now 自动推进。

### 3.2 查询

```ts
world.get(id, options?: {deref?: boolean, derefDepth?: number}): Promise<any | null>;
world.getMany(ids: string[]): Promise<Array<any | null>>;
world.list(type?: string): Promise<Array<{id: string, type: string, name: string}>>;
world.findRefs(targetId: string, sourceType?: string): Promise<Array<{subjectId: string, attr: string}>>;
world.searchText(query: string, options?: {k?: number, threshold?: number, types?: string[], attrs?: string[], at?: bigint}): Promise<Array<{subjectId: string, attr: string, text: string, score: number}>>;
world.slices(options?: {from?: bigint, to?: bigint, limit?: number, withPatches?: boolean}): Promise<SliceListItem[]>;
world.getSlice(id: string): Promise<SliceListItem>;
```

- 写入前先查 schema 语义和现有 subject，避免 id/type/ref 拼错。
- 需要精确编辑 mutation 时，用 `world.getSlice(id)` 或 `world.slices({withPatches:true})` 取得 `patchId`。
- `world.findRefs` 内部批量查询 subject；返回 attr 已转成 JSON Pointer。

### 3.3 写入与编辑

```ts
world.writeSlice({
    time: bigint,
    title?: string,
    summary?: string,
    kind?: string,
    patches: Array<{
        subjectId: string,
        path: string,
        op: "replace" | "increment" | "remove" | "append",
        value?: unknown,
        summary?: string,
        type?: string,
        name?: string,
    }>,
}): Promise<{sliceId: string, issues: WorldIssue[]}>;

world.editMutations(
    sliceId: string,
    edits: Array<
        | {patchId: string, set: {path?: string, op?: string, value?: unknown, summary?: string}}
        | {patchId: string, remove: true}
        | {add: {subjectId: string, path: string, op: string, value?: unknown, summary?: string}}
    >,
    meta?: {time?: bigint, title?: string, summary?: string, kind?: string},
): Promise<{sliceId: string, issues: WorldIssue[]}>;

world.deleteSlice(sliceId: string): Promise<{issues: WorldIssue[]}>;
```

- 首次写入新 subject 时，在任意 patch 上声明 `type`，可选 `name`，`writeSlice` 会自动创建 subject 并写入 schema default。
- 同一 instant 只能有一个 slice；确实要补同一时刻内容时，读出已有切面的 patches 后用 `editMutations` 增加 patch。
- 修一条写错的 mutation 时优先 `editMutations`，不要 delete 整片重写。
- `editMutations` 复用 `service.editSlice`，会整块替换该 slice 的 patch 行；编辑后所有旧 `patchId` 都失效，连续编辑同一 slice 必须重新 `getSlice`。
- `editMutations.add` 不继承首写自动建 subject 规则；创建新 subject 仍走 `writeSlice`。
- `deleteSlice` 是物理删除，不可恢复，只用于整条切面作废。

## 4. 推荐脚本范式

```js
const time = world.parseTime("复兴纪元312年5月20日 09:00:00");

const written = await world.writeSlice({
    time,
    title: "遗迹余波",
    kind: "event",
    patches: [
        {subjectId: "erina", path: "/hp", op: "replace", value: 90},
    ],
});

if (written.issues.some((issue) => issue.code === "broken-relative" || issue.code === "dangling-ref")) {
    throw new Error("写入产生 E issue，回滚本次脚本");
}

const erina = await world.get("erina");
return {
    sliceId: written.sliceId,
    time: world.formatTime(time),
    hp: erina.hp,
};
```

## 5. Issues 处理

- E issues（`broken-relative` / `dangling-ref`）是数据错误，必须修。
- A issues（`base-shifted` / `masked`）是补过去时的一次性提醒，确认语义即可。
- 写方法返回 issues 供脚本内判断是否 throw；工具结果中的 `issues` 是运行时 collector 汇总结果，最终解释给用户时用人话。

## 6. 与旧协议的关系

- `execute_world_query` / `write_world_slice` / `delete_world_slice` 已被 `execute_world` 取代。
- 更早的 `get_world_state`、`list_world_slices`、`create_world_subject`、`edit_world_slice`、`get_world_schema`、`list_world_subjects` 等固定工具只保留在历史 walkthrough / migration 语境。
- `schema.yaml` 已被 Zod `world-engine/schema/index.ts` 取代；Calendar 配置为 `world-engine/calendar.ts`。
