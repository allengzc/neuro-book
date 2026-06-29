import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULT_NAMESPACE_ALIASES} from "./namespaces";
import type {
    ActiveRuleRecord,
    DeclarativeRuleRecord,
    HandlerRuleRecord,
    LintRuleRecord,
    LoadedRules,
    LLMRuleRecord,
    NormalizedLlmlintConfig,
    RegistryDiagnostic,
    RegistrySummary,
    RegexRuleRecord,
    RuleLevel,
    RuleOverride,
    RulesetManifest,
} from "./types";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULESETS_ROOT = resolve(SKILL_ROOT, "rulesets");

type RegistryItem = {
    rule: ActiveRuleRecord;
    defaultEnabled: boolean;
};

/**
 * 加载 ruleset，合并成扁平 Rule Registry，并应用 ruleset / namespace / rule 覆盖。
 */
export async function loadRules(config: NormalizedLlmlintConfig): Promise<LoadedRules> {
    const diagnostics: RegistryDiagnostic[] = [];
    const registry = new Map<string, RegistryItem>();
    const namespaceAliases: Record<string, string> = {...DEFAULT_NAMESPACE_ALIASES};
    const loadedRulesets: string[] = [];

    for (const rulesetId of config.rulesets) {
        const rulesetSetting = config.rulesetOverrides[rulesetId];
        const manifest = await loadManifest(rulesetId);
        Object.assign(namespaceAliases, manifest.namespaceAliases ?? {});

        const rules = await loadRulesetRecords(manifest.id);
        let mergedRules = 0;
        let skippedByRulesetOff = 0;
        for (const rawRule of rules) {
            const normalized = normalizeRule(rawRule, manifest, namespaceAliases, diagnostics);
            if (!normalized) {
                continue;
            }
            if (rulesetSetting === "off" && !isExplicitlyEnabled(normalized, config, namespaceAliases)) {
                skippedByRulesetOff++;
                continue;
            }

            const previous = registry.get(normalized.id);
            if (previous) {
                diagnostics.push({
                    level: "warning",
                    code: "rule-override",
                    message: `规则 ${normalized.id} 被规则包 ${manifest.id} 覆盖；旧来源为 ${previous.rule.ruleset}。`,
                    ruleId: normalized.id,
                    namespace: normalized.namespace,
                    previousRuleset: previous.rule.ruleset,
                    nextRuleset: manifest.id,
                });
            }

            registry.set(normalized.id, {
                rule: normalized,
                defaultEnabled: normalized.enabled !== false,
            });
            mergedRules++;
        }

        if (rulesetSetting === "off") {
            diagnostics.push({
                level: "info",
                code: "ruleset-disabled",
                message: `规则包 ${manifest.id} 已被配置关闭，跳过 ${skippedByRulesetOff} 条规则，显式启用 ${mergedRules} 条规则。`,
                ruleset: manifest.id,
            });
        }
        if (rulesetSetting !== "off" || mergedRules > 0) {
            loadedRulesets.push(manifest.id);
        }
    }

    const activeRules = [...registry.values()]
        .flatMap((item) => applyConfig(item, config, namespaceAliases));
    const regexRules = activeRules.filter((rule): rule is RegexRuleRecord => rule.detector.type === "regex");
    const llmRules = activeRules.filter((rule): rule is LLMRuleRecord => rule.detector.type === "llm");

    return {
        rules: activeRules,
        regexRules,
        llmRules,
        diagnostics,
        summary: summarizeRegistry([...registry.values()], activeRules, loadedRulesets),
    };
}

export function normalizeNamespace(namespace: string, aliases: Record<string, string> = DEFAULT_NAMESPACE_ALIASES): string {
    return aliases[namespace] ?? namespace;
}

async function loadManifest(rulesetId: string): Promise<RulesetManifest> {
    const root = resolveRulesetRoot(rulesetId);
    const manifest = await readJson(resolve(root, "ruleset.json"));
    if (!isObject(manifest)) {
        throw new Error(`规则包 ${rulesetId} 的 ruleset.json 必须是对象。`);
    }
    const id = readRequiredString(manifest, "id", `规则包 ${rulesetId}.id`);
    const title = readRequiredString(manifest, "title", `规则包 ${rulesetId}.title`);
    const version = readRequiredString(manifest, "version", `规则包 ${rulesetId}.version`);
    const description = readOptionalString(manifest, "description", `规则包 ${rulesetId}.description`);
    const namespaceAliases = readOptionalStringRecord(manifest, "namespaceAliases", `规则包 ${rulesetId}.namespaceAliases`);
    if (id !== rulesetId) {
        throw new Error(`规则包路径 ${rulesetId} 与 manifest id ${id} 不一致。`);
    }
    return {id, title, version, description, namespaceAliases};
}

async function loadRulesetRecords(rulesetId: string): Promise<LintRuleRecord[]> {
    const root = resolveRulesetRoot(rulesetId);
    const rules = await readJson(resolve(root, "rules.json"));
    if (!Array.isArray(rules)) {
        throw new Error(`规则包 ${rulesetId} 的 rules.json 必须是数组。`);
    }
    return rules.map((rule, index) => validateRuleRecord(rule, `${rulesetId}.rules[${index}]`));
}

function normalizeRule(
    rule: LintRuleRecord,
    manifest: RulesetManifest,
    aliases: Record<string, string>,
    diagnostics: RegistryDiagnostic[],
): ActiveRuleRecord | null {
    if ("handler" in rule) {
        diagnostics.push({
            level: "warning",
            code: "handler-not-implemented",
            message: `规则 ${rule.id} 是 handler rule；llmlint v1 只登记诊断，不执行第三方 handler。`,
            ruleset: manifest.id,
            ruleId: rule.id,
            namespace: normalizeNamespace(rule.namespace, aliases),
        });
        return null;
    }

    const namespace = normalizeNamespace(rule.namespace, aliases);
    if (namespace !== rule.namespace) {
        diagnostics.push({
            level: "info",
            code: "namespace-alias",
            message: `namespace ${rule.namespace} 已归一化为 ${namespace}。`,
            ruleset: manifest.id,
            ruleId: rule.id,
            namespace,
        });
    }

    return {
        ...rule,
        namespace,
        ruleset: manifest.id,
    };
}

function applyConfig(item: RegistryItem, config: NormalizedLlmlintConfig, aliases: Record<string, string>): ActiveRuleRecord[] {
    const rulesetSetting = config.rulesetOverrides[item.rule.ruleset];
    let enabled = item.defaultEnabled;
    let level = item.rule.level;

    if (rulesetSetting === "on") {
        enabled = true;
    }

    const namespaceOverride = resolveNamespaceOverride(config.namespaces, item.rule.namespace, aliases);
    const namespaceResult = applyOverride(enabled, level, namespaceOverride);
    enabled = namespaceResult.enabled;
    level = namespaceResult.level;

    const ruleResult = applyOverride(enabled, level, config.rules[item.rule.id]);
    enabled = ruleResult.enabled;
    level = ruleResult.level;

    return enabled ? [{...item.rule, level}] : [];
}

function isExplicitlyEnabled(rule: ActiveRuleRecord, config: NormalizedLlmlintConfig, aliases: Record<string, string>): boolean {
    const ruleOverride = config.rules[rule.id];
    if (ruleOverride === "off") {
        return false;
    }
    if (ruleOverride) {
        return true;
    }
    const namespaceOverride = resolveNamespaceOverride(config.namespaces, rule.namespace, aliases);
    return namespaceOverride !== undefined && namespaceOverride !== "off";
}

function resolveNamespaceOverride(overrides: Record<string, RuleOverride>, namespace: string, aliases: Record<string, string>): RuleOverride | undefined {
    for (const [key, override] of Object.entries(overrides)) {
        if (normalizeNamespace(key, aliases) === namespace) {
            return override;
        }
    }
    return undefined;
}

function applyOverride(enabled: boolean, level: RuleLevel, override: RuleOverride | undefined): {enabled: boolean; level: RuleLevel} {
    if (!override) {
        return {enabled, level};
    }
    if (override === "off") {
        return {enabled: false, level};
    }
    return {
        enabled: true,
        level: normalizeLevel(override),
    };
}

function normalizeLevel(override: Exclude<RuleOverride, "off">): RuleLevel {
    if (override === "warn") {
        return "medium";
    }
    if (override === "error") {
        return "high";
    }
    return override;
}

function summarizeRegistry(items: RegistryItem[], activeRules: ActiveRuleRecord[], rulesets: string[]): RegistrySummary {
    const activeIds = new Set(activeRules.map((rule) => rule.id));
    const namespaceMap = new Map<string, {namespace: string; totalRules: number; activeRules: number}>();

    for (const item of items) {
        const current = namespaceMap.get(item.rule.namespace) ?? {
            namespace: item.rule.namespace,
            totalRules: 0,
            activeRules: 0,
        };
        current.totalRules++;
        if (activeIds.has(item.rule.id)) {
            current.activeRules++;
        }
        namespaceMap.set(item.rule.namespace, current);
    }

    return {
        rulesets,
        totalRules: items.length,
        activeRules: activeRules.length,
        disabledRules: items.length - activeRules.length,
        namespaces: [...namespaceMap.values()].sort((left, right) => left.namespace.localeCompare(right.namespace)),
    };
}

function resolveRulesetRoot(rulesetId: string): string {
    const root = resolve(RULESETS_ROOT, rulesetId);
    const relativePath = relative(RULESETS_ROOT, root);
    if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
        throw new Error(`规则包 ID 不允许跳出 rulesets 目录: ${rulesetId}`);
    }
    if (!existsSync(root)) {
        throw new Error(`规则包不存在: ${rulesetId}`);
    }
    return root;
}

async function readJson(filePath: string): Promise<unknown> {
    return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
}

function validateRuleRecord(value: unknown, fieldName: string): LintRuleRecord {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是规则对象。`);
    }

    const base = {
        id: readRequiredString(value, "id", `${fieldName}.id`),
        namespace: readRequiredString(value, "namespace", `${fieldName}.namespace`),
        ruleset: readOptionalString(value, "ruleset", `${fieldName}.ruleset`),
        title: readRequiredString(value, "title", `${fieldName}.title`),
        level: readRuleLevel(value.level, `${fieldName}.level`),
        enabled: readOptionalBoolean(value, "enabled", `${fieldName}.enabled`),
        note: readOptionalString(value, "note", `${fieldName}.note`),
        examples: readExamples(value.examples, `${fieldName}.examples`),
        source: readSource(value.source, `${fieldName}.source`),
    };

    if ("handler" in value) {
        const handler = readHandler(value.handler, `${fieldName}.handler`);
        return compactObject({...base, handler}) as LintRuleRecord;
    }

    const detector = readDetector(value.detector, `${fieldName}.detector`);
    const action = readAction(value.action, `${fieldName}.action`);
    return compactObject({...base, detector, action}) as LintRuleRecord;
}

function readDetector(value: unknown, fieldName: string): DeclarativeRuleRecord["detector"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 detector 对象。`);
    }
    if (value.type === "regex") {
        return {
            type: "regex",
            targets: readRequiredStringArray(value, "targets", `${fieldName}.targets`),
            flags: readOptionalString(value, "flags", `${fieldName}.flags`),
        };
    }
    if (value.type === "llm") {
        return {
            type: "llm",
            prompt: readRequiredString(value, "prompt", `${fieldName}.prompt`),
        };
    }
    throw new Error(`${fieldName}.type 必须是 regex 或 llm。`);
}

function readAction(value: unknown, fieldName: string): DeclarativeRuleRecord["action"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 action 对象。`);
    }
    if (value.type === "replace") {
        return {
            type: "replace",
            replacements: readReplacementArray(value, "replacements", `${fieldName}.replacements`),
        };
    }
    if (value.type === "suggest") {
        return {
            type: "suggest",
            message: readRequiredString(value, "message", `${fieldName}.message`),
        };
    }
    throw new Error(`${fieldName}.type 必须是 replace 或 suggest。`);
}

function readHandler(value: unknown, fieldName: string): HandlerRuleRecord["handler"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 handler 对象。`);
    }
    if (value.type !== "module") {
        throw new Error(`${fieldName}.type 第一版只支持 module。`);
    }
    const handlerPath = readRequiredString(value, "path", `${fieldName}.path`);
    if (handlerPath.includes("..") || handlerPath.startsWith("/") || handlerPath.startsWith("\\")) {
        throw new Error(`${fieldName}.path 必须是 ruleset 内部相对路径。`);
    }
    return {
        type: "module",
        path: handlerPath,
        export: readOptionalString(value, "export", `${fieldName}.export`),
    };
}

function readExamples(value: unknown, fieldName: string): BaseExample[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} 必须是数组。`);
    }
    return value.map((item, index) => {
        if (!isObject(item)) {
            throw new Error(`${fieldName}[${index}] 必须是对象。`);
        }
        return compactObject({
            bad: readRequiredString(item, "bad", `${fieldName}[${index}].bad`),
            good: readOptionalString(item, "good", `${fieldName}[${index}].good`),
            reason: readOptionalString(item, "reason", `${fieldName}[${index}].reason`),
        });
    });
}

type BaseExample = NonNullable<DeclarativeRuleRecord["examples"]>[number];

function readSource(value: unknown, fieldName: string): DeclarativeRuleRecord["source"] {
    if (value === undefined) {
        return undefined;
    }
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }
    for (const key of Object.keys(value)) {
        if (key !== "version" && key !== "canonicalKey" && key !== "importedFrom") {
            throw new Error(`${fieldName}.${key} 不是允许的 source 字段。`);
        }
    }
    return compactObject({
        version: readOptionalString(value, "version", `${fieldName}.version`),
        canonicalKey: readOptionalString(value, "canonicalKey", `${fieldName}.canonicalKey`),
        importedFrom: readOptionalString(value, "importedFrom", `${fieldName}.importedFrom`),
    });
}

function readRequiredString(value: Record<string, unknown>, key: string, fieldName: string): string {
    const raw = value[key];
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error(`${fieldName} 必须是非空字符串。`);
    }
    return raw;
}

function readOptionalString(value: Record<string, unknown>, key: string, fieldName: string): string | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw !== "string") {
        throw new Error(`${fieldName} 必须是字符串。`);
    }
    return raw;
}

function readOptionalBoolean(value: Record<string, unknown>, key: string, fieldName: string): boolean | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw !== "boolean") {
        throw new Error(`${fieldName} 必须是布尔值。`);
    }
    return raw;
}

function readRequiredStringArray(value: Record<string, unknown>, key: string, fieldName: string): string[] {
    const raw = value[key];
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        throw new Error(`${fieldName} 必须是字符串数组。`);
    }
    const normalized = raw.map((item) => item.trim()).filter((item) => item.length > 0);
    if (normalized.length === 0) {
        throw new Error(`${fieldName} 至少需要一个非空字符串。`);
    }
    return normalized;
}

function readReplacementArray(value: Record<string, unknown>, key: string, fieldName: string): string[] {
    const raw = value[key];
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        throw new Error(`${fieldName} 必须是字符串数组。`);
    }
    if (raw.length === 0) {
        throw new Error(`${fieldName} 至少需要一个字符串；删除规则使用空字符串。`);
    }
    return [...raw];
}

function readOptionalStringRecord(value: Record<string, unknown>, key: string, fieldName: string): Record<string, string> | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (!isObject(raw)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }
    const result: Record<string, string> = {};
    for (const [recordKey, recordValue] of Object.entries(raw)) {
        if (typeof recordValue !== "string" || recordValue.trim().length === 0) {
            throw new Error(`${fieldName}.${recordKey} 必须是非空字符串。`);
        }
        result[recordKey] = recordValue.trim();
    }
    return result;
}

function readRuleLevel(value: unknown, fieldName: string): RuleLevel {
    if (value !== "high" && value !== "medium" && value !== "low") {
        throw new Error(`${fieldName} 必须是 high、medium 或 low。`);
    }
    return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) {
            result[key] = item;
        }
    }
    return result as T;
}
