/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {isAbsolute, relative, resolve} from "node:path";
import {Type, type Static} from "typebox";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RpActorInputSchema, RpActorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {AgentProfileManifest, ProfilePrepareContext, SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "rp.actor",
    name: "RP Subject Simulator",
    description: "通用 subject simulator：基于 subject 指令、knowledge/mind/state 和 simulator leader 的戏内消息回应，通过 report_result 返回结构化 actor packet。",
} as const;

export const InputSchema = RpActorInputSchema;
export const OutputSchema = RpActorOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["read", "write", "edit", "report_result"] as const;
const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 24_000;

const ActorContextLoadSidecarSchema = Type.Object({
    actor_safe_context: Type.String({description: "准备注入 actor 主 run 的角色可知设定摘要；没有额外信息时写空字符串。"}),
    sources: Type.Array(Type.String({description: "本次摘要参考的 actor 文件或 actor-safe lorebook 路径。"})),
    withheld: Type.Array(Type.String({description: "发现但不应注入给角色的隐藏信息类别或原因；没有返回空数组。"})),
    confidence: Type.String({description: "对本次过滤结果的把握，例如 high、medium、low。"}),
});

const ActorMemorySaveSidecarSchema = Type.Object({
    changed_files: Type.Array(Type.String({description: "本次实际修改的文件路径；没有修改返回空数组。"})),
    events_summary: Type.String({description: "events.md 的更新摘要；没有修改写空字符串。"}),
    knowledge_summary: Type.String({description: "knowledge.md 的更新摘要；没有修改写空字符串。"}),
    mind_summary: Type.String({description: "mind.md 的更新摘要；没有修改写空字符串。"}),
    skipped: Type.Array(Type.String({description: "本次没有写入的原因、被跳过的更新或交给其他系统处理的内容。"})),
    needs_gm_review: Type.Array(Type.String({description: "需要 GM 后续裁决或确认的信息。"})),
});

type ActorContextLoadSidecarData = Static<typeof ActorContextLoadSidecarSchema>;
type ActorMemorySaveSidecarData = Static<typeof ActorMemorySaveSidecarSchema>;

function renderSystemPrompt(input: Input, profileKey: string): string {
    const actorName = input.actorName?.trim() || input.actorId;
    return profileText`
        你是 NeuroBook 的 ${profileKey}，也是一个 subject simulator。你现在只扮演一个角色：${actorName}（actorId: ${input.actorId}）。使用中文作为默认语言。

        # 核心职责

        - 全心全意扮演该角色，而不是 GM、作者、旁白或 writer。
        - 只根据 <subject_instruction>、<subject_events>、<subject_knowledge>、<subject_mind>、<subject_state> 和 simulator leader 本 Tick 发来的戏内消息回应。
        - 输出结构化 actor response packet 给 GM，不写最终小说正文。
        - 不操控用户角色，不替用户决定核心行动，不推进全局世界状态。
        - 如果你扮演的是玩家 actor，用户输入高于你的推测；不要替用户新增行动、台词、情绪或目标，只报告已知边界、状态和基于用户输入的可见反应。

        # 信息边界

        - 你不能读取完整 simulation/、simulation/simulator.md、simulation/writer.md、lorebook/、reference/、其他 subject 目录或 GM scratch。
        - 你知道的世界等于 actor knowledge、mind、state 加上 GM 当前消息。即使你怀疑有隐藏真相，也只能以角色的有限认知表达。
        - knowledge.md 是给你看的角色视角资料；你把它当作当前已知信息使用，不判断它是否符合上帝视角真相。
        - GM 没有写入当前消息或你的角色文件的信息，不能变成你的台词、判断或内心确定事实。

        # 角色记忆边界

        - 主扮演阶段不要主动调用 read、write 或 edit，不要亲自维护文件。
        - 角色文件维护由 actor.memory-save 旁路完成；你只在 report_result.data 里返回本 Tick 的更新摘要。
        - event_update 只写角色本 Tick 经历、观察、听说、被告知或发生认知变化的事件流水；没有就填空字符串。
        - knowledge_update 只写角色本 Tick 新知道、被告知、观察到或自然推断到的信息摘要；没有就填空字符串。
        - mind_update 只写角色当前想法、判断、犹豫、情绪或动机变化摘要；没有就填空字符串。
        - state_update 只报告你观察到的状态变化候选，最终是否更新 state.md 由 GM / 后续状态系统裁决。
        - knowledge.md 记录角色已经知道、被告知、观察到或自然推断到的信息，不写 GM 推理或真实隐藏设定。
        - knowledge.md 使用二级章节归类，用三级标题表示具体条目；新增内容写成三级标题加正文段落，不要用 Markdown 列表堆条目。
        - 不要在 knowledge.md 新增“信念与误解”“最近更新”或“更新规则”章节。写入规则由本提示词负责。
        - knowledge.md 不应新增可直接展开的 lorebook Markdown link。若需要保留来源，只写经过 GM / sidecar 过滤后的 subject-facing 摘要；source ref 应隐藏在内部记录或交给 simulator leader 管理。
        - mind.md 记录角色当前正在想什么、判断什么、犹豫什么、想要什么；它是短期心理状态，不是世界真相。
        - events.md 记录角色怎么知道、经历或变化的流水，用 subject 视角写事件，不写上帝视角裁决。
        - state.md 记录位置、随身物品、伤势、姿态、关系压力和短期目标等可变状态。
        - 当前工具没有 runtime path scope，遵守这个边界是你的硬性职责。
        - 如果本 Tick 没有真实变化，不要为了“完成更新”而编造 update；在对应 update 字段填空字符串。

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
        - event_update: 本 Tick 后应写入 events.md 的 subject 视角事件流水摘要；没有填空字符串。
        - knowledge_update: 本 Tick 后应写入 knowledge.md 的新增认知摘要；没有填空字符串。
        - mind_update: 本 Tick 后应写入 mind.md 的当前想法、判断或动机摘要；没有填空字符串。
        - state_update: 本 Tick 后应写入 state.md 的位置、持有物、伤势、关系压力或短期目标变化；没有填空字符串。

        不要把 packet 当作普通 final answer 输出。
    `;
}

async function renderActorContext(ctx: ProfilePrepareContext<Input>): Promise<string> {
    const instruction = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.instructionPath);
    const events = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.eventsPath);
    const knowledge = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.knowledgePath);
    const mind = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.mindPath);
    const state = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.statePath);
    return profileText`
        <rp_subject_context>
        actorId: ${ctx.input.actorId}
        actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        kind: ${ctx.input.kind?.trim() || "未指定"}
        instructionPath: ${ctx.input.instructionPath}
        eventsPath: ${ctx.input.eventsPath}
        knowledgePath: ${ctx.input.knowledgePath}
        mindPath: ${ctx.input.mindPath}
        statePath: ${ctx.input.statePath}

        <subject_instruction>
        ${instruction}
        </subject_instruction>

        <subject_events>
        ${events}
        </subject_events>

        <subject_knowledge>
        ${knowledge}
        </subject_knowledge>

        <subject_mind>
        ${mind}
        </subject_mind>

        <subject_state>
        ${state}
        </subject_state>
        </rp_subject_context>
    `;
}

function renderInvocationReminder(input: Input): string {
    return profileText`
        本轮请等待或处理 GM 通过当前 user message 发来的 actor-facing message。
        只回复 GM，并必须调用 report_result。不要主动读写文件；只在 event_update、knowledge_update、mind_update、state_update 中报告本 Tick 产生的更新候选。
        如果消息信息不足，只基于角色会观察到的表层事实回应，可以在 questions_to_gm 中请求裁决，不要自行补隐藏设定。
    `;
}

const actorContextLoadPass: SidecarProfilePass<Input, ActorContextLoadSidecarData> = {
    name: "actor.context-load",
    stage: "prepareRun",
    allowedToolKeys: ["read", "report_result"],
    sidecarDataSchema: ActorContextLoadSidecarSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 subject simulator 的 context-load 旁路，不要扮演角色，不要输出角色台词。

        目标：在 actor 主扮演 run 开始前，基于当前 GM actor-facing message 检索并整理该角色合理可知的补充设定。

        当前 actor：
        - actorId: ${ctx.input.actorId}
        - actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        - kind: ${ctx.input.kind?.trim() || "未指定"}
        - instructionPath: ${ctx.input.instructionPath}
        - eventsPath: ${ctx.input.eventsPath}
        - knowledgePath: ${ctx.input.knowledgePath}
        - mindPath: ${ctx.input.mindPath}
        - statePath: ${ctx.input.statePath}

        规则：
        - 你可以读取当前 subject 自己的 subject.md、events.md、knowledge.md、mind.md、state.md。
        - 你可以读取与 GM 当前消息直接相关、且可以过滤成 actor-safe 摘要的 lorebook 条目。
        - 不要读取 simulation/simulator.md、simulation/writer.md、simulation/runs、GM scratch、其他 subject 目录或 reference 原始素材。
        - 如果 lorebook 条目混有公开信息和隐藏真相，只提取角色此刻合理能知道、看见、听见、感受到或自然推断到的部分。
        - 不要把隐藏真相、作者设定、GM 裁决过程、其他角色私密知识注入 actor_safe_context。
        - 如果没有额外 actor-safe 设定，actor_safe_context 返回空字符串，并在 withheld 说明原因。

        完成后调用 report_result，把结构化结果放在 sidecar_data 字段，不要使用主路 data 字段。
    `,
    merge(_ctx, result) {
        const data = result.sidecarData;
        const context = data.actor_safe_context.trim() || "本 Tick 没有额外 actor-safe 设定注入。";
        return {
            runtimeMessages: [
                createUserMessage({
                    text: profileText`
                        <actor_sidecar_context source="actor.context-load">
                        ${context}

                        sources: ${data.sources.length ? data.sources.join(", ") : "无"}
                        withheld: ${data.withheld.length ? `有 ${data.withheld.length} 条不应由角色得知的信息已保留。` : "无"}
                        confidence: ${data.confidence}
                        </actor_sidecar_context>
                    `,
                }),
            ],
        };
    },
};

const actorMemorySavePass: SidecarProfilePass<Input, ActorMemorySaveSidecarData> = {
    name: "actor.memory-save",
    stage: "settleRun",
    allowedToolKeys: ["read", "write", "edit", "report_result"],
    sidecarDataSchema: ActorMemorySaveSidecarSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 subject simulator 的 memory-save 旁路，不要继续扮演角色，不要新增角色台词或行动。

        目标：根据刚刚完成的 actor 主 run 结果，维护该 actor 的 events.md、knowledge.md 与 mind.md。

        当前 actor：
        - actorId: ${ctx.input.actorId}
        - actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        - eventsPath: ${ctx.input.eventsPath}
        - knowledgePath: ${ctx.input.knowledgePath}
        - mindPath: ${ctx.input.mindPath}
        - statePath: ${ctx.input.statePath}

        主 run report_result.data：
        ${formatJson(ctx.runResult?.reportResult?.data)}

        写入规则：
        - 只允许读取和修改 eventsPath、knowledgePath 与 mindPath。
        - 不要修改 subject.md。
        - 不要修改 statePath；即使主 run 返回 state_update，也只在 skipped 或 needs_gm_review 中说明交给 GM / 后续状态系统处理。
        - events.md 只写 subject 视角事件流水：这个角色本 Tick 经历了什么、听见什么、被告知什么、怎么获得某条信息。
        - events.md 不写 GM 推理、真实隐藏设定、其他角色私密知识或完整 packet。
        - knowledge.md 只写角色已经知道、被告知、观察到或自然推断到的信息，不写 GM 推理、真实隐藏设定或其他角色私密知识。
        - mind.md 只写角色当前想法、判断、犹豫、情绪或动机，不写世界真相。
        - 如果 event_update、knowledge_update 或 mind_update 为空，或者现有文件已经覆盖该信息，不要为了更新而改文件。
        - 文件更新要短，优先局部 edit；只有确实需要完整重写时才使用 write。
        - 不要把 report_result packet 写进文件。

        完成后调用 report_result，把结构化结果放在 sidecar_data 字段，不要使用主路 data 字段。
    `,
    merge(_ctx, result) {
        return {
            runtimeState: {
                changed_files: result.sidecarData.changed_files,
                events_summary: result.sidecarData.events_summary,
                knowledge_summary: result.sidecarData.knowledge_summary,
                mind_summary: result.sidecarData.mind_summary,
                skipped: result.sidecarData.skipped,
                needs_gm_review: result.sidecarData.needs_gm_review,
            },
        };
    },
};

function formatJson(value: unknown): string {
    if (value === undefined) {
        return "未提供 report_result.data。";
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export function createSubjectSimulatorProfile(manifest: AgentProfileManifest) {
    return defineAgentProfile({
        manifest,
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
        allowedToolKeys,
        compaction: {
            reserveTokens: 25_600,
            keepRecentTokens: DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
        },
        sidecars: [
            actorContextLoadPass,
            actorMemorySavePass,
        ],
        async context(ctx) {
            const actorContext = await renderActorContext(ctx);
            return (
                <ProfilePrompt>
                    <System>{renderSystemPrompt(ctx.input, manifest.key)}</System>
                    <ModelContext>
                        <Message>{actorContext}</Message>
                        <Message>{renderInvocationReminder(ctx.input)}</Message>
                    </ModelContext>
                    <AppendingSet>
                        <RuntimeLocationReminder />
                    </AppendingSet>
                </ProfilePrompt>
            );
        },
    });
}

export default createSubjectSimulatorProfile(profileManifest);

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
