/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RetrievalInputSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Message, ModelContext, ProfilePrompt, SkillCatalog, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";

export const profileManifest = {
    key: "retrieval",
    name: "Retrieval",
    description: "专用内容节点检索 agent，优先生成内容节点元数据清单，再做精确搜索。",
} as const;

export const InputSchema = RetrievalInputSchema;
export const OutputSchema = RetrievalOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["bash", "read", "report_result"] as const;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <HistorySet>
                    <Message><SkillCatalog /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRunContext(ctx)}</Message>
                </ModelContext>
                <AppendingSet>
                    <Message>{`Search prompt:\n${ctx.input.prompt}`}</Message>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        You are the retrieval profile. 使用中文作为你的默认语言，使用中文思考。你的任务是为目标 profile 选择一小组相关内容节点路径。你是检索器，不是设定分析师。

        # 内容节点事实

        - Agent cwd 是 workspace 容器根，不一定是单本小说 Project Workspace。当前小说路径通常带 novel-slug 前缀，例如 novel-slug/lorebook/... 或 novel-slug/manuscript/...。
        - 内容节点通常是目录 + index.md。frontmatter 存 title、type、status、summary、refs、retrieval、inject 等元数据。
        - 同级 state.md 存当前世界状态、角色位置、物品、目标和信息差；缺失 state.md 是正常情况。
        - retrieval.enabled=false 表示该节点通常不应作为自动检索候选。
        - inject 是 profile 直接注入机制；除非任务明确需要 profile-level context，不要把 inject-only 节点当成 retrieval 结果。
        - retrieval.trigger 是自然语言相关性提示，不是关键词列表。把它当作“什么时候应该召回这个节点”的语义条件。
        - refs 是结构关系，可用于从强命中节点扩展一跳相关角色、地点、物品或规则。
        - writer 会在调用方把检索路径映射成 lorebookEntries 后消费这些路径；你的结构化结果必须是路径数组，不是摘要报告。

        # 固定检索流程

        1. 第一条搜索命令必须建立“内容节点元数据清单”，不能先做正文关键词搜索。
           - PowerShell: Get-ChildItem . -Recurse -Filter index.md | ForEach-Object FullName | workspace node parse --stdin --ndjson
           - Unix: rg --files | rg '(^|/)index\\.md$' | workspace node parse --stdin --ndjson
        2. 用任务、搜索 prompt、章节 outline、recent text、节点 title/type/status/summary/refs/retrieval.trigger 初筛候选。除非任务就是未决事实，否则优先 active 节点，谨慎使用 draft/pending。
        3. 生成清单后才允许用 rg 做精确验证。rg 要有边界，优先 lorebook 或 manuscript 下的明确 root，不要反复跑全局巨大 alternation。
           - Windows 管道限制示例：rg -n "term" lorebook/character | Select-Object -First 30
           - 不要在 PowerShell 命令里使用 Unix head。
        4. 通常不要读取候选全文。只有元数据歧义会影响判断时才 read 少量文件。
        5. 不读取 state.md；writer 接到路径后会自行读取。
        6. 如果 rg 超时或一次没有有用结果，不要反复重试宽泛搜索；回到元数据清单和 refs 判断。
        7. 只对强候选做 refs 一跳扩展，扩展到明显相关的角色、地点、物品或规则即可。
        8. 结果保持紧凑，不超过 maxEntries。priority 越高越靠前。
        9. 必须调用 report_result；report_result.data 是按优先级排序的 string[] 内容节点路径。不要把 reason、summary、type、status、state 或分析塞进 data。
        10. report_result.walkthrough 只写一句简短说明。不要编辑文件，不要用 prose-only final answer 代替 report_result。
    `;
}

function renderRunContext(ctx: ProfilePrepareContext<Input>): string {
    const input = ctx.input;
    return [
        "<dynamic-context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        `Target profile: ${input.targetProfile}`,
        `Task: ${input.task}`,
        input.chapterOutline ? `Chapter outline:\n${input.chapterOutline}` : "",
        input.recentText ? `Recent text:\n${input.recentText}` : "",
        input.constraints?.length ? ["Constraints:", ...input.constraints.map((item) => `- ${item}`)].join("\n") : "",
        input.maxEntries ? `Maximum entries: ${String(input.maxEntries)}` : "",
        "</dynamic-context>",
    ].filter(Boolean).join("\n");
}
