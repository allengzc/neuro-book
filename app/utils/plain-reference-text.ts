import {parseReferenceLink} from "nbook/shared/reference-link";
import {parseWorkspaceReferenceLink} from "nbook/shared/workspace-reference";
import {parseReferenceUri} from "nbook/shared/reference-core";

export interface PlainReferenceNodeAttrs {
    label: string;
    target: string;
}

export interface PlainSkillNodeAttrs {
    name: string;
}

export interface PlainTextProseMirrorNode {
    type: string;
    text?: string;
    attrs?: Record<string, string>;
    content?: PlainTextProseMirrorNode[];
}

export interface PlainTextToken {
    kind: "text" | "reference" | "skill";
    raw: string;
    reference?: PlainReferenceNodeAttrs;
    skill?: PlainSkillNodeAttrs;
}

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const SKILL_PATTERN = /(^|[\s(])(\$(?:([\p{L}_-][\p{L}\p{N}_-]*)|\{([\p{L}_-][\p{L}\p{N}_-]*)\}))/gu;
const WORKSPACE_REFERENCE_PREFIXES = [
    "agent-context/",
    "assets/",
    "docs/",
    "lorebook/",
    "manuscript/",
    "reference/",
    "simulation/",
    "workspace/",
    ".agent/",
    ".nbook/agent/",
];

/**
 * 将普通文本解析成 plain reference editor 使用的 ProseMirror doc。
 */
export function parsePlainReferenceText(value: string): PlainTextProseMirrorNode {
    const paragraphs = value.split(/\n/);
    return {
        type: "doc",
        content: paragraphs.map((paragraph) => ({
            type: "paragraph",
            content: tokensToNodes(tokenizePlainReferenceText(paragraph)),
        })),
    };
}

/**
 * 将普通文本解析成可直接插入当前光标的 inline content。
 */
export function parsePlainReferenceInlineContent(value: string): PlainTextProseMirrorNode[] {
    const lines = value.split(/\n/);
    return lines.flatMap((line, index) => {
        const nodes = tokensToNodes(tokenizePlainReferenceText(line));
        if (index >= lines.length - 1) {
            return nodes;
        }
        return [...nodes, {type: "hardBreak"}];
    });
}

/**
 * 将 plain reference editor 的 ProseMirror doc 序列化回普通文本。
 */
export function serializePlainReferenceDoc(doc: PlainTextProseMirrorNode): string {
    if (doc.type === "doc") {
        return (doc.content ?? []).map(serializePlainReferenceDoc).join("\n");
    }
    if (doc.type === "paragraph") {
        return (doc.content ?? []).map(serializePlainReferenceDoc).join("");
    }
    if (doc.type === "text") {
        return doc.text ?? "";
    }
    if (doc.type === "hardBreak") {
        return "\n";
    }
    if (doc.type === "plainReference") {
        const label = doc.attrs?.label ?? "";
        const target = doc.attrs?.target ?? "";
        return label && target ? `[${label}](${target})` : "";
    }
    if (doc.type === "agentSkill") {
        const name = doc.attrs?.name ?? "";
        return name ? `$${name}` : "";
    }
    return (doc.content ?? []).map(serializePlainReferenceDoc).join("");
}

/**
 * 把普通文本切分成文本、系统引用和 skill token。
 */
export function tokenizePlainReferenceText(value: string): PlainTextToken[] {
    const referenceMatches = collectReferenceMatches(value);
    const skillMatches = collectSkillMatches(value, referenceMatches);
    const matches = [...referenceMatches, ...skillMatches].sort((left, right) => left.start - right.start);
    const tokens: PlainTextToken[] = [];
    let cursor = 0;

    for (const match of matches) {
        if (match.start < cursor) {
            continue;
        }
        if (match.start > cursor) {
            const raw = value.slice(cursor, match.start);
            tokens.push({kind: "text", raw});
        }
        tokens.push(match.token);
        cursor = match.end;
    }

    if (cursor < value.length) {
        tokens.push({kind: "text", raw: value.slice(cursor)});
    }
    return tokens;
}

function tokensToNodes(tokens: PlainTextToken[]): PlainTextProseMirrorNode[] {
    return tokens
        .map((token): PlainTextProseMirrorNode | null => {
            if (token.kind === "text") {
                return token.raw ? {type: "text", text: token.raw} : null;
            }
            if (token.kind === "reference" && token.reference) {
                return {
                    type: "plainReference",
                    attrs: {
                        label: token.reference.label,
                        target: token.reference.target,
                    },
                };
            }
            if (token.kind === "skill" && token.skill) {
                return {
                    type: "agentSkill",
                    attrs: {
                        name: token.skill.name,
                    },
                };
            }
            return null;
        })
        .filter((node): node is PlainTextProseMirrorNode => node !== null);
}

interface TokenMatch {
    start: number;
    end: number;
    token: PlainTextToken;
}

function collectReferenceMatches(value: string): TokenMatch[] {
    const matches: TokenMatch[] = [];
    for (const matched of value.matchAll(MARKDOWN_LINK_PATTERN)) {
        const raw = matched[0] ?? "";
        const start = matched.index ?? -1;
        if (start < 0 || !raw) {
            continue;
        }
        const reference = resolveReferenceToken(raw);
        if (!reference) {
            continue;
        }
        matches.push({
            start,
            end: start + raw.length,
            token: {
                kind: "reference",
                raw,
                reference,
            },
        });
    }
    return matches;
}

function collectSkillMatches(value: string, referenceMatches: TokenMatch[]): TokenMatch[] {
    const matches: TokenMatch[] = [];
    for (const matched of value.matchAll(SKILL_PATTERN)) {
        const prefix = matched[1] ?? "";
        const raw = matched[2] ?? "";
        const start = (matched.index ?? -1) + prefix.length;
        const name = matched[3] ?? matched[4] ?? "";
        if (start < 0 || !raw || !name || isInsideToken(start, referenceMatches)) {
            continue;
        }
        matches.push({
            start,
            end: start + raw.length,
            token: {
                kind: "skill",
                raw,
                skill: {name},
            },
        });
    }
    return matches;
}

function resolveReferenceToken(raw: string): PlainReferenceNodeAttrs | null {
    const domainReference = parseReferenceLink(raw);
    if (domainReference) {
        return {
            label: domainReference.title,
            target: `${domainReference.kind}://${domainReference.targetId}`,
        };
    }

    const workspaceReference = parseWorkspaceReferenceLink(raw);
    if (!workspaceReference || !isSystemWorkspaceReferenceTarget(workspaceReference.target)) {
        return null;
    }
    return {
        label: workspaceReference.label,
        target: workspaceReference.target,
    };
}

function isSystemWorkspaceReferenceTarget(target: string): boolean {
    const normalized = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
        return false;
    }
    if (parseReferenceUri(normalized)) {
        return true;
    }
    return WORKSPACE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isInsideToken(position: number, matches: TokenMatch[]): boolean {
    return matches.some((match) => position >= match.start && position < match.end);
}
