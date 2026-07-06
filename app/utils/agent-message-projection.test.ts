import {describe, expect, it} from "vitest";
import {RequestUserInputToolArgsSchema, applyRuntimeEventToMessages, applySessionEntryToMessages, deriveMessagesFromSessionSnapshot, deriveRequestUserInputAnswerViews, hasVisibleInvocationError, messageStatusLabel, toLocalMessage, toPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";

describe("agent message projection helpers", () => {
    it("request_user_input schema 拒绝默认值、推荐和多选旧字段", () => {
        const invalidArgs = [
            {questions: [{question: "Pick", defaultOptionIndex: 0}]},
            {questions: [{question: "Pick", defaultOptionIndexes: [0]}]},
            {questions: [{question: "Pick", multiSelect: true}]},
            {questions: [{question: "Pick", options: [{label: "A", defaultSelected: true}]}]},
            {questions: [{question: "Pick", options: [{label: "A", recommended: true}]}]},
        ];

        for (const args of invalidArgs) {
            expect(RequestUserInputToolArgsSchema.safeParse(args).success).toBe(false);
        }
    });

    it("request_user_input schema 接受问题、header 和单选 options", () => {
        const parsed = RequestUserInputToolArgsSchema.parse({
            questions: [{
                header: "偏好",
                question: "Pick",
                options: [
                    {label: "A", description: "使用 A 路径"},
                    {label: "B"},
                ],
            }],
        });

        expect(parsed.questions[0]).toEqual({
            header: "偏好",
            question: "Pick",
            options: [
                {label: "A", description: "使用 A 路径"},
                {label: "B"},
            ],
        });
    });

    it("approval pending session 保留批准和拒绝选项", () => {
        const session = toPendingUserInputSession({
            toolCallId: "plan-1",
            toolName: "switch_mode",
            args: {
                targetMode: "plan",
                reason: "需要先制定计划",
            },
        }, []);

        expect(session?.questions[0]).toEqual(expect.objectContaining({
            options: [
                expect.objectContaining({label: "批准"}),
                expect.objectContaining({label: "拒绝"}),
            ],
        }));
    });

    it("switch_mode 退出计划 pending session 保留计划文件预览", () => {
        const session = toPendingUserInputSession({
            toolCallId: "exit-1",
            toolName: "switch_mode",
            args: {
                targetMode: "normal",
                reason: "ready",
                planFilePath: ".agent/plan/preview.md",
            },
            planFilePath: ".agent/plan/preview.md",
            planContent: "# Preview\n\n- one\n",
        }, []);
        const enterSession = toPendingUserInputSession({
            toolCallId: "enter-1",
            toolName: "switch_mode",
            args: {
                targetMode: "plan",
                reason: "需要先制定计划",
            },
        }, []);

        expect(session?.questions[0]).toEqual(expect.objectContaining({
            approvalAction: "switch_mode",
            switchTargetMode: "normal",
            planFilePath: ".agent/plan/preview.md",
            planContent: "# Preview\n\n- one\n",
        }));
        expect(enterSession?.questions[0]?.switchTargetMode).toBe("plan");
        expect(enterSession?.questions[0]?.planFilePath).toBeUndefined();
        expect(enterSession?.questions[0]?.planContent).toBeUndefined();
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

    it("request_user_input 历史答案展示支持单选加备注", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [
                {
                    question: "选择标签",
                    options: [{label: "剧情"}, {label: "人物"}, {label: "节奏"}],
                },
            ],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, selectedOptionIndex: 2, note: "节奏更适合当前章节"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "选择标签",
                selectedLabel: "节奏",
                note: "节奏更适合当前章节",
                openAnswer: false,
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

    it("snapshot lifecycle error 会展示为 Run Error 系统消息", () => {
        const messages = deriveMessagesFromSessionSnapshot({
            summary: {
                sessionId: 1,
                profileKey: "leader.default",
                workspaceKey: "novel-1",
                workspaceRoot: "workspace",
                status: "idle",
                updatedAt: Date.now(),
                archived: false,
            },
            activeLeafId: "error-1",
            activePathRevision: null,
            messages: [],
            tree: [],
            entries: [{
                id: "start-1",
                parentId: null,
                timestamp: Date.now(),
                type: "invocation_lifecycle",
                invocationId: "invoke-1",
                status: "start",
            }, {
                id: "error-1",
                parentId: "start-1",
                timestamp: Date.now(),
                type: "invocation_lifecycle",
                invocationId: "invoke-1",
                status: "error",
                error: "Provider rejected image payload",
            }],
            eventEpoch: "epoch-1",
            eventCursor: {
                eventEpoch: "epoch-1",
                after: 0,
            },
            latestSeq: 0,
            linkedAgents: [],
            linkedByAgents: [],
            pendingUserInputs: [],
            pendingApprovals: [],
            steerQueue: [],
            followUpQueue: {
                status: "ready",
                items: [],
            },
            activeInvocation: null,
            model: null,
            thinkingLevel: null,
            effectiveThinkingLevel: "off",
            agentMode: "normal",
            lastSeq: 0,
        });

        expect(messages).toEqual([
            expect.objectContaining({
                id: "error-1",
                type: "system",
                systemDisplayKind: "error",
                systemLabel: "Run Error",
                content: "Provider rejected image payload",
                invocationId: "invoke-1",
            }),
        ]);
    });

    it("session_entry lifecycle error 能增量展示", () => {
        const messages = applySessionEntryToMessages([], {
            id: "error-1",
            parentId: null,
            timestamp: Date.now(),
            type: "invocation_lifecycle",
            invocationId: "invoke-1",
            status: "error",
            errorInfo: {
                message: "prepare failed",
                phase: "pre_loop",
            },
        });

        expect(messages).toEqual([
            expect.objectContaining({
                id: "error-1",
                systemDisplayKind: "error",
                content: "prepare failed",
            }),
        ]);
    });

    it("session_entry lifecycle error 不会被其他 invocation 的 assistant error 吞掉", () => {
        const messages = applySessionEntryToMessages([{
            id: "assistant-error",
            type: "ai",
            content: "old error",
            status: "stopped",
            error: "old error",
            invocationId: "invoke-old",
        }], {
            id: "error-1",
            parentId: null,
            timestamp: Date.now(),
            type: "invocation_lifecycle",
            invocationId: "invoke-new",
            status: "error",
            error: "new error",
        });

        expect(messages).toEqual([
            expect.objectContaining({id: "assistant-error"}),
            expect.objectContaining({
                id: "error-1",
                systemDisplayKind: "error",
                invocationId: "invoke-new",
                content: "new error",
            }),
        ]);
    });

    it("已有 assistant error 时不重复展示 lifecycle error", () => {
        const timestamp = Date.now();
        const messages = deriveMessagesFromSessionSnapshot({
            summary: {
                sessionId: 1,
                profileKey: "leader.default",
                workspaceKey: "novel-1",
                workspaceRoot: "workspace",
                status: "idle",
                updatedAt: timestamp,
                archived: false,
            },
            activeLeafId: "error-1",
            activePathRevision: null,
            messages: [],
            tree: [],
            entries: [{
                id: "start-1",
                parentId: null,
                timestamp,
                type: "invocation_lifecycle",
                invocationId: "invoke-1",
                status: "start",
            }, {
                id: "assistant-1",
                parentId: "start-1",
                timestamp,
                type: "message",
                origin: "harness",
                message: {
                    role: "assistant",
                    content: [],
                    stopReason: "error",
                    errorMessage: "Provider rejected image payload",
                    timestamp,
                } as never,
            }, {
                id: "error-1",
                parentId: "assistant-1",
                timestamp,
                type: "invocation_lifecycle",
                invocationId: "invoke-1",
                status: "error",
                error: "Provider rejected image payload",
            }],
            eventEpoch: "epoch-1",
            eventCursor: {
                eventEpoch: "epoch-1",
                after: 0,
            },
            latestSeq: 0,
            linkedAgents: [],
            linkedByAgents: [],
            pendingUserInputs: [],
            pendingApprovals: [],
            steerQueue: [],
            followUpQueue: {
                status: "ready",
                items: [],
            },
            activeInvocation: null,
            model: null,
            thinkingLevel: null,
            effectiveThinkingLevel: "off",
            agentMode: "normal",
            lastSeq: 0,
        });

        expect(messages.filter((message) => message.systemDisplayKind === "error")).toHaveLength(0);
        expect(messages.filter((message) => message.type === "ai" && message.error)).toHaveLength(1);
        expect(hasVisibleInvocationError(messages, "invoke-1")).toBe(true);
    });

    it("session_entry toolResult 能增量完成对应工具调用", () => {
        const messages = applySessionEntryToMessages([{
            id: "assistant-1",
            type: "ai",
            content: "",
            status: "done",
            toolCalls: [{
                id: "approval-call",
                assistantMessageId: "assistant-1",
                index: 0,
                name: "request_user_input",
                argsText: "{\"questions\":[{\"question\":\"继续吗？\"}]}",
                status: "streaming",
            }],
        }], {
            id: "tool-result-1",
            parentId: "assistant-1",
            timestamp: Date.now(),
            type: "message",
            origin: "harness",
            message: {
                role: "toolResult",
                toolCallId: "approval-call",
                toolName: "request_user_input",
                content: [{type: "text", text: "用户已选择：继续"}],
                isError: false,
                timestamp: Date.now(),
            } as never,
        });

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            status: "success",
            result: "用户已选择：继续",
        }));
    });

    it("tool_execution_start 展示 JSON 参数", () => {
        const messages = applyRuntimeEventToMessages([{
            id: "assistant-1",
            type: "ai",
            content: "",
            status: "streaming",
            toolCalls: [{
                id: "patch-1",
                assistantMessageId: "assistant-1",
                index: 0,
                name: "apply_patch",
                argsText: "",
                status: "streaming",
            }],
        }], {
            type: "tool_execution_start",
            toolCallId: "patch-1",
            toolName: "apply_patch",
            args: {patch: "*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch"},
        });

        expect(messages[0]?.toolCalls?.[0]?.argsText).toContain("*** Begin Patch");
        expect(messages[0]?.toolCalls?.[0]?.argsJson).toContain("\"patch\"");
    });
});
