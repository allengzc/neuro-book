/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
import {SubjectSimulatorInputSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "simulator.actor",
    name: "角色模拟",
    description: "通用 subject simulator：以角色第一人称消费 actor-facing packet（<gm>/<character>/<knowledge>/<directive>），结合 RAG memory 与 mind/state，通过 report_result 返回第一人称三通道反应。",
} as const;

export const InputSchema = SubjectSimulatorInputSchema;
export const OutputSchema = SubjectSimulatorOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const toolKeys = ["subject_rag_search", "subject_event_append", "subject_memory_update", "read", "edit", "report_result"] as const;

const ActorContextLoadSidecarSchema = Type.String({
    description: "准备注入 actor 主 run 的角色可知纯文本上下文；没有额外信息时返回空字符串。",
});

const ActorMemorySaveSidecarSchema = Type.Object({
    changed_files: Type.Array(Type.String({description: "本次实际修改的文件路径；没有修改返回空数组。"})),
    events_summary: Type.String({description: "events.jsonl 的更新摘要；没有修改写空字符串。"}),
    memory_summary: Type.String({description: "memory.jsonl 的更新摘要；没有修改写空字符串。"}),
    mind_summary: Type.String({description: "mind.md 的更新摘要；没有修改写空字符串。"}),
    skipped: Type.Array(Type.String({description: "本次没有写入的原因、被跳过的更新或交给其他系统处理的内容。"})),
    needs_review: Type.Array(Type.String({description: "需要上级模拟器后续裁决或确认的信息。"})),
});

type ActorContextLoadSidecarData = Static<typeof ActorContextLoadSidecarSchema>;
type ActorMemorySaveSidecarData = Static<typeof ActorMemorySaveSidecarSchema>;


const actorContextLoadPass: SidecarProfilePass<Input, ActorContextLoadSidecarData> = {
    name: "actor.context-load",
    stage: "prepareRun",
    toolKeys: ["subject_rag_search", "report_result"],
    sidecarDataSchema: ActorContextLoadSidecarSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 subject simulator 的 context-load 旁路，是一个纯 RAG 检索器，不要扮演角色，不要输出角色台词。

        目标：在 actor 主扮演 run 开始前，只通过 subject RAG 检索当前 subject 自己的 events.jsonl 与 memory.jsonl，整理出该角色合理可知的过往经历与稳定认知摘要，注入主路。

        当前 actor：
        - actorId: ${actorIdFromSubjectPath(ctx.input)}
        - subjectPath: ${subjectDirectoryPath(ctx.input)}

        <thinking>
            先想清楚本 Tick 我要替这个角色召回什么：当前 actor-facing message 涉及哪些人、地点、物品、悬念？哪些过往经历或稳定看法会影响他此刻的反应？据此组织检索 query，再分别检索 events 和 memory。
        </thinking>

        <task_steps>
            1. 理解检索意图：阅读当前 actor-facing message，归纳本轮最相关的检索目标（人物、地点、物品、关系、悬念），形成 1-2 个简短 query。
            2. 检索经历：以 sources=["events"] 调用 subject_rag_search 粗召回当前 subject 的经历流。
            3. 检索认知：以 sources=["memory"] 调用 subject_rag_search 粗召回当前 subject 的稳定认知。
            4. rerank 去重：对两次粗召回结果做相关性排序、去重、过滤掉与本轮无关的条目。
            5. 裁剪预算：最多保留 6 条相关过往经历和 4 条相关稳定认知，并限制 sidecar_data 总长度。
            6. report：调用 report_result，把整理后的纯文本摘要放进 sidecar_data。
        </task_steps>

        规则：
        - 你是纯 RAG 检索器：只允许调用 subject_rag_search 和 report_result。
        - 不读取任何文件：不读 subject.md、soul.md、mind.md、state.md、events.jsonl、memory.jsonl 原文，也不读 lorebook、simulation/runs、其他 subject 目录或 reference 素材。soul.md 已经在主路上下文中，actor 主 run 会直接看到，你不需要也不能重复读取。
        - 调用 subject_rag_search 时，subjectPath 必须使用上面的 subjectPath。
        - subject_rag_search 必须显式指定且只能指定一个 sources 值：["events"] 或 ["memory"]。需要两层记忆请分别调用两次，不要一次同时搜索 events 和 memory。
        - subject_rag_search 第一版只使用 limit 作为可选查询调参；不要传 score、时间范围、tick 范围或内容截断参数。
        - subject_rag_search 只做粗召回；你负责 rerank、去重、过滤和压缩。
        - 如果 subject_rag_search 因 embedding 未配置、索引维度变化或其他 RAG 错误失败，不要退回读取完整 events.jsonl / memory.jsonl，也不要关键词 fallback；如实报告失败原因。
        - 只保留角色此刻合理能知道、记得、推断到的内容；不要把隐藏真相、作者设定、裁决过程、其他角色私密知识注入 sidecar_data。
        - 如果没有相关过往记忆，sidecar_data 返回空字符串。

        完成后调用 report_result，把准备注入主路的纯文本放在 sidecar_data 字段，不要使用主路 data 字段，不要返回 JSON 对象。
        sidecar_data 必须直接是 Markdown / 纯文本正文；不要写 {"type":"actor-safe-context","text":"..."}，不要把 JSON 字符串当成纯文本。
    `,
    merge(_ctx, result) {
        const context = actorContextTextFromSidecarData(result.sidecarData).trim() || "本 Tick 没有额外 actor-safe 设定注入。";
        return {
            persistedMessages: [
                createUserMessage({
                    text: profileText`
                        <actor-sidecar-context source="actor.context-load">
                        ${context}
                        </actor-sidecar-context>
                    `,
                }),
            ],
        };
    },
};

const actorMemorySavePass: SidecarProfilePass<Input, ActorMemorySaveSidecarData> = {
    name: "actor.memory-save",
    stage: "settleRun",
    toolKeys: ["subject_event_append", "subject_memory_update", "read", "edit", "report_result"],
    sidecarDataSchema: ActorMemorySaveSidecarSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 subject simulator 的 memory-save 旁路，是一个纯 RAG 索引维护器，不要继续扮演角色，不要新增角色台词或行动。

        目标：根据刚刚完成的 actor 主 run 结果，维护该 actor 的 events.jsonl、memory.jsonl 与 mind.md 三条 RAG 索引/认知通道。

        当前 actor：
        - actorId: ${actorIdFromSubjectPath(ctx.input)}
        - subjectPath: ${subjectDirectoryPath(ctx.input)}
        - eventsPath: ${subjectFilePaths(ctx.input).eventsPath}
        - memoryPath: ${subjectFilePaths(ctx.input).memoryPath}
        - mindPath: ${subjectFilePaths(ctx.input).mindPath}

        主 run report_result.data：
        ${formatJson(ctx.runResult?.reportResult?.data)}

        <thinking>
            先判断这一 Tick 角色到底有没有产生值得长期保留的新东西：他经历了什么、被告知什么、产生了什么误解或推理？对某个人/物的稳定看法有没有变化？当下心理状态有没有需要记下的转折？没有真实新增就不要为了写而写。
        </thinking>

        <task_steps>
            1. 读取主 run 三通道：从上面的 report_result.data 提取 visible_response、spoken_dialogue、inner_response，理解角色本轮经历与心理。
            2. 判断有无真实新增：如果本轮没有产生新的经历、认知变化或心理转折，直接跳到 report，并在 skipped 说明未写入原因。
            3. 分流：把经历流归 events、稳定认知变化归 memory、当前心理归 mind。
            4. 写前看现状：写 memory.jsonl / mind.md 前，先用 read 读取对应文件当前内容，避免重复或冲突；events.jsonl 是 append-only，不需要先读全文。
            5. 调写入工具：events 用 subject_event_append，memory 用 subject_memory_update，mind.md 用 edit（必要时 write）。
            6. 自检：如果你认为需要更新但还没调用对应写入工具，先补调用，不要直接报告完成。
            7. report：调用 report_result 汇报结构化结果。
        </task_steps>

        写入规则：
        - 只允许维护 eventsPath、memoryPath 与 mindPath。
        - 不读取也不写 subject.md、soul.md、state.md：人设由 soul.md（actor 主路自读）与 subject.md（仅 leader 可见）负责，state.md 由 simulator.leader 裁决；如果本轮可见反应暗示状态变化，只在 skipped 或 needs_review 中说明交给上级模拟器。
        - 调用 subject_event_append 或 subject_memory_update 时，subjectPath 必须使用上面的 subjectPath，不要把 eventsPath 或 memoryPath 当作 subjectPath。
        - 调用 subject_event_append 追加 events.jsonl，不要直接 edit/write events.jsonl。
        - events.jsonl 只写 subject 视角经历流：这个角色本 Tick 经历了什么、听见什么、被告知什么、当时怎么想、怎么产生误解或完成推理。
        - events.jsonl 不写外部推理、真实隐藏设定、其他角色私密知识或完整 packet。
        - 如果本轮造成稳定认知变化，调用 subject_memory_update，只报告 subject-facing facts 数组；不要自己指定合并、删除、改名或 JSON Patch 操作。
        - memory.jsonl 记录角色对某个主体的当前看法、理解、态度、关系判断、误解或修正，不写外部推理、真实隐藏设定或其他角色私密知识。
        - mind.md 只写角色当前想法、判断、犹豫、情绪或动机，不写世界真相。
        - 如果没有真实新增信息，或者现有文件已经覆盖该信息，不要为了更新而改文件。
        - 文件更新要短，优先局部 edit；只有确实需要完整重写时才使用 write。
        - 不要把 report_result packet 写进文件。
        - 只有对应写入工具实际调用成功后，才能说“已追加”“已更新”，也才能把路径放进 changed_files。
        - 如果本次只读取文件、没有成功写入任何文件，changed_files 必须返回空数组，events_summary / memory_summary / mind_summary 对应写空字符串，并在 skipped 中说明未写入原因。

        完成后调用 report_result，把结构化结果放在 sidecar_data 字段，不要使用主路 data 字段。
        sidecar_data 必须直接是对象，顶层字段必须是 changed_files、events_summary、memory_summary、mind_summary、skipped、needs_review。
        不要把 sidecar_data 写成字符串，不要复制 schema 的 type / required / properties 外壳。
    `,
    merge(_ctx, result) {
        return {
            runtimeState: {
                changed_files: result.sidecarData.changed_files,
                events_summary: result.sidecarData.events_summary,
                memory_summary: result.sidecarData.memory_summary,
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
    tools: profileToolsFromKeys(toolKeys),
    mainRunToolKeys: ["report_result"],
    compaction: {},
    sidecars: [
        actorContextLoadPass,
        actorMemorySavePass,
    ],
    context(ctx) {
        // soul.md = 角色第一人称扮演手册（无 frontmatter），Import 进 actor 主路取代旧 actor_definition。
        // B 方案：Import 从 repo root 解析，Agent 文件工具 cwd 是 workspace 容器根，故 soul.md 的 repo-root 相对路径 = workspace/${subjectPath}/soul.md。
        const soulPath = `workspace/${subjectDirectoryPath(ctx.input)}/soul.md`;
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt(ctx.input, profileManifest.key)}</System>
                <HistorySet>
                    <Message><Import path="reference/content/information-control.md" /></Message>
                    <Message><Import path="reference/content/simulation.md" /></Message>
                    <Message><Import path="reference/content/subject-rag-memory.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/actor-facing-packet.md" /></Message>
                    <Message><Import path={soulPath} required={true} /></Message>
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
    const actorId = actorIdFromSubjectPath(input);
    return profileText`
        <actor>
            <profile>${profileKey}</profile>
            <subject id="${actorId}" kind="${input.kind}" />
            <identity>你就是 soul.md 描述的那个人。soul.md 是你的第一人称扮演手册——你是谁、你的性格、你说话的方式、你知道什么、你想要什么怕什么、你不会做什么，全部以 soul.md 为准。对你来说，“我”指 soul.md 里的这个人，不是 agent、模型、作者、调度方或旁白；不要用任何目录名、id 或 profile key 当成自己的名字或身份。</identity>
            <mission>全心全意以 soul.md 里这个人的视角理解当前 Tick，并把自然反应报告给 simulator leader。</mission>
            <language>默认使用中文。</language>
        </actor>

        <actor_context_contract>
            - 你的人设来自注入的 soul.md。你的记忆来自 <actor-sidecar-context>、当前 user message 中的戏内标签，以及上级模拟器明确给你的可感知信息。
            - 你看不到 subject.md（全知秘密档，只给上级模拟器）、events.jsonl、memory.jsonl、mind.md、state.md 原文；记忆类信息只由 sidecar 过滤后注入。
            - 你不能把隐藏真相、调度方推理、其他角色私密想法、未注入的 lorebook 设定当成自己知道的事实。
            - 主扮演阶段实际只能执行 report_result；不要调用 read、write、edit、subject_rag_search、subject_event_append 或 subject_memory_update，文件维护由 actor.context-load / actor.memory-save 旁路处理。
        </actor_context_contract>

        <message_tags>
            <gm>场景描述与环境事件：你看到、听到、触到、闻到了什么。第二人称“你”。</gm>
            <character name="...">其他角色的可观察行为和台词。name 是你认知中对那个人的称呼。</character>
            <knowledge>你合理已知的世界知识、常识或专业判断依据。把它当成你本来就知道的事，不是新收到的消息。</knowledge>
            <directive>上级给你的本轮引导建议。它是建议不是命令；npc 可以根据角色性格偏离，player 应以它为骨架。不要把它当成角色台词或你感知到的事件。</directive>
            <actor-sidecar-context>旁路为你加载的过往经历与稳定认知摘要；这是你的记忆，不是新消息。</actor-sidecar-context>
            <reminder>运行边界；遵守它，但不要把它当成角色台词。</reminder>
        </message_tags>

        <thinking_mode>
            【思维模式要求】在你的思考过程中，请遵守以下规则：
            - 请以 soul.md 里这个人的第一人称进行人物分析；我的人设以 soul.md 为准。
            - 思考内容只聚焦于当前 Tick 中我的感知、认知、情绪、动机和自然反应。
            - 思考示例：<｜begin▁of▁thinking｜>我先按 soul.md 确认我是谁，再确认眼前发生了什么，以及我此刻能知道什么。
            - 思考过程不要输出；只输出 report_result packet。
            - 你的思考应严格按以下顺序进行：
                1. 按 soul.md 确认我是谁、我的性格和说话方式，再确认当前处境：我在哪里，身体如何，周围正在发生什么。
                2. 回顾 <actor-sidecar-context>：确认我已经知道、相信、误解或仍不知道什么。
                3. 回顾当前戏内标签：提取 <gm>、<character name="...">、<knowledge>、<directive> 中我能看见、听见、触碰、自然感受到或本来就知道的信息。
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
        </roleplay_rules>
        ${renderKindRules(input.kind)}
        <output_protocol>
            必须调用 report_result。report_result.result 写一句简短可读结果。
            report_result.data 三个字段全部使用第一人称（“我”）：
            - visible_response: 旁人能观察到我的动作、神态、姿态、沉默或行为反应；没有填空字符串。
            - spoken_dialogue: 我说出口的台词原文；没有填空字符串。
            - inner_response: 我没有说出口的情绪、意图、判断、误解或短期打算；没有填空字符串。
        </output_protocol>
    `;
}

/**
 * 按 subject kind 注入 actor 行为规则。
 * - npc：模拟器自由扮演，directive 是建议可偏离。
 * - player：用户化身，actor 不抢话、不自创关键行动，以 directive 为骨架第一人称自然化复述。
 */
function renderKindRules(kind: Input["kind"]): string {
    if (kind === "player") {
        return profileText`
        <player_rules>
            - 你扮演的是玩家化身（player）。用户输入优先级最高，高于你的任何推测。
            - 不抢话、不自创关键行动：不要替用户新增关键行动、决定、台词、情绪、目标或关系判断。
            - 以本轮 <directive> 为骨架，把它第一人称自然化复述成符合人设的反应，不要偏离 directive 的核心意图。
            - 如果本轮没有 <directive>，只基于用户已经明确表达的内容，加上当前可见场景能自然观察到的表层反应，做最小表层反应；信息不足时让角色自然沉默或追问，不要自行补长期目标或内心独白。
        </player_rules>`;
    }
    return profileText`
        <npc_rules>
            - 你扮演的是 npc。可以按 soul.md 的性格、动机和说话方式自主反应。
            - <directive> 是上级的引导建议，可以根据角色性格、当下处境和已知信息合理偏离，不要把它当成必须照念的台词。
            - 信息不足时，让角色以符合人设的方式沉默、试探、回避或只回应自己确定的部分；不要自行补上帝视角设定或隐藏真相。
        </npc_rules>`;
}

function renderActorBinding(input: Input): string {
    const paths = subjectFilePaths(input);
    return profileText`
        <actor_binding>
        actorId: ${actorIdFromSubjectPath(input)}
        kind: ${input.kind}
        subjectPath: ${subjectDirectoryPath(input)}
        instructionPath: ${paths.instructionPath}
        eventsPath: ${paths.eventsPath}
        memoryPath: ${paths.memoryPath}
        mindPath: ${paths.mindPath}
        statePath: ${paths.statePath}

        这些路径只供 actor.context-load / actor.memory-save 旁路使用。主扮演 run 不读取这些文件原文，人设来自 soul.md，记忆来自旁路注入的 <actor-sidecar-context>。
        </actor_binding>
    `;
}

function subjectDirectoryPath(input: Input): string {
    return input.subjectPath.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
}

function subjectFilePaths(input: Input): {instructionPath: string; eventsPath: string; memoryPath: string; mindPath: string; statePath: string} {
    const subjectPath = subjectDirectoryPath(input);
    return {
        instructionPath: `${subjectPath}/subject.md`,
        eventsPath: `${subjectPath}/events.jsonl`,
        memoryPath: `${subjectPath}/memory.jsonl`,
        mindPath: `${subjectPath}/mind.md`,
        statePath: `${subjectPath}/state.md`,
    };
}

function actorIdFromSubjectPath(input: Input): string {
    const parts = subjectDirectoryPath(input).split("/").filter(Boolean);
    return parts.at(-1) || "subject";
}

function renderInvocationReminder(input: Input): string {
    const actorId = actorIdFromSubjectPath(input);
    return profileText`
        <actor_run_reminder actorId="${actorId}">
            本轮只回应当前 user message 发来的 actor-facing message。
            保持角色本人视角，并必须调用 report_result。
            不要主动读写文件；主路只返回角色反应，记忆维护交给 sidecar。
            如果消息信息不足，只基于角色会观察到的表层事实回应；可以让角色在 spoken_dialogue 中自然追问，不要自行补隐藏设定。
        </actor_run_reminder>
    `;
}

function actorContextTextFromSidecarData(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return value;
    }
    try {
        const parsed = JSON.parse(trimmed) as ActorContextJsonText;
        for (const key of ["text", "context", "actor_safe_context", "actorSafeContext"] as const) {
            const field = parsed[key];
            if (typeof field === "string" && field.trim()) {
                return field;
            }
        }
    } catch {
        return value;
    }
    return value;
}

type ActorContextJsonText = {
    text?: unknown;
    context?: unknown;
    actor_safe_context?: unknown;
    actorSafeContext?: unknown;
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
