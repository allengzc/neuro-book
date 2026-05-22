import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import type {Message} from "nbook/server/agent/messages/types";

describe("approval helpers", () => {
    it("从最后一条未完成 approval tool call 推导等待态", () => {
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [{
            type: "toolCall",
            id: "call-1",
            name: "request_user_input",
            arguments: {
                questions: [{question: "Name?"}],
            },
        }];

        expect(findPendingApprovalCall([assistant], ["request_user_input"])).toEqual({
            toolCallId: "call-1",
            toolName: "request_user_input",
        });

        const completed = createTextToolResult({
            toolCallId: "call-1",
            toolName: "request_user_input",
            text: "1. Alice",
        });

        expect(findPendingApprovalCall([assistant, completed], ["request_user_input"])).toBeNull();
    });

    it("把用户输入 resolution 转成模型可见 toolResult", () => {
        const message = resolutionToToolResult({
            kind: "user_input",
            toolCallId: "call-1",
            answers: [
                {questionIndex: 1, text: "second"},
                {questionIndex: 0, text: "first"},
            ],
        }, {
            toolCallId: "call-1",
            toolName: "request_user_input",
        }) as Message;

        expect(message.role).toBe("toolResult");
        expect(messageText(message)).toBe("1. first\n2. second");
    });
});

function messageText(message: Message): string {
    if (message.role !== "toolResult") {
        return "";
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
