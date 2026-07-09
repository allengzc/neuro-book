import {describe, expect, it} from "vitest";
import {buildReferenceMarkdown, parseReferenceLink} from "nbook/shared/reference-link";
import {
    normalizeAlign,
    parseMarkdownAlign,
    parseMarkdownInlineComment,
    renderMarkdownAlign,
    renderMarkdownInlineComment,
} from "nbook/shared/markdown-workbench";

describe("markdown-workbench", () => {
    it("引用 Markdown 使用 canonical scheme URI 往返", () => {
        const source = "[青铜门](lorebook://world/bronze-gate)";
        const parsed = parseReferenceLink(source);
        expect(parsed).toEqual({
            kind: "lorebook",
            title: "青铜门",
            targetId: "world/bronze-gate",
        });
        expect(buildReferenceMarkdown(parsed!)).toBe(source);
    });

    it("inline-comment 解析 body 并在渲染时转义属性", () => {
        const source = "<inline-comment body=\"改成 &quot;低语&quot;\">青铜门</inline-comment>";
        const parsed = parseMarkdownInlineComment(source);
        expect(parsed).toMatchObject({
            raw: source,
            id: null,
            body: "改成 \"低语\"",
            text: "青铜门",
        });
        expect(renderMarkdownInlineComment("A&B\"C", "青铜门")).toBe("<inline-comment body=\"A&amp;B&quot;C\">青铜门</inline-comment>");
        expect(renderMarkdownInlineComment({id: "draft:1", body: "A&B\"C"}, "青铜门")).toBe("<inline-comment id=\"draft:1\" body=\"A&amp;B&quot;C\">青铜门</inline-comment>");
    });

    it("align 支持四种值并回退 left", () => {
        for (const align of ["left", "center", "right", "justify"] as const) {
            const source = `<align value="${align}">\n正文\n</align>`;
            const parsed = parseMarkdownAlign(source);
            expect(parsed?.align).toBe(align);
            expect(renderMarkdownAlign(parsed?.align, "正文")).toBe(source);
        }
        expect(normalizeAlign("bad")).toBe("left");
    });
});
