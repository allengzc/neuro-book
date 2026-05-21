import {HumanMessage} from "@langchain/core/messages";
import {describe, expect, it, vi} from "vitest";
import {z} from "zod";
import type {AgentSystem} from "nbook/server/agent/agent-system";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-preview.service";
import {Message} from "nbook/server/agent/prompts";
import {HistorySet, ProfilePrompt, SimpleProfile, type ProfilePromptContext} from "nbook/server/agent/profiles/simple-profile";

class PreviewProfile extends SimpleProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "Preview";
    readonly inputSchema = z.object({
        prompt: z.string(),
    });
    readonly allowedToolKeys = [];

    protected override buildPrompt(ctx: ProfilePromptContext<"leader.default", {prompt: string}>) {
        return ProfilePrompt({
            children: HistorySet({
                children: [
                    Message({
                        role: "system",
                        children: `workspace=${ctx.scope.studio.workspace ?? ""}`,
                    }),
                    Message({
                        role: "human",
                        source: "input",
                        children: ctx.input.prompt,
                    }),
                ],
            }),
        });
    }
}

describe("profile-preview.service", () => {
    it("调用真实 profile.prepare 返回模型消息", async () => {
        const profileRegistry = new InMemoryAgentProfileRegistry();
        profileRegistry.register(new PreviewProfile());
        const agentSystem = {
            profileRegistry,
            threadRepository: {
                findById: vi.fn(async () => null),
            },
            threadMessages: {
                loadThreadHistory: vi.fn(async () => []),
            },
            skillCatalog: {
                list: vi.fn(async () => []),
            },
        } as unknown as AgentSystem;

        const result = await previewAgentProfilePrepare(agentSystem, {
            profileKey: "leader.default",
            input: {
                prompt: "hello",
            },
        });

        expect(result.ok).toBe(true);
        expect(result.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
            "system:workspace=",
            "human:hello",
        ]);
    });

    it("input 不符合 schema 时返回 issue 而不是抛错", async () => {
        const profileRegistry = new InMemoryAgentProfileRegistry();
        profileRegistry.register(new PreviewProfile());
        const agentSystem = {
            profileRegistry,
            threadRepository: {
                findById: vi.fn(async () => null),
            },
            threadMessages: {
                loadThreadHistory: vi.fn(async () => [new HumanMessage("old")]),
            },
            skillCatalog: {
                list: vi.fn(async () => []),
            },
        } as unknown as AgentSystem;

        const result = await previewAgentProfilePrepare(agentSystem, {
            profileKey: "leader.default",
            input: {},
        });

        expect(result.ok).toBe(false);
        expect(result.issues[0]?.code).toBe("profile_input_invalid");
    });
});
