/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {SessionSummarizerInputSchema, SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";

export const profileManifest = {
    key: "session.summarizer",
    name: "Session Summarizer",
    description: "Background profile that maintains display title and summary for an Agent session.",
} as const;

export const InputSchema = SessionSummarizerInputSchema;
export const OutputSchema = SessionSummarizerOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys: ["report_result"],
    prepare() {
        return {
            systemPrompt: [
                "你是 NeuroBook 的后台 session 展示元数据摘要器。",
                "你会收到一段 Agent Dialogue Content，它是源 session 当前 active path 的可见正文。",
                "只根据这段正文生成展示用 title 和 summary，不要编造文件、工具结果或未出现的结论。",
                "title 必须简短具体，不超过 32 个中文字符。",
                "summary 用一句话概括当前会话目标、已完成进展或最新状态，不超过 240 个中文字符。",
                "必须调用 report_result，report_result.data 必须是 { title, summary }。",
            ].join("\n"),
        };
    },
});
