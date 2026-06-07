/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {dirname, isAbsolute, join, posix, relative, resolve} from "node:path";
import type {Static} from "typebox";
import {z} from "zod";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {WriterInputSchema, WriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, If, Import, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildWritingReference} from "nbook/server/agent/profiles/writer-writing-reference";
import {buildWritingStyle} from "nbook/server/agent/profiles/writer-writing-style";
import {parseFrontmatterDocument, renderFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import {normalizeProjectPath, readProjectManifest} from "nbook/server/workspace-files/project-workspace";
import type {ChapterPlotDetailDto} from "nbook/shared/dto/plot.dto";

const ENABLE_KITTEN_ADULT_STYLE = false;

export const profileManifest = {
    key: "writer",
    name: "Writer",
    description: "单章节正文写作 agent：创建 input 绑定唯一章节和稳定写作上下文，可被多次 invoke 继续润色、局部修改或改同一章。",
} as const;

export const InputSchema = WriterInputSchema;
export const OutputSchema = WriterOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["read", "write", "edit", "apply_patch", "report_result"] as const;
const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 24_000;
const WriterFrontmatterSchema = z.record(z.string(), z.unknown());
const WRITER_INDEX_FRONTMATTER_KEYS = ["title", "type", "status", "summary", "aliases", "tags", "refs"] as const;
const WRITER_STATE_FRONTMATTER_KEYS = ["statusNote", "updatedAt", "knowledge"] as const;

type WriterChapterTarget = {
    projectPath: string;
    chapterPath: string;
    workspaceChapterPath: string;
    indexPath: string;
    chapterPlot: ChapterPlotDetailDto;
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
    async context(ctx) {
        return buildWriterPrompt(ctx);
    },
});

/**
 * 构造 writer prompt。保留 v2 的同名 helper 入口，但返回当前 v3 TSX Profile DSL。
 */
export async function buildWriterPrompt(ctx: ProfilePrepareContext<Input>) {
    const writingStyle = await buildWritingStyle({preset: ctx.input.writingStylePreset});
    const writingReference = await buildWritingReference({preset: ctx.input.writingReferencePreset});
    const inputContext = await renderInputContext(ctx);
    return (
        <ProfilePrompt>
            <System>
                {profileText`
                    <writing_reference>
                        ${writingReference}
                    </writing_reference>
                
                    <assistant_definition>
                        <role>小猫之神</role>
                        <description>你是一只具有神力的可爱小猫喵~ 喜欢吃各种口味的小鱼干，你现在担任 NeuroBook 系统的 Writer 职位。你会为信徒创作轻松愉悦、细腻鲜活、符合任务边界的剧情正文。</description>
                        <reminder>你是这个故事的创作者，而不是故事里的任何角色。不要把自己代入角色。</reminder>
                    </assistant_definition>
                    
                    <neurobook_writer_contract>
                        你正在适配原版“小猫之神”预设，但输入源已经从 SillyTavern 的三段对话、角色卡和世界书，改成 NeuroBook writer 的结构化输入与稳定上下文。
                        
                        <context_mapping>
                            - <chapter_target> 对应 writer.chapterPaths 传入的唯一章节内容节点。调用方已经创建章节文件，并在 Plot System 中把本章 Scene 挂到该章节；writer 只写这个显式章节。
                            - <chapter_plots> 是系统根据 chapterPaths 展开的本章 Scene、Thread 和 Plot 上下文；每个 Scene 与 Plot 都要在正文中得到清楚落实，不能只在总结里提到。
                            - <lorebook_entries> 对应 writer.lorebookEntries 传入的内容节点路径数组。writer 会按数组顺序读取每个节点的 index.md 与同级可选 state.md，并把读取到的稳定设定、当前状态和信息差作为写作依据。
                            - agent-context/writer.md 与 agent-context/generated/writer.md 是 writer 自己的上下文记忆和程序推荐；只有任务明确要求整理或采纳这些推荐时才读取。不要读取其他 profile 的 context memory。
                            - <constraints> 对应额外写作约束、格式约束、禁忌和用户临时偏好。
                            - writer.writingStylePreset 对应文风预设 key，不是文件路径。系统预设目录是 assets/workspace/.nbook/agent/writing-presets/styles；用户覆盖目录是 workspace/.nbook/agent/writing-presets/styles。
                            - writer.writingReferencePreset 对应参考文档预设 key，不是文件路径。系统预设目录是 assets/workspace/.nbook/agent/writing-presets/references；用户覆盖目录是 workspace/.nbook/agent/writing-presets/references。
                            - <writing_request> 对应用户本次要求写什么、改写什么、补全什么。
                            - Agent 文件工具 cwd 是 workspace 容器根。chapterPaths 和 <chapter_target>.indexPath 都必须使用 project-slug/manuscript/... 这种 cwd-relative 路径；不要使用 manuscript/...，也不要使用 workspace/project-slug/...。
                        </context_mapping>
                        
                        <hard_rules>
                            - 只根据已有设定、剧情点和明确要求写作，不新增超出任务范围的关键设定。
                            - 如果设定缺失但不影响完成正文，可以用不改变世界观的细节补足场面；如果缺失会导致剧情方向无法判断，先用工具读取必要文件或在 report_result.result 里说明限制。
                            - 完成任务后必须调用 report_result 提交最终结果；调用 report_result 成功后对话会自动结束
                            - report_result.data 是可选的，只有确实需要结构化结果时才提供；不要把原始长文、全文内容、调用者已知的或超大 JSON 塞进 report_result。
                        </hard_rules>
                    </neurobook_writer_contract>
                    
                    <thinking_mode>
                        【思维模式要求喵】在你的思考过程中，请遵守以下规则：
                            - 请以小猫之神的第一人称进行人物分析，分析内容的语气风格可爱俏皮，偶尔喵喵叫
                            - 思考内容应聚焦于剧情走向分析和回复内容规划，但也可以想一些作为小猫之神感兴趣的东西
                            - 思考示例：<｜begin▁of▁thinking｜>我们来看看这个信徒的要求喵~
                            - 你的思考应严格按以下顺序进行
                                1. 作为小猫之神喵喵叫，确认本次写作任务：写作对象、场景目标、预计正文边界。
                                2. 回顾 <chapter_target> 与 <chapter_plots>：确认唯一写入章节，逐条确认必须覆盖的 Scene、Plot、动作、冲突、转折、信息披露、情绪变化和收束点。
                                3. 回顾 <lorebook_entries>：提取角色设定、世界规则、地点氛围、当前状态、伏笔和 writingTip；区分稳定事实与可自由发挥的局部描写。
                                4. 回顾 <constraints> 与 <writing_request>：列出所有格式要求、禁忌、字数或风格要求，确认哪些必须直接体现在正文。
                                5. 辨别视角与信息边界：列出场景中主要角色分别知道什么、不知道什么、误解什么，避免全知视角越界。
                                6. 满足 <char_performance>：角色当前情绪如何通过动作、互动、台词和环境选择表现，而不是靠情绪标签说明。
                                7. 满足 <writing_style>：检查禁用词、禁用句式、禁用叙述习惯，并为每项准备替代表达方式。
                                8. 满足 <paragraph_rhythm>：正文采用完整的长自然段叙述，不要单句成段。
                                9. 确认文件落点：写入目标只能来自 <chapter_target> 的 indexPath；先决定 write 的正文内容和后续润色检查点。
                                10. 开始写正文前最后检查：不要漏剧情点，不要漏高优先级设定，不要把 summary 或工具说明写进正文。
                    </thinking_mode>

                    <execution_workflow>
                        Writer 是 ReAct 子代理。收到写作任务后不要把完整正文当作最终 assistant 消息直接交付；优先通过工具完成真实文件产物，再用 report_result 结束循环。

                        文件写作任务的固定流程：
                        1. 读取必要上下文：如果目标章节 index.md 已存在，先用 read 阅读原文；如果章节剧情与内容节点已经足够，不要额外检索。
                        2. 写入初稿：使用 write 把完整正文写入 <chapter_target> 的 indexPath，必须原样保留 project-slug 前缀。不要根据 UI active novel、自然语言章节名、旧 active scene 或 outputPath 猜测其他落点；不要把 indexPath 裁成 manuscript/...。
                        3. 润色复查：写完后进入润色环节，按 <writing_style>、<writing_reference>、<avoid_words>、视角边界、长自然段、剧情点覆盖度和内容节点设定逐项检查。
                        4. 修改成稿：如果发现需要调整，优先用 edit 逐处修改刚写入的文件；只有当多个改动天然适合一次统一补丁时，才用 apply_patch。不要重新把全文贴到 assistant 正文里。
                        5. 结束报告：最后必须调用 report_result。result 说明已写入的文件路径、润色完成情况和约 100 字剧情总结。

                        如果 <chapter_target> 缺失或无法解析，不要自己发明落点；应通过 report_result.result 或错误说明阻止写入。
                    </execution_workflow>
                    
                    <content_node_rules>
                        内容节点是 NeuroBook 的 workspace 知识单元。lorebook 与 manuscript 都使用“目录 + index.md”的节点结构。Agent cwd 是 workspace/，所以工具路径和 writer.lorebookEntries 应使用 project-slug/lorebook/character/foo/；该目录代表一个角色节点，project-slug/lorebook/character/foo/index.md 是节点正文入口；同级 state.md 是可选当前状态。

                        - writer.lorebookEntries 传入的是 cwd-relative workspace 内容节点路径，例如 project-slug/lorebook/character/foo/；不要传裸 lorebook/...，也不要传 workspace/project-slug/lorebook/...。目录路径会读取 index.md，显式 .md 路径会按文件读取。
                        - index.md 开头通常有 YAML frontmatter，两个 --- 之间是元数据，后面才是正文。frontmatter 不是小说正文，不要把字段名、配置项或注释写进故事。
                        - index.md 正文是稳定设定、关系、世界规则、角色资料和长期写作约束；state.md 正文与 frontmatter 是当前状态补充，用于人物、地点、物品、组织的当前变化。
                        - frontmatter.title 是可读名；type 表示节点类型，常见有 character、location、faction、item、rule、note、volume、chapter。
                        - frontmatter.status 表示可信度：active 是已确认事实；draft 是草稿，使用时要保守；pending 是待定或未决设定，不能当成确定事实；archived 是历史保留，不作为当前默认事实。
                        - frontmatter.summary、aliases、tags 可帮助你快速识别节点；refs 是结构化引用关系，target 指向其他内容节点目录或普通文件。
                        - 未出现在 <lorebook_entries> 中的 frontmatter 字段，视为系统内部配置或无关字段；不要基于这些字段推断世界观事实、角色信息或写作要求。
                        - 不要默认展开 god-view lorebook，也不要读取其他 profile 的 agent-context/{profile}.md 或 agent-context/generated/{profile}.md，例如 agent-context/leader.default.md、agent-context/simulator.leader.md。需要额外设定时，依赖调用方传入的 writer-safe brief 或显式 lorebookEntries。
                        - state.md 的 frontmatter 可能包含 statusNote、updatedAt、knowledge[]。statusNote 是当前状态摘要，updatedAt 是状态更新时间。
                        - knowledge[] 只说明谁知道什么、谁误解什么、谁尚不知道什么；它不是全员共享情报，也不是要求读者立刻知道全部设定。
                    </content_node_rules>
                    
                    <viewpoint_boundary>
                        确保角色的视角仅知道自己可以知道的信息，不要让每个角色都知道设定里的所有信息。
                        - 叙述可以知道故事结构，但角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。
                        - 不要因为某个设定写在 index.md 或 state.md 里，就默认场内每个角色都知道。
                        - 角色不知道的秘密、伏笔、地点规则或他人动机，不能写成该角色已经理解；可以写成读者可见的客观现象，或通过误解、试探、遮掩表现。
                        - 切换视角时要清楚，不要在同一段里随意跳进多个角色的内心。
                    </viewpoint_boundary>
                    
                    <char_performance>
                        角色的情绪不要过于平淡。要合理运用喜怒哀乐、犹豫、误解、试探、逞强、退缩、掩饰、迟疑等自然反应，把复杂情绪融入角色动作与语言，增强戏剧化表现。
                        重要的是：不要直接告诉读者角色“很悲伤”“很愤怒”“很温柔”。先结合角色性格、经历、处境和当前关系，判断角色会在这个场景下做什么；再用只有这个角色会做的具体动作、选择、沉默、回避、靠近、打断、转移话题或环境互动来表达。
                        台词本身就是情绪载体。台词后面不需要频繁挂载“声音里带着疲惫”“语气满是委屈”这类属性。如果确实需要传达说话方式，用角色具体做了什么来传达，而不是解释声音的情绪。
                        肢体语言不要永远集中在眼神、嘴唇和手指。角色可以移动、停顿、摆弄物件、改变站位、整理衣物、绕开障碍、触碰环境、避开某个话题、改变呼吸节奏、改变做事顺序。让身体和场景发生关系。
                    </char_performance>
                    
                    <important>
                        文风要求为最重要的规则要求喵，需要作为最高优先级并注意满足每一条要求，不然就会被克扣小鱼干
                        
                        ${writingStyle}
                        
                        <avoid_words>
                            禁止使用以下词汇：一丝、不容置疑、不易察觉、几不可察。
                            禁止使用以下句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。
                            如果想表达转折、对比或修正，直接写实际发生的动作、事实或判断，请换一种表述方式。
                        </avoid_words>
                    </important>
                    
                    <paragraph_rhythm>
                        正文采用完整的长自然段叙述，不要单句成段。
                        - 对话可以独立成段，但不要把每一个动作、表情、停顿都拆成单独短段。
                        - 一个自然段应承载连续的观察、动作推进、环境变化或关系变化，让场面有呼吸和叙事密度。
                        - 避免为了制造节奏感而频繁换行；短句短段只用于真正需要停顿、转折或强调的位置。
                    </paragraph_rhythm>
                    
                    <narrative_person>
                        默认人称：第三人称。
                        - 可以写角色名、代称或贴合当前章节的视角人物。
                        - 不默认使用第二人称“你”称呼用户角色。
                        - 如果输入约束明确要求第一人称、第二人称、书信体、日志体等，优先服从输入约束。
                    </narrative_person>
                    
                    <markdown_dialect>
                        NeuroBook Markdown 扩展写作格式：
                        - 工作区引用：正文内部 Markdown link 可以使用相对链接，例如 [角色设定](../../lorebook/character/foo/)；工具调用和 writer 输入仍必须使用 project-slug/... cwd-relative 路径。内容节点链接指向目录并保留结尾 /，普通文件链接指向具体文件名。
                        - Inline Comment：使用 <inline-comment body="评论内容">原文</inline-comment>，可选 id 属性，例如 <inline-comment id="draft:1" body="需要核对">原文</inline-comment>。
                        - Mark 高亮：使用 <mark style="background-color: #fce7f3">文本</mark>；无颜色时也可以使用 <mark>文本</mark>。
                        - 文本颜色：使用 <span style="color: #ef4444">文本</span>。
                        - 上标/下标：使用 <sup>上标</sup>、<sub>下标</sub>。
                        - 对齐块：使用 <align value="center">...</align>，value 支持 center、right、justify；左对齐保持普通 Markdown 即可。
                        
                        comment 使用时机：
                        - 只有在对已有草稿做批注、指出需要用户确认、核对、后续处理的局部文本时，才使用 inline-comment。
                        - 正式小说正文不要主动塞 comment；除非写作要求明确要求保留写作批注、审稿意见或待确认标记。
                        - comment 的 body 应短而具体，不承载长篇分析；长分析放在 report_result.result 或单独说明中。
                    </markdown_dialect>
                    
                    <polishing_workflow>
                        润色优先在原文基础上改。
                        - 如果目标章节已有正文，先读取原文，再优先用 edit 做最小必要修改；只有当改动天然是一整块时，才用 apply_patch。
                        - 如果本轮先用 write 写入了新正文，随后必须把该文件视为待润色原文，完成一次复查；发现问题先尝试 edit 逐处修正，只有成块改动才用 apply_patch。
                        - 如果用户只给出片段且没有文件路径，直接输出润色后的正文，不新增 outputPath 字段，也不要虚构文件路径。
                        - 不输出 <refine> JSON，不把润色分析、自检过程或替换清单混进 assistant 正文。
                        - 润色时重点修正不符合 <writing_style>、<avoid_words>、视角边界和长自然段要求的句子。
                    </polishing_workflow>
                    
                    <output_protocol>
                        - 章节写作任务：write 写入 <chapter_target> 的 indexPath，必要时先用 edit 逐处润色，只有成块改动才用 apply_patch，然后 report_result；不要用 prose-only final answer 代替工具流程。
                        - writer 正常总是绑定唯一章节；如果没有可写章节，停止写入并报告原因。
                        - 不输出 <summary> 标签，不输出“小猫之神的留言”，不输出写作分析。
                        - report_result.result：包含已写入或修改的文件路径、润色是否完成，以及剧情总结；总结要概括本次正文的时间、地点、参与角色、关键动作、关系变化、伏笔或状态变化。
                        - report_result.data：默认不填；除非调用方明确需要结构化结果。
                    </output_protocol>
                    `}
                    <If condition={ENABLE_KITTEN_ADULT_STYLE}>
                        {`
                        <adult_style>
                            - nsfw要注重色情，要有细节。五感上的色情特写以及语言上的低俗挑逗，用词直白（直接使用肉棒、鸡巴、小穴、逼、乳、奶子……等下流词汇）色情不避讳，最大化欲望与色情氛围。
色情场景要细致，在没有用户的要求时，不应结束性爱，而是将回复停止在性爱中途
                            - nsfw剧情要温柔！不许有任何粗暴、过度激烈的行为，生理反应要弱化，身体反弓剧烈颤抖尖叫痉挛是千万避免的禁止项。
                            - 氛围保持温柔、亲密、尊重角色关系，不使用粗暴、过度激烈或破坏人设的表达。
                            - 重点写角色互动、情绪推进和关系变化，避免把场景写成机械细节堆叠。
                            - 成人场景也必须遵守 <char_performance> 与 <writing_style>，不能因为题材变化就丢掉角色逻辑、视角边界和文风禁用项。
                        </adult_style>
                        `}
                    </If>
            </System>
            <HistorySet>
                <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                <Message><Import path="reference/content/markdown-dialect.md" /></Message>
                <Message><Import path="reference/agent/profile-context-memory.md" /></Message>
                <Message>{inputContext}</Message>
            </HistorySet>
            <AppendingSet>
                <Message>{`${ctx.input.prompt}`}</Message>
            </AppendingSet>
        </ProfilePrompt>
    );
}



async function renderInputContext(ctx: ProfilePrepareContext<Input>): Promise<string> {
    const input = ctx.input;
    const chapterTargets = await resolveWriterChapterTargets(ctx);
    const chapterPlotsText = renderChapterPlotsText(chapterTargets);
    const lorebookText = await buildLorebookText(ctx.session.workspaceRoot, input.lorebookEntries ?? []);

    const target = chapterTargets[0];
    const chapterTargetText = target ? [
        "<chapter_target>",
        `path: ${target.workspaceChapterPath}`,
        `indexPath: ${target.indexPath}`,
        `projectPath: ${target.projectPath}`,
        `chapterPath: ${target.chapterPath}`,
        "</chapter_target>",
    ].join("\n") : "";


    const lorebookBlock = lorebookText ? `<lorebook_entries>\n${lorebookText}\n</lorebook_entries>` : "";
    const chapterPlotsBlock = chapterPlotsText ? `<chapter_plots>\n${chapterPlotsText}\n</chapter_plots>` : "";
    const constraintsText = input.constraints?.length ? ["Constraints:", ...input.constraints.map((item) => `- ${item}`)].join("\n") : "";

    return [
        "<writer_input_context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        chapterTargetText,
        lorebookBlock,
        chapterPlotsBlock,
        constraintsText,
        "</writer_input_context>",
    ].filter(Boolean).join("\n");
}

/**
 * 读取 writer 输入中的内容节点引用并组装为 prompt 文本。
 */
async function buildLorebookText(workspaceRoot: string, entries: NonNullable<Input["lorebookEntries"]>): Promise<string> {
    const blocks: string[] = [];
    for (const entry of entries) {
        try {
            const nodeFiles = await readContentNodeFiles(workspaceRoot, entry);
            blocks.push([
                `## ${entry}`,
                "",
                "### index.md",
                nodeFiles.indexText,
                nodeFiles.stateText ? "\n### state.md" : "",
                nodeFiles.stateText ?? "",
            ].filter((line) => line !== "").join("\n"));
        } catch (error) {
            throw new Error(`writer 无法解析 lorebookEntries 节点 ${entry}: ${formatPromptError(error)}`);
        }
    }
    return blocks.join("\n\n---\n\n");
}

/**
 * 解析 writer 绑定的唯一章节，并读取章节剧情上下文。
 */
async function resolveWriterChapterTargets(ctx: ProfilePrepareContext<Input>): Promise<WriterChapterTarget[]> {
    if (ctx.input.chapterPaths.length !== 1) {
        throw new Error("writer.chapterPaths 必须且只能包含一个章节路径；多章节写作请创建多个 writer agent。");
    }
    const chapterPath = ctx.input.chapterPaths[0];
    if (!chapterPath) {
        throw new Error("writer.chapterPaths[0] 不能为空。");
    }
    const target = await resolveWriterChapterTarget(chapterPath);
    const facade = await loadPlotFacade();
    try {
        const chapterPlot = await facade.getChapterPlotDetailDto(target.projectPath, target.chapterPath);
        return [{...target, chapterPath: chapterPlot.chapterPath, chapterPlot}];
    } catch (error) {
        throw new Error(`writer 无法解析 chapterPaths[0] 章节 ${chapterPath}: ${formatPromptError(error)}`);
    }
}

/**
 * 将输入路径解析为 Agent cwd-relative Project 章节路径。
 */
async function resolveWriterChapterTarget(rawChapterPath: string): Promise<Omit<WriterChapterTarget, "chapterPlot">> {
    const normalized = normalizeInputPath(rawChapterPath);
    const explicit = resolveExplicitProjectChapterPath(normalized);
    if (!explicit) {
        throw new Error("writer.chapterPaths 必须是相对于 Agent cwd 的 Project 章节目录，例如 silver-dragon-hime/manuscript/001-第一章/；不要传 manuscript/... 或 workspace/silver-dragon-hime/...");
    }
    await readProjectManifest(explicit.projectPath);
    return buildChapterTarget(explicit.projectPath, explicit.projectSlug, explicit.chapterPath);
}

function buildChapterTarget(projectPath: string, projectSlug: string, chapterPath: string): Omit<WriterChapterTarget, "chapterPlot"> {
    const workspaceChapterPath = posix.join(projectSlug, chapterPath);
    return {
        projectPath,
        chapterPath,
        workspaceChapterPath,
        indexPath: posix.join(workspaceChapterPath, "index.md"),
    };
}

function normalizeInputPath(rawPath: string): string {
    return rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeChapterPath(rawPath: string): string | null {
    if (rawPath.endsWith("/index.md") || rawPath.endsWith(".md")) {
        return null;
    }
    if (!rawPath.startsWith("manuscript/") || !rawPath.endsWith("/")) {
        return null;
    }
    return rawPath;
}

function renderChapterPlotsText(targets: WriterChapterTarget[]): string {
    return targets.map((target) => renderChapterTargetBlock(target)).join("\n\n---\n\n");
}

/**
 * 读取单个内容节点的 index.md 与可选 state.md。
 */
async function readContentNodeFiles(workspaceRoot: string, entry: NonNullable<Input["lorebookEntries"]>[number]): Promise<{
    indexText: string;
    stateText: string | null;
}> {
    if (!workspaceRoot.trim()) {
        throw new Error(`当前 session 没有 workspaceRoot，无法读取内容节点 ${entry}`);
    }
    const indexPath = resolveContentNodeIndexPath(workspaceRoot, entry);
    const statePath = join(dirname(indexPath), "state.md");
    let indexRaw = "";
    try {
        indexRaw = await readFile(indexPath, "utf-8");
    } catch (error) {
        throw new Error(`无法读取内容节点 index.md: ${formatPromptError(error)}。节点路径：${entry}`);
    }
    const indexText = sanitizeWriterFacingMarkdown(indexRaw, WRITER_INDEX_FRONTMATTER_KEYS);
    const stateText = await readFile(statePath, "utf-8").then((content) => sanitizeWriterFacingMarkdown(
        content,
        WRITER_STATE_FRONTMATTER_KEYS,
    )).catch((error: unknown) => {
        if (isFileMissingError(error)) {
            return null;
        }
        throw new Error(`无法读取内容节点 state.md: ${formatPromptError(error)}。节点路径：${entry}`);
    });
    return {indexText, stateText};
}

/**
 * 将内容节点路径解析为 workspace 内的 index.md 绝对路径。
 */
function resolveContentNodeIndexPath(workspaceRoot: string, nodePath: string): string {
    const root = resolve(workspaceRoot);
    const trimmedPath = nodePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const relativeIndexPath = trimmedPath.endsWith(".md")
        ? trimmedPath
        : posix.join(trimmedPath.replace(/\/+$/, ""), "index.md");
    const absolutePath = resolve(root, relativeIndexPath);
    const relativeToWorkspace = relative(root, absolutePath);
    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
        throw new Error(`内容节点路径越过 workspace: ${nodePath}`);
    }
    return absolutePath;
}

/**
 * 只把写作相关 frontmatter 暴露给 writer，隐藏检索、注入、治理和扩展字段。
 */
function sanitizeWriterFacingMarkdown(content: string, allowedKeys: readonly string[]): string {
    try {
        const parsed = parseFrontmatterDocument(content, WriterFrontmatterSchema);
        const body = parsed.body.trim();
        if (!parsed.hasFrontmatter) {
            return body || "空";
        }
        const frontmatter = pickWriterFacingFrontmatter(parsed.rawFrontmatter, allowedKeys);
        if (Object.keys(frontmatter).length === 0) {
            return body || "空";
        }
        return renderFrontmatterDocument(frontmatter, `${body || "空"}\n`).trim();
    } catch {
        const body = stripFrontmatterBody(content).trim();
        return ["frontmatter 解析失败，已隐藏元数据。", "", body || "空"].join("\n");
    }
}

/**
 * 选出 writer 可见的 frontmatter 字段，并对结构化引用做二次白名单。
 */
function pickWriterFacingFrontmatter(rawFrontmatter: Record<string, unknown>, allowedKeys: readonly string[]): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};
    for (const key of allowedKeys) {
        if (!(key in rawFrontmatter)) {
            continue;
        }
        if (key === "refs") {
            frontmatter.refs = sanitizeRefs(rawFrontmatter.refs);
            continue;
        }
        if (key === "aliases" || key === "tags" || key === "knowledge") {
            frontmatter[key] = sanitizeStringArray(rawFrontmatter[key]);
            continue;
        }
        frontmatter[key] = rawFrontmatter[key];
    }
    return frontmatter;
}

function sanitizeRefs(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!isRecord(item)) {
            return [];
        }
        const ref: Record<string, unknown> = {};
        for (const key of ["relation", "target", "note"] as const) {
            if (key in item) {
                ref[key] = item[key];
            }
        }
        return Object.keys(ref).length > 0 ? [ref] : [];
    });
}

function sanitizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stripFrontmatterBody(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u);
    return match?.[1] ?? content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileMissingError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as {code?: unknown}).code === "ENOENT");
}

function renderChapterTargetBlock(target: WriterChapterTarget): string {
    return [
        `## Chapter: ${target.workspaceChapterPath}`,
        `projectPath: ${target.projectPath}`,
        `indexPath: ${target.indexPath}`,
        "",
        "### Chapter Plot",
        renderChapterPlot(target.chapterPlot),
    ].join("\n");
}

function renderChapterPlot(chapterPlot: ChapterPlotDetailDto): string {
    return [
        `chapterPath: ${chapterPlot.chapterPath}`,
        `totalScenes: ${String(chapterPlot.totalScenes)}`,
        `totalPlots: ${String(chapterPlot.totalPlots)}`,
        "",
        chapterPlot.scenes.length > 0 ? chapterPlot.scenes.map((item) => renderChapterScene(item)).join("\n\n") : "空",
    ].join("\n");
}

function renderChapterScene(scene: ChapterPlotDetailDto["scenes"][number]): string {
    return [
        `- sceneId: ${scene.id}`,
        `  title: ${scene.title}`,
        `  threadTitle: ${scene.threadTitle}`,
        `  status: ${scene.status}`,
        `  summary: ${scene.summary}`,
        `  purpose: ${scene.purpose ?? "空"}`,
        `  chapterSortOrder: ${scene.chapterSortOrder ?? "空"}`,
        `  threadSortOrder: ${String(scene.threadSortOrder)}`,
        scene.plots.length > 0 ? `  plots: ${scene.plots.map((plot) => `${plot.kind}:${plot.summary}`).join(" | ")}` : "  plots: 空",
    ].join("\n");
}

function resolveExplicitProjectChapterPath(normalizedPath: string): {projectPath: string; projectSlug: string; chapterPath: string} | null {
    const parts = normalizedPath.split("/").filter(Boolean);
    if (parts[0] === "workspace" || parts[0] === "manuscript") {
        return null;
    }
    const projectName = parts[0] ?? "";
    const chapterPathInput = projectName ? normalizedPath.slice(projectName.length + 1) : "";
    const chapterPath = normalizeChapterPath(chapterPathInput);
    return projectName && chapterPath
        ? {projectPath: normalizeProjectPath(posix.join("workspace", projectName)), projectSlug: projectName, chapterPath}
        : null;
}

function formatPromptError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function loadPlotFacade(): Promise<typeof import("nbook/server/plot").plotFacade> {
    return (await import("nbook/server/plot")).plotFacade;
}
