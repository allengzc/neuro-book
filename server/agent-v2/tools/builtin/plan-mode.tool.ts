import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const EmptyArgsSchema = z.object({});
const ExitPlanModeArgsSchema = z.object({
    planFilePath: z.string().trim().min(1).optional().describe("Optional Markdown plan file path inside the current-thread directory to show in the approval UI."),
});
const THREAD_DIRECTORY_PATH = "workspace/{novel-name}/.agent/{thread_id}/";

/**
 * 进入软 Plan Mode。
 */
export const enterPlanModeTool: AgentTool<typeof EmptyArgsSchema> = {
    key: "enter_plan_mode",
    description: [
        "Request user approval to enter soft Plan Mode for the current thread. This tool takes no arguments.",
        "",
        "Prefer this tool for implementation tasks unless they are simple. Use it when any of these apply: new feature implementation, meaningful behavior or structure changes, architectural decisions, multi-file changes, unclear requirements, multiple valid approaches, or user preferences that materially shape the solution.",
        "Skip this tool for single-line or few-line fixes, obvious small tweaks, a single function with clear requirements, very specific instructions that already determine the implementation, ordinary research, codebase exploration, file reading, or search-only tasks.",
        "",
        "Before calling this tool, briefly tell the user in normal assistant text why Plan Mode is needed. The tool itself has no reason parameter.",
        "After the user approves entering Plan Mode, explore read-only first, report important findings to the user, clarify unresolved requirements with request_user_input when needed, then prepare an implementation-ready plan before coding.",
        "While Plan Mode is active, do not implement code or mutate product files until the plan has been approved through exit_plan_mode, except for small non-editing tasks that only require read-only work.",
        "",
        `Optional Plan Mode work files are scoped to the current-thread directory only: ${THREAD_DIRECTORY_PATH}`,
        "In Plan Mode, use that directory for reviewable Markdown plan files, walkthrough files, or research notes when the implementation is non-trivial or needs longer review. Do not inspect, enumerate, read, or cite files from other sessions or threads.",
        "",
        "This tool only requests approval to enter Plan Mode. Do not use it to ask whether a finished plan is approved; use exit_plan_mode for plan approval.",
    ].join("\n"),
    schema: EmptyArgsSchema,
    async execute(input) {
        const rawResult = {
            kind: "pending_tool_approval",
            action: "enter_plan_mode",
            planDirectoryPath: THREAD_DIRECTORY_PATH,
            message: "Requesting user approval to enter Plan Mode.",
        };
        return {
            ...createToolResultMessage("Plan Mode approval requested: enter", JSON.stringify(input)),
            rawResult,
        };
    },
};

/**
 * 退出软 Plan Mode。
 */
export const exitPlanModeTool: AgentTool<typeof ExitPlanModeArgsSchema> = {
    key: "exit_plan_mode",
    description: [
        "Use this tool only when you are in Plan Mode, have finished an implementation-ready plan, and are ready for the user to review and approve leaving Plan Mode.",
        "",
        "When to use this tool:",
        "- Use it after planning implementation steps for a task that requires code or behavior changes.",
        "- Do not use it for research-only tasks, codebase exploration, file reading, searching, or general understanding work where you are not proposing implementation steps.",
        "",
        "Before using this tool, ensure the plan is complete and unambiguous. If requirements or approach choices are still unresolved, use request_user_input earlier in Plan Mode instead.",
        "Before the tool call, briefly report what you planned in chat. When you prepared a Markdown plan or walkthrough file, cite it either by passing planFilePath to this tool or by using a Markdown link in your chat report.",
        "Do not use request_user_input or plain text to ask whether the plan is okay. This tool is the approval request.",
        "",
        "This tool accepts one optional argument: planFilePath.",
        "Do not pass plan content as a parameter. The user should see the plan in chat, and when planFilePath is provided the UI approval bubble can also show a Markdown file preview.",
        `The planFilePath must point to a Markdown file inside the current-thread directory ${THREAD_DIRECTORY_PATH}`,
        "You may pass a file name such as plan.md or walkthrough.md, a nested relative path such as notes/review.md, or the displayed workspace/.../.agent/{thread_id}/plan.md path.",
        "Do not inspect, enumerate, read, or cite files from other sessions or threads.",
        "",
        "If you omit planFilePath, the approval still proceeds and the user reviews the visible chat plan. Use this mainly when no plan file was prepared, such as for a small non-editing task. The runtime will not auto-select a plan file.",
        "Do not hide the plan only in a file: summarize the plan or important changes in chat before requesting approval.",
    ].join("\n"),
    schema: ExitPlanModeArgsSchema,
    async execute(input) {
        const rawResult = {
            kind: "pending_tool_approval",
            action: "exit_plan_mode",
            planDirectoryPath: THREAD_DIRECTORY_PATH,
            ...(input.planFilePath ? {planFilePath: input.planFilePath} : {}),
            message: "Requesting user approval to exit Plan Mode.",
        };
        return {
            ...createToolResultMessage("Plan Mode approval requested: exit", JSON.stringify(input)),
            rawResult,
        };
    },
};
