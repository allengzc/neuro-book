import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

export type ModelCostDraft = {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
};

/**
 * 创建空价格草稿；空字段表示继承 Pi registry，价格单位固定为 USD / 1M tokens。
 */
export function createEmptyModelCostDraft(): ModelCostDraft {
    return {
        input: "",
        output: "",
        cacheRead: "",
        cacheWrite: "",
    };
}

/**
 * 从已保存的 USD 价格创建编辑草稿。
 */
export function createModelCostDraft(cost: ConfiguredModelDto["cost"]): ModelCostDraft {
    if (!cost) {
        return createEmptyModelCostDraft();
    }
    return {
        input: formatDraftNumber(cost.input),
        output: formatDraftNumber(cost.output),
        cacheRead: formatDraftNumber(cost.cacheRead),
        cacheWrite: formatDraftNumber(cost.cacheWrite),
    };
}

/**
 * 清空价格覆盖，恢复继承 Pi registry。
 */
export function clearModelCostDraft(cost: ModelCostDraft): void {
    cost.input = "";
    cost.output = "";
    cost.cacheRead = "";
    cost.cacheWrite = "";
}

/**
 * 判断当前草稿是否显式覆盖价格。
 */
export function hasModelCostOverride(cost: ModelCostDraft): boolean {
    return [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].some((value) => value.trim().length > 0);
}

/**
 * 将价格草稿解析为保存用 USD / 1M tokens；空草稿表示继承 Pi registry。
 */
export function parseModelCostDraft(cost: ModelCostDraft): ConfiguredModelDto["cost"] {
    if (!hasModelCostOverride(cost)) {
        return null;
    }

    return {
        input: normalizePrice(readPrice(cost.input)),
        output: normalizePrice(readPrice(cost.output)),
        cacheRead: normalizePrice(readPrice(cost.cacheRead)),
        cacheWrite: normalizePrice(readPrice(cost.cacheWrite)),
    };
}

/**
 * 保持价格输入框里的数字可读，避免 JSON 序列化格式污染 UI。
 */
function formatDraftNumber(value: number): string {
    return Number.isFinite(value) ? String(value) : "";
}

/**
 * 读取非负价格；未填或非法字段按 0 保存。
 */
function readPrice(value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        return 0;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * 抹平汇率换算后的二进制浮点尾差，保持配置可读。
 */
function normalizePrice(value: number): number {
    return Number(value.toFixed(12));
}
