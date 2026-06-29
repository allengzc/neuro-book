import type {Issue, RegexRuleRecord} from "./types";

/**
 * 使用 regex detector 扫描全文。命中只表示候选，是否修复仍由 Agent 结合上下文判断。
 */
export function scanText(content: string, rules: RegexRuleRecord[]): Issue[] {
    const lineStarts = buildLineStarts(content);
    const issues: Issue[] = [];

    for (const rule of rules) {
        for (const target of rule.detector.targets) {
            let regex: RegExp;
            try {
                regex = new RegExp(target, ensureGlobalFlags(rule.detector.flags));
            } catch (error) {
                throw new Error(`规则 ${rule.id} 的正则无效: ${error instanceof Error ? error.message : String(error)}`);
            }

            let match: RegExpExecArray | null;
            while ((match = regex.exec(content)) !== null) {
                const position = locatePosition(lineStarts, match.index);
                issues.push({
                    rule,
                    line: position.line,
                    column: position.column,
                    match: match[0],
                    target,
                    context: extractContext(content, match.index, match[0].length),
                });

                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        }
    }

    return issues;
}

function ensureGlobalFlags(flags: string | undefined): string {
    const merged = new Set((flags ?? "").split("").filter((flag) => flag.length > 0));
    merged.add("g");
    return [...merged].join("");
}

function buildLineStarts(content: string): number[] {
    const lineStarts = [0];
    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            lineStarts.push(index + 1);
        }
    }
    return lineStarts;
}

function locatePosition(lineStarts: number[], index: number): {line: number; column: number} {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const lineStart = lineStarts[middle] ?? 0;
        if (lineStart <= index) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    const lineIndex = Math.max(0, high);
    const lineStart = lineStarts[lineIndex] ?? 0;
    return {
        line: lineIndex + 1,
        column: index - lineStart + 1,
    };
}

function extractContext(content: string, matchIndex: number, matchLength: number): Issue["context"] {
    const matchEnd = matchIndex + matchLength;
    const lineStart = content.lastIndexOf("\n", Math.max(0, matchIndex - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", matchEnd);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;

    return {
        before: renderInline(content.substring(Math.max(lineStart, matchIndex - 20), matchIndex)),
        current: renderInline(content.substring(matchIndex, matchEnd)),
        after: renderInline(content.substring(matchEnd, Math.min(lineEnd, matchEnd + 20))),
    };
}

function renderInline(text: string): string {
    return text
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}
