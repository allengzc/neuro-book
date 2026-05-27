import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {SessionSummarizerInputSchema, SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";

/**
 * 最小内置 session summarizer profile。真实提示词从 assets/workspace/.nbook 加载。
 */
export const sessionSummarizerProfile = defineAgentProfile({
    manifest: {
        key: "session.summarizer",
        name: "Session Summarizer",
        description: "Maintains display title and summary for an Agent session.",
    },
    inputSchema: SessionSummarizerInputSchema,
    outputSchema: SessionSummarizerOutputSchema,
    allowedToolKeys: ["report_result"],
    prepare() {
        return {
            systemPrompt: [
                "你是 NeuroBook 的后台 session 展示元数据摘要器。",
                "你只根据本轮用户消息中的 Agent Dialogue Content 生成展示用 title 和 summary。",
                "必须调用 report_result，data 必须包含 title 和 summary。",
                "title 简短具体，summary 用一句话概括当前会话进展。",
            ].join("\n"),
        };
    },
});
