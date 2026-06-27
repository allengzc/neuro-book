import type { WorldApi } from "nbook/server/world-engine/codeact-sandbox";
import type { SubjectState, Instant, JsonValue } from "nbook/server/world-engine/types";
import type { WorldEngineService } from "nbook/server/world-engine/world-engine.service";
import type { WorldEngineRepository } from "nbook/server/world-engine/world-engine.repository";

/**
 * CodeAct World API 实现。
 *
 * 为 Agent 查询代码提供统一的 world API，封装底层 WorldEngineService。
 *
 * 核心功能：
 * - get / getMany / list：查询 subject 状态
 * - findRefs：反向查找引用关系
 * - searchText：向量搜索（复用 RAG 实现）
 * - vectorize：显式触发向量化
 * - slices / now：时间轴操作
 *
 * 解引用：
 * - deref=true 时自动解引用 `subject://id`
 * - derefDepth 控制递归深度（默认 1，最大 5）
 * - 循环引用防护（visited Set）
 */

const MAX_DEREF_DEPTH = 5;

export type WorldApiOptions = {
    /** World Engine Service 实例 */
    service: WorldEngineService;
    /** World Engine Repository 实例 */
    repository: WorldEngineRepository;
    /** 当前时间（用于 now() 和查询默认时间）*/
    currentInstant: Instant;
};

/**
 * 创建 CodeAct World API 实例。
 */
export function createWorldApi(options: WorldApiOptions): WorldApi {
    const { service, repository, currentInstant } = options;

    return {
        /**
         * 查询单个 subject 的状态。
         *
         * @param id - Subject ID
         * @param options.deref - 是否自动解引用（默认 false）
         * @param options.derefDepth - 解引用深度（默认 1，最大 5）
         * @returns Subject 状态，不存在时返回 null
         */
        async get(id: string, options?: { deref?: boolean; derefDepth?: number }) {
            const result = await service.queryState({
                subjectIds: [id],
                at: currentInstant,
            });

            if (result.subjects.length === 0) {
                return null;
            }

            const subject = result.subjects[0];
            if (!subject) {
                return null;
            }

            if (options?.deref) {
                const depth = options.derefDepth ?? 1;
                return await derefSubject(subject, depth, new Set([id]), service, currentInstant);
            }

            return subject.attrs;
        },

        /**
         * 批量查询多个 subject 的状态。
         *
         * @param ids - Subject ID 列表
         * @returns Subject 状态列表（不存在的返回 null）
         */
        async getMany(ids: string[]) {
            if (ids.length === 0) {
                return [];
            }

            const result = await service.queryState({
                subjectIds: ids,
                at: currentInstant,
            });

            const stateMap = new Map<string, SubjectState>();
            for (const subject of result.subjects) {
                stateMap.set(subject.subjectId, subject);
            }

            return ids.map((id) => {
                const subject = stateMap.get(id);
                return subject ? subject.attrs : null;
            });
        },

        /**
         * 列出指定类型的所有 subject。
         *
         * @param type - Subject 类型
         * @returns Subject 列表（id + name）
         */
        async list(type: string) {
            return await service.listSubjects({ type });
        },

        /**
         * 反向查找：哪些 subject 引用了目标 subject。
         *
         * @param targetId - 目标 Subject ID
         * @param sourceType - 可选：限定源 subject 类型
         * @returns 引用列表（subjectId + attr）
         */
        async findRefs(targetId: string, sourceType?: string) {
            // 查询所有 subject（或指定类型）
            const subjects = await repository.listSubjects({
                type: sourceType,
            });

            const refs: Array<{ subjectId: string; attr: string }> = [];

            // 遍历所有 subject，查询它们的状态
            for (const subject of subjects) {
                const result = await service.queryState({
                    subjectIds: [subject.id],
                    at: currentInstant,
                });

                if (result.subjects.length === 0) {
                    continue;
                }

                const state = result.subjects[0];
                if (!state) {
                    continue;
                }

                // 递归查找引用
                const foundRefs = findRefsInValue(state.attrs, targetId);
                for (const attr of foundRefs) {
                    refs.push({
                        subjectId: subject.id,
                        attr,
                    });
                }
            }

            return refs;
        },

        /**
         * 向量搜索（Decision #8）。只读：在内存对未向量化命中即时 embed，不落库。
         *
         * @param options.k - top-k（默认 10）
         * @param options.threshold - 相似度下限
         * @param options.types - 限定 subject type
         * @param options.attrs - 限定 embedding 字段（memory / events）
         * @param options.at - time-travel：只搜该时刻前的世界
         * @returns 相似度降序 [{ subjectId, attr, text, score }]
         */
        async searchText(query: string, options?: { k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint }) {
            return await service.searchText(query, options ?? {});
        },

        /**
         * 查询时间轴切面列表。
         *
         * @param options.from - 起始时间（inclusive）
         * @param options.to - 结束时间（inclusive）
         * @param options.limit - 最大返回数量
         * @returns 切面列表
         */
        async slices(options?: { from?: Instant; to?: Instant; limit?: number }) {
            return await service.listSlices({
                from: options?.from,
                to: options?.to,
                limit: options?.limit,
            });
        },

        /**
         * 获取当前时间。
         *
         * @returns 当前 instant
         */
        now() {
            return currentInstant;
        },
    };
}

/**
 * 在值中递归查找引用。
 *
 * @param value - 要搜索的值
 * @param targetId - 目标 subject ID
 * @param prefix - 当前路径前缀
 * @returns 找到引用的属性路径列表
 */
function findRefsInValue(value: JsonValue, targetId: string, prefix = ""): string[] {
    const refs: string[] = [];
    const targetRef = `subject://${targetId}`;

    // 字符串：检查是否为目标引用
    if (typeof value === "string" && value === targetRef) {
        refs.push(prefix || ".");
        return refs;
    }

    // 数组：递归搜索元素
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const itemRefs = findRefsInValue(value[i] ?? null, targetId, prefix ? `${prefix}[${i}]` : `[${i}]`);
            refs.push(...itemRefs);
        }
        return refs;
    }

    // 对象：递归搜索属性
    if (typeof value === "object" && value !== null) {
        for (const [key, subValue] of Object.entries(value)) {
            const itemRefs = findRefsInValue(subValue, targetId, prefix ? `${prefix}.${key}` : key);
            refs.push(...itemRefs);
        }
        return refs;
    }

    return refs;
}

/**
 * 解引用 subject 的引用字段。
 *
 * @param subject - Subject 状态
 * @param depth - 剩余解引用深度
 * @param visited - 已访问的 subject ID（防循环引用）
 * @param service - World Engine Service
 * @param at - 查询时间
 * @returns 解引用后的 attrs
 */
async function derefSubject(
    subject: SubjectState,
    depth: number,
    visited: Set<string>,
    service: WorldEngineService,
    at: Instant,
): Promise<Record<string, JsonValue>> {
    if (depth > MAX_DEREF_DEPTH) {
        throw new Error(`解引用深度超过限制（最大 ${MAX_DEREF_DEPTH}）`);
    }

    if (depth === 0) {
        return subject.attrs;
    }

    const result: Record<string, JsonValue> = {};

    for (const [key, value] of Object.entries(subject.attrs)) {
        result[key] = await derefValue(value, depth, visited, service, at);
    }

    return result;
}

/**
 * 递归解引用单个值。
 */
async function derefValue(
    value: JsonValue,
    depth: number,
    visited: Set<string>,
    service: WorldEngineService,
    at: Instant,
): Promise<JsonValue> {
    // 字符串：检查是否为引用
    if (typeof value === "string" && value.startsWith("subject://")) {
        const targetId = value.replace("subject://", "");

        // 循环引用防护
        if (visited.has(targetId)) {
            return { __ref: value, __circular: true };
        }

        // 查询目标 subject
        const targetResult = await service.queryState({
            subjectIds: [targetId],
            at,
        });

        if (targetResult.subjects.length === 0) {
            // 引用目标不存在
            return { __ref: value, __missing: true };
        }

        const targetSubject = targetResult.subjects[0];
        if (!targetSubject) {
            return {__ref: value, __missing: true};
        }
        visited.add(targetId);

        // 递归解引用
        const derefed = await derefSubject(targetSubject, depth - 1, visited, service, at);

        // 保留原始引用信息
        return {
            __ref: value,
            ...derefed,
        };
    }

    // 数组：递归解引用元素
    if (Array.isArray(value)) {
        const result: JsonValue[] = [];
        for (const item of value) {
            result.push(await derefValue(item, depth, visited, service, at));
        }
        return result;
    }

    // 对象：递归解引用属性
    if (typeof value === "object" && value !== null) {
        const result: Record<string, JsonValue> = {};
        for (const [key, subValue] of Object.entries(value)) {
            result[key] = await derefValue(subValue, depth, visited, service, at);
        }
        return result;
    }

    // 其他类型：原样返回
    return value;
}
