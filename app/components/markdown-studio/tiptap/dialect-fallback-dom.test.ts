// @vitest-environment jsdom
// 依赖 DOM 解析路径的兜底行为验证。
// MarkdownManager 的 parseHTMLToken 需要 window：node 环境下「交回 DOM」退化为
// 纯文本保留（数据不丢但无语义），只有 jsdom 才能测到 Bridge 完整性自愈的真实路径。
import {MarkdownManager} from "@tiptap/markdown";
import {Markdown} from "@tiptap/markdown";
import {StarterKit} from "@tiptap/starter-kit";
import {describe, expect, it} from "vitest";
import {Comment, CommentBlock} from "nbook/app/components/markdown-studio/tiptap/Comment";
import {HtmlBlock, HtmlBlockBridge, RawInlineHtml} from "nbook/app/components/markdown-studio/tiptap/HtmlFallback";
import {HtmlEmbed} from "nbook/app/components/markdown-studio/tiptap/HtmlEmbed";
import {MarkdownAlign} from "nbook/app/components/markdown-studio/tiptap/MarkdownAlign";
import {MarkdownBilingual} from "nbook/app/components/markdown-studio/tiptap/MarkdownBilingual";
import {MarkdownRuby} from "nbook/app/components/markdown-studio/tiptap/MarkdownRuby";
import {MarkdownHighlight, MarkdownTextColor} from "nbook/app/components/markdown-studio/tiptap/MarkdownTextMarks";

function createManager(): MarkdownManager {
    return new MarkdownManager({
        extensions: [
            Markdown,
            StarterKit.configure({
                code: false,
                hardBreak: false,
                link: false,
                trailingNode: false,
            }),
            Comment,
            CommentBlock,
            MarkdownRuby,
            MarkdownBilingual,
            HtmlEmbed,
            HtmlBlock,
            HtmlBlockBridge,
            RawInlineHtml,
            MarkdownAlign,
            MarkdownTextColor,
            MarkdownHighlight,
        ],
    });
}

describe("HTML 兜底的 DOM 解析路径（jsdom）", () => {
    it("闭标签黏行的单段 <comment> 由 Bridge 交回 DOM 自愈为行内评论 mark", () => {
        const manager = createManager();
        const parsed = manager.parse("<comment>\ncontent</comment>");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"comment\"");
        expect(JSON.stringify(parsed)).not.toContain("htmlBlock");
        // 自愈后保存写回规范行内形态（DOM 折叠首部换行为空白）
        expect(manager.serialize(parsed).replace(/\s/g, "")).toBe("<comment>content</comment>");
    });

    it("跨空行截断的畸形块不交 DOM（会静默改写评论范围），保源码块", () => {
        const manager = createManager();
        const source = "<comment>\npara1\n\npara2</comment>";
        const parsed = manager.parse(source);
        expect(JSON.stringify(parsed)).toContain("\"type\":\"htmlBlock\"");
        expect(manager.serialize(parsed)).toBe(source);
    });
});
