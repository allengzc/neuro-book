import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {estimateModelRequestTokens, estimateTextTokens} from "nbook/server/agent/harness/model-context-estimate";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";

describe("model-context-estimate", () => {
    it("中文文本按 CJK 字符保守估算，避免 char / 4 低估", () => {
        const text = "这是一个很长的中文上下文";

        expect(estimateTextTokens(text)).toBe(text.length);
    });

    it("模型请求估算包含 system prompt 与 tool schema", () => {
        const estimate = estimateModelRequestTokens({
            systemPrompt: "系统提示：请严格遵循工具协议。",
            messages: [
                createUserMessage({text: "请读取世界观设定并继续写作。"}),
            ],
            tools: [{
                name: "workspace_read",
                description: "读取 Project Workspace 中的文件内容。",
                parameters: Type.Object({
                    path: Type.String({description: "lorebook/... 或 manuscript/... 路径"}),
                    reason: Type.String({description: "读取原因"}),
                }),
            }],
        });

        expect(estimate.systemPromptTokens).toBeGreaterThan(0);
        expect(estimate.messageTokens).toBeGreaterThan(0);
        expect(estimate.toolTokens).toBeGreaterThan(0);
        expect(estimate.tokens).toBe(
            estimate.systemPromptTokens
            + estimate.messageTokens
            + estimate.toolTokens
            + estimate.overheadTokens,
        );
    });
});
