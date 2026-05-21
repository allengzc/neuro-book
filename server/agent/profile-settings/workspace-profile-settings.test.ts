import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {
    readWorkspaceAgentProfileSettings,
    resolveWorkspaceDefaultLeaderProfileKey,
    updateWorkspaceAgentProfileSettings,
} from "nbook/server/agent/profile-settings/workspace-profile-settings";
import {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import type {AgentSystem} from "nbook/server/agent/agent-system";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";

class TestLeaderProfile extends AgentProfile<string> {
    readonly kind = "leader" as const;
    readonly inputSchema = z.object({prompt: z.string().optional()});
    readonly allowedToolKeys = [];

    constructor(
        readonly key: string,
        readonly name: string,
    ) {
        super();
    }

    async prepare(_runtime: ProfileContextRuntime<string>) {
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

class TestSubagentProfile extends AgentProfile<string> {
    readonly kind = "subagent" as const;
    readonly inputSchema = z.object({prompt: z.string().optional()});
    readonly allowedToolKeys = [];

    constructor(
        readonly key: string,
        readonly name: string,
    ) {
        super();
    }

    async prepare(_runtime: ProfileContextRuntime<string>) {
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

/**
 * 构造只含 profileRegistry 的 AgentSystem 测试替身。
 */
function createAgentSystemStub(): AgentSystem {
    const registry = new InMemoryAgentProfileRegistry();
    registry.register(new TestLeaderProfile("leader.default", "Default"));
    registry.register(new TestLeaderProfile("leader.assets", "Assets"));
    registry.register(new TestLeaderProfile("leader.custom", "Custom"));
    registry.register(new TestSubagentProfile("subagent.writer", "Writer"));
    return {
        profileRegistry: registry,
    } as unknown as AgentSystem;
}

describe("workspace profile settings", () => {
    it("没有 workspace 设置时按 workspaceKind 返回系统默认", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-profile-settings-"));
        try {
            const agentSystem = createAgentSystemStub();

            await expect(resolveWorkspaceDefaultLeaderProfileKey({
                agentSystem,
                workspaceRoot,
                workspaceKind: "novel",
            })).resolves.toBe("leader.default");
            await expect(resolveWorkspaceDefaultLeaderProfileKey({
                agentSystem,
                workspaceRoot,
                workspaceKind: "user-assets",
            })).resolves.toBe("leader.assets");
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("保存 workspace 默认 profile 后会读取并写入 .nbook 配置", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-profile-settings-"));
        try {
            const agentSystem = createAgentSystemStub();
            const updated = await updateWorkspaceAgentProfileSettings({
                agentSystem,
                workspaceRoot,
                workspaceKind: "novel",
                body: {
                    leader: {
                        defaultProfileKey: "leader.custom",
                    },
                },
            });

            expect(updated.effectiveLeaderProfileKey).toBe("leader.custom");
            await expect(fs.readFile(path.join(workspaceRoot, ".nbook", "agent-profile-settings.json"), "utf-8")).resolves.toContain("leader.custom");
            await expect(resolveWorkspaceDefaultLeaderProfileKey({
                agentSystem,
                workspaceRoot,
                workspaceKind: "novel",
            })).resolves.toBe("leader.custom");
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("拒绝把 subagent 设置成 workspace 默认 leader profile", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-profile-settings-"));
        try {
            await expect(updateWorkspaceAgentProfileSettings({
                agentSystem: createAgentSystemStub(),
                workspaceRoot,
                workspaceKind: "novel",
                body: {
                    leader: {
                        defaultProfileKey: "subagent.writer",
                    },
                },
            })).rejects.toMatchObject({
                statusCode: 400,
            });
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("读取 DTO 时只列出 leader profiles", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-profile-settings-"));
        try {
            const dto = await readWorkspaceAgentProfileSettings({
                agentSystem: createAgentSystemStub(),
                workspaceRoot,
                workspaceKind: "novel",
            });

            expect(dto.leaderProfiles.map((profile) => profile.profileKey)).toEqual([
                "leader.assets",
                "leader.custom",
                "leader.default",
            ]);
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });
});
