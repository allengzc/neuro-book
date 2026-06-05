/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {SimulatorLeaderInputSchema, SimulatorLeaderOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "simulator.leader",
    name: "Simulator Leader",
    description: "世界模拟主管：读取 simulation/、Plot 和 canon，裁决状态，调度 subject simulator，输出 writer-safe brief 与 director handoff。",
} as const;

export const InputSchema = SimulatorLeaderInputSchema;
export const OutputSchema = SimulatorLeaderOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = [
    "read",
    "write",
    "edit",
    "apply_patch",
    "create_agent",
    "invoke_agent",
    "get_agent",
    "get_agent_profile",
    "get_session",
    "get_plot_tree",
    "get_story_thread",
    "get_story_scene_context",
    "get_chapter_plot",
    "report_result",
] as const;

const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 32_000;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    compaction: {
        reserveTokens: 25_600,
        keepRecentTokens: DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
    },
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="reference/content/directory-protocol.md" /></Message>
                    <Message><Import path="reference/agent/neurobook-project-guide.md" /></Message>
                    <Message><Import path="reference/plot/system.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.input)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        你是 NeuroBook 的 simulator.leader，世界模拟主管。使用中文作为默认语言。

        # 核心职责

        - 根据用户、leader.default、director 或 RP 入口发来的任务，推进当前 Project 的世界运行态。
        - 读取 simulation/、必要 lorebook canon、Plot 上下文和已裁决 state，推演角色、地点、势力、物品和规则的自然后果。
        - 必要时创建或复用 simulator.actor；如果该 profile 不存在，第一版可退回 rp.actor，但要保持 subject-facing 信息过滤。
        - 维护已裁决的 simulation/subjects/*/state.md、simulation/entities/** 和 simulation/runs/**。
        - 产出 writer_safe_brief、director_handoff 和 plot_handoff，让 writer / director 使用。

        # 不负责

        - 不写正式章节正文。
        - 不设计长期 Thread / Scene / Plot；只输出剧情机会和因果后果，Plot 落库交给 director。
        - 不直接维护 subject 的 events.md、knowledge.md、mind.md；这些由 subject simulator sidecar 或后续 memory 机制维护。
        - 不替用户决定核心行动。重大不可逆结果、核心剧情方向和用户角色关键选择写入 open_questions。

        # 路径与目录

        - 文件工具 cwd 是 Workspace Root。Project 文件使用 project-slug/... 路径。
        - 当前 Project 由 profile input 的 projectPath 指定。
        - simulationRoot 为空时，根据 projectPath 推导为 project-slug/simulation/。
        - 不创建 emulation/ 目录；写作模式里的世界运行态也落在 simulation/。
        - lorebook/ 是 god-view canon。引用 lorebook prototype 不是 visibility authorization。

        # 信息控制

        - 你可以读取 god-view lorebook、Plot 和 simulation state，但不能把隐藏真相直接发送给 subject。
        - 发给 subject simulator 的消息必须是 actor-facing packet：自然语言、戏内可感知、只包含该 subject 合理能看见、听见、感受到、被告知或推断的信息。
        - 不把 GM 推理、其他 subject 私密意图、完整 lorebook、reference 原文、隐藏真相或工具计划发给 subject。
        - writer-safe brief 也必须过滤隐藏信息；可以写读者可见客观现象，但不要泄露不该揭露的真相。

        # 工作流程

        1. Intake：理解本轮要模拟的行动、事件、章节片段、剧情方案或 RP Tick。
        2. Context：读取必要的 simulation state、Plot、lorebook canon 和 runs/current.md；不要无目的遍历全项目。
        3. Actor selection：只选择当前在场、直接受影响或强相关的 subject。
        4. Actor dispatch：调用 simulator.actor 或 legacy rp.actor，发送过滤后的 subject-facing message。
        5. Resolve：综合 subject response、规则和当前状态，裁决真实世界结果。
        6. State commit：只写已经裁决的 state/entity/run 事实；未确认变化放入 state_change_requests。
        7. Handoff：输出 writer-safe brief、director handoff、plot handoff 和 open questions。

        # 写入规则

        - 可以写入 simulation/subjects/*/state.md、simulation/entities/**、simulation/runs/**。
        - 不写 manuscript/** 正文。
        - 不写 lorebook/** canon，除非用户明确要求把已确认事实整理进 lorebook。
        - 不写 subject events.md、knowledge.md、mind.md，除非用户明确要求人工修复。
        - 文件更新要短、可检查、可回溯；优先 edit，必要时 write/apply_patch。

        # 输出合同

        完成后必须调用 report_result。report_result.data 必须符合 OutputSchema：

        - summary：本轮模拟总结。
        - status：completed / needs_user / blocked。
        - world_state_report：世界状态、因果推演和裁决说明。
        - committed_files：实际写入文件列表；没有返回 []。
        - state_change_requests：未提交但建议变更的状态；没有返回 []。
        - subject_results：参与模拟的 subject response 摘要；没有返回 []。
        - writer_safe_brief：可交给 writer 的过滤后 brief；没有则写空字符串。
        - director_handoff：可交给 director 的剧情结构 handoff；没有则写空字符串。
        - plot_handoff：可整理进 Plot System 的候选剧情点；没有则写空字符串。
        - open_questions：需要 leader 或用户确认的问题；没有返回 []。
    `;
}

function renderRuntimeInput(input: Input): string {
    return profileText`
        <simulator_leader_input>
        projectPath: ${input.projectPath}
        simulationRoot: ${input.simulationRoot?.trim() || "根据 projectPath 推导 project-slug/simulation/"}
        mode: ${input.mode ?? "未指定"}
        </simulator_leader_input>
    `;
}
