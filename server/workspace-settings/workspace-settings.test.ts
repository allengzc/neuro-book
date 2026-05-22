import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {Type} from "typebox";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {readWorkspaceSettings, updateWorkspaceSettings} from "nbook/server/workspace-settings/workspace-settings";
import {validateWorkspaceSettingsQuery} from "nbook/server/workspace-settings/workspace-settings-query";

const createdRoots: string[] = [];

describe("workspace settings", () => {
    afterEach(async () => {
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("普通小说 workspace 无 settings 文件时返回 leader.default", async () => {
        const root = await createWorkspace();
        const settings = await readWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            profiles: createCatalog(["leader.default"]),
        });

        expect(settings.agent.systemDefaultProfileKey).toBe("leader.default");
        expect(settings.agent.workspaceDefaultProfileKey).toBeNull();
        expect(settings.agent.effectiveProfileKey).toBe("leader.default");
    });

    it("用户资产 workspace 无 settings 文件时返回 leader.assets", async () => {
        const root = await createWorkspace();
        const settings = await readWorkspaceSettings({
            prisma: prismaFor(root),
            query: {workspaceKind: "user-assets"},
            profiles: createCatalog(["leader.assets"]),
        });

        expect(settings.workspaceKind).toBe("user-assets");
        expect(settings.agent.effectiveProfileKey).toBe("leader.assets");
    });

    it("保存有效 profile 后返回 workspace override", async () => {
        const root = await createWorkspace();
        const profiles = createCatalog(["leader.default", "custom.agent"]);
        const settings = await updateWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            body: {agent: {defaultProfileKey: "custom.agent"}},
            profiles,
        });

        expect(settings.agent.workspaceDefaultProfileKey).toBe("custom.agent");
        expect(settings.agent.effectiveProfileKey).toBe("custom.agent");
        await expect(fs.readFile(path.join(root, ".nbook", "settings.json"), "utf-8")).resolves.toContain("custom.agent");
    });

    it("保存 null 后清空 workspace override", async () => {
        const root = await createWorkspace();
        const profiles = createCatalog(["leader.default", "custom.agent"]);
        await updateWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            body: {agent: {defaultProfileKey: "custom.agent"}},
            profiles,
        });

        const settings = await updateWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            body: {agent: {defaultProfileKey: null}},
            profiles,
        });

        expect(settings.agent.workspaceDefaultProfileKey).toBeNull();
        expect(settings.agent.effectiveProfileKey).toBe("leader.default");
    });

    it("拒绝不存在的 profile key", async () => {
        const root = await createWorkspace();
        await expect(updateWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            body: {agent: {defaultProfileKey: "missing.agent"}},
            profiles: createCatalog(["leader.default"]),
        })).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("保存 agent 设置时保留 settings 文件中的其他字段", async () => {
        const root = await createWorkspace();
        await fs.mkdir(path.join(root, ".nbook"), {recursive: true});
        await fs.writeFile(path.join(root, ".nbook", "settings.json"), JSON.stringify({
            display: {density: "compact"},
            agent: {defaultProfileKey: "leader.default"},
        }, null, 4), "utf-8");

        await updateWorkspaceSettings({
            prisma: prismaFor(root),
            query: {novelId: "6"},
            body: {agent: {defaultProfileKey: "custom.agent"}},
            profiles: createCatalog(["leader.default", "custom.agent"]),
        });

        const parsed = JSON.parse(await fs.readFile(path.join(root, ".nbook", "settings.json"), "utf-8")) as {
            display?: {density?: string};
            agent?: {defaultProfileKey?: string};
        };
        expect(parsed.display?.density).toBe("compact");
        expect(parsed.agent?.defaultProfileKey).toBe("custom.agent");
    });

    it("缺少 novelId 且不是用户资产 workspace 时返回 400", () => {
        expect(() => validateWorkspaceSettingsQuery({})).toThrow(expect.objectContaining({
            statusCode: 400,
            message: "小说工作区必须提供 novelId",
        }));
    });
});

async function createWorkspace(): Promise<string> {
    const root = path.join(".agent", "workspace-settings-test", randomUUID());
    createdRoots.push(root);
    await fs.mkdir(root, {recursive: true});
    return root;
}

function prismaFor(root: string) {
    return {
        novel: {
            findUnique: async () => ({workspaceSlug: path.relative("workspace", root).replace(/\\/g, "/")}),
        },
    } as never;
}

function createCatalog(profileKeys: string[]): AgentProfileCatalog {
    const catalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
    for (const profileKey of profileKeys) {
        catalog.register(defineAgentProfile({
            manifest: {
                key: profileKey,
                name: profileKey,
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Unknown(),
            allowedToolKeys: [],
            prepare: () => ({}),
        }), true);
    }
    return catalog;
}
