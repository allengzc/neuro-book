/**
 * Pi 请求 trace 查看器 DTO。
 *
 * 字段镜像 `server/agent/observability/pi-request-recorder.ts` 的
 * `PiTraceRecord` / `PiTraceIndexEntry`（shared 不能 import server 模块，否则
 * node:fs 会进前端 bundle）；traces route handler 的返回值同时标注两侧类型，
 * 靠 typecheck 防两份定义漂移。
 */

/** trace 来源分类。turn = 主 ReAct 轮次；compaction = 压缩摘要；health-check 保留备用（当前无调用方）。 */
export type AgentTraceKindDto = "turn" | "compaction" | "health-check";

export type AgentTraceStatusDto = "ok" | "error" | "aborted";

/** 领域关联字段。除 kind 外都可选（compaction 可能缺 turnIndex，手动 /compact 缺 mode）。 */
export type AgentTraceCorrelationDto = {
    kind: AgentTraceKindDto;
    sessionId?: number;
    invocationId?: string;
    profileKey?: string;
    turnIndex?: number;
    mode?: string;
};

/** 请求侧。context = pi 规范化上下文（跨 provider 统一），payload = provider 原生请求体。 */
export type AgentTraceRequestDto = {
    provider: string;
    api: string;
    model: string;
    baseUrl?: string;
    reasoning?: string;
    /** pi 规范化 {systemPrompt, messages, tools}；内容是任意 JSON，前端只透传给渲染层。 */
    context?: unknown;
    /** provider 原生请求体；capturePayload 关闭或 faux provider 时缺省。任意 JSON，透传 JsonViewer。 */
    payload?: unknown;
};

/** 响应侧健康度。失败请求 httpStatus/headers 可能缺（provider 错误路径跳过 onResponse）。 */
export type AgentTraceResponseDto = {
    httpStatus?: number;
    headers?: Record<string, string>;
    stopReason?: string;
    usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        /** 仅当 Provider 提供 1h cache write 拆分时存在。 */
        cacheWrite1h?: number;
        /** 仅当 Provider 提供 reasoning token 拆分时存在。 */
        reasoning?: number;
        totalTokens: number;
    };
    errorMessage?: string;
};

/** 时序。ttftMs 仅主 turn 有效；compaction 只 await result() 不迭代流，无 TTFT。 */
export type AgentTraceTimingDto = {
    startedAt: string;
    ttftMs?: number;
    durationMs?: number;
};

/** 单条完整 trace 记录（详情接口返回）。 */
export type AgentTraceRecordDto = {
    id: string;
    ts: string;
    status: AgentTraceStatusDto;
    correlation: AgentTraceCorrelationDto;
    request: AgentTraceRequestDto;
    response: AgentTraceResponseDto;
    timing: AgentTraceTimingDto;
};

/** index.jsonl 汇总行（列表接口返回，不含 payload）。 */
export type AgentTraceIndexEntryDto = {
    id: string;
    ts: string;
    status: AgentTraceStatusDto;
    kind: AgentTraceKindDto;
    invocationId?: string;
    turnIndex?: number;
    provider: string;
    model: string;
    stopReason?: string;
    totalTokens?: number;
    ttftMs?: number;
    durationMs?: number;
    bytes: number;
};

/** bucket 汇总（sessionId 或 _system）。 */
export type AgentTraceBucketDto = {
    bucket: string;
    count: number;
    lastTs?: string;
};

export type AgentTraceBucketListDto = {
    buckets: AgentTraceBucketDto[];
};

export type AgentTraceIndexListDto = {
    entries: AgentTraceIndexEntryDto[];
};

/** 「最近请求」聚合条目：index 行 + 来源 bucket（目录名，不落盘）。 */
export type AgentTraceRecentEntryDto = AgentTraceIndexEntryDto & {bucket: string};

export type AgentTraceRecentListDto = {
    entries: AgentTraceRecentEntryDto[];
};

/** 清空 bucket 的结果（DELETE /api/agent/traces/[bucket]）。 */
export type AgentTraceClearResultDto = {
    ok: boolean;
};
