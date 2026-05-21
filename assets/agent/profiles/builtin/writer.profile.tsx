import {buildWriterPrompt} from "nbook/server/agent/profiles/builtin/writer.profile";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {WriterInputSchema} from "nbook/server/agent/types";

export const profileManifest = {
    key: "subagent.writer",
    kind: "subagent",
    name: "Writer",
} as const;

export const InputSchema = WriterInputSchema;
export type Input = typeof InputSchema._output;

export default defineAgentProfile<typeof profileManifest.key, Input>({
    manifest: profileManifest,
    inputSchema: InputSchema,
    allowedToolKeys: [
        "read_file",
        "edit_file",
        "apply_patch",
        "write_file",
        "report_result",
    ],
    buildPrompt: buildWriterPrompt,
});
