import type {JsonValue} from "nbook/server/agent/types";

/**
 * 稳定序列化 JSON 值。
 * 用于比较变量是否发生真实变化。
 */
export function stableStringifyJsonValue(value: JsonValue | undefined): string {
    if (value === undefined) {
        return "__undefined__";
    }
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringifyJsonValue(item)).join(",")}]`;
    }
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringifyJsonValue(value[key])}`).join(",")}}`;
}
