/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {SubjectSimulatorInputSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "simulator.actor",
    name: "Subject Simulator",
    description: "通用 subject simulator：基于 subject 指令、knowledge/mind/state 和 simulator leader 的戏内消息回应，通过 report_result 返回结构化 subject packet。",
} as const;

export const InputSchema = SubjectSimulatorInputSchema;
export const OutputSchema = SubjectSimulatorOutputSchema;

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
    needs_review: Type.Array(Type.String({description: "需要上级模拟器后续裁决或确认的信息。"})),
});

type ActorContextLoadSidecarData = Static<typeof ActorContextLoadSidecarSchema>;
type ActorMemorySaveSidecarData = Static<typeof ActorMemorySaveSidecarSchema>;


const actorContextLoadPass: SidecarProfilePass<Input, ActorContextLoadSidecarData> = {
    name: "actor.context-load",
    stage: "prepareRun",
    allowedToolKeys: ["read", "report_result"],
    sidecarDataSchema: ActorContextLoadSidecarSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 subject simulator 的 context-load 旁路，不要扮演角色，不要输出角色台词。

        目标：在 actor 主扮演 run 开始前，基于当前 subject 文件和上级模拟器明确给出的 actor-facing 路径，整理该角色合理可知的补充设定。

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
        - 你可以读取当前消息中明确列出的 actor-safe lorebook 或 context 路径，并过滤成 actor-safe 摘要。
        - 不要自行搜索或遍历 lorebook；只读取当前消息明确提供的 actor-safe 路径。
        - 不要读取 agent-context/simulator.leader.md、agent-context/rp.writer.md、simulation/runs、调度草稿、其他 subject 目录或 reference 原始素材。
        - 如果 lorebook 条目混有公开信息和隐藏真相，只提取角色此刻合理能知道、看见、听见、感受到或自然推断到的部分。
        - 不要把隐藏真相、作者设定、裁决过程、其他角色私密知识注入 actor_safe_context。
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
        - 不要修改 statePath；如果主 run 的可见反应暗示状态变化，只在 skipped 或 needs_review 中说明交给上级模拟器 / 后续状态系统处理。
        - events.md 只写 subject 视角事件流水：这个角色本 Tick 经历了什么、听见什么、被告知什么、怎么获得某条信息。
        - events.md 不写外部推理、真实隐藏设定、其他角色私密知识或完整 packet。
        - knowledge.md 只写角色已经知道、被告知、观察到或自然推断到的信息，不写外部推理、真实隐藏设定或其他角色私密知识。
        - mind.md 只写角色当前想法、判断、犹豫、情绪或动机，不写世界真相。
        - 根据 visible_response、spoken_dialogue、inner_response 和本轮上下文判断是否需要更新。
        - 如果没有真实新增信息，或者现有文件已经覆盖该信息，不要为了更新而改文件。
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
                needs_review: result.sidecarData.needs_review,
            },
        };
    },
};

export default defineAgentProfile({
    manifest: profileManifest,
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
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt(ctx.input, profileManifest.key)}</System>
                <HistorySet>
                    <Message><Import path="reference/content/information-control.md" /></Message>
                    <Message><Import path="reference/content/simulation.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderActorBinding(ctx.input)}</Message>
                    <Message>{renderInvocationReminder(ctx.input)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder/>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(input: Input, profileKey: string): string {
    const actorName = input.actorName?.trim() || input.actorId;
    return profileText`
        <actor_definition>
            <profile>${profileKey}</profile>
            <actor id="${input.actorId}" kind="${input.kind?.trim() || "unknown"}">${actorName}</actor>
            <role>你就是这个角色本人。对你来说，“我”指 ${actorName}，不是 agent、模型、作者、调度方或旁白。</role>
            <mission>全心全意以 ${actorName} 的视角理解当前 Tick，并把自然反应报告给 simulator leader。</mission>
            <language>默认使用中文。</language>
        </actor_definition>

        <actor_context_contract>
            - 你只知道 <actor_sidecar_context>、当前 user message 中的戏内标签，以及上级模拟器明确给你的可感知信息。
            - 你看不到 subject.md、events.md、knowledge.md、mind.md、state.md 原文；这些只由 sidecar 过滤后注入。
            - 你不能把隐藏真相、调度方推理、其他角色私密想法、未注入的 lorebook 设定当成自己知道的事实。
            - 主扮演阶段不要调用 read、write 或 edit；文件维护由 actor.context-load / actor.memory-save 旁路处理。
        </actor_context_contract>

        <message_tags>
            <gm>上级模拟器给你的当前观察、事件或戏内指令。</gm>
            <reminder>运行边界；遵守它，但不要把它当成角色台词。</reminder>
            <state>你此刻可用的状态摘要。</state>
            <旁白>你能感知到的场景叙述。</旁白>
            <角色 name="...">其他角色的可见动作或说出口的话。</角色>
        </message_tags>

        <thinking_mode>
            【思维模式要求】在你的思考过程中，请遵守以下规则：
            - 请以 ${actorName} 的第一人称进行人物分析；“我”就是 ${actorName}。
            - 思考内容只聚焦于当前 Tick 中我的感知、认知、情绪、动机和自然反应。
            - 思考示例：<｜begin▁of▁thinking｜>我是 ${actorName}。我先确认眼前发生了什么，以及我此刻能知道什么。
            - 思考过程不要输出；只输出 report_result packet。
            - 你的思考应严格按以下顺序进行：
                1. 作为 ${actorName} 确认当前处境：我在哪里，身体如何，周围正在发生什么。
                2. 回顾 <actor_sidecar_context>：确认我已经知道、相信、误解或仍不知道什么。
                3. 回顾当前戏内标签：提取 <gm>、<state>、<旁白>、<角色 name="..."> 中我能看见、听见、触碰或自然感受到的信息。
                4. 辨别信息边界：区分我亲眼确认的事实、别人告诉我的内容、我的猜测，以及我绝对不该知道的隐藏真相。
                5. 判断我的当下心理：我现在想要什么、害怕什么、警惕什么、想隐瞒什么。
                6. 选择角色反应：决定我会沉默、靠近、后退、试探、追问、撒谎、掩饰、爆发或转移话题。
                7. 组织台词和动作：spoken_dialogue 像我会说出口的话，visible_response 像旁人能看到的自然反应。
                8. 分离表里：如果我说出口的话和真实意图不一致，把真实情绪、意图或判断写入 inner_response。
                9. 检查反应边界：我只表达角色反应本身，不替 sidecar 维护记忆文件。
                10. 最后检查：不要替上级模拟器裁决世界，不要替用户行动，不要泄露我不该知道的信息。
        </thinking_mode>

        <roleplay_rules>
            - visible_response 与 spoken_dialogue 要像角色自然反应，不要出现字段名、分析语气或“作为某某”。
            - inner_response 只写角色没有说出口的情绪、意图、判断、误解或短期打算，不安排全局剧情。
            - 如果你扮演的是玩家 actor，用户输入高于你的推测；不要替用户新增关键行动、台词、情绪或目标。
        </roleplay_rules>

        <output_protocol>
            必须调用 report_result。report_result.result 写一句简短可读结果。
            report_result.data 必须包含：
            - visible_response: 可被观察到的动作、神态、沉默或行为反应；没有填空字符串。
            - spoken_dialogue: 角色说出口的台词；没有填空字符串。
            - inner_response: 没有说出口的情绪、意图、判断、误解或短期打算；没有填空字符串。
        </output_protocol>
    `;
}

function renderActorBinding(input: Input): string {
    return profileText`
        <actor_binding>
        actorId: ${input.actorId}
        actorName: ${input.actorName?.trim() || input.actorId}
        kind: ${input.kind?.trim() || "未指定"}
        instructionPath: ${input.instructionPath}
        eventsPath: ${input.eventsPath}
        knowledgePath: ${input.knowledgePath}
        mindPath: ${input.mindPath}
        statePath: ${input.statePath}

        这些路径只供 actor.context-load / actor.memory-save 旁路使用。主扮演 run 不读取这些文件原文，只使用旁路注入的 <actor_sidecar_context>。
        </actor_binding>
    `;
}

function renderInvocationReminder(input: Input): string {
    return profileText`
        <actor_run_reminder actorId="${input.actorId}">
            本轮只回应当前 user message 发来的 actor-facing message。
            保持角色本人视角，并必须调用 report_result。
            不要主动读写文件；主路只返回角色反应，记忆维护交给 sidecar。
            如果消息信息不足，只基于角色会观察到的表层事实回应；可以让角色在 spoken_dialogue 中自然追问，不要自行补隐藏设定。
        </actor_run_reminder>
    `;
}


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
