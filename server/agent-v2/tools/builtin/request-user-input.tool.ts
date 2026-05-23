import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {RequestUserInputToolArgsSchema} from "nbook/server/agent-v2/dto/agent-chat.dto";

/**
 * 向前端发起结构化提问。
 * 该工具本身不直接完成问题，而是由运行协调器识别后切换到 waiting_user。
 */
export const requestUserInputTool: AgentTool<typeof RequestUserInputToolArgsSchema> = {
    key: "request_user_input",
    description: "Ask the user one or more questions and wait. Pass questions[]. Empty options means an open-ended question. For choice questions, set multiSelect=true when the user may select multiple options. The UI already allows a free-form or other answer, so do not add generic fallback choices such as \"I have my own idea\" or \"Other\"; provide only meaningful choices.",
    schema: RequestUserInputToolArgsSchema,
    async execute(input) {
        const rawResult = {
            kind: "pending_user_input",
            questions: input.questions,
        };
        return {
            ...createToolResultMessage(`Waiting for user input: ${String(input.questions.length)} question(s)`, JSON.stringify(input)),
            rawResult,
        };
    },
};
