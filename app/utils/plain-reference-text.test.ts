import {describe, expect, it} from "vitest";
import {
    parsePlainReferenceInlineContent,
    parsePlainReferenceText,
    serializePlainReferenceDoc,
    tokenizePlainReferenceText,
} from "nbook/app/utils/plain-reference-text";

describe("plain-reference-text", () => {
    it("保留 XML-like 文本为普通文本", () => {
        const text = `<custom-tag attr="x">hello</custom-tag>`;
        const doc = parsePlainReferenceText(text);

        expect(doc.content?.[0]?.content).toEqual([{type: "text", text}]);
        expect(serializePlainReferenceDoc(doc)).toBe(text);
    });

    it("不会把普通 Markdown link 转成 chip", () => {
        const text = "参考 [普通链接](foo)。";

        expect(tokenizePlainReferenceText(text)).toEqual([{kind: "text", raw: text}]);
        expect(serializePlainReferenceDoc(parsePlainReferenceText(text))).toBe(text);
    });

    it("识别系统 workspace reference 并保持序列化格式", () => {
        const text = "打开 [角色](lorebook/character/main/index.md)。";
        const doc = parsePlainReferenceText(text);

        expect(doc.content?.[0]?.content).toEqual([
            {type: "text", text: "打开 "},
            {type: "plainReference", attrs: {label: "角色", target: "lorebook/character/main/index.md"}},
            {type: "text", text: "。"},
        ]);
        expect(serializePlainReferenceDoc(doc)).toBe(text);
    });

    it("识别 domain reference 并序列化为 canonical target", () => {
        const text = "剧情 [主线](thread://thread-main) 和 [情节](plot://plot-1)";
        const doc = parsePlainReferenceText(text);

        expect(doc.content?.[0]?.content).toEqual([
            {type: "text", text: "剧情 "},
            {type: "plainReference", attrs: {label: "主线", target: "thread://thread-main"}},
            {type: "text", text: " 和 "},
            {type: "plainReference", attrs: {label: "情节", target: "plot://plot-1"}},
        ]);
        expect(serializePlainReferenceDoc(doc)).toBe(text);
    });

    it("识别 skill token 并支持大括号写法", () => {
        const text = "使用 $draft 和 ${review}";
        const doc = parsePlainReferenceText(text);

        expect(doc.content?.[0]?.content).toEqual([
            {type: "text", text: "使用 "},
            {type: "agentSkill", attrs: {name: "draft"}},
            {type: "text", text: " 和 "},
            {type: "agentSkill", attrs: {name: "review"}},
        ]);
        expect(serializePlainReferenceDoc(doc)).toBe("使用 $draft 和 $review");
    });

    it("不会把 XML/template 内的变量误识别为 skill", () => {
        const text = `<custom-tag value="\${schema}">abc$draft</custom-tag>`;

        expect(tokenizePlainReferenceText(text)).toEqual([{kind: "text", raw: text}]);
        expect(serializePlainReferenceDoc(parsePlainReferenceText(text))).toBe(text);
    });

    it("保留多行文本 round-trip", () => {
        const text = "第一行\n第二行 [文件](manuscript/chapter-1/index.md)\n第三行 $skill";

        expect(serializePlainReferenceDoc(parsePlainReferenceText(text))).toBe(text);
    });

    it("生成可插入当前光标的 inline content", () => {
        expect(parsePlainReferenceInlineContent("A\n[角色](lorebook/character/main/) $skill")).toEqual([
            {type: "text", text: "A"},
            {type: "hardBreak"},
            {type: "plainReference", attrs: {label: "角色", target: "lorebook/character/main/"}},
            {type: "text", text: " "},
            {type: "agentSkill", attrs: {name: "skill"}},
        ]);
    });
});
