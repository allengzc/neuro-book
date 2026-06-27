import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {Value} from "typebox/value";
import type {Static} from "typebox";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";
import {controlTools} from "nbook/server/agent/tools/control-tools";
import type {UserInputRequestContext, ToolExecutionContext} from "nbook/server/agent/tools/types";

describe("request_user_input userInputRequest", () => {
    const requestUserInputTool = controlTools.requestUserInput.runtime();

    it("单个开放式问题返回正确的 formSpec", async () => {
        // 1. 模拟工具参数
        const params = {
            questions: [
                {
                    question: "请输入您的名字",
                    header: "用户信息",
                },
            ],
        };

        // 2. 构造 UserInputRequestContext
        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        // 3. 调用 userInputRequest.when()
        const formSpec = await requestUserInputTool.userInputRequest!.when(context);

        // 4. 验证返回的 formSpec
        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(1);

        const field = formSpec!.form.fields[0]!;
        expect(field.path).toBe("answer_0");
        expect(field.component).toBe("textarea");
        expect(field.label).toBe("请输入您的名字");
        expect(field.description).toBe("用户信息");
        expect(field.required).toBe(true);
        expect(field.rows).toBe(3);
    });

    it("单选问题返回正确的 radio formSpec", async () => {
        const params = {
            questions: [
                {
                    question: "选择您的偏好",
                    options: [
                        {label: "选项 A", description: "这是 A"},
                        {label: "选项 B", description: "这是 B"},
                        {label: "选项 C"},
                    ],
                    defaultOptionIndex: 1,
                },
            ],
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await requestUserInputTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(1);

        const field = formSpec!.form.fields[0]!;
        expect(field.path).toBe("answer_0");
        expect(field.component).toBe("radio");
        expect(field.label).toBe("选择您的偏好");
        expect(field.required).toBe(true);
        expect(field.options).toHaveLength(3);
        expect(field.options![0]).toEqual({value: 0, label: "选项 A", description: "这是 A"});
        expect(field.options![1]).toEqual({value: 1, label: "选项 B", description: "这是 B"});
        expect(field.options![2]).toEqual({value: 2, label: "选项 C", description: undefined});
        expect(field.defaultValue).toBe(1);
    });

    it("多选问题返回正确的 checkbox formSpec", async () => {
        const params = {
            questions: [
                {
                    question: "选择多个选项",
                    options: [
                        {label: "A"},
                        {label: "B"},
                        {label: "C"},
                    ],
                    multiSelect: true,
                    defaultOptionIndexes: [0, 2],
                },
            ],
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await requestUserInputTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(1);

        const field = formSpec!.form.fields[0]!;
        expect(field.path).toBe("answer_0");
        expect(field.component).toBe("checkbox");
        expect(field.label).toBe("选择多个选项");
        expect(field.required).toBe(true);
        expect(field.options).toHaveLength(3);
        expect(field.defaultValue).toEqual([0, 2]);
    });

    it("多个问题返回正确的 fields 数组", async () => {
        const params = {
            questions: [
                {question: "第一个问题"},
                {
                    question: "第二个问题",
                    options: [{label: "是"}, {label: "否"}],
                },
                {question: "第三个问题"},
            ],
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await requestUserInputTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(3);

        expect(formSpec!.form.fields[0]!.path).toBe("answer_0");
        expect(formSpec!.form.fields[0]!.component).toBe("textarea");

        expect(formSpec!.form.fields[1]!.path).toBe("answer_1");
        expect(formSpec!.form.fields[1]!.component).toBe("radio");

        expect(formSpec!.form.fields[2]!.path).toBe("answer_2");
        expect(formSpec!.form.fields[2]!.component).toBe("textarea");
    });

    it("executeWithContext 正确处理开放式问题的用户输入", async () => {
        const params = {
            questions: [
                {question: "您的名字？"},
                {question: "您的爱好？"},
            ],
        };

        const userInput = {
            answer_0: "张三",
            answer_1: "阅读",
        };

        const context = {
            harness: {} as any,
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: "/test/workspace",
            workspaceKey: "test-workspace",
        };

        const result = await requestUserInputTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.content).toHaveLength(1);
        const text = readText(result);
        expect(text).toContain("您的名字？");
        expect(text).toContain("回答：张三");
        expect(text).toContain("您的爱好？");
        expect(text).toContain("回答：阅读");

        expect(result.details).toEqual({
            answers: [
                {questionIndex: 0, text: "张三"},
                {questionIndex: 1, text: "阅读"},
            ],
        });
    });

    it("executeWithContext 正确处理单选问题的用户输入", async () => {
        const params = {
            questions: [
                {
                    question: "选择颜色",
                    options: [
                        {label: "红色"},
                        {label: "蓝色"},
                        {label: "绿色"},
                    ],
                },
            ],
        };

        const userInput = {
            answer_0: 1, // 选择 "蓝色"
        };

        const context = {
            harness: {} as any,
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: "/test/workspace",
            workspaceKey: "test-workspace",
        };

        const result = await requestUserInputTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.details).toEqual({
            answers: [
                {
                    questionIndex: 0,
                    text: "蓝色",
                    selectedOptionIndex: 1,
                },
            ],
        });
    });

    it("executeWithContext 正确处理多选问题的用户输入", async () => {
        const params = {
            questions: [
                {
                    question: "选择多个颜色",
                    options: [
                        {label: "红色"},
                        {label: "蓝色"},
                        {label: "绿色"},
                    ],
                    multiSelect: true,
                },
            ],
        };

        const userInput = {
            answer_0: [0, 2], // 选择 "红色" 和 "绿色"
        };

        const context = {
            harness: {} as any,
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: "/test/workspace",
            workspaceKey: "test-workspace",
        };

        const result = await requestUserInputTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.details).toEqual({
            answers: [
                {
                    questionIndex: 0,
                    text: "红色, 绿色",
                    selectedOptionIndexes: [0, 2],
                },
            ],
        });
    });

    it("executeWithContext 混合问题类型的用户输入", async () => {
        const params = {
            questions: [
                {question: "您的名字？"},
                {
                    question: "性别？",
                    options: [{label: "男"}, {label: "女"}],
                },
                {
                    question: "兴趣爱好？",
                    options: [{label: "阅读"}, {label: "运动"}, {label: "旅游"}],
                    multiSelect: true,
                },
            ],
        };

        const userInput = {
            answer_0: "李四",
            answer_1: 0,
            answer_2: [0, 2],
        };

        const context = {
            harness: {} as any,
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: "/test/workspace",
            workspaceKey: "test-workspace",
        };

        const result = await requestUserInputTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.details).toEqual({
            answers: [
                {questionIndex: 0, text: "李四"},
                {questionIndex: 1, text: "男", selectedOptionIndex: 0},
                {questionIndex: 2, text: "阅读, 旅游", selectedOptionIndexes: [0, 2]},
            ],
        });
    });

    it("executeWithContext 没有 userInput 时抛出错误", async () => {
        const params = {
            questions: [{question: "测试问题"}],
        };

        const context = {
            harness: {} as any,
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: "/test/workspace",
            workspaceKey: "test-workspace",
        };

        await expect(
            requestUserInputTool.executeWithContext!(context, "call-1", params, undefined),
        ).rejects.toThrow("request_user_input 需要用户输入数据");
    });
});

describe("enter_plan_mode userInputRequest", () => {
    const enterPlanModeTool = controlTools.enterPlanMode.runtime();

    it("生成 radio 字段用于批准选择", async () => {
        const params = {
            reason: "需要制定详细的实现计划",
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await enterPlanModeTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(1);

        const field = formSpec!.form.fields[0]!;
        expect(field.path).toBe("approved");
        expect(field.component).toBe("radio");
        expect(field.label).toBe("是否批准进入计划模式？");
        expect(field.description).toBe("需要制定详细的实现计划");
        expect(field.required).toBe(true);
        expect(field.options).toEqual([
            {value: true, label: "批准"},
            {value: false, label: "拒绝"},
        ]);
        expect(field.defaultValue).toBe(true);
    });

    it("批准后返回 pending 状态", async () => {
        const params = {reason: "制定实现计划"};
        const userInput = {approved: true};

        const context = createToolContext();

        const result = await enterPlanModeTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: true, pending: true});
        expect(readText(result)).toContain("请求进入计划模式：制定实现计划");
    });

    it("拒绝后终止并返回拒绝状态", async () => {
        const params = {reason: "制定计划"};
        const userInput = {approved: false};

        const context = createToolContext();

        const result = await enterPlanModeTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: false});
        expect(readText(result)).toBe("用户拒绝进入计划模式。");
    });
});

describe("exit_plan_mode userInputRequest", () => {
    const exitPlanModeTool = controlTools.exitPlanMode.runtime();

    it("生成 radio 字段用于批准选择", async () => {
        const params = {
            reason: "计划已完成",
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await exitPlanModeTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(1);

        const field = formSpec!.form.fields[0]!;
        expect(field.path).toBe("approved");
        expect(field.component).toBe("radio");
        expect(field.label).toBe("是否批准退出计划模式？");
        expect(field.description).toBe("计划已完成");
    });

    it("提供 planFilePath 时添加预览提示字段", async () => {
        const params = {
            reason: "计划已完成",
            planFilePath: ".agent/plan/feature-x.md",
        };

        const context: UserInputRequestContext = {
            args: params,
            session: {
                sessionId: 1,
                profileKey: "test-profile",
                workspaceRoot: "/test/workspace",
                workspaceKey: "test-workspace",
            },
        };

        const formSpec = await exitPlanModeTool.userInputRequest!.when(context);

        expect(formSpec).not.toBeNull();
        expect(formSpec!.form.fields).toHaveLength(2);

        const approvalField = formSpec!.form.fields[0]!;
        expect(approvalField.path).toBe("approved");
        expect(approvalField.component).toBe("radio");

        const previewField = formSpec!.form.fields[1]!;
        expect(previewField.path).toBe("planPreviewNote");
        expect(previewField.component).toBe("text");
        expect(previewField.label).toBe("计划文件");
        expect(previewField.description).toContain(".agent/plan/feature-x.md");
        expect(previewField.defaultValue).toBe(".agent/plan/feature-x.md");
        expect(previewField.required).toBe(false);
    });

    it("批准后返回 pending 状态", async () => {
        const params = {
            reason: "计划完成",
            planFilePath: ".agent/plan/test.md",
        };
        const userInput = {approved: true};

        const context = createToolContext();

        const result = await exitPlanModeTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: true, pending: true});
        expect(readText(result)).toContain("请求退出计划模式：计划完成");
    });

    it("拒绝后终止", async () => {
        const params = {reason: "计划完成"};
        const userInput = {approved: false};

        const context = createToolContext();

        const result = await exitPlanModeTool.executeWithContext!(
            context,
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: false});
        expect(readText(result)).toBe("用户拒绝退出计划模式。");
    });
});

describe("向后兼容性", () => {
    it("request_user_input schema 保持向后兼容", () => {
        const tool = controlTools.requestUserInput.runtime();

        // 旧格式：带 defaultOptionIndex
        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "选择",
                    options: [{label: "A"}],
                    defaultOptionIndex: 0,
                },
            ],
        })).toBe(true);

        // 新格式：带 defaultSelected
        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "选择",
                    options: [
                        {label: "A", defaultSelected: true},
                        {label: "B"},
                    ],
                },
            ],
        })).toBe(true);

        // 多选格式
        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "多选",
                    options: [{label: "A"}, {label: "B"}],
                    multiSelect: true,
                    defaultOptionIndexes: [0, 1],
                },
            ],
        })).toBe(true);
    });

    it("plan mode schema 保持向后兼容", () => {
        const enterTool = controlTools.enterPlanMode.runtime();
        const exitTool = controlTools.exitPlanMode.runtime();

        // 带 reason
        expect(Value.Check(enterTool.parameters, {reason: "test"})).toBe(true);
        // 空对象
        expect(Value.Check(enterTool.parameters, {})).toBe(true);

        // 带 reason 和 planFilePath
        expect(Value.Check(exitTool.parameters, {
            reason: "done",
            planFilePath: ".agent/plan/test.md",
        })).toBe(true);
        // 空对象
        expect(Value.Check(exitTool.parameters, {})).toBe(true);
    });
});

function readText(result: AgentToolResult<unknown>): string {
    const item = result.content[0];
    if (!item || item.type !== "text") {
        throw new Error("测试期望工具返回 text content");
    }
    return item.text;
}

function createToolContext(): ToolExecutionContext {
    return {
        harness: {} as any,
        sessionId: 1,
        profileKey: "test-profile",
        workspaceRoot: "/test/workspace",
        workspaceKey: "test-workspace",
    };
}
