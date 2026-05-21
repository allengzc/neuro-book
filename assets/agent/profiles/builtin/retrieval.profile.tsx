import {buildRetrievalPrompt} from "nbook/server/agent/profiles/builtin/retrieval.profile";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RetrievalInputSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin/retrieval.contract";

export const profileManifest = {
    key: "subagent.retrieval",
    kind: "subagent",
    name: "Retrieval",
} as const;

export const InputSchema = RetrievalInputSchema;
export const OutputSchema = RetrievalOutputSchema;
export type Input = typeof InputSchema._output;
export type Output = typeof OutputSchema._output;

export default defineAgentProfile<typeof profileManifest.key, Input, Output>({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys: [
        "execute_shell",
        "read_file",
        "skill",
        "report_result",
    ],
    buildPrompt: buildRetrievalPrompt,
});
