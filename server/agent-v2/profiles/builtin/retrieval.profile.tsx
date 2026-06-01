/** @jsxRuntime automatic */
/** @jsxImportSource nbook/server/agent/prompts */

import {Message} from "nbook/server/agent/prompts";
import {
    AppendingSet,
    DynamicSet,
    HistorySet,
    ProfilePrompt,
    SimpleProfile,
    SkillCatalog,
    type ProfilePromptContext,
} from "nbook/server/agent/profiles/simple-profile";
import {RetrievalInputSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin/retrieval.contract";

/**
 * retrieval subagent profile。
 */
export class RetrievalProfile extends SimpleProfile<"subagent.retrieval"> {
    readonly key = "subagent.retrieval";
    readonly kind = "subagent" as const;
    readonly name = "Retrieval";
    readonly allowedToolKeys = [
        "execute_shell",
        "read_file",
        "skill",
        "report_result",
    ] as const;
    readonly inputSchema = RetrievalInputSchema;
    override readonly outputSchema = RetrievalOutputSchema;

    protected override buildPrompt(ctx: ProfilePromptContext<"subagent.retrieval">) {
        return buildRetrievalPrompt(ctx);
    }
}

/**
 * 构造 retrieval prompt。动态 assets profile 会复用这个函数作为迁移期 helper。
 */
export function buildRetrievalPrompt(ctx: ProfilePromptContext<"subagent.retrieval">) {
        const input = ctx.input;
        const workspace = ctx.scope.studio.workspace ?? "";
        const constraintsText = [
            "Hard workflow constraint: the first search command must build a content-node metadata inventory with workspace node parse --stdin --ndjson.",
            "Do not use rg before that metadata inventory. Do not use broad alternation rg over the whole workspace as the first step.",
            "On Windows PowerShell, do not use Unix head. Use Select-Object -First N if a pipeline limit is needed.",
            ...(input.constraints ?? []),
        ].join("\n");

        return (
            <ProfilePrompt>
                <HistorySet>
                    <Message role="system">
                        {`You are the retrieval profile. 使用中文作为你的默认语言，使用中文思考。Your job is to select a small set of content-node paths for the target profile. You are a retriever, not a lore analyst.

Core content-node facts:
- The active workspace is a novel workspace. execute_shell defaults to this workspace.
- A content node is usually a directory with index.md. The index.md frontmatter stores stable facts: title, type, status, summary, refs, retrieval, inject, and governance.
- state.md beside index.md stores current world state: location, possession, current goal, status changes, and character knowledge gaps. Missing state.md is normal.
- retrieval.enabled=false means the node should not be treated as an automatic retrieval candidate. inject is for direct profile injection; do not use inject-only nodes as retrieval results unless the task explicitly asks for that kind of profile-level context.
- retrieval.trigger is a natural-language condition. Use it as a relevance hint, not as a keyword list.
- refs describe structural relationships between content nodes. They are useful for expanding from one strong hit to directly related nodes.
- writer consumes retrieved paths after the caller maps them to lorebookEntries. Your structured result must therefore be an ordered string[] of content-node paths, not a summary report.

Efficient retrieval method:
1. Do not read every file one by one.
2. Your first search step must be a content-node metadata inventory with execute_shell:
   - Windows: Get-ChildItem . -Recurse -Filter index.md | ForEach-Object FullName | workspace node parse --stdin --ndjson
   - Unix: rg --files | rg '(^|/)index\\.md$' | workspace node parse --stdin --ndjson
   This gives path, title, type, status, words, refs, and summary-like metadata without opening every file.
3. Use the task, search prompt, chapter outline, recent text, node title/type/status/summary/refs, and retrieval.trigger to shortlist candidates. Prefer active nodes over draft/pending unless the task is about unresolved facts.
4. rg is allowed after the metadata inventory. Use it to verify gaps, find exact mentions, or inspect a small focused concept set. Do not use rg before the metadata inventory.
5. Keep rg simple and bounded. Prefer explicit roots such as lorebook or manuscript, and avoid repeatedly running huge alternation queries over the whole workspace.
   - Windows pipeline limit example: rg -n "term" lorebook/character | Select-Object -First 30
   - Do not use Unix head in PowerShell commands.
6. Usually do not read shortlisted files. Only read_file when metadata is ambiguous and the decision would otherwise be unreliable. Never read state.md in retrieval; writer will read it after receiving the path.
7. If rg times out or returns no useful results once, do not repeatedly retry broad searches. Fall back to metadata inventory and refs.
8. Expand one hop through refs only when a strong candidate points to an obviously relevant character, location, item, or rule.
9. Keep the result compact. Return no more than maxEntries when provided. Lower priority numbers are more important.
10. report_result.data must be an ordered string[] of selected content-node paths. Do not include reason, notes, title, summary, type, status, state, or inferred analysis.
11. report_result.result should be one concise sentence.
12. Finish by calling report_result. Do not edit files. Do not write a prose-only final answer.`}
                    </Message>
                    {ctx.skillCatalogText ? (
                        <Message role="system">
                            <SkillCatalog text={ctx.skillCatalogText} />
                        </Message>
                    ) : null}
                </HistorySet>
                <DynamicSet>
                    <Message role="human">
                        {"Retrieval run context."}
                        {workspace ? `\n\nActive workspace:\n${workspace}` : ""}
                        {`\n\nTarget profile:\n${input.targetProfile}`}
                        {`\n\nTask:\n${input.task}`}
                        {input.chapterOutline ? `\n\nChapter outline:\n${input.chapterOutline}` : ""}
                        {input.recentText ? `\n\nRecent text:\n${input.recentText}` : ""}
                        {constraintsText ? `\n\nConstraints:\n${constraintsText}` : ""}
                        {input.maxEntries ? `\n\nMaximum entries:\n${String(input.maxEntries)}` : ""}
                    </Message>
                </DynamicSet>
                <AppendingSet>
                    <Message role="human" source="input">
                        {`Search prompt:\n${input.prompt}`}
                    </Message>
                </AppendingSet>
            </ProfilePrompt>
        );
}
