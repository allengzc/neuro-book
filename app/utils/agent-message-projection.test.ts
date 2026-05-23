import {describe, expect, it} from "vitest";
import {RequestUserInputToolArgsSchema, applySessionEntryToMessages, deriveRequestUserInputAnswerViews, messageStatusLabel, toLocalMessage, toPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";

describe("agent message projection helpers", () => {
    it("request_user_input schema 保留默认选项字段", () => {
        const parsed = RequestUserInputToolArgsSchema.parse({
            questions: [{
                question: "Pick",
                options: [
                    {label: "A", defaultSelected: true},
                    {label: "B"},
                ],
                defaultOptionIndex: 0,
                defaultOptionIndexes: [0],
            }],
        });

        expect(parsed.questions[0]).toEqual(expect.objectContaining({
            defaultOptionIndex: 0,
            defaultOptionIndexes: [0],
            options: [
                expect.objectContaining({label: "A", defaultSelected: true}),
                expect.objectContaining({label: "B"}),
            ],
        }));
    });

    it("approval pending session 默认选中批准", () => {
        const session = toPendingUserInputSession({
            toolCallId: "plan-1",
            toolName: "enter_plan_mode",
            args: {
                reason: "需要先制定计划",
            },
        }, []);

        expect(session?.questions[0]).toEqual(expect.objectContaining({
            defaultOptionIndex: 0,
            options: [
                expect.objectContaining({label: "批准", defaultSelected: true}),
                expect.objectContaining({label: "拒绝"}),
            ],
        }));
    });

    it("request_user_input 历史答案展示支持多题", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [
                {
                    question: "选方案",
                    options: [{label: "A"}, {label: "B"}],
                },
                {
                    question: "补充说明",
                    options: [],
                },
            ],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, selectedOptionIndex: 1, note: "偏稳"},
                {questionIndex: 1, note: "继续推进"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "选方案",
                selectedLabel: "B",
                note: "偏稳",
                openAnswer: false,
            }),
            expect.objectContaining({
                questionIndex: 1,
                question: "补充说明",
                selectedLabel: "",
                note: "继续推进",
                openAnswer: true,
            }),
        ]);
    });

    it("request_user_input 历史答案保留 text-only payload", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [{
                question: "开放问题",
                options: [],
            }],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, text: "用户直接写下的答案"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "开放问题",
                text: "用户直接写下的答案",
                openAnswer: true,
            }),
        ]);
    });

    it("session_entry 先插入 system reminder，再替换同内容乐观用户消息", () => {
        const withReminder = applySessionEntryToMessages([{
            id: "system-prompt:1:leader.default",
            type: "system",
            systemDisplayKind: "prompt",
            content: "SYSTEM",
        }, {
            id: "optimistic-user-1",
            type: "user",
            content: "你好",
            status: "done",
        }], {
            id: "reminder-1",
            parentId: null,
            timestamp: Date.now(),
            type: "custom_message",
            visibleToModel: true,
            message: {
                role: "custom",
                customType: "system-reminder",
                content: "<system-reminder>提醒</system-reminder>",
            } as never,
        });
        const withPrompt = applySessionEntryToMessages(withReminder, {
            id: "prompt-1",
            parentId: "reminder-1",
            timestamp: Date.now(),
            type: "message",
            origin: "prompt",
            message: {
                role: "user",
                content: "你好",
            } as never,
        });

        expect(withPrompt.map((message) => ({
            id: message.id,
            type: message.type,
            content: message.content,
        }))).toEqual([
            {id: "system-prompt:1:leader.default", type: "system", content: "SYSTEM"},
            {id: "reminder-1", type: "system", content: "<system-reminder>提醒</system-reminder>"},
            {id: "prompt-1", type: "user", content: "你好"},
        ]);
    });

    it("assistant 失败但没有正文时展示 errorMessage", () => {
        const message = toLocalMessage("assistant-error", {
            role: "assistant",
            content: [],
            api: "openai-completions",
            provider: "mimo",
            model: "mimo-v2.5-pro",
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                },
            },
            stopReason: "error",
            errorMessage: "Provider rejected image payload",
            timestamp: Date.now(),
        });

        expect(message).toEqual(expect.objectContaining({
            content: "Provider rejected image payload",
            error: "Provider rejected image payload",
            status: "stopped",
        }));
        expect(messageStatusLabel(message)).toBe("生成失败");
    });
});
