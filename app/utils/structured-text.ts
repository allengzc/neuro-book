import {parseReferenceLink} from "nbook/shared/reference-link";
import {parseMarkdownInlineComment} from "nbook/shared/markdown-workbench";
import {parseWorkspaceReferenceLink} from "nbook/shared/workspace-reference";

export interface InlineCommentToken {
    body: string;
    text: string;
    raw: string;
    start: number;
    end: number;
}

const INLINE_COMMENT_PATTERN = /<inline-comment(?:\s+[^>]*)?>[\s\S]*?<\/inline-comment>/g;
const INLINE_REFERENCE_PATTERN = /\[[^\]]+\]\([^)]+\)/g;

export function parseInlineComment(raw: string): InlineCommentToken | null {
    const parsed = parseMarkdownInlineComment(raw);
    if (!parsed) {
        return null;
    }
    return {
        body: parsed.body,
        text: parsed.text,
        raw,
        start: 0,
        end: raw.length,
    };
}

export function countInlineComments(text: string): number {
    return [...text.matchAll(INLINE_COMMENT_PATTERN)].length;
}

export function countInlineReferences(text: string): number {
    return [...text.matchAll(INLINE_REFERENCE_PATTERN)]
        .filter((matched) => parseReferenceLink(matched[0] ?? "") || parseWorkspaceReferenceLink(matched[0] ?? ""))
        .length;
}

export function renderInlineCommentHtml(raw: string): string {
    const comment = parseInlineComment(raw);
    if (!comment) {
        return raw;
    }

    return [
        "<span class=\"nb-inline-comment\">",
        "<span class=\"nb-inline-comment__badge\">评论</span>",
        `<span class="nb-inline-comment__body">${escapeHtml(comment.body || "无评论内容")}</span>`,
        "</span>",
    ].join("");
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
