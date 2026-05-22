import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {Type} from "typebox";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";

describe("AgentProfileCatalog", () => {
    let root: string;
    let systemRoot: string;
    let userRoot: string;

    beforeEach(async () => {
        root = resolve(".agent", "agent-profile-catalog-test", randomUUID());
        systemRoot = join(root, "assets", ".nbook", "agent", "profiles");
        userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(systemRoot, {recursive: true});
        await mkdir(userRoot, {recursive: true});
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("坏 profile 进入 issue，不阻断其他 profile", async () => {
        await writeProfile(systemRoot, "good.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            export const profileManifest = { key: "custom.good", name: "Good" } as const;
            export type Input = { topic: string };
            export type Output = { result: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({ topic: Type.String() }),
                outputSchema: Type.Object({ result: Type.String() }),
                allowedToolKeys: [],
                prepare() { return { systemPrompt: "ok" }; },
            });
        `);
        await writeProfile(systemRoot, "bad.profile.tsx", "export default { manifest: { key: 'bad', name: 'Bad' } };");
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defaultAgentProfile);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.map((profile) => profile.key)).toContain("custom.good");
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "schema_missing",
            }),
        ]));
    });

    it("用户 profile 按 key 覆盖系统 profile", async () => {
        await writeProfile(systemRoot, "custom.same.profile.tsx", profileSource("custom.same", "System"));
        await writeProfile(userRoot, "custom.same.profile.tsx", profileSource("custom.same", "User"));
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const profile = await catalog.get("custom.same");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("User");
        expect(snapshot.profiles.find((item) => item.key === "custom.same")).toEqual(expect.objectContaining({
            name: "User",
            source: "user",
            loadStatus: "loaded",
        }));
    });

    it("builtin 覆盖只替换运行时实现，不替换锁定 schema", async () => {
        await writeProfile(userRoot, "leader.default.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            export const profileManifest = { key: "leader.default", name: "User Leader" } as const;
            export type Input = { changed: string };
            export type Output = { changed: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({ changed: Type.String() }),
                outputSchema: Type.Object({ changed: Type.String() }),
                allowedToolKeys: [],
                prepare() { return { systemPrompt: "user" }; },
            });
        `);
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("User Leader");
        expect(profile.inputSchema).toEqual(defaultAgentProfile.inputSchema);
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "builtin_schema_locked",
                profileKey: "leader.default",
            }),
        ]));
    });

    it("系统 leader.default schema 与 builtin contract 一致时不产生 schema lock issue", async () => {
        await writeProfile(systemRoot, "leader.default.profile.tsx", `
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {LeaderDefaultInputSchema, LeaderDefaultOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
            export const profileManifest = { key: "leader.default", name: "System Leader" } as const;
            export type Input = typeof LeaderDefaultInputSchema.static;
            export type Output = typeof LeaderDefaultOutputSchema.static;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: LeaderDefaultInputSchema,
                outputSchema: LeaderDefaultOutputSchema,
                allowedToolKeys: [],
                prepare() { return { systemPrompt: "system" }; },
            });
        `);
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("System Leader");
        expect(snapshot.issues.some((issue) => issue.code === "builtin_schema_locked")).toBe(false);
    });

    it("内存 builtin 可参与 snapshot schema", async () => {
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defineAgentProfile({
            manifest: {
                key: "memory.profile",
                name: "Memory",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }));

        await expect(catalog.snapshot()).resolves.toEqual(expect.objectContaining({
            profiles: [
                expect.objectContaining({
                    key: "memory.profile",
                    source: "memory",
                    builtin: true,
                }),
            ],
        }));
    });

    it("文件名与 manifest key 不一致只产生 warning issue，不阻断加载", async () => {
        await writeProfile(systemRoot, "wrong-name.profile.tsx", profileSource("custom.right-name", "Right"));
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const profile = await catalog.get("custom.right-name");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("Right");
        expect(snapshot.issues).toEqual([
            expect.objectContaining({
                code: "filename_mismatch",
                profileKey: "custom.right-name",
            }),
        ]);
    });
});

async function writeProfile(root: string, name: string, source: string): Promise<void> {
    await mkdir(root, {recursive: true});
    await writeFile(join(root, name), source, "utf8");
}

function profileSource(key: string, name: string): string {
    return `
        import {Type} from "typebox";
        import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
        export const profileManifest = { key: ${JSON.stringify(key)}, name: ${JSON.stringify(name)} } as const;
        export type Input = {};
        export type Output = {};
        export default defineAgentProfile({
            manifest: profileManifest,
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() { return { systemPrompt: ${JSON.stringify(name)} }; },
        });
    `;
}
