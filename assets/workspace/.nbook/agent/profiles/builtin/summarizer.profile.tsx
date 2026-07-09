/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import type {AgentRuntimeHookContext} from "nbook/server/agent/profiles/define-agent-runtime";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {SessionSummarizerInitialSchema, SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "summarizer",
    name: "会话摘要",
    description: "后台元数据维护 agent：自动维护 Agent session 的显示标题与摘要。",
} as const;

export const InitialSchema = SessionSummarizerInitialSchema;
export const OutputSchema = SessionSummarizerOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    runtime: defineAgentRuntime<Initial>({
        hooks: [
            agentRuntimeBuiltins.profilePrompt<Initial>(),
            agentRuntimeBuiltins.sessionContext<Initial>(),
            agentRuntimeBuiltins.reportResult<Initial>(),
            agentRuntimeBuiltins.runtimeOnlyTranscript<Initial>(),
            {
                name: "write-source-summary",
                stage: "settleRun",
                async run(ctx) {
                    const data = normalizeSummaryResult(ctx.runResult?.reportResult?.data);
                    const state = await readSourceState(ctx.initial.sourceSessionId, ctx);
                    if (!data || !state.running || state.sourceLeafId !== (await ctx.session.read(ctx.initial.sourceSessionId)).snapshot.leafId) {
                        return {
                            writePlans: [{
                                target: {sessionId: ctx.initial.sourceSessionId},
                                cause: "summarizer.stale",
                                ops: [{
                                    kind: "append",
                                    projection: true,
                                    entry: {
                                        type: "custom",
                                        key: "summarizer.state",
                                        value: jsonState({
                                            ...state,
                                            running: false,
                                            dirty: true,
                                            ...(data ? {} : {lastError: "summarizer 缺少有效 report_result.data。"}),
                                        }),
                                    },
                                }],
                            }],
                        };
                    }
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.initial.sourceSessionId},
                            cause: "summarizer.writeback",
                            ops: [
                                {
                                    kind: "append",
                                    projection: {
                                        scope: "activeLeaf",
                                        leafId: state.sourceLeafId,
                                    },
                                    entry: {
                                        type: "session_update",
                                        updates: data,
                                    },
                                },
                                {
                                    kind: "append",
                                    projection: true,
                                    entry: {
                                        type: "custom",
                                        key: "summarizer.state",
                                        value: jsonState({
                                            ...state,
                                            running: false,
                                            dirty: state.dirty === true,
                                            lastRunAt: Date.now(),
                                            lastDialogueContentFingerprint: state.runningDialogueContentFingerprint,
                                            lastDialogueContentTokens: state.runningDialogueContentTokens,
                                            sourcePromptUserTurnCount: state.runningSourcePromptUserTurnCount,
                                        }),
                                    },
                                },
                            ],
                        }],
                    };
                },
            },
        ],
    }),
    async context(ctx) {
        const dialogue = await ctx.session.agentDialogueContent({
            sessionId: ctx.initial.sourceSessionId,
            profileKey: "summarizer",
            initial: ctx.initial,
        });
        return (
            <ProfilePrompt>
                <System>
                    {[
                        "你是 NeuroBook 的后台 session 展示元数据摘要器。",
                        "你会收到一段 Agent Dialogue Content，它是源 session 当前 active path 的可见正文。",
                        "只根据这段正文生成展示用 title 和 summary，不要编造文件、工具结果或未出现的结论。",
                        "title 必须简短具体，不超过 32 个中文字符。",
                        "summary 用一句话概括当前会话目标、已完成进展或最新状态，不超过 240 个中文字符。",
                        "必须调用 report_result，report_result.data 必须是 { title, summary }。",
                    ].join("\n")}
                </System>
                <ModelContext>
                    <Message>{dialogue.text || "当前 source session 没有可摘要的 Agent Dialogue Content。"}</Message>
                </ModelContext>
            </ProfilePrompt>
        );
    },
});

function normalizeSummaryResult(value: unknown): Output | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as {title?: unknown; summary?: unknown};
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 80) : "";
    const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 500) : "";
    if (!title || !summary) {
        return null;
    }
    return {title, summary};
}

async function readSourceState(sourceSessionId: number, ctx: AgentRuntimeHookContext<Initial>): Promise<{
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    sessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
    sourcePromptUserTurnCount?: number;
    runningDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningSourcePromptUserTurnCount?: number;
    summarizerInputFingerprint?: string;
}> {
    const source = await ctx.session.read(sourceSessionId);
    const value = source.context.customState["summarizer.state"];
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonState(state: {
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    sessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
    sourcePromptUserTurnCount?: number;
    runningDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningSourcePromptUserTurnCount?: number;
    summarizerInputFingerprint?: string;
}): Record<string, string | number | boolean | null> {
    return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean | null>;
}
