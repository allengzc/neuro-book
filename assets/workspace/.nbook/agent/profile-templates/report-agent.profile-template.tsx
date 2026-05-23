/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "__PROFILE_KEY__",
    name: "__PROFILE_NAME__",
    description: "__PROFILE_DESCRIPTION__",
} as const;

export const InputSchema = Type.Object({});
export const OutputSchema = Type.Object({});
export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export const allowedToolKeys = [
    "read",
    "report_result",
] as const;

function renderSystemPrompt(): string {
    return `__SYSTEM_PROMPT__`.trim();
}

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    context() {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
            </ProfilePrompt>
        );
    },
});
