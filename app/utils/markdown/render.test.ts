import {describe, expect, it} from "vitest";
import {renderMarkdown} from "nbook/app/utils/markdown/render";

describe("renderMarkdown", () => {
    it("会把 skill 文本按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("$小说初始化流程")).not.toThrow();
        expect(renderMarkdown("$小说初始化流程")).toContain("$小说初始化流程");
    });

    it("会把模板 skill 按普通 Markdown 渲染", () => {
        expect(() => renderMarkdown("${小说初始化流程}")).not.toThrow();
        expect(renderMarkdown("${小说初始化流程}")).toContain("${小说初始化流程}");
    });

    it("会修复流式输出中分隔行缺列的 GFM 表格", () => {
        const html = renderMarkdown("| 因果链 | 起因 | 过程 | 结果 |\n|--------|------|------|");

        expect(html).toContain("<table>");
        expect(html).toContain("<th>结果</th>");
    });

    it("会修复流式输出中分隔行缺尾部 pipe 的 GFM 表格", () => {
        const html = renderMarkdown("| 姓名 | 年龄 | 城市 |\n|------|------\n| 张三 | 25 | 北京 |");

        expect(html).toContain("<table>");
        expect(html).toContain("<th>城市</th>");
        expect(html).toMatch(/<td[^>]*>北京<\/td>/);
    });

    it("会修复表头缺列的 GFM 表格", () => {
        const html = renderMarkdown("| One header |\n|:------------- |:-------------|:-----|\n| row | has | 3 cols |");

        expect(html).toContain("<table>");
        expect(html).toMatch(/<td[^>]*>3 cols<\/td>/);
    });

    it("不会修复代码块里的半截 GFM 表格示例", () => {
        const html = renderMarkdown("```md\n| 因果链 | 起因 | 过程 | 结果 |\n|--------|------|------|\n```");

        expect(html).not.toContain("<table>");
        expect(html).toContain("| 因果链 | 起因 | 过程 | 结果 |");
    });
});
