import {Mark, mergeAttributes} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import type {Mark as ProseMirrorMark, Node as ProseMirrorNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import {
    parseMarkdownInlineComment,
    renderMarkdownInlineComment,
} from "nbook/shared/markdown-workbench";

interface InlineCommentToken extends MarkdownToken {
    id?: string | null;
    body?: string;
    text?: string;
    tokens?: MarkdownToken[];
}

export interface InlineCommentRange {
    from: number;
    to: number;
    body: string;
    text: string;
}

export interface InlineCommentInfo {
    index: number;
    id: string | null;
    from: number;
    to: number;
    body: string;
    text: string;
    active: boolean;
    ranges: InlineCommentRange[];
}

interface InlineCommentOptions {
    onSelect: (index: number) => void;
}

interface InlineCommentPluginState {
    activeIndex: number | null;
}

export const INLINE_COMMENT_PLUGIN_KEY = new PluginKey<InlineCommentPluginState>("inline-comment");

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        inlineComment: {
            setInlineComment: (body: string, id?: string | null) => ReturnType;
            unsetInlineComment: () => ReturnType;
        };
    }
}

/**
 * Markdown inline comment mark, serialized as <inline-comment body="...">text</inline-comment>.
 */
export const InlineComment = Mark.create<InlineCommentOptions>({
    name: "inlineComment",
    priority: 780,
    inclusive: false,

    addOptions() {
        return {
            onSelect: () => {},
        };
    },

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute("id"),
                renderHTML: (attributes) => attributes.id ? {id: attributes.id} : {},
            },
            body: {
                default: "",
                parseHTML: (element: HTMLElement) => element.getAttribute("body") ?? "",
                renderHTML: (attributes) => ({body: attributes.body ?? ""}),
            },
        };
    },

    parseHTML() {
        return [{
            tag: "inline-comment",
            getAttrs: (dom) => ({
                id: (dom as HTMLElement).getAttribute("id"),
                body: (dom as HTMLElement).getAttribute("body") ?? "",
            }),
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["inline-comment", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: {
        name: "inlineComment",
        level: "inline",
        start(src: string) {
            return src.indexOf("<inline-comment");
        },
        tokenize(src: string, _tokens: unknown, lexer: {inlineTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownInlineComment(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "inlineComment",
                raw: parsed.raw,
                id: parsed.id,
                body: parsed.body,
                text: parsed.text,
                tokens: lexer.inlineTokens(parsed.text),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const commentToken = token as InlineCommentToken;
        return helpers.applyMark("inlineComment", helpers.parseInline(commentToken.tokens ?? []), {
            id: commentToken.id ?? null,
            body: commentToken.body ?? "",
        });
    },

    renderMarkdown: (node, helpers) => {
        return renderMarkdownInlineComment(
            {
                id: normalizeCommentId(node.attrs?.id),
                body: String(node.attrs?.body ?? ""),
            },
            helpers.renderChildren(node),
        );
    },

    addCommands() {
        return {
            setInlineComment: (body: string, id: string | null = null) => ({commands}) => commands.setMark(this.name, {id, body}),
            unsetInlineComment: () => ({commands}) => commands.unsetMark(this.name),
        };
    },

    addProseMirrorPlugins() {
        return [new Plugin({
            key: INLINE_COMMENT_PLUGIN_KEY,
            state: {
                init: (): InlineCommentPluginState => ({activeIndex: null}),
                apply: (transaction, value) => {
                    const meta = transaction.getMeta(INLINE_COMMENT_PLUGIN_KEY) as Partial<InlineCommentPluginState> | undefined;
                    if (meta && Object.hasOwn(meta, "activeIndex")) {
                        return {activeIndex: meta.activeIndex ?? null};
                    }
                    return value;
                },
            },
            props: {
                decorations: (state) => {
                    const activeIndex = INLINE_COMMENT_PLUGIN_KEY.getState(state)?.activeIndex ?? null;
                    const comments = collectInlineComments(state.doc, state.selection.from, state.selection.to);
                    const decorations: Decoration[] = [];
                    for (const comment of comments) {
                        const active = comment.active || comment.index === activeIndex;
                        for (const range of comment.ranges) {
                            decorations.push(Decoration.inline(range.from, range.to, {
                                class: active ? "nb-inline-comment-mark is-active" : "nb-inline-comment-mark",
                                "data-inline-comment-index": String(comment.index),
                            }));
                        }
                    }
                    return DecorationSet.create(state.doc, decorations);
                },
                handleClick: (view, position, event) => {
                    if (!event.ctrlKey) {
                        return false;
                    }
                    const target = event.target as HTMLElement | null;
                    const comments = collectInlineComments(view.state.doc, position, position);
                    const targetIndex = Number(target?.closest(".nb-inline-comment-mark")?.getAttribute("data-inline-comment-index") ?? 0);
                    const matched = comments.find((comment) => comment.index === targetIndex)
                        ?? comments.find((comment) => position >= comment.from && position <= comment.to);
                    if (!matched) {
                        return false;
                    }
                    event.preventDefault();
                    view.dispatch(view.state.tr.setMeta(INLINE_COMMENT_PLUGIN_KEY, {activeIndex: matched.index}));
                    this.options.onSelect(matched.index);
                    return true;
                },
            },
        })];
    },
});

/**
 * Collect inline-comment mark ranges in document order.
 */
export function collectInlineComments(doc: ProseMirrorNode, selectionFrom: number, selectionTo: number): InlineCommentInfo[] {
    const comments: InlineCommentInfo[] = [];
    const commentsById = new Map<string, InlineCommentInfo>();
    doc.descendants((node, position) => {
        if (!node.isInline) {
            return;
        }
        const mark = findInlineCommentMark(node.marks);
        if (!mark) {
            return;
        }
        const from = position;
        const to = position + node.nodeSize;
        const id = normalizeCommentId(mark.attrs?.id);
        const body = String(mark.attrs?.body ?? "");
        const text = node.isText ? (node.text ?? "") : node.type.name === "hardBreak" ? "\n" : node.textContent;
        const active = isCommentActive(from, to, selectionFrom, selectionTo);
        if (id) {
            const existing = commentsById.get(id);
            if (existing) {
                const previousTo = existing.to;
                appendCommentRange(existing, {from, to, body, text});
                existing.to = Math.max(previousTo, to);
                existing.text += text;
                existing.active = existing.active || active;
                if (!existing.body && body) {
                    existing.body = body;
                }
                return;
            }
            const comment = createCommentInfo(comments.length + 1, id, {from, to, body, text}, active);
            comments.push(comment);
            commentsById.set(id, comment);
            return;
        }

        const previous = comments[comments.length - 1];
        if (previous && previous.id === null && previous.body === body && previous.to === from) {
            appendCommentRange(previous, {from, to, body, text});
            previous.to = to;
            previous.text += text;
            previous.active = previous.active || active;
            return;
        }

        comments.push(createCommentInfo(comments.length + 1, null, {from, to, body, text}, active));
    });
    return comments;
}

function findInlineCommentMark(marks: readonly ProseMirrorMark[]): ProseMirrorMark | null {
    return marks.find((mark) => mark.type.name === "inlineComment") ?? null;
}

function isCommentActive(from: number, to: number, selectionFrom: number, selectionTo: number): boolean {
    if (selectionFrom === selectionTo) {
        return selectionFrom >= from && selectionFrom <= to;
    }
    return selectionFrom < to && selectionTo > from;
}

function normalizeCommentId(value: unknown): string | null {
    const id = String(value ?? "").trim();
    return id ? id : null;
}

function createCommentInfo(index: number, id: string | null, range: InlineCommentRange, active: boolean): InlineCommentInfo {
    return {
        index,
        id,
        from: range.from,
        to: range.to,
        body: range.body,
        text: range.text,
        active,
        ranges: [{...range}],
    };
}

function appendCommentRange(comment: InlineCommentInfo, range: InlineCommentRange): void {
    const previous = comment.ranges[comment.ranges.length - 1];
    if (previous && previous.to === range.from && previous.body === range.body) {
        previous.to = range.to;
        previous.text += range.text;
        return;
    }
    comment.ranges.push({...range});
}
