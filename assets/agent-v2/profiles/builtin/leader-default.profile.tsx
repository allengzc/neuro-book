import {buildLeaderDefaultPrompt} from "nbook/server/agent/profiles/builtin/leader-default.profile";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {LeaderInputSchema} from "nbook/server/agent/types";

export const profileManifest = {
    key: "leader.default",
    kind: "leader",
    name: "Leader",
} as const;

export const InputSchema = LeaderInputSchema;
export type Input = typeof InputSchema._output;

export default defineAgentProfile<typeof profileManifest.key, Input>({
    manifest: profileManifest,
    inputSchema: InputSchema,
    allowedToolKeys: [
        "create_subagent",
        "list_subagents",
        "invoke_subagent",
        "enter_plan_mode",
        "exit_plan_mode",
        "request_user_input",
        "skill",
        "task_create",
        "task_set_status",
        "execute_sql",
        "execute_shell",
        "read_file",
        "edit_file",
        "apply_patch",
        "write_file",
        "update_novel",
        "get_plot_tree",
        "get_story_thread",
        "get_story_scene_context",
        "get_chapter_plot",
        "create_story_thread",
        "update_story_thread",
        "create_story_scene",
        "update_story_scene",
        "create_story_plot",
        "update_story_plot",
    ],
    buildPrompt: buildLeaderDefaultPrompt,
});
