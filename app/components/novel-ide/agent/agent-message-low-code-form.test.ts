import {describe, test, expect} from "vitest";
import {toPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentPendingApprovalDto} from "nbook/shared/dto/agent-session.dto";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";

describe("agent-message Low-Code Form 集成", () => {
    test("当 pending.formSpec 存在时，优先生成 Low-Code Form session", () => {
        const form: LowCodeFormDto = {
            defaults: {},
            fields: [
                {
                    path: "answer_0",
                    component: "textarea",
                    label: "姓名",
                    required: true,
                    options: [],
                },
            ],
        };

        const pending: AgentPendingApprovalDto = {
            toolCallId: "call_form_spec",
            toolName: "request_user_input",
            args: {
                questions: [
                    {
                        question: "旧问题参数不应优先",
                        options: [],
                    },
                ],
            },
            formSpec: {
                form,
                prompt: "请填写",
                layout: "dialog",
            },
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_form_spec",
            status: "pending",
            questions: [],
            form,
            formToolCallId: "call_form_spec",
        });
    });

    test("当 args 包含 form 时，生成 Low-Code Form session", () => {
        const form: LowCodeFormDto = {
            defaults: {},
            fields: [
                {
                    path: "name",
                    component: "text",
                    label: "姓名",
                    required: true,
                    options: [],
                },
                {
                    path: "age",
                    component: "number",
                    label: "年龄",
                    required: false,
                    min: 0,
                    max: 150,
                    options: [],
                },
            ],
        };

        const pending: AgentPendingApprovalDto = {
            toolCallId: "call_123",
            toolName: "custom_tool",
            args: {form},
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_123",
            status: "pending",
            questions: [],
            form,
            formToolCallId: "call_123",
        });
    });

    test("当 args 不包含 form 时，保持原有 questions 模式", () => {
        const pending: AgentPendingApprovalDto = {
            toolCallId: "call_456",
            toolName: "request_user_input",
            args: {
                questions: [
                    {
                        question: "请问您的姓名？",
                        options: [],
                    },
                ],
            },
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_456",
            status: "pending",
            questions: [
                {
                    question: "请问您的姓名？",
                    toolNodeId: "call_456",
                    questionIndex: 0,
                    toolCallId: "call_456",
                    toolName: "request_user_input",
                    kind: "question",
                },
            ],
        });
        expect(session?.form).toBeUndefined();
        expect(session?.formToolCallId).toBeUndefined();
    });

    test("当 args.form 结构不完整时，回退到 tool_approval 模式", () => {
        const pending: AgentPendingApprovalDto = {
            toolCallId: "call_789",
            toolName: "some_tool",
            args: {
                form: {fields: "invalid"},
            },
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session?.questions).toHaveLength(1);
        expect(session?.questions[0]?.kind).toBe("tool_approval");
        expect(session?.form).toBeUndefined();
    });
});
