import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {LeaderDefaultProfile} from "nbook/server/agent/profiles/builtin/leader-default.profile";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {ProfileKey} from "nbook/server/agent/types";

class TestLeaderProfile extends AgentProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "Leader";
    readonly inputSchema = z.object({
        prompt: z.string(),
    });
    readonly allowedToolKeys = [];

    async prepare(_runtime: ProfileContextRuntime<"leader.default">) {
        return {
            modelMessages: [],
            persistedMessages: {
                prepend: [],
                append: [],
            },
            immediateMetadata: {},
            completedMetadata: {},
        };
    }
}

describe("InMemoryAgentProfileRegistry", () => {
    it("会从用户 assets 加载新增动态 profile", async () => {
        const workspaceRoot = await createTempWorkspace();
        await writeDynamicProfile(workspaceRoot, "workspace/.nbook/assets/agent/profiles/custom.profile.tsx", {
            key: "subagent.custom",
            kind: "subagent",
            name: "Custom Subagent",
            prompt: "user dynamic",
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);

        const profile = await registry.get("subagent.custom");

        expect(profile.key).toBe("subagent.custom");
        expect(profile.kind).toBe("subagent");
        expect(profile.name).toBe("Custom Subagent");
    });

    it("用户 assets 同路径 profile 会覆盖系统 assets profile", async () => {
        const workspaceRoot = await createTempWorkspace();
        await writeDynamicProfile(workspaceRoot, "assets/agent/profiles/custom.profile.tsx", {
            key: "subagent.custom",
            kind: "subagent",
            name: "System Profile",
            prompt: "system",
        });
        await writeDynamicProfile(workspaceRoot, "workspace/.nbook/assets/agent/profiles/custom.profile.tsx", {
            key: "subagent.custom",
            kind: "subagent",
            name: "User Profile",
            prompt: "user",
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);

        const profile = await registry.get("subagent.custom");

        expect(profile.name).toBe("User Profile");
    });

    it("覆盖 builtin key 时不允许修改 InputSchema", async () => {
        const workspaceRoot = await createTempWorkspace();
        await writeDynamicProfile(workspaceRoot, "workspace/.nbook/assets/agent/profiles/leader-default.profile.tsx", {
            key: "leader.default",
            kind: "leader",
            name: "User Leader",
            prompt: "bad schema",
            inputSchemaSource: "z.object({task: z.string()})",
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);
        registry.register(new TestLeaderProfile());

        await expect(registry.get("leader.default")).rejects.toThrow("不允许修改 InputSchema");
    });

    it("动态 profile 加载失败会进入 inspectDynamicProfiles", async () => {
        const workspaceRoot = await createTempWorkspace();
        await writeDynamicProfile(workspaceRoot, "workspace/.nbook/assets/agent/profiles/leader-default.profile.tsx", {
            key: "leader.default",
            kind: "leader",
            name: "User Leader",
            prompt: "bad schema",
            inputSchemaSource: "z.object({task: z.string()})",
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);
        registry.register(new TestLeaderProfile());

        const inspected = await registry.inspectDynamicProfiles();

        expect(inspected.errors).toHaveLength(1);
        expect(inspected.errors[0]?.profileKey).toBe("leader.default");
        expect(inspected.errors[0]?.relativePath).toBe("leader-default.profile.tsx");
        expect(inspected.errors[0]?.message).toContain("不允许修改 InputSchema");
    });

    it("覆盖 builtin key 时允许复用等价 InputSchema 并保留 builtin schema 对象", async () => {
        const workspaceRoot = await createTempWorkspace();
        const builtinProfile = new TestLeaderProfile();
        await writeDynamicProfile(workspaceRoot, "workspace/.nbook/assets/agent/profiles/leader-default.profile.tsx", {
            key: "leader.default",
            kind: "leader",
            name: "User Leader",
            prompt: "same schema",
            inputSchemaSource: "z.object({prompt: z.string()})",
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);
        registry.register(builtinProfile);

        const profile = await registry.get("leader.default");

        expect(profile.name).toBe("User Leader");
        expect(profile.inputSchema).toBe(builtinProfile.inputSchema);
    });

    it("动态 profile 的相对依赖变化后会重新加载", async () => {
        const workspaceRoot = await createTempWorkspace();
        const profilePath = "workspace/.nbook/assets/agent/profiles/custom.profile.tsx";
        await writeDynamicProfileDependency(workspaceRoot, "workspace/.nbook/assets/agent/profiles/prompt-text.ts", "first prompt");
        await writeDynamicProfile(workspaceRoot, profilePath, {
            key: "subagent.custom",
            kind: "subagent",
            name: "Custom Subagent",
            prompt: "unused",
            promptExpression: "PROMPT_TEXT",
            imports: ["import {PROMPT_TEXT} from './prompt-text';"],
        });
        const registry = new InMemoryAgentProfileRegistry(workspaceRoot);

        await expect(readPreparedSystemMessage(await registry.get("subagent.custom"))).resolves.toContain("first prompt");

        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeDynamicProfileDependency(workspaceRoot, "workspace/.nbook/assets/agent/profiles/prompt-text.ts", "second prompt");
        await registry.refreshDynamicProfiles();

        await expect(readPreparedSystemMessage(await registry.get("subagent.custom"))).resolves.toContain("second prompt");
    });

    it("系统 assets 的默认 leader profile 会覆盖静态 builtin contract", async () => {
        const builtinProfile = new LeaderDefaultProfile();
        const registry = new InMemoryAgentProfileRegistry(process.cwd());
        registry.register(builtinProfile);

        const profile = await registry.get("leader.default");

        expect(profile.key).toBe("leader.default");
        expect(profile.inputSchema).toBe(builtinProfile.inputSchema);
    });
});

/**
 * 创建临时 workspace。
 */
async function createTempWorkspace(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "nbook-profile-registry-"));
}

/**
 * 写入测试动态 profile。
 */
async function writeDynamicProfile(workspaceRoot: string, relativePath: string, input: {
    key: string;
    kind: "leader" | "subagent";
    name: string;
    prompt: string;
    inputSchemaSource?: string;
    promptExpression?: string;
    imports?: string[];
}): Promise<void> {
    const absolutePath = path.join(workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, [
        "/** @jsxRuntime automatic */",
        "/** @jsxImportSource nbook/server/agent/prompts */",
        "import {z} from 'zod';",
        "import {Message} from 'nbook/server/agent/prompts';",
        "import {defineAgentProfile} from 'nbook/server/agent/profiles/define-agent-profile';",
        "import {ProfilePrompt, HistorySet} from 'nbook/server/agent/profiles/simple-profile';",
        ...(input.imports ?? []),
        `export const profileManifest = ${JSON.stringify({
            key: input.key,
            kind: input.kind,
            name: input.name,
        })} as const;`,
        `export const InputSchema = ${input.inputSchemaSource ?? "z.object({prompt: z.string()})"};`,
        "export type Input = z.infer<typeof InputSchema>;",
        "export default defineAgentProfile({",
        "    manifest: profileManifest,",
        "    inputSchema: InputSchema,",
        "    allowedToolKeys: [],",
        "    buildPrompt() {",
        `        return <ProfilePrompt><HistorySet><Message role="system">{${input.promptExpression ?? JSON.stringify(input.prompt)}}</Message></HistorySet></ProfilePrompt>;`,
        "    },",
        "});",
        "",
    ].join("\n"), "utf-8");
}

/**
 * 写入动态 profile 的相对依赖。
 */
async function writeDynamicProfileDependency(workspaceRoot: string, relativePath: string, prompt: string): Promise<void> {
    const absolutePath = path.join(workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, `export const PROMPT_TEXT = ${JSON.stringify(prompt)};\n`, "utf-8");
}

/**
 * 读取测试 profile 渲染出的 system message。
 */
async function readPreparedSystemMessage(profile: AgentProfile<ProfileKey>): Promise<string> {
    const prepared = await profile.prepare({
        thread: {
            id: 1,
            kind: profile.kind,
            profileKey: profile.key,
            title: "",
            runStatus: "idle",
            metadata: {},
            activeCursorMessageId: null,
            lastMessageAt: new Date(),
            lastMessagePreview: "",
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        profile,
        input: {prompt: "test"},
        scope: {
            ide: {},
            studio: {},
            agent: {
                thread: {
                    id: "thread-1",
                    title: "",
                    summary: "",
                    status: "idle",
                },
                profileKey: profile.key,
                kind: profile.kind,
                tools: [],
                subagents: [],
                tasks: null,
            },
            input: {prompt: "test"},
        },
        skillCatalog: [],
        options: {},
        loadHistoryMessages: async () => [],
        loadPersistedPreludeMessages: async () => ({messages: [], existingLatestHash: null}),
        loadActivatedSkillsText: async () => "",
        messageStore: {} as never,
        threadRepository: {} as never,
        variableStore: {} as never,
    } as unknown as ProfileContextRuntime<ProfileKey>);
    return prepared.persistedMessages.prepend[0]?.message.text ?? "";
}
