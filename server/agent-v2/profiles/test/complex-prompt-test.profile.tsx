/** @jsxRuntime automatic */
/** @jsxImportSource nbook/server/agent/prompts */

import {If, Message} from "nbook/server/agent/prompts";
import {
    ActivatedSkills,
    AppendingSet,
    DynamicSet,
    HistorySet,
    ProfilePrompt,
    Reminder,
    SimpleProfile,
    SkillCatalog,
    Watch,
    type ProfilePromptContext,
} from "nbook/server/agent/profiles/simple-profile";
import {LeaderInputSchema} from "nbook/server/agent/types";

/**
 * 专用于 SimpleProfile TSX prompt 编排测试的复杂 profile。
 */
export class ComplexPromptTestProfile extends SimpleProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "Complex Prompt Test";
    readonly inputSchema = LeaderInputSchema;
    readonly allowedToolKeys = ["read_file", "skill", "execute_shell"] as const;

    protected override async buildPrompt(ctx: ProfilePromptContext<"leader.default">) {
        const scope = ctx.scope;
        const promptText = "prompt" in ctx.input ? ctx.input.prompt : "";
        const shouldAppendInput = !("mode" in ctx.input && ctx.input.mode === "continue");
        const workspace = scope.studio.workspace ?? "";
        const selectedThreadId = ctx.var("scope.studio.extra.selectedStoryThreadId");
        const selectedSceneId = ctx.var("scope.studio.extra.selectedStorySceneId");
        const activatedSkillsText = await ctx.activatedSkillsText();
        const compactSubagents = scope.agent.subagents
            .map((item) => [item.title, item.profileKey, item.status].filter(Boolean).join(" | "))
            .filter(Boolean);
        const compactTaskSteps = scope.agent.tasks
            ? scope.agent.tasks.steps.map((step) => [
                `id: ${step.id}`,
                `status: ${step.status}`,
                `text: ${step.text}`,
                step.note ? `note: ${step.note}` : "",
            ].filter(Boolean).join(" | "))
            : [];

        return (
            <ProfilePrompt>
                <HistorySet>
                    <Message role="system">
                        complex system prompt
                    </Message>
                    {ctx.skillCatalogText ? (
                        <Message role="system">
                            <SkillCatalog text={ctx.skillCatalogText} />
                        </Message>
                    ) : null}
                </HistorySet>
                <DynamicSet>
                    <If condition={ctx.hasTool("execute_shell")}>
                        <Message role="assistant">
                            dynamic shell tool enabled
                        </Message>
                    </If>
                </DynamicSet>
                <AppendingSet>
                    <If condition={Boolean(selectedThreadId || selectedSceneId || compactSubagents.length || compactTaskSteps.length)}>
                        <Reminder id="runtime">
                            <Message role="human">
                                {selectedThreadId ? `【当前剧情焦点】\nThread: ${String(selectedThreadId)}\n` : ""}
                                {selectedSceneId ? `Scene: ${String(selectedSceneId)}\n` : ""}
                                {compactSubagents.length ? `【当前已关联 subagent】\n${compactSubagents.join("\n")}\n` : ""}
                                {compactTaskSteps.length ? `【当前任务状态】\n${compactTaskSteps.join("\n")}` : ""}
                            </Message>
                        </Reminder>
                    </If>
                    <Reminder
                        id="workspace"
                        when={Boolean(workspace)}
                        watchPath="scope.studio.workspace"
                        repeatEveryTurns={5}
                    >
                        <Message role="system">
                            {`workspace reminder: ${workspace}`}
                        </Message>
                    </Reminder>
                    {ctx.runtime.options.planModeReminder ? (
                        <Reminder id="plan-mode">
                            <Message role="system">
                                {`plan reminder: ${ctx.runtime.options.planModeReminder}`}
                            </Message>
                        </Reminder>
                    ) : null}
                    <Watch
                        path="scope.studio.currentChapterLabel"
                        render={({previousValue, currentValue}) => {
                            const previousText = previousValue ?? "";
                            const currentText = currentValue ?? "";
                            if (!previousText && !currentText) {
                                return null;
                            }
                            return (
                                <Message role="system">
                                    {`chapter changed: ${previousText}->${currentText}`}
                                </Message>
                            );
                        }}
                    />
                    {activatedSkillsText ? (
                        <Message role="human">
                            <ActivatedSkills text={activatedSkillsText} />
                        </Message>
                    ) : null}
                    {shouldAppendInput ? (
                        <Message role="human" source="input">
                            {promptText}
                        </Message>
                    ) : null}
                </AppendingSet>
            </ProfilePrompt>
        );
    }
}
