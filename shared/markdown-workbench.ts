import {Lexer} from "marked";
import type {MarkdownToken} from "@tiptap/core";

export type AlignValue = "left" | "center" | "right" | "justify";

export interface MarkdownInlineCommentToken {
    raw: string;
    id: string | null;
    body: string;
    text: string;
    tokens: MarkdownToken[];
}

export interface MarkdownAlignToken {
    raw: string;
    align: AlignValue;
    text: string;
    tokens: MarkdownToken[];
}

const INLINE_COMMENT_PATTERN = /^<inline-comment(?:\s+([^>]*))?>([\s\S]*?)<\/inline-comment>/;
const ALIGN_PATTERN = /^<align\s+value="(left|center|right|justify)">\n?([\s\S]*?)\n?<\/align>/;

/**
 * 解析内联评论语法，body 属性承载评论正文。
 */
export function parseMarkdownInlineComment(src: string): MarkdownInlineCommentToken | null {
    const matched = INLINE_COMMENT_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const attrs = parseAttributes(matched[1] ?? "");
    const text = matched[2] ?? "";
    return {
        raw: matched[0],
        id: attrs.id ?? null,
        body: attrs.body ?? "",
        text,
        tokens: Lexer.lexInline(text) as MarkdownToken[],
    };
}

/**
 * 渲染内联评论语法，属性值会做 HTML attribute 转义。
 */
export function renderMarkdownInlineComment(body: string, innerMarkdown: string): string;
export function renderMarkdownInlineComment(attrs: {id?: string | null; body?: string | null}, innerMarkdown: string): string;
export function renderMarkdownInlineComment(attrsOrBody: string | {id?: string | null; body?: string | null}, innerMarkdown: string): string {
    const attrs = typeof attrsOrBody === "string" ? {body: attrsOrBody} : attrsOrBody;
    const id = attrs.id?.trim() ?? "";
    const body = attrs.body ?? "";
    const idAttribute = id ? ` id="${escapeAttribute(id)}"` : "";
    const bodyAttribute = body ? ` body="${escapeAttribute(body)}"` : "";
    return `<inline-comment${idAttribute}${bodyAttribute}>${innerMarkdown}</inline-comment>`;
}

/**
 * 解析块级对齐语法。
 */
export function parseMarkdownAlign(src: string): MarkdownAlignToken | null {
    const matched = ALIGN_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const text = matched[2] ?? "";
    return {
        raw: matched[0],
        align: normalizeAlign(matched[1]),
        text,
        tokens: [],
    };
}

/**
 * 渲染块级对齐语法。
 */
export function renderMarkdownAlign(align: unknown, innerMarkdown: string): string {
    return `<align value="${normalizeAlign(align)}">\n${innerMarkdown}\n</align>`;
}

/**
 * 归一化对齐值；非法值按 left 处理。
 */
export function normalizeAlign(value: unknown): AlignValue {
    return value === "center" || value === "right" || value === "justify" ? value : "left";
}

/**
 * 转义 HTML 属性值。
 */
export function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * 还原 HTML 属性值。
 */
export function unescapeAttribute(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function parseAttributes(rawValue: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const matched of rawValue.matchAll(/([\w-]+)="([^"]*)"/g)) {
        const key = matched[1] ?? "";
        if (!key) {
            continue;
        }
        attrs[key] = unescapeAttribute(matched[2] ?? "");
    }
    return attrs;
}
