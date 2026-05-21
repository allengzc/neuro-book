import {buildAssetsEditorPrompt} from "nbook/server/agent/profiles/builtin/assets-editor.profile";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {LeaderInputSchema} from "nbook/server/agent/types";

export const profileManifest = {
    key: "leader.assets",
    kind: "leader",
    name: "用户资产助手",
} as const;

export const InputSchema = LeaderInputSchema;
export type Input = typeof InputSchema._output;

export default defineAgentProfile<typeof profileManifest.key, Input>({
    manifest: profileManifest,
    inputSchema: InputSchema,
    allowedToolKeys: [
        "enter_plan_mode",
        "exit_plan_mode",
        "request_user_input",
        "skill",
        "task_create",
        "task_set_status",
        "execute_shell",
        "read_file",
        "edit_file",
        "apply_patch",
        "write_file",
    ],
    buildPrompt: buildAssetsEditorPrompt,
});
