/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "__PROFILE_KEY__",
    name: "__PROFILE_NAME__",
    description: "__PROFILE_DESCRIPTION__",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({});
export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export const profileTools = toolset(
    builtin.file.read,
    builtin.result.main({dataSchema: OutputSchema}),
);

function renderSystemPrompt(): string {
    return `__SYSTEM_PROMPT__`.trim();
}

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: profileTools,
    context() {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
            </ProfilePrompt>
        );
    },
});
