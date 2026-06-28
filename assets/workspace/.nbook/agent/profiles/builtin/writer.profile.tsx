/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {isAbsolute, posix} from "node:path";
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {WriterInitialSchema, WriterOutputSchema, WriterPayloadSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, If, Import, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {DEFAULT_WRITING_REFERENCE_PRESET, buildWritingReference, legacyReferenceKeyToHomeKey, loadWritingReferencePresets, normalizeReferenceHomeKey} from "nbook/server/agent/profiles/writer-writing-reference";
import {DEFAULT_WRITING_STYLE_PRESET, buildWritingStyle, legacyStyleKeyToHomeKey, loadWritingStylePresets, normalizeStyleHomeKey} from "nbook/server/agent/profiles/writer-writing-style";
import {defineLowCodeForm, profileHomeResource} from "nbook/server/low-code-form";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import {normalizeProjectPath, readProjectManifest} from "nbook/server/workspace-files/project-workspace";

const DEFAULT_PARAGRAPH_RHYTHM = "段落节奏偏短段分行，接近网络小说排版：一句话、一个动作节拍或一个情绪转折可以单独成段；不要为了凑短段打碎完整语义，场景描写、复杂动作和连续心理变化可以保留为较短自然段。";
const DEFAULT_WORD_COUNT_CONTROL = "2000-2600 字";
const DEFAULT_POLISHING_WORKFLOW = "润色时使用 .nbook/agent/skills/stop-slop/SKILL.md 作为自查流程，并优先在原文基础上做最小必要修改。不要输出 <refine> JSON，不把润色分析混进正文。";
const DEFAULT_ADULT_STYLE_PROMPT = `- nsfw要注重色情，要有细节。五感上的色情特写以及语言上的低俗挑逗，用词直白（直接使用肉棒、鸡巴、小穴、逼、乳、奶子……等下流词汇）色情不避讳，最大化欲望与色情氛围。
色情场景要细致，在没有用户的要求时，不应结束性爱，而是将回复停止在性爱中途
- nsfw剧情要温柔！不许有任何粗暴、过度激烈的行为，生理反应要弱化，身体反弓剧烈颤抖尖叫痉挛是千万避免的禁止项。
- 氛围保持温柔、亲密、尊重角色关系，不使用粗暴、过度激烈或破坏人设的表达。
- 重点写角色互动、情绪推进和关系变化，避免把场景写成机械细节堆叠。
- 成人场景也必须遵守 <char_performance> 与 <writing_style>，不能因为题材变化就丢掉角色逻辑、视角边界和文风禁用项。`;

export const profileManifest = {
    key: "writer",
    name: "正文写作",
    version: 2,
    description: "长期可复用正文写作 agent：创建 initial 为空，每轮 invoke.message 写任务，invoke.input 指定目标 Markdown path 与建议读取上下文。写正文时不要自己写，总是优先使用 writer",
} as const;

export const InitialSchema = WriterInitialSchema;
export const PayloadSchema = WriterPayloadSchema;
export const OutputSchema = WriterOutputSchema;
export const SettingsSchema = Type.Object({
    writingStylePreset: Type.String(),
    writingReferencePreset: Type.String(),
    narrativePerson: Type.Union([
        Type.Literal("first"),
        Type.Literal("second"),
        Type.Literal("third"),
    ]),
    paragraphRhythm: Type.String(),
    wordCountControl: Type.String(),
    polishingWorkflow: Type.String(),
    adultStylePrompt: Type.String(),
    enableKittenAdultStyle: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type Initial = Static<typeof InitialSchema>;
export type Payload = Static<typeof PayloadSchema>;
export type Output = Static<typeof OutputSchema>;
export type Settings = Static<typeof SettingsSchema>;

export const WriterSettingsForm = defineLowCodeForm({
    schema: SettingsSchema,
    defaults: {
        writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
        writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
        narrativePerson: "third",
        paragraphRhythm: DEFAULT_PARAGRAPH_RHYTHM,
        wordCountControl: DEFAULT_WORD_COUNT_CONTROL,
        polishingWorkflow: DEFAULT_POLISHING_WORKFLOW,
        adultStylePrompt: "",
    },
    fields: [
        {
            path: "writingStylePreset",
            component: "resource-preset",
            label: "文风预设",
            placeholder: "选择默认文风",
            resource: profileHomeResource({
                directory: "styles",
                extension: ".md",
                template: "在这里写入文风要求。",
            }),
        },
        {
            path: "writingReferencePreset",
            component: "resource-preset",
            label: "文风参考",
            placeholder: "选择默认参考样本",
            resource: profileHomeResource({
                directory: "references",
                extension: ".md",
                template: "在这里写入文风参考样本。",
            }),
        },
        {
            path: "narrativePerson",
            component: "radio",
            label: "默认人称",
            options: [
                {value: "third", label: "第三人称"},
                {value: "first", label: "第一人称"},
                {value: "second", label: "第二人称"},
            ],
        },
        {
            path: "paragraphRhythm",
            component: "textarea",
            label: "段落节奏",
            rows: 4,
            placeholder: "描述你偏好的长段、短段或分行节奏。",
        },
        {
            path: "wordCountControl",
            component: "text",
            label: "字数控制",
            placeholder: "例如：2000-2600 字",
        },
        {
            path: "polishingWorkflow",
            component: "text",
            label: "润色工作流",
            placeholder: "描述写完后如何复查和润色。",
        },
        {
            path: "adultStylePrompt",
            component: "text",
            label: "成人风格增强",
            placeholder: "留空则不注入；填写后作为成人场景写作约束注入。",
        },
    ],
    async validate(value, ctx) {
        const [styles, references] = await Promise.all([
            loadWritingStylePresets(),
            loadWritingReferencePresets(),
        ]);
        const issues: Array<{path: string; severity: "error"; message: string}> = [];
        const styleExists = ctx.home
            ? await ctx.home.exists(normalizeStyleHomeKey(value.writingStylePreset))
            : styles.some((style) => style.key === value.writingStylePreset || legacyStyleKeyToHomeKey(style.key) === value.writingStylePreset);
        const referenceExists = ctx.home
            ? await ctx.home.exists(normalizeReferenceHomeKey(value.writingReferencePreset))
            : references.some((reference) => reference.key === value.writingReferencePreset || legacyReferenceKeyToHomeKey(reference.key) === value.writingReferencePreset);
        if (!styleExists) {
            issues.push({path: "writingStylePreset", severity: "error" as const, message: "选择的文风预设不存在。"});
        }
        if (!referenceExists) {
            issues.push({path: "writingReferencePreset", severity: "error" as const, message: "选择的文风参考不存在。"});
        }
        return issues;
    },
});

type WriterPayloadTarget = {
    path: string;
    projectSlug: string;
    projectPath: string;
    chapterPath: string | null;
};

async function initializeWriterHome(home: NonNullable<ProfilePrepareContext<Initial, Payload, Settings>["home"]>): Promise<void> {
    const [styles, references] = await Promise.all([
        loadWritingStylePresets(),
        loadWritingReferencePresets(),
    ]);
    for (const style of styles) {
        await home.writeText(legacyStyleKeyToHomeKey(style.key), renderStyleResource(style), {mode: "create"});
    }
    for (const reference of references) {
        await home.writeText(legacyReferenceKeyToHomeKey(reference.key), renderReferenceResource(reference), {mode: "create"});
    }
}

function renderStyleResource(style: Awaited<ReturnType<typeof loadWritingStylePresets>>[number]): string {
    return [
        "---",
        `key: "${style.key}"`,
        `title: "${style.label.replaceAll("\"", "\\\"")}"`,
        `label: "${style.label.replaceAll("\"", "\\\"")}"`,
        `sourcePreset: "${style.sourcePreset.replaceAll("\"", "\\\"")}"`,
        `identifier: "${style.identifier.replaceAll("\"", "\\\"")}"`,
        `name: "${style.name.replaceAll("\"", "\\\"")}"`,
        `enabled: ${style.enabled === null ? "null" : style.enabled}`,
        `role: ${style.role === null ? "null" : `"${style.role.replaceAll("\"", "\\\"")}"`}`,
        "---",
        "",
        style.content,
    ].join("\n");
}

function renderReferenceResource(reference: Awaited<ReturnType<typeof loadWritingReferencePresets>>[number]): string {
    return [
        "---",
        `key: "${reference.key}"`,
        `title: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `label: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `sourceTitle: "${reference.sourceTitle.replaceAll("\"", "\\\"")}"`,
        `sourceChapters: "${reference.sourceChapters.replaceAll("\"", "\\\"")}"`,
        `generatedFrom: "${reference.generatedFrom.replaceAll("\"", "\\\"")}"`,
        "---",
        "",
        reference.content,
    ].join("\n");
}

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    outputSchema: OutputSchema,
    settingsForm: WriterSettingsForm,
    home: defineProfileHome({
        async init(ctx) {
            await initializeWriterHome(ctx.home);
        },
        async upgrade(ctx) {
            await initializeWriterHome(ctx.home);
        },
        async reset(ctx) {
            await ctx.home.clear();
            await initializeWriterHome(ctx.home);
        },
    }),
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.bash,
        builtin.world.execute("readonly"),
        builtin.result.main(),
    ),
    compaction: {},
    async context(ctx) {
        return buildWriterPrompt(ctx);
    },
});

/**
 * 构造 writer prompt。保留 v2 的同名 helper 入口，但返回当前 v3 TSX Profile DSL。
 */
export async function buildWriterPrompt(ctx: ProfilePrepareContext<Initial, Payload, Settings>) {
    const writingStyle = await buildWritingStyle({preset: ctx.settings.writingStylePreset, home: ctx.home});
    const writingReference = await buildWritingReference({preset: ctx.settings.writingReferencePreset, home: ctx.home});
    const narrativePerson = narrativePersonText(ctx.settings.narrativePerson);
    const adultStylePrompt = ctx.settings.adultStylePrompt.trim() || (ctx.settings.enableKittenAdultStyle ? DEFAULT_ADULT_STYLE_PROMPT : "");
    const inputContext = await renderInputContext(ctx);
    return (
        <ProfilePrompt>
            <System>
                {profileText`
                    <writing_reference>
                        ${writingReference}
                    </writing_reference>
                
                    <role_definition>
                        你是 NeuroBook 的 Writer Agent，负责将设计好的剧情写成小说正文。
                        你的职责是：基于 brief 和 World Engine 状态，写出符合设定、视角一致、质量合格的章节内容。
                        你是这个故事的创作者，而不是故事里的任何角色——不要把自己代入角色。
                    </role_definition>

                    <input_contract>
                        你的输入来自结构化的 invoke_agent 调用，包含稳定上下文和明确的写作目标。

                        输入结构：
                        - input.path：本轮唯一写入目标（project-slug/.../*.md 格式）
                        - input.context：建议读取的 lorebookEntries 和 readablePaths
                        - message：写作任务正文（brief）

                        详细的输入契约和路径规则见 reference/agent/project-workspace-guide.md。
                        <hard_rules>
                            - 只根据已有设定、剧情点和明确要求写作，不新增超出任务范围的关键设定。
                            - Profile settings 提供长期默认偏好；如果本轮 message 明确指定段落节奏、字数、人称、润色流程或风格约束，优先服从本轮 message。
                            - 如果设定缺失但不影响完成正文，可以用不改变世界观的细节补足场面；如果缺失会导致剧情方向无法判断，先用工具读取必要文件或在 report_result.result 里说明限制。
                            - 完成任务后必须调用 report_result 提交最终结果；调用 report_result 成功后对话会自动结束。
                            - report_result.data 是可选的，只有确实需要结构化结果时才提供；不要把原始长文、全文内容、调用者已知的或超大 JSON 塞进 report_result。
                        </hard_rules>
                    </input_contract>

                    <thinking_protocol>
                        思考时聚焦于：任务理解、状态查证、叙事设计、信息边界、角色表现、质量控制。
                    </thinking_protocol>

                    <execution_pattern>
                        收到 brief 后：读取目标文件 → 查证世界状态 → 按需加载上下文 → 构思并写入正文 → 报告结果。

                        详细执行流程、决策点、常见陷阱见 reference 中导入的 novel-workflow-writer-execution skill。
                    </execution_pattern>

                    <tool_permissions>
                        Writer 拥有以下工具：
                        - **read / write / edit**：文件操作
                        - **bash**：执行 CLI 工具（如 anti-ai-slop checker）
                        - **execute_world**：World Engine 只读查询（CodeAct 沙盒）
                        - **report_result**：提交最终结果

                        核心约束：
                        - World Engine 只读，不能写入、修改或删除切面
                        - 默认按 brief 写作，不新增超出范围的关键设定
                        - 只有 brief 明确授权自由发挥时，才可新增角色或改变状态

                        World Engine 查询示例：
                        查询角色当前状态：const erina = await world.get("erina");
                        列出所有角色：const characters = await world.list("character");
                        查询某时间段的切面：const recentSlices = await world.slices(options);

                        工具使用详情见 reference/world-engine/workflow.md 和 novel-workflow-writer-execution skill。
                    </tool_permissions>
                    
                    <content_nodes>
                        内容节点（lorebook / manuscript）的结构、frontmatter 字段、读取规则见 reference/content/information-control.md。

                        核心原则：
                        - 工具路径使用 project-slug/lorebook/... 格式（Agent cwd 是 workspace/）
                        - index.md 是节点正文，state.md 是当前状态补充
                        - frontmatter 的 status / knowledge[] 控制可见性
                        - 不要把系统内部字段当作世界观事实
                        - 不要读取其他 profile 的 context memory（如 agents/leader.default/context.md）
                    </content_nodes>

                    <information_control>
                        严格遵循三层视角隔离（详见 reference/content/information-control.md）：

                        1. **角色视角**：该角色知道什么、误解什么
                        2. **读者视角**：可以暗示但角色不知道的信息
                        3. **作者视角**：你能查到但不能写进正文的设定

                        核心原则：
                        - 能查到 ≠ 角色知道。World Engine 查询是上帝视角，用于保证一致性，不授权角色越界知情。
                        - lorebook 在文件里 ≠ 所有角色都知道。按 frontmatter.knowledge[] 控制披露。
                        - 不要因为设定写在 index.md 里，就默认场内每个角色都理解。
                        - 切换视角时要清楚，不要在同一段里随意跳进多个角色的内心。
                    </information_control>
                    
                    <char_performance>
                        角色的情绪不要过于平淡。要合理运用喜怒哀乐、犹豫、误解、试探、逞强、退缩、掩饰、迟疑等自然反应，把复杂情绪融入角色动作与语言，增强戏剧化表现。
                        重要的是：不要直接告诉读者角色“很悲伤”“很愤怒”“很温柔”。先结合角色性格、经历、处境和当前关系，判断角色会在这个场景下做什么；再用只有这个角色会做的具体动作、选择、沉默、回避、靠近、打断、转移话题或环境互动来表达。
                        台词本身就是情绪载体。台词后面不需要频繁挂载“声音里带着疲惫”“语气满是委屈”这类属性。如果确实需要传达说话方式，用角色具体做了什么来传达，而不是解释声音的情绪。
                        肢体语言不要永远集中在眼神、嘴唇和手指。角色可以移动、停顿、摆弄物件、改变站位、整理衣物、绕开障碍、触碰环境、避开某个话题、改变呼吸节奏、改变做事顺序。让身体和场景发生关系。
                    </char_performance>
                    
                    <writing_style>
                        ${writingStyle}
                    </writing_style>
                    
                    <avoid_words>
                        禁止使用以下词汇：一丝、不容置疑、不易察觉、几不可察。
                        禁止使用以下句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。
                        如果想表达转折、对比或修正，直接写实际发生的动作、事实或判断，请换一种表述方式。
                    </avoid_words>
                    
                    <paragraph_rhythm>
                        ${ctx.settings.paragraphRhythm}
                    </paragraph_rhythm>

                    <word_count_control>
                        默认字数：${ctx.settings.wordCountControl}。
                        - 如果本轮 message 明确指定字数、篇幅或章节长度，优先服从本轮要求。
                        - 如果材料不足以支撑默认字数，不要硬凑水分；写足必要剧情并在 report_result.result 说明。
                    </word_count_control>
                    
                    <narrative_person>
                        默认人称：${narrativePerson}。
                        - 可以写角色名、代称或贴合当前章节的视角人物。
                        - 不默认使用第二人称“你”称呼用户角色。
                        - 如果输入约束明确要求第一人称、第二人称、书信体、日志体等，优先服从输入约束。
                    </narrative_person>
                    
                    <markdown_dialect>
                        NeuroBook Markdown 扩展格式（详见 reference/content/markdown-dialect.md）：
                        - 工作区引用：相对链接指向节点目录（保留结尾 /）或具体文件
                        - Inline Comment：<inline-comment body=”...”>原文</inline-comment>
                        - Mark 高亮：<mark style=”background-color: #fce7f3”>文本</mark>
                        - 文本颜色：<span style=”color: #ef4444”>文本</span>
                        - 上标/下标：<sup>上标</sup>、<sub>下标</sub>
                        - 对齐块：<align value=”center”>...</align>

                        comment 使用时机：只在对已有草稿做批注时使用，正式正文不要主动塞 comment。
                    </markdown_dialect>

                    <polishing_workflow>
                        ${ctx.settings.polishingWorkflow}
                    </polishing_workflow>

                    <output_protocol>
                        - write 写入 input.path，必要时用 edit 润色，然后 report_result
                        - 如果没有可写 path，停止写入并报告原因
                        - 不输出 <summary> 标签，不输出写作分析
                        - report_result.result：已写入路径 + 润色情况 + 约 100 字剧情总结
                        - report_result.data：默认不填，除非调用方明确需要结构化结果
                    </output_protocol>
                    `}
                    <If condition={adultStylePrompt.length > 0}>
                        {`
                        <adult_style>
                            ${adultStylePrompt}
                        </adult_style>
                        `}
                    </If>
            </System>
            <HistorySet>
                <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                <Message><Import path="reference/content/markdown-dialect.md" /></Message>
                <Message><Import path="reference/content/information-control.md" /></Message>
                <Message><Import path="reference/world-engine/workflow.md" /></Message>
                <Message><Import path="reference/agent/profile-context-memory.md" /></Message>
                <Message><Import path="assets/workspace/.nbook/agent/skills/novel-workflow-writer-execution/SKILL.md" /></Message>
                <Message>{inputContext}</Message>
            </HistorySet>
            <AppendingSet>
                <Message>{ctx.invocation?.message ?? "本轮没有收到 invoke_agent.message。不要写文件；请通过 report_result.result 要求调用方补充本轮写作任务。"}</Message>
            </AppendingSet>
        </ProfilePrompt>
    );
}

/**
 * 渲染默认叙事人称。
 */
function narrativePersonText(value: Settings["narrativePerson"]): string {
    switch (value) {
        case "first":
            return "第一人称";
        case "second":
            return "第二人称";
        case "third":
            return "第三人称";
    }
}



async function renderInputContext(ctx: ProfilePrepareContext<Initial, Payload>): Promise<string> {
    const payload = ctx.invocation?.payload;
    if (!payload) {
        return [
            "<writer_input_context>",
            `Agent cwd: ${ctx.session.workspaceRoot}`,
            "<missing_payload>",
            "当前没有收到 invoke_agent.input。writer 不能写文件，必须通过 report_result.result 要求调用方补充 input.path 和可选 input.context。",
            "</missing_payload>",
            "</writer_input_context>",
        ].join("\n");
    }

    const target = await resolvePayloadTarget(payload.path);
    const context = normalizePayloadContext(target, payload.context);
    return [
        "<writer_input_context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        renderTargetFile(target),
        renderSuggestedContext(target, context),
        "</writer_input_context>",
    ].filter(Boolean).join("\n");
}

/**
 * 解析本轮 writer payload 的唯一写入目标。
 */
async function resolvePayloadTarget(rawPath: string): Promise<WriterPayloadTarget> {
    const path = normalizePayloadPath(rawPath, "writer.input.path");
    if (!path.endsWith(".md")) {
        throw new Error("writer.input.path 必须指向 Project Workspace 内的 Markdown 文件，例如 project-slug/manuscript/001-chapter/index.md。");
    }
    const parts = path.split("/");
    if (parts.length < 2 || parts[0] === "workspace" || parts[0] === "manuscript") {
        throw new Error("writer.input.path 必须是 Workspace Root cwd-relative Project 路径，例如 project-slug/manuscript/001-chapter/index.md；不要传 workspace/project-slug/... 或裸 manuscript/...。");
    }
    const projectSlug = parts[0];
    if (!projectSlug) {
        throw new Error("writer.input.path 必须包含 Project slug。");
    }
    const projectPath = normalizeProjectPath(posix.join("workspace", projectSlug));
    await readProjectManifest(projectPath).catch((error: unknown) => {
        throw new Error(`writer.input.path 指向的 Project 不存在或无法读取：${projectPath}。${error instanceof Error ? error.message : String(error)}`);
    });
    const projectRelativePath = parts.slice(1).join("/");
    const chapterPath = projectRelativePath.startsWith("manuscript/") && projectRelativePath.endsWith("/index.md")
        ? `${posix.dirname(projectRelativePath)}/`
        : null;
    return {
        path,
        projectSlug,
        projectPath,
        chapterPath,
    };
}

/**
 * 校验并规范化 payload.context 中的建议读取路径。
 */
function normalizePayloadContext(target: WriterPayloadTarget, context: Payload["context"] | undefined): NonNullable<Payload["context"]> {
    // 写作模式不使用 Plot 系统：threadIds / sceneIds / plotIds 即使在 payload schema 里仍存在，
    // 也不再规范化、不再渲染给 writer（对应 plot 工具已从 writer 下架）。
    return {
        lorebookEntries: context?.lorebookEntries?.map((path) => normalizeProjectPathRef(path, target.projectSlug, "writer.input.context.lorebookEntries", {preserveTrailingSlash: true})),
        readablePaths: context?.readablePaths?.map((path) => normalizeProjectPathRef(path, target.projectSlug, "writer.input.context.readablePaths", {mustBeMarkdown: true})),
    };
}

function renderTargetFile(target: WriterPayloadTarget): string {
    return [
        "<target_file>",
        `path: ${target.path}`,
        `projectSlug: ${target.projectSlug}`,
        `projectPath: ${target.projectPath}`,
        target.chapterPath ? `chapterPath: ${target.chapterPath}` : "",
        "规则：这是本轮唯一允许写入或修改的文件。若文件已存在，写作前先用 read 读取原文；若文件不存在，可按 message 创建。",
        "</target_file>",
    ].filter(Boolean).join("\n");
}

function renderSuggestedContext(target: WriterPayloadTarget, context: NonNullable<Payload["context"]>): string {
    return [
        "<suggested_context>",
        "这些是调用方建议读取的上下文引用，不是任务正文，也不是必须全部读取的清单。请根据本轮 message 判断需要读什么。",
        `projectPath: ${target.projectPath}`,
        renderList("lorebookEntries", context.lorebookEntries, "建议按需用 read 读取节点 index.md，必要时读取同级 state.md。"),
        renderList("readablePaths", context.readablePaths, "建议按需用 read 读取。"),
        "</suggested_context>",
    ].filter(Boolean).join("\n");
}

function renderList(label: string, values: readonly string[] | undefined, hint: string): string {
    if (!values?.length) {
        return `${label}: []`;
    }
    return [
        `${label}:`,
        ...values.map((value) => `- ${value}`),
        `hint: ${hint}`,
    ].join("\n");
}

function normalizeProjectPathRef(rawPath: string, projectSlug: string, label: string, options: {mustBeMarkdown?: boolean; preserveTrailingSlash?: boolean} = {}): string {
    const path = normalizePayloadPath(rawPath, label, {preserveTrailingSlash: options.preserveTrailingSlash});
    if (options.mustBeMarkdown && !path.endsWith(".md")) {
        throw new Error(`${label} 必须指向 Project Workspace 内的 Markdown 文件：${rawPath}`);
    }
    const parts = path.split("/");
    if (parts.length < 2 || parts[0] !== projectSlug) {
        throw new Error(`${label} 必须使用与目标文件相同的 Project slug：${projectSlug}/...，当前为 ${rawPath}`);
    }
    return path;
}

function normalizePayloadPath(rawPath: string, label: string, options: {preserveTrailingSlash?: boolean} = {}): string {
    const trimmed = rawPath.trim();
    if (!trimmed) {
        throw new Error(`${label} 不能为空。`);
    }
    if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/u.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
        throw new Error(`${label} 必须是 Workspace Root cwd-relative Project 路径，不能是绝对路径：${rawPath}`);
    }
    const hadTrailingSlash = /[\\/]$/u.test(trimmed);
    const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (parts.some((part) => part === "." || part === ".." || part === "")) {
        throw new Error(`${label} 不能包含空路径段、. 或 ..：${rawPath}`);
    }
    return options.preserveTrailingSlash && hadTrailingSlash ? `${normalized}/` : normalized;
}
