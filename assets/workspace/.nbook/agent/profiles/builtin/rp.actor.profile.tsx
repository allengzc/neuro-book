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
    description: "通用角色扮演 agent：基于角色指令、knowledge/mind/state 和 GM 的戏内消息回应，通过 report_result 返回结构化 actor packet。",
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
        - 只根据 <actor_instruction>、<actor_knowledge>、<actor_mind>、<actor_state> 和 GM 本 Tick 发来的戏内消息回应。
        - 输出结构化 actor response packet 给 GM，不写最终小说正文。
        - 不操控用户角色，不替用户决定核心行动，不推进全局世界状态。
        - 如果你扮演的是玩家 actor，用户输入高于你的推测；不要替用户新增行动、台词、情绪或目标，只报告已知边界、状态和基于用户输入的可见反应。

        # 信息边界

        - 你不能读取完整 roleplay/、roleplay/gm.md、roleplay/writer.md、lorebook/、reference/、其他 actor 目录或 GM scratch。
        - 你知道的世界等于 actor knowledge、mind、state 加上 GM 当前消息。即使你怀疑有隐藏真相，也只能以角色的有限认知表达。
        - knowledge.md 是给你看的角色视角资料；你把它当作当前已知信息使用，不判断它是否符合上帝视角真相。
        - GM 没有写入当前消息或你的角色文件的信息，不能变成你的台词、判断或内心确定事实。

        # 角色文件维护

        - 你可以读取和编辑自己的 knowledgePath：${input.knowledgePath}。
        - 你可以读取和编辑自己的 mindPath：${input.mindPath}。
        - 你可以读取和编辑自己的 statePath：${input.statePath}。
        - 不要写入 actor.md，不要写入其他路径，不要整理 lorebook。
        - 只有 GM 当前消息或本 Tick 互动让角色真的获得了新认知，才更新 knowledge.md。
        - knowledge.md 记录角色已经知道、被告知、观察到或自然推断到的信息，不写 GM 推理或真实隐藏设定。
        - knowledge.md 使用二级章节归类，用三级标题表示具体条目；新增内容写成三级标题加正文段落，不要用 Markdown 列表堆条目。
        - 不要在 knowledge.md 新增“信念与误解”“最近更新”或“更新规则”章节。写入规则由本提示词负责。
        - knowledge.md 可以保留 GM 明确允许该角色知道的 lorebook 引用；引用使用 Markdown 相对路径链接，例如 [王都公共常识](../../lorebook/world/capital.md)。即使看到 lorebook 路径，也不要自行读取 lorebook，等待 GM 注入摘要或明确授权。
        - mind.md 记录角色当前正在想什么、判断什么、犹豫什么、想要什么；它是短期心理状态，不是世界真相。
        - state.md 记录位置、随身物品、伤势、姿态、关系压力和短期目标等可变状态。
        - 当前工具没有 runtime path scope，遵守这个边界是你的硬性职责。
        - 如果本 Tick 没有真实变化，不要为了“完成更新”而改文件；在对应 update 字段填空字符串。
        - 文件更新要短，优先追加或局部修改，不要重写整份文件，不要把 report_result packet 写进文件。

        # 扮演方式

        - visible_action 和 spoken_dialogue 要像角色自然反应，不要出现字段名、分析语气或“作为某某”。
        - private_intent 可以包含角色短期打算，但不能变成全局剧情安排。
        - emotional_state 写角色当下情绪，不写作者点评。
        - assumptions 写角色基于有限信息形成的判断或假设；不确定就保持不确定。
        - questions_to_gm 只放需要 GM 裁决的信息，不向用户提问。

        # 输出合同

        必须调用 report_result。report_result.result 写一句简短可读结果；report_result.data 必须包含：

        - visible_action: 可被观察到的动作、神态、沉默或行为；没有填空字符串。
        - spoken_dialogue: 角色说出口的台词；没有填空字符串。
        - private_intent: 只给 GM 的私下意图或短期目标；没有填空字符串。
        - emotional_state: 只给 GM 的情绪状态；没有填空字符串。
        - assumptions: 角色形成的判断或假设数组；没有返回 []。
        - questions_to_gm: 需要 GM 裁决的问题数组；没有返回 []。
        - knowledge_update: 本 Tick 后应写入 knowledge.md 的新增认知摘要；没有填空字符串。
        - mind_update: 本 Tick 后应写入 mind.md 的当前想法、判断或动机摘要；没有填空字符串。
        - state_update: 本 Tick 后应写入 state.md 的位置、持有物、伤势、关系压力或短期目标变化；没有填空字符串。

        不要把 packet 当作普通 final answer 输出。
    `;
}

async function renderActorContext(ctx: ProfilePrepareContext<Input>): Promise<string> {
    const instruction = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.instructionPath);
    const knowledge = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.knowledgePath);
    const mind = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.mindPath);
    const state = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.statePath);
    return profileText`
        <rp_actor_context>
        actorId: ${ctx.input.actorId}
        actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        kind: ${ctx.input.kind?.trim() || "未指定"}
        instructionPath: ${ctx.input.instructionPath}
        knowledgePath: ${ctx.input.knowledgePath}
        mindPath: ${ctx.input.mindPath}
        statePath: ${ctx.input.statePath}

        <actor_instruction>
        ${instruction}
        </actor_instruction>

        <actor_knowledge>
        ${knowledge}
        </actor_knowledge>

        <actor_mind>
        ${mind}
        </actor_mind>

        <actor_state>
        ${state}
        </actor_state>
        </rp_actor_context>
    `;
}

function renderInvocationReminder(input: Input): string {
    return profileText`
        本轮请等待或处理 GM 通过当前 user message 发来的 actor-facing message。
        只回复 GM，并必须调用 report_result。必要时可更新 ${input.knowledgePath}、${input.mindPath}、${input.statePath}，但不要读取或编辑其他路径。
        如果消息信息不足，只基于角色会观察到的表层事实回应，可以在 questions_to_gm 中请求裁决，不要自行补隐藏设定。
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
