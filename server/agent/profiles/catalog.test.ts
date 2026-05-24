import {randomUUID} from "node:crypto";
import {copyFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {Type} from "typebox";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {
    compileProfileArtifacts,
    readProfileArtifactManifest,
    rehomeProfileArtifactItem,
    validateProfileArtifact,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";

describe("AgentProfileCatalog", () => {
    let root: string;
    let systemRoot: string;
    let userRoot: string;

    beforeEach(async () => {
        root = resolve(".agent", "workspace", "agent-profile-catalog-test", randomUUID());
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
        await compileRoot(systemRoot, "good.profile.tsx");
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defaultAgentProfile);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.map((profile) => profile.key)).toContain("custom.good");
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "not_compiled",
            }),
        ]));
    });

    it("用户 profile 按 key 覆盖系统 profile", async () => {
        await writeProfile(systemRoot, "custom.same.profile.tsx", profileSource("custom.same", "System"));
        await writeProfile(userRoot, "custom.same.profile.tsx", profileSource("custom.same", "User"));
        await compileRoot(systemRoot);
        await compileRoot(userRoot);
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

    it("加载 TSX DSL profile 时使用自动 JSX runtime", async () => {
        await writeProfile(systemRoot, "custom.jsx.profile.tsx", `
            /** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
            /** @jsxRuntime automatic */
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {AppendingSet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";

            export const profileManifest = { key: "custom.jsx", name: "JSX" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                allowedToolKeys: [],
                context() {
                    return (
                        <ProfilePrompt>
                            <System>system</System>
                            <AppendingSet>
                                <Message>append</Message>
                            </AppendingSet>
                        </ProfilePrompt>
                    );
                },
            });
        `);
        await compileRoot(systemRoot);
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const profile = await catalog.get("custom.jsx");
        const prepared = await profile.prepare!(context());

        expect(prepared.systemPrompt).toBe("system");
        expect((prepared.appendingMessages ?? []).map(messageText)).toEqual(["append"]);
    });

    it("TSX profile 依赖 helper 文件变化时重新编译缓存", async () => {
        await writeProfile(systemRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(systemRoot, "custom.helper.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.helper", name: "Helper" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                allowedToolKeys: [],
                prepare() { return { systemPrompt: helperText }; },
            });
        `);

        await compileRoot(systemRoot);
        const firstCatalog = new AgentProfileCatalog(systemRoot, userRoot);
        const firstProfile = await firstCatalog.get("custom.helper");
        expect((await firstProfile.prepare!(context())).systemPrompt).toBe("v1");

        await writeProfile(systemRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        const staleSnapshot = await firstCatalog.snapshot();
        expect(staleSnapshot.profiles.find((item) => item.key === "custom.helper")?.loadStatus).toBe("compile_stale");

        await compileRoot(systemRoot);
        firstCatalog.invalidate();
        const secondProfile = await firstCatalog.get("custom.helper");

        expect((await secondProfile.prepare!(context())).systemPrompt).toBe("v2");
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
        await compileRoot(userRoot);
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
        await compileRoot(systemRoot);
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
        await compileRoot(systemRoot);
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

    it("未编译 profile 不可运行，并在 snapshot 中标记 not_compiled", async () => {
        await writeProfile(systemRoot, "custom.needs-compile.profile.tsx", profileSource("custom.needs-compile", "Needs Compile"));
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "custom.needs-compile")?.loadStatus).toBe("not_compiled");
        await expect(catalog.get("custom.needs-compile")).rejects.toThrow("不可运行");
    });

    it("未编译的系统文件会遮蔽同 key 内存 fallback", async () => {
        await writeProfile(systemRoot, "leader.default.profile.tsx", profileSource("leader.default", "Stale Leader"));
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);
        catalog.register(defaultAgentProfile);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "leader.default")?.loadStatus).toBe("not_compiled");
        await expect(catalog.get("leader.default")).rejects.toThrow("不可运行");
    });

    it("全量编译失败时保留上一版 compiled manifest 和 artifact", async () => {
        await writeProfile(systemRoot, "custom.safe.profile.tsx", profileSource("custom.safe", "Safe"));
        await compileRoot(systemRoot);
        const manifestPath = join(systemRoot, ".compiled", "manifest.json");
        const previousManifest = await readFile(manifestPath, "utf8");
        const previousCatalog = new AgentProfileCatalog(systemRoot, userRoot);
        await expect(previousCatalog.get("custom.safe")).resolves.toEqual(expect.objectContaining({
            manifest: expect.objectContaining({key: "custom.safe"}),
        }));

        await writeProfile(systemRoot, "custom.bad.profile.tsx", "export default null;");
        await expect(compileRoot(systemRoot)).rejects.toThrow("compiled profile");

        await expect(readFile(manifestPath, "utf8")).resolves.toBe(previousManifest);
        const nextCatalog = new AgentProfileCatalog(systemRoot, userRoot);
        await expect(nextCatalog.get("custom.safe")).resolves.toEqual(expect.objectContaining({
            manifest: expect.objectContaining({key: "custom.safe"}),
        }));
    });

    it("系统 artifact 同步到用户 root 后入口源码依赖可重定位", async () => {
        await writeProfile(systemRoot, "builtin/custom.synced.profile.tsx", profileSource("custom.synced", "Synced"));
        await writeProfile(userRoot, "builtin/custom.synced.profile.tsx", profileSource("custom.synced", "Synced"));
        await compileRoot(systemRoot);
        const systemManifest = await readProfileArtifactManifest(systemRoot);
        const systemItem = systemManifest.profiles.find((item) => item.profileKey === "custom.synced")!;
        await mkdir(join(userRoot, ".compiled"), {recursive: true});
        await copyFile(
            join(systemRoot, ".compiled", systemItem.artifactFileName),
            join(userRoot, ".compiled", systemItem.artifactFileName),
        );
        const userItem = rehomeProfileArtifactItem(systemItem, {
            fromRootLabel: relative(process.cwd(), systemRoot).split(/[\\/]+/).join("/"),
            toRootLabel: relative(process.cwd(), userRoot).split(/[\\/]+/).join("/"),
        });

        expect(userItem.dependencies.some((dependency) => dependency.path.endsWith("workspace/.nbook/agent/profiles/builtin/custom.synced.profile.tsx"))).toBe(true);
        await expect(validateProfileArtifact(userRoot, userItem)).resolves.toEqual({fresh: true});
    });
});

async function writeProfile(root: string, name: string, source: string): Promise<void> {
    await mkdir(dirname(join(root, name)), {recursive: true});
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

function context() {
    return {
        session: {
            systemPrompt: "",
            messages: [],
            model: null,
            thinkingLevel: "off" as const,
            profileKey: "custom.jsx",
            workspaceRoot: "workspace",
            customState: {},
            linkedAgents: [],
            archived: false,
            planModeActive: false,
        },
        input: {},
        catalog: {
            profiles: [],
            issues: [],
        },
        skills: [],
        runtime: {
            now: "2026-05-23T00:00:00.000Z",
            promptUserTurnCount: 0,
        },
    };
}

async function compileRoot(profileRoot: string, fileName?: string): Promise<void> {
    await compileProfileArtifacts({
        profileRoot,
        fileName,
    });
}
