import {existsSync} from "node:fs";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type {LlmlintConfig, LlmlintOutput, NormalizedLlmlintConfig, RuleOverride, RulesetOverride} from "./types";

const DEFAULT_CONFIG: NormalizedLlmlintConfig = {
    rulesets: ["builtin/default"],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {},
    rules: {},
    output: "stylish",
};

const VALID_RULE_OVERRIDES = new Set<RuleOverride>(["off", "warn", "error", "high", "medium", "low"]);
const VALID_RULESET_OVERRIDES = new Set<RulesetOverride>(["off", "on"]);
const VALID_OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);

export type LoadedConfig = {
    config: NormalizedLlmlintConfig;
    configPath: string | null;
};

/**
 * 加载 llmlint 配置。显式 --config 缺失时报错；未显式配置时使用默认 ruleset。
 */
export async function loadConfig(options: {cwd: string; configPath?: string}): Promise<LoadedConfig> {
    const explicitPath = options.configPath?.trim();
    const configPath = explicitPath
        ? resolve(options.cwd, explicitPath)
        : findConfigPath(options.cwd);

    if (!configPath) {
        return {config: cloneDefaultConfig(), configPath: null};
    }

    if (!existsSync(configPath)) {
        throw new Error(`配置文件不存在: ${configPath}`);
    }

    const imported = await import(pathToFileURL(configPath).href);
    const rawConfig = imported.default ?? imported.config;
    if (!isConfigObject(rawConfig)) {
        throw new Error(`配置文件必须 default export 一个对象: ${configPath}`);
    }

    return {
        config: normalizeConfig(rawConfig),
        configPath,
    };
}

function findConfigPath(cwd: string): string | null {
    let current = resolve(cwd);
    while (true) {
        const candidate = join(current, "llmlint.config.ts");
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = dirname(current);
        if (parent === current || !isAbsolute(parent)) {
            return null;
        }
        current = parent;
    }
}

function normalizeConfig(config: LlmlintConfig): NormalizedLlmlintConfig {
    return {
        rulesets: normalizeStringArray(config.rulesets, DEFAULT_CONFIG.rulesets, "rulesets"),
        trustedRulesets: normalizeStringArray(config.trustedRulesets, DEFAULT_CONFIG.trustedRulesets, "trustedRulesets"),
        rulesetOverrides: normalizeRulesetOverrides(config.rulesetOverrides),
        namespaces: normalizeRuleOverrides(config.namespaces, "namespaces"),
        rules: normalizeRuleOverrides(config.rules, "rules"),
        output: normalizeOutput(config.output),
    };
}

function cloneDefaultConfig(): NormalizedLlmlintConfig {
    return {
        rulesets: [...DEFAULT_CONFIG.rulesets],
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        output: DEFAULT_CONFIG.output,
    };
}

function normalizeRulesetOverrides(value: LlmlintConfig["rulesetOverrides"]): Record<string, RulesetOverride> {
    if (value === undefined) {
        return {};
    }
    if (!isConfigObject(value)) {
        throw new Error("配置 rulesetOverrides 必须是对象。");
    }

    const normalized: Record<string, RulesetOverride> = {};
    for (const [rulesetId, override] of Object.entries(value)) {
        if (!VALID_RULESET_OVERRIDES.has(override as RulesetOverride)) {
            throw new Error(`规则包 ${rulesetId} 的覆盖值无效: ${String(override)}`);
        }
        normalized[rulesetId] = override as RulesetOverride;
    }
    return normalized;
}

function normalizeRuleOverrides(value: Record<string, RuleOverride> | undefined, fieldName: string): Record<string, RuleOverride> {
    if (value === undefined) {
        return {};
    }
    if (!isConfigObject(value)) {
        throw new Error(`配置 ${fieldName} 必须是对象。`);
    }

    const normalized: Record<string, RuleOverride> = {};
    for (const [key, override] of Object.entries(value)) {
        if (!VALID_RULE_OVERRIDES.has(override as RuleOverride)) {
            throw new Error(`${fieldName} ${key} 的覆盖值无效: ${String(override)}`);
        }
        normalized[key] = override as RuleOverride;
    }
    return normalized;
}

function normalizeStringArray(value: string[] | undefined, fallback: string[], fieldName: string): string[] {
    if (value === undefined) {
        return [...fallback];
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
        throw new Error(`配置 ${fieldName} 必须是非空字符串数组。`);
    }
    return value.map((item) => item.trim());
}

function normalizeOutput(output: LlmlintConfig["output"]): LlmlintOutput {
    if (output === undefined) {
        return DEFAULT_CONFIG.output;
    }
    if (!VALID_OUTPUTS.has(output)) {
        throw new Error(`配置 output 无效: ${String(output)}`);
    }
    return output;
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
