# Subject RAG Memory

Subject RAG Memory 是 `simulation/subjects/` 的第一版长期记忆机制。它只服务当前 subject，不检索完整 Project、不检索 lorebook，也不实现 GraphRAG。

目标是让 `simulator.actor` 在长线 world simulation / RP 中能召回自己过去经历和稳定认知，同时保持 actor-facing 信息边界：当前 actor 只能使用自己合理知道的内容，不能因为 lorebook、entity 或其他 subject 中存在真相就变成全知。

它是 runtime 机制，不是作者手工整理素材的通用搜索入口。作者仍应把稳定真相写进 `lorebook/`，把有状态实例写进 `simulation/entities/`，把 subject-facing 认知写进当前 subject 文件。

## Scope

第一版 RAG 只覆盖当前 subject 的两个事实源文件：

```text
simulation/subjects/{subject-id}/events.jsonl
simulation/subjects/{subject-id}/memory.jsonl
```

这两个文件由 `actor.context-load` sidecar 通过 `subject_rag_search` 检索召回。`actor.context-load` 是纯 RAG 检索器，不读取任何文件原文（包括 `subject.md`、`soul.md`、`mind.md`、`state.md`），只把召回结果整理进 actor-safe context。

角色人设由 `soul.md` 提供（第一人称扮演手册，已被 actor 主路直接 Import）；隐藏真相由全知档 `subject.md` 保管（仅 simulator.leader 可读）。这两个文件都不进 RAG 索引。

初始化记忆没有中转文件：创建 subject 时，由 simulator.leader 直接把冷启动经历写进 `events.jsonl`、把冷启动稳定认知写进 `memory.jsonl`。

## Subject Memory Files

`events.jsonl` 是经历流。每行是一条 subject 当时的经历或认知片段：

```ts
type SubjectEvent = {
    tick?: string;
    time?: string;
    text: string;
};
```

它记录 subject 当时经历了什么、观察到什么、被告知什么、怎么想、产生了什么误解、后来又完成了什么推理。它不是客观知识库，也不要求每条记录都已经完成联想。

`memory.jsonl` 是稳定认知集合。每行是 subject 对某个 topic 的当前看法：

```ts
type SubjectMemory = {
    topic: string;
    aliases?: string[];
    view: string;
};
```

它不是 append-only 日志。重要记忆可以被更新、合并、改名或删除。例如 subject 先记住“粉色头发的女孩子”，之后认识“艾琳娜”，再推理出二者相同；此时 `memory.jsonl` 应把旧 topic 合并到 `艾琳娜`，旧称放入 `aliases`。

## Tools

Subject memory 工具只给 sidecar 使用。`simulator.actor` 主 run 不直接读取完整 subject 文件，也不直接维护文件；它的主 run 实际执行权限只允许 `report_result`。工具入参中的 `subjectPath` 是当前 Agent cwd 内的 subject 目录路径；普通 Project session 通常形如 `{project}/simulation/subjects/{subject-id}`。

`subject_event_append`：

- 追加 `events.jsonl`。
- 校验每条 event 的 `text` 非空，`tick` / `time` 若存在必须是字符串。
- 标记该 subject 的 `events` source dirty。
- 避免 agent 直接手写 JSONL 格式。

`subject_memory_update`：

- 调用方只报告 subject-facing facts 数组，不指定“合并 A 到 B”或 JSON Patch 操作。
- 工具读取当前 `memory.jsonl`。
- 调用真实 `memory.curator` profile 产出 JSON Patch。
- 工具应用 patch 后校验 `topic`、`view`、`aliases` 和重复 topic。
- patch 失败最多重试一次；仍失败则返回 `needs_review`，不写坏文件。
- 成功写入后标记该 subject 的 `memory` source dirty。

`subject_rag_search`：

- 输入当前 `subjectPath`、`query`、`sources` 和 `limit`。
- `sources` 必须显式指定单一 source：`["events"]` 或 `["memory"]`。工具不提供默认双搜，也不允许一次同时搜索两层；需要两层记忆时由 sidecar 分两次调用。
- `limit` 是第一版唯一暴露的查询调参；相关性阈值由工具内部设置。
- 搜索前检查 source hash 和 dirty 状态，必要时同步重建索引。
- 使用 configured embedding service 生成 query embedding。
- 只在当前 subject 和指定 source 内召回候选。
- 返回文本渲染的候选，不返回 score，也不用 JSON 包裹候选；工具不直接生成最终 actor context。

## RAG Index

RAG 索引库位于 Project Workspace：

```text
{project}/.nbook/subject-rag.sqlite
```

它是可重建缓存，不是事实来源。事实来源始终是 `events.jsonl` 和 `memory.jsonl`。删除该 SQLite 文件不会删除角色记忆，只会要求下一次检索重新建立索引。

核心表：

- `subject_rag_meta`：schema version、embedding provider、embedding model 和 dimensions。
- `subject_rag_sources`：每个 subject 的 `events` / `memory` source hash、dirty 状态和索引时间。
- `subject_rag_chunks`：切分后的文本 chunk，保留 source、topic、tick、time 和 source path。
- `subject_rag_vec`：sqlite-vec 向量表。

`subject_rag_vec` 使用 `subject_path` 和 `source_type` 作为 partition key。检索时先限定当前 subject 和 source，再做 KNN。这避免两个问题：

- 当前 actor 召回到其他 subject 的私有记忆。
- 全局 top-k 先截断，导致当前 subject 的相关记忆被其他 subject 或其他 source 挤掉。

如果 embedding provider、model 或 dimensions 与索引元数据不一致，第一版会明确报错，要求删除 `.nbook/subject-rag.sqlite` 后重建。这样可以避免不同维度或不同模型的向量混在同一个缓存库里。

## Embedding Config

Subject RAG 不使用 Pi model registry。Pi 模型配置只管理 chat / vision 模型。

NeuroBook 顶层 Config 提供独立 embedding 配置。Global Config 保存服务级信息：

```ts
embedding: {
    enabled: boolean;
    provider: "openai-compatible";
    model: string | null;
    dimensions: number | null;
    apiKey: string;
    baseURL: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};
```

Project Config 只能覆盖当前 Project 的 embedding model 和 dimensions：

```ts
embedding: {
    model?: string | null;
    dimensions?: number | null;
};
```

`subject_rag_search` 读取 effective `embedding` 配置，并调用：

```text
POST {baseURL}/embeddings
```

未启用 embedding、缺少 model、缺少 dimensions、缺少 API Key 或缺少 API Base 时，工具会明确失败，不做关键词 fallback。

Agent runtime 读取配置时必须使用 `workspaceRoot + projectPath` 合并 Project Config。普通 Project session 的 `workspaceRoot` 通常是容器 `workspace`，Project 覆盖由 `projectPath` 表达；外部 Project Workspace session 则以绝对 `projectPath` 读取该 Project 的 `.nbook/config.json`。

## Sidecar Flow

`actor.context-load` 在 `prepareRun` 阶段执行（纯 RAG 检索器，不读文件）：

1. 基于 actor-facing packet 生成检索 query。
2. 调用 `subject_rag_search` 粗召回当前 subject 的 `events.jsonl` 和/或 `memory.jsonl`；如果两层都需要，必须分别传 `["events"]`、`["memory"]` 调用两次。除 `limit` 外不使用额外查询调参。
3. 自行 rerank、去重、过滤和压缩。
4. 通过 `report_sidecar_result.result` 返回纯文本 actor-safe context，并传 `data: { "actor.context-load": {} }` 闭合旁路结果。
5. `merge()` 把少量相关经历和稳定认知写入 `<actor-sidecar-context>`，并通过 `persistedMessages` 写入 actor session 主 active path，让本轮主 run 可见。

注入预算第一版限制为最多 6 条 events 和 4 条 memory，并限制最终注入文本长度。若注入后 provider-visible context 超出模型窗口，父 invocation 会失败；已写入的 persisted message 第一版不回滚。后续 compaction 会像处理其他 session history 一样处理这条 sidecar context。sidecar 自身 transcript 会持久化在 session tree 的旁路 leaf 上，但不会成为主 active path。

`actor.memory-save` 在 `settleRun` 阶段执行：

1. 使用 `subject_event_append` 追加本轮 subject-facing 经历。
2. 若稳定认知变化，调用 `subject_memory_update` 维护 `memory.jsonl`。
3. 必要时更新 `mind.md`。
4. 不读取也不写 `subject.md`、`soul.md`、`state.md`：人设固定，秘密只在全知档，位置 / 伤势 / 持有物等状态由 `simulator.leader` 裁决。

## Boundaries

- Subject RAG 第一版不检索 lorebook。
- Subject RAG 第一版不检索完整 Project。
- Subject RAG 第一版不实现 who-knows-what GraphRAG。
- subject 侧 `events.md` / `knowledge.md` 已 hard cut，运行时工具不读取、不导入、不自动迁移。
- lorebook 和 entity 可以保存真相；subject 是否知道这些真相，只由自己的 `events.jsonl`、`memory.jsonl`、`state.md` 和 simulator 过滤输入决定。

## Related References

- [simulation.md](simulation.md)
- [information-control.md](information-control.md)
- [../agent/sidecar-profile-pass.md](../agent/sidecar-profile-pass.md)
