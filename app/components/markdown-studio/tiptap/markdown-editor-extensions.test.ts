import {MarkdownManager} from "@tiptap/markdown";
import {Markdown} from "@tiptap/markdown";
import {StarterKit} from "@tiptap/starter-kit";
import {describe, expect, it} from "vitest";
import {InlineComment} from "nbook/app/components/markdown-studio/tiptap/InlineComment";
import {MarkdownAlign} from "nbook/app/components/markdown-studio/tiptap/MarkdownAlign";
import {MarkdownHighlight, MarkdownTextColor} from "nbook/app/components/markdown-studio/tiptap/MarkdownTextMarks";

/**
 * 创建 Markdown Studio 的真实 TipTap Markdown manager。
 */
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
            InlineComment,
            MarkdownAlign,
            MarkdownTextColor,
            MarkdownHighlight,
        ],
    });
}

describe("markdown-studio TipTap Markdown extensions", () => {
    it("align 后续普通段落和行内 HTML 格式不会被解析成空段落", () => {
        const manager = createManager();
        const source = [
            "# 第一章：醒来",
            "",
            "## 正文草稿",
            "",
            "<align value=\"center\">*— 在记忆断裂的地方，世界重新开始。—*</align>",
            "",
            "林屿睁开眼睛的时候，后脑勺正贴着一块冰凉的石板。",
            "",
            "空气里有股陈旧的纸张味道，混着某种说不上来的甜腥。<mark>那些符号在缓慢移动。</mark>",
            "",
            "架上摆的是一团 <span style=\"color: #60a5fa\">淡蓝色的雾气</span>。",
            "",
            "<inline-comment body=\"后续确认\">她抬头看了林屿一眼。</inline-comment>",
        ].join("\n");

        const parsed = manager.parse(source);
        const content = parsed.content ?? [];

        expect(parsed.type).toBe("doc");
        expect(content[2]).toMatchObject({
            type: "markdownAlign",
            attrs: {align: "center"},
            content: [{
                type: "paragraph",
                content: [{
                    type: "text",
                    text: "— 在记忆断裂的地方，世界重新开始。—",
                    marks: [{type: "italic"}],
                }],
            }],
        });
        expect(content[3]).toMatchObject({
            type: "paragraph",
            content: [{
                type: "text",
                text: "林屿睁开眼睛的时候，后脑勺正贴着一块冰凉的石板。",
            }],
        });
        expect(JSON.stringify(parsed)).toContain("那些符号在缓慢移动。");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownHighlight\"");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"markdownTextColor\"");
        expect(JSON.stringify(parsed)).toContain("\"type\":\"inlineComment\"");
    });
});
