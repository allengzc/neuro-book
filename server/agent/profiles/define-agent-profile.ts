import {z, type ZodType} from "zod";
import {
    ProfilePrompt,
    SimpleProfile,
    type ProfilePromptContext,
    type SimpleProfileTemplate,
} from "nbook/server/agent/profiles/simple-profile";
import type {AgentThreadKind, ProfileInput, ProfileKey, ProfileOutput, ToolKey} from "nbook/server/agent/types";

/**
 * 动态 profile manifest。
 */
export type AgentProfileManifest<TKey extends string = string> = {
    key: TKey;
    kind: AgentThreadKind;
    name: string;
    description?: string;
};

/**
 * defineAgentProfile 输入。
 */
export type DefineAgentProfileInput<TKey extends ProfileKey> = {
    manifest: AgentProfileManifest<TKey>;
    inputSchema: ZodType<ProfileInput<TKey>>;
    outputSchema?: ZodType<ProfileOutput<TKey>>;
    allowedToolKeys: readonly ToolKey[];
    buildPrompt(ctx: ProfilePromptContext<TKey>): SimpleProfileTemplate | Promise<SimpleProfileTemplate>;
};

const ManifestSchema = z.object({
    key: z.string().trim().min(1),
    kind: z.enum(["leader", "subagent"]),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
});

/**
 * 定义一个可动态加载的 SimpleProfile。
 */
export function defineAgentProfile<TKey extends ProfileKey>(input: DefineAgentProfileInput<TKey>): SimpleProfile<TKey> {
    assertManifest(input.manifest);

    return new class extends SimpleProfile<TKey> {
        readonly key = input.manifest.key;
        readonly kind = input.manifest.kind;
        readonly name = input.manifest.name;
        readonly inputSchema = input.inputSchema;
        override readonly outputSchema = input.outputSchema;
        readonly allowedToolKeys = input.allowedToolKeys;

        protected override buildPrompt(ctx: ProfilePromptContext<TKey>) {
            return input.buildPrompt(ctx);
        }
    }();
}

/**
 * 确认 profile manifest 满足动态加载约束。
 */
export function assertManifest(manifest: AgentProfileManifest): void {
    const parsed = ManifestSchema.parse(manifest);
    if (!parsed.key.startsWith(`${parsed.kind}.`)) {
        throw new Error(`profileKey ${parsed.key} 必须以 ${parsed.kind}. 开头`);
    }
}

export {
    ProfilePrompt,
};
