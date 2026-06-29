export type RuleLevel = "high" | "medium" | "low";

export type RuleOverride = "off" | "warn" | "error" | RuleLevel;

export type RulesetOverride = "off" | "on";

export type LlmlintOutput = "stylish" | "json";

export type LlmlintConfig = {
    /** 启用的规则包。为空时默认使用 builtin/default。 */
    rulesets?: string[];
    /** 允许加载未来 handler rule 的规则包；v1 仍不执行 handler。 */
    trustedRulesets?: string[];
    /** 按规则包启停。 */
    rulesetOverrides?: Record<string, RulesetOverride>;
    /** 按 namespace 批量关闭或调整级别；支持中文 alias。 */
    namespaces?: Record<string, RuleOverride>;
    /** 按规则 ID 覆盖级别；off 表示禁用该规则。 */
    rules?: Record<string, RuleOverride>;
    output?: LlmlintOutput;
};

export type NormalizedLlmlintConfig = {
    rulesets: string[];
    trustedRulesets: string[];
    rulesetOverrides: Record<string, RulesetOverride>;
    namespaces: Record<string, RuleOverride>;
    rules: Record<string, RuleOverride>;
    output: LlmlintOutput;
};

export type RulesetManifest = {
    id: string;
    title: string;
    version: string;
    description?: string;
    namespaceAliases?: Record<string, string>;
};

export type LintRuleRecord = DeclarativeRuleRecord | HandlerRuleRecord;

export type BaseLintRuleRecord = {
    id: string;
    namespace: string;
    /** 规则包来源由 loader 写入，规则文件中可省略。 */
    ruleset?: string;
    title: string;
    level: RuleLevel;
    enabled?: boolean;
    note?: string;
    examples?: Array<{
        bad: string;
        good?: string;
        reason?: string;
    }>;
    source?: {
        version?: string;
        canonicalKey?: string;
        importedFrom?: string;
    };
};

export type RegexDetector = {
    type: "regex";
    targets: string[];
    flags?: string;
};

export type LLMDetector = {
    type: "llm";
    prompt: string;
};

export type DeclarativeRuleRecord = BaseLintRuleRecord & {
    detector: RegexDetector | LLMDetector;
    action:
        | {type: "replace"; replacements: string[]}
        | {type: "suggest"; message: string};
};

export type HandlerRuleRecord = BaseLintRuleRecord & {
    handler: {
        type: "module";
        path: string;
        export?: string;
    };
};

export type ActiveRuleRecord = DeclarativeRuleRecord & {
    ruleset: string;
};

export type RegexRuleRecord = ActiveRuleRecord & {
    detector: RegexDetector;
};

export type LLMRuleRecord = ActiveRuleRecord & {
    detector: LLMDetector;
};

export type RegistryDiagnostic = {
    level: "info" | "warning" | "error";
    code: string;
    message: string;
    ruleset?: string;
    ruleId?: string;
    namespace?: string;
    previousRuleset?: string;
    nextRuleset?: string;
};

export type RegistrySummary = {
    rulesets: string[];
    totalRules: number;
    activeRules: number;
    disabledRules: number;
    namespaces: Array<{
        namespace: string;
        totalRules: number;
        activeRules: number;
    }>;
};

export type LoadedRules = {
    rules: ActiveRuleRecord[];
    regexRules: RegexRuleRecord[];
    llmRules: LLMRuleRecord[];
    diagnostics: RegistryDiagnostic[];
    summary: RegistrySummary;
};

export interface Issue {
    rule: RegexRuleRecord;
    line: number;
    column: number;
    match: string;
    target: string;
    context: {
        before: string;
        current: string;
        after: string;
    };
}

export type CheckSummary = {
    total: number;
    high: number;
    medium: number;
    low: number;
};

export type CheckJsonReport = {
    kind: "check";
    filePath: string;
    configPath: string | null;
    summary: CheckSummary;
    registry: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    issues: Issue[];
};

export type LLMRulesJsonReport = {
    kind: "llm-rules";
    configPath: string | null;
    registry: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    rules: LLMRuleRecord[];
};

export type CuratedRulesetReport = {
    rulesetId: string;
    outputRoot: string;
    sourceFiles: string[];
    originalTargets: number;
    rules: number;
    activeRules: number;
    converted: {
        text: number;
        simple: number;
        regex: number;
    };
    replacementConflicts: number;
};

export type CuratedImportJsonReport = {
    kind: "curated-import";
    sourceRoot: string;
    outputRoot: string;
    sourceFiles: number;
    originalTargets: number;
    uniqueRules: number;
    converted: {
        text: number;
        simple: number;
        regex: number;
    };
    skipped: Array<{
        file: string;
        group: string;
        reason: string;
        target?: string;
    }>;
    rulesets: CuratedRulesetReport[];
};
