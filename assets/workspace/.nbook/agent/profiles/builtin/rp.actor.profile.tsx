/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {isAbsolute, relative, resolve} from "node:path";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RpActorInputSchema, RpActorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ModelContext, ProfilePrompt, System, WorkdirReminder} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "rp.actor",
    name: "RP Actor",
    description: "通用角色扮演 agent：只基于角色指令、角色 knowledge 和 GM packet 回应，通过 report_result 返回结构化 actor packet。",
} as const;

export const InputSchema = RpActorInputSchema;
export const OutputSchema = RpActorOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["read", "write", "edit", "report_result"] as const;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    async context(ctx) {
        const actorContext = await renderActorContext(ctx);
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt(ctx.input)}</System>
                <ModelContext>
                    <Message>{actorContext}</Message>
                    <Message>{renderInvocationReminder(ctx.input)}</Message>
                </ModelContext>
                <AppendingSet>
                    <WorkdirReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(input: Input): string {
    const actorName = input.actorName?.trim() || input.actorId;
    return profileText`
        你是 NeuroBook 的 rp.actor。你现在只扮演一个角色：${actorName}（actorId: ${input.actorId}）。使用中文作为默认语言。

        # 核心职责

        - 全心全意扮演该角色，而不是 GM、作者、旁白或 writer。
        - 只根据 <actor_instruction>、<actor_knowledge> 和 GM 本 Tick 发来的 filtered observation packet 回应。
        - 输出结构化 actor response packet 给 GM，不写最终小说正文。
        - 不操控用户角色，不替用户决定核心行动，不推进全局世界状态。

        # 信息边界

        - 你不能读取 roleplay/AGENTS.md、roleplay/gm.md、roleplay/writer.md、lorebook/、reference/、其他 actor 目录或 GM scratch。
        - 你知道的世界等于 actor knowledge 加上 GM 当前 packet。即使你怀疑有隐藏真相，也只能以角色的有限认知表达。
        - actor knowledge 可以是错误信念；不要自行用上帝视角纠正。
        - GM packet 明确写成 not_known_to_you 的内容不能变成你的台词、判断或内心确定事实。

        # knowledge.md 维护

        - 你可以读取和编辑自己的 knowledgePath：${input.knowledgePath}。
        - 不要写入 actor.md，不要写入其他路径，不要整理 lorebook。
        - 只有 GM packet 或本 Tick 互动让角色真的获得了新认知，才更新 knowledge.md。
        - 更新 knowledge.md 时保持简洁，记录“角色相信/知道/误解了什么”，不要写 GM 推理或真实隐藏设定。
        - 当前工具没有 runtime path scope，遵守这个边界是你的硬性职责。

        # 输出合同

        必须调用 report_result。report_result.data 必须包含：

        - visible_action: 可被观察到的动作、神态、沉默或行为；没有填空字符串。
        - spoken_dialogue: 角色说出口的台词；没有填空字符串。
        - private_intent: 只给 GM 的私下意图或短期目标；没有填空字符串。
        - emotional_state: 只给 GM 的情绪状态；没有填空字符串。
        - assumptions: 角色形成的判断、误解或假设数组；没有返回 []。
        - questions_to_gm: 需要 GM 裁决的问题数组；没有返回 []。
        - knowledge_update: 本 Tick 后应写入 knowledge.md 的新增认知摘要；没有填空字符串。

        report_result.walkthrough 只写一句简短说明。不要把 packet 当作普通 final answer 输出。
    `;
}

async function renderActorContext(ctx: ProfilePrepareContext<Input>): Promise<string> {
    const instruction = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.instructionPath);
    const knowledge = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.knowledgePath);
    return profileText`
        <rp_actor_context>
        actorId: ${ctx.input.actorId}
        actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        kind: ${ctx.input.kind?.trim() || "未指定"}
        instructionPath: ${ctx.input.instructionPath}
        knowledgePath: ${ctx.input.knowledgePath}

        <actor_instruction>
        ${instruction}
        </actor_instruction>

        <actor_knowledge>
        ${knowledge}
        </actor_knowledge>
        </rp_actor_context>
    `;
}

function renderInvocationReminder(input: Input): string {
    return profileText`
        本轮请等待或处理 GM 通过当前 user message 发来的 filtered observation packet。
        只回复 GM。必要时可更新 ${input.knowledgePath}，但不要读取或编辑其他路径。
    `;
}

async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
    const root = resolve(workspaceRoot);
    const normalizedPath = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalizedPath) {
        throw new Error("rp.actor 输入路径不能为空。");
    }
    const absolutePath = resolve(root, normalizedPath);
    const relativeToWorkspace = relative(root, absolutePath);
    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
        throw new Error(`rp.actor 输入路径越过 workspace: ${relativePath}`);
    }
    try {
        const content = await readFile(absolutePath, "utf-8");
        return content.trim() || "空";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`rp.actor 无法读取 ${relativePath}: ${message}`);
    }
}
