import * as dsl from "nbook/server/agent/profiles/profile-dsl";
import type {ProfileDslChild, ProfileDslNode} from "nbook/server/agent/profiles/profile-dsl";

type Props = Record<string, unknown> & {
    children?: ProfileDslChild | ProfileDslChild[];
};

const components = {
    ProfilePrompt: dsl.ProfilePrompt,
    System: dsl.System,
    HistorySet: dsl.HistorySet,
    ModelContext: dsl.ModelContext,
    AppendingSet: dsl.AppendingSet,
    Compaction: dsl.Compaction,
    CompactionPrompt: dsl.CompactionPrompt,
    CompactionSummaryPrefix: dsl.CompactionSummaryPrefix,
    Message: dsl.Message,
    AIMessage: dsl.AIMessage,
    ToolCall: dsl.ToolCall,
    ToolResult: dsl.ToolResult,
    Reminder: dsl.Reminder,
    Watch: dsl.Watch,
    If: dsl.If,
    SystemReminder: dsl.SystemReminder,
    RuntimeContext: dsl.RuntimeContext,
    LinkedAgentsSummary: dsl.LinkedAgentsSummary,
    WorkspaceReminder: dsl.WorkspaceReminder,
    LinkedAgentsReminder: dsl.LinkedAgentsReminder,
    TaskReminder: dsl.TaskReminder,
    PlanModeReminder: dsl.PlanModeReminder,
    PlanModeFull: dsl.PlanModeFull,
    PlanModeSparse: dsl.PlanModeSparse,
    PlanModeExit: dsl.PlanModeExit,
    PlanModeReentry: dsl.PlanModeReentry,
    ActivePlanModeReminder: dsl.ActivePlanModeReminder,
    MentionedSkillsReminder: dsl.MentionedSkillsReminder,
    PlotFocusReminder: dsl.PlotFocusReminder,
    AgentCatalog: dsl.AgentCatalog,
    SkillCatalog: dsl.SkillCatalog,
    ActivatedSkills: dsl.ActivatedSkills,
    SqlSchemaSummary: dsl.SqlSchemaSummary,
};

export const Fragment = dsl.Fragment;

/**
 * TSX 自动运行时入口。profile 文件通过 @jsxImportSource 指向这里。
 */
export function jsx(type: keyof typeof components | typeof Fragment | ((props: Props) => ProfileDslNode), props: Props): ProfileDslNode {
    return createElement(type, props);
}

export const jsxs = jsx;

export function createElement(type: keyof typeof components | typeof Fragment | ((props: Props) => ProfileDslNode), props: Props): ProfileDslNode {
    if (typeof type === "function") {
        return type(props);
    }
    const component = components[type];
    if (!component) {
        throw new Error(`未知 Profile DSL JSX 节点：${String(type)}`);
    }
    return component(props as never);
}

export namespace JSX {
    export type Element = ProfileDslNode;
    export interface IntrinsicElements {
        ProfilePrompt: Parameters<typeof dsl.ProfilePrompt>[0];
        System: Parameters<typeof dsl.System>[0];
        HistorySet: Parameters<typeof dsl.HistorySet>[0];
        ModelContext: Parameters<typeof dsl.ModelContext>[0];
        AppendingSet: Parameters<typeof dsl.AppendingSet>[0];
        Compaction: Parameters<typeof dsl.Compaction>[0];
        CompactionPrompt: Parameters<typeof dsl.CompactionPrompt>[0];
        CompactionSummaryPrefix: Parameters<typeof dsl.CompactionSummaryPrefix>[0];
        Message: Parameters<typeof dsl.Message>[0];
        AIMessage: Parameters<typeof dsl.AIMessage>[0];
        ToolCall: Parameters<typeof dsl.ToolCall>[0];
        ToolResult: Parameters<typeof dsl.ToolResult>[0];
        Reminder: Parameters<typeof dsl.Reminder>[0];
        Watch: Parameters<typeof dsl.Watch>[0];
        If: Parameters<typeof dsl.If>[0];
        SystemReminder: Parameters<typeof dsl.SystemReminder>[0];
        RuntimeContext: Parameters<typeof dsl.RuntimeContext>[0];
        LinkedAgentsSummary: Parameters<typeof dsl.LinkedAgentsSummary>[0];
        WorkspaceReminder: Parameters<typeof dsl.WorkspaceReminder>[0];
        LinkedAgentsReminder: Parameters<typeof dsl.LinkedAgentsReminder>[0];
        TaskReminder: Parameters<typeof dsl.TaskReminder>[0];
        PlanModeReminder: Parameters<typeof dsl.PlanModeReminder>[0];
        PlanModeFull: Parameters<typeof dsl.PlanModeFull>[0];
        PlanModeSparse: Parameters<typeof dsl.PlanModeSparse>[0];
        PlanModeExit: Parameters<typeof dsl.PlanModeExit>[0];
        PlanModeReentry: Parameters<typeof dsl.PlanModeReentry>[0];
        ActivePlanModeReminder: Parameters<typeof dsl.ActivePlanModeReminder>[0];
        MentionedSkillsReminder: Record<string, never>;
        PlotFocusReminder: Parameters<typeof dsl.PlotFocusReminder>[0];
        AgentCatalog: Parameters<typeof dsl.AgentCatalog>[0];
        SkillCatalog: Parameters<typeof dsl.SkillCatalog>[0];
        ActivatedSkills: Parameters<typeof dsl.ActivatedSkills>[0];
        SqlSchemaSummary: Parameters<typeof dsl.SqlSchemaSummary>[0];
    }
}
