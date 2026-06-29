import type {CheckJsonReport, CheckSummary, Issue, LLMRuleRecord, LLMRulesJsonReport, LoadedRules, RegistryDiagnostic} from "./types";

export function formatCheckReport(filePath: string, issues: Issue[], loadedRules: LoadedRules): string {
    const lines: string[] = [
        filePath,
        "",
        ...formatDiagnostics(loadedRules.diagnostics),
    ];
    if (issues.length === 0) {
        lines.push("✓ No problems found");
        return lines.join("\n");
    }

    const grouped = groupByRule(issues);
    const summary = summarizeIssues(issues);

    for (const ruleIssues of grouped.values()) {
        const firstIssue = ruleIssues[0];
        if (!firstIssue) {
            continue;
        }
        const rule = firstIssue.rule;
        lines.push(`${rule.id} [${rule.namespace}] (${rule.title})`);
        lines.push(`  来源：${rule.ruleset}；级别：${rule.level}`);

        for (const issue of ruleIssues) {
            const linePrefix = `  ${issue.line}:${issue.column}  `;
            lines.push(`${linePrefix}${issue.context.before}${issue.context.current}${issue.context.after}`.trimEnd());
            lines.push(`${" ".repeat(linePrefix.length + issue.context.before.length)}${"^".repeat(Math.max(1, issue.context.current.length))}`);
            lines.push("");
        }

        const occurrenceText = ruleIssues.length === 1 ? "occurrence" : "occurrences";
        lines.push(`  ${ruleIssues.length} ${occurrenceText}. ${formatAction(rule.action)}`);
        if (rule.note) {
            lines.push(`  说明：${rule.note}`);
        }
        lines.push("");
    }

    const parts = [];
    if (summary.high > 0) parts.push(`${summary.high} high`);
    if (summary.medium > 0) parts.push(`${summary.medium} medium`);
    if (summary.low > 0) parts.push(`${summary.low} low`);
    lines.push(`✖ ${summary.total} problem${summary.total > 1 ? "s" : ""} (${parts.join(", ")})`);

    return lines.join("\n");
}

export function createCheckJsonReport(filePath: string, configPath: string | null, issues: Issue[], loadedRules: LoadedRules): CheckJsonReport {
    return {
        kind: "check",
        filePath,
        configPath,
        summary: summarizeIssues(issues),
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        issues,
    };
}

export function createLLMRulesJsonReport(configPath: string | null, loadedRules: LoadedRules): LLMRulesJsonReport {
    return {
        kind: "llm-rules",
        configPath,
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        rules: loadedRules.llmRules,
    };
}

export function formatJsonReport(report: CheckJsonReport | LLMRulesJsonReport): string {
    return JSON.stringify(report, null, 2);
}

export function formatLLMRules(rules: LLMRuleRecord[], diagnostics: RegistryDiagnostic[]): string {
    const lines: string[] = [
        ...formatDiagnostics(diagnostics),
        "LLM 判断规则",
        "",
        "说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。",
        "",
    ];

    if (rules.length === 0) {
        lines.push("当前没有启用需要全文语义审查的 LLM 规则。");
        return lines.join("\n");
    }

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
        const rule = rules[ruleIndex];
        if (!rule) {
            continue;
        }
        lines.push(`规则 ${ruleIndex + 1}: ${rule.id} - ${rule.title}`);
        lines.push("");
        lines.push(`namespace: ${rule.namespace}`);
        lines.push("");
        lines.push(`来源: ${rule.ruleset}`);
        lines.push("");
        lines.push(`级别: ${rule.level}`);
        lines.push("");
        if (rule.note) {
            lines.push(`说明: ${rule.note}`);
            lines.push("");
        }
        lines.push("判断标准:");
        lines.push("");
        lines.push(rule.detector.prompt);
        lines.push("");

        if (rule.examples && rule.examples.length > 0) {
            lines.push("判断示例:");
            lines.push("");
            for (let i = 0; i < rule.examples.length; i++) {
                const example = rule.examples[i];
                if (!example) {
                    continue;
                }
                lines.push(`示例 ${i + 1}:`);
                lines.push("");
                lines.push(`坏例: ${example.bad}`);
                if (example.good) {
                    lines.push("");
                    lines.push(`好例: ${example.good}`);
                }
                if (example.reason) {
                    lines.push("");
                    lines.push(`理由: ${example.reason}`);
                }
                lines.push("");
            }
        }

        lines.push("----");
        lines.push("");
    }

    return lines.join("\n");
}

export function hasHighLevelIssue(issues: Issue[]): boolean {
    return issues.some((issue) => issue.rule.level === "high");
}

function formatDiagnostics(diagnostics: RegistryDiagnostic[]): string[] {
    const visible = diagnostics.filter((diagnostic) => diagnostic.level !== "info");
    if (visible.length === 0) {
        return [];
    }
    return [
        "规则加载提示：",
        ...visible.map((diagnostic) => `  [${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}`),
        "",
    ];
}

function formatAction(action: Issue["rule"]["action"]): string {
    if (action.type === "suggest") {
        return `建议：${action.message}`;
    }
    if (action.replacements.length === 1 && action.replacements[0] === "") {
        return "建议删除。";
    }
    const replacements = action.replacements
        .map((replacement) => replacement === "" ? "删除" : replacement)
        .join(" / ");
    return `替换候选：${replacements}`;
}

function summarizeIssues(issues: Issue[]): CheckSummary {
    const summary: CheckSummary = {total: issues.length, high: 0, medium: 0, low: 0};
    for (const issue of issues) {
        summary[issue.rule.level]++;
    }
    return summary;
}

function groupByRule(issues: Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();
    for (const issue of issues) {
        const current = grouped.get(issue.rule.id) ?? [];
        current.push(issue);
        grouped.set(issue.rule.id, current);
    }
    return grouped;
}
