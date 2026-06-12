import {randomUUID} from "node:crypto";
import {copyFile, cp, mkdir, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
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
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

function defineAgentProfile(profile: any): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
    });
}

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
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            export const profileManifest = { key: "custom.good", name: "Good" } as const;
            export type Input = { topic: string };
            export type Output = { result: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({ topic: Type.String() }),
                outputSchema: Type.Object({ result: Type.String() }),
                tools: profileToolsFromKeys([]),
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
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {AppendingSet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";

            export const profileManifest = { key: "custom.jsx", name: "JSX" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: profileToolsFromKeys([]),
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

    it("profile 编译产物包含 session variable authoring types", async () => {
        await writeProfile(systemRoot, "custom.session-types.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {defineSessionVariable} from "nbook/server/agent/variables/registry";

            export const profileManifest = { key: "custom.sessionTypes", name: "Session Types" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: profileToolsFromKeys([]),
                variableDefinitions: [
                    defineSessionVariable({
                        key: "draftGoal",
                        schema: Type.String(),
                    }),
                ],
                prepare() {
                    return {};
                },
            });
        `);
        const result = await compileProfileArtifacts({
            profileRoot: systemRoot,
            fileName: "custom.session-types.profile.tsx",
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled[0];

        expect(item?.registeredVariablePaths).toEqual(["session.draftGoal"]);
        expect(item?.artifactFileName).toBe("custom.session-types.mjs");
        expect(item?.typeFileName).toBe("custom.session-types.types.d.ts");
        expect(await readFile(resolve(systemRoot, ".compiled", item!.typeFileName!), "utf8")).toContain("\"session.draftGoal\": string;");
    });

    it("full compile 使用稳定文件名并清理旧 hash artifact", async () => {
        await writeProfile(systemRoot, "builtin/custom.stable.profile.tsx", profileSource("custom.stable", "Stable"));
        await mkdir(join(systemRoot, ".compiled"), {recursive: true});
        await writeFile(join(systemRoot, ".compiled", "old-hash-artifact.mjs"), "export default null;", "utf8");
        await writeFile(join(systemRoot, ".compiled", "old-hash-artifact.types.d.ts"), "export {};", "utf8");

        const result = await compileProfileArtifacts({
            profileRoot: systemRoot,
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled.find((profile) => profile.profileKey === "custom.stable");

        expect(item?.artifactFileName).toBe("builtin__custom.stable.mjs");
        expect(item?.typeFileName).toBe("builtin__custom.stable.types.d.ts");
        await expect(readFile(join(systemRoot, ".compiled", "old-hash-artifact.mjs"), "utf8")).rejects.toThrow();
        await expect(readFile(join(systemRoot, ".compiled", "old-hash-artifact.types.d.ts"), "utf8")).rejects.toThrow();
    });

    it("TSX profile 依赖 helper 文件变化时重新编译缓存", async () => {
        await writeProfile(systemRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(systemRoot, "custom.helper.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.helper", name: "Helper" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: profileToolsFromKeys([]),
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

    it("用户 profile 依赖变化时继续使用上次编译产物并给出 warning", async () => {
        await writeProfile(userRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(userRoot, "custom.user-helper.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.user-helper", name: "User Helper" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: profileToolsFromKeys([]),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);
        await compileRoot(userRoot);
        await writeProfile(userRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const profile = await catalog.get("custom.user-helper");
        const snapshot = await catalog.snapshot();

        expect((await profile.prepare!(context())).systemPrompt).toBe("v1");
        expect(snapshot.profiles.find((item) => item.key === "custom.user-helper")).toEqual(expect.objectContaining({
            loadStatus: "loaded",
            source: "user",
            issue: expect.objectContaining({
                code: "dependency_stale",
            }),
        }));
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "dependency_stale",
                profileKey: "custom.user-helper",
            }),
        ]));
    });

    it("用户 profile 源码变化但未编译时继续使用上次编译产物并给出 warning", async () => {
        await writeProfile(userRoot, "custom.unsaved.profile.tsx", profileSource("custom.unsaved", "Compiled Version"));
        await compileRoot(userRoot);
        await writeProfile(userRoot, "custom.unsaved.profile.tsx", profileSource("custom.unsaved", "Edited Source"));
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const profile = await catalog.get("custom.unsaved");
        const snapshot = await catalog.snapshot();

        expect((await profile.prepare!(context())).systemPrompt).toBe("Compiled Version");
        expect(snapshot.profiles.find((item) => item.key === "custom.unsaved")).toEqual(expect.objectContaining({
            loadStatus: "loaded",
            source: "user",
            issue: expect.objectContaining({
                code: "source_stale",
            }),
        }));
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "source_stale",
                profileKey: "custom.unsaved",
            }),
        ]));
    });

    it("用户 profile 依赖变化且 artifact 损坏时不可运行", async () => {
        await writeProfile(userRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(userRoot, "custom.broken-artifact.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.broken-artifact", name: "Broken Artifact" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: profileToolsFromKeys([]),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);
        await compileRoot(userRoot);
        const manifest = await readProfileArtifactManifest(userRoot);
        const manifestItem = manifest.profiles.find((item) => item.profileKey === "custom.broken-artifact")!;
        await writeProfile(userRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        await writeFile(join(userRoot, ".compiled", manifestItem.artifactFileName), "export default null;", "utf8");
        const catalog = new AgentProfileCatalog(systemRoot, userRoot);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "custom.broken-artifact")).toEqual(expect.objectContaining({
            loadStatus: "compile_stale",
            issue: expect.objectContaining({
                code: "compile_stale",
            }),
        }));
        await expect(catalog.get("custom.broken-artifact")).rejects.toThrow("不可运行");
    });

    it("builtin 覆盖只替换运行时实现，不替换锁定 schema", async () => {
        await writeProfile(userRoot, "leader.default.profile.tsx", `
            import {Type} from "typebox";
            import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            export const profileManifest = { key: "leader.default", name: "User Leader" } as const;
            export type Input = { changed: string };
            export type Output = { changed: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: Type.Object({ changed: Type.String() }),
                outputSchema: Type.Object({ changed: Type.String() }),
                tools: profileToolsFromKeys([]),
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
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
            import {LeaderDefaultInputSchema, LeaderDefaultOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
            export const profileManifest = { key: "leader.default", name: "System Leader" } as const;
            export type Input = typeof LeaderDefaultInputSchema.static;
            export type Output = typeof LeaderDefaultOutputSchema.static;
            export default defineAgentProfile({
                manifest: profileManifest,
                inputSchema: LeaderDefaultInputSchema,
                outputSchema: LeaderDefaultOutputSchema,
                tools: profileToolsFromKeys([]),
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

    it("单文件编译失败时不会把 building artifact 留在真实 compiled root", async () => {
        await writeProfile(systemRoot, "custom.safe.profile.tsx", profileSource("custom.safe", "Safe"));
        await compileRoot(systemRoot);
        const manifestPath = join(systemRoot, ".compiled", "manifest.json");
        const previousManifest = await readFile(manifestPath, "utf8");

        await writeProfile(systemRoot, "custom.bad.profile.tsx", "export default null;");
        await expect(compileRoot(systemRoot, "custom.bad.profile.tsx")).rejects.toThrow("compiled profile");

        const compiledEntries = await readdir(join(systemRoot, ".compiled"));
        expect(compiledEntries.some((entry) => entry.includes(".building."))).toBe(false);
        await expect(readFile(manifestPath, "utf8")).resolves.toBe(previousManifest);
    });

    it("skipFresh 会在 type artifact 缺失时重新编译 profile", async () => {
        await writeProfile(systemRoot, "custom.typed.profile.tsx", profileSource("custom.typed", "Typed"));
        const first = await compileProfileArtifacts({profileRoot: systemRoot});
        const firstItem = first.manifest.profiles.find((item) => item.profileKey === "custom.typed")!;
        await rm(join(systemRoot, ".compiled", firstItem.typeFileName!), {force: true});

        const next = await compileProfileArtifacts({profileRoot: systemRoot, skipFresh: true});
        const nextItem = next.manifest.profiles.find((item) => item.profileKey === "custom.typed")!;

        expect(next.compiled.map((item) => item.profileKey)).toContain("custom.typed");
        await expect(readFile(join(systemRoot, ".compiled", nextItem.typeFileName!), "utf8")).resolves.toContain("ProfileVariableValueMap");
        await expect(validateProfileArtifact(systemRoot, nextItem)).resolves.toEqual({fresh: true});
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
        expect(systemItem.typeFileName).toMatch(/types\.d\.ts$/);
        const userItem = rehomeProfileArtifactItem(systemItem, {
            fromRootLabel: relative(process.cwd(), systemRoot).split(/[\\/]+/).join("/"),
            toRootLabel: relative(process.cwd(), userRoot).split(/[\\/]+/).join("/"),
        });

        expect(userItem.dependencies.some((dependency) => dependency.path.endsWith("workspace/.nbook/agent/profiles/builtin/custom.synced.profile.tsx"))).toBe(true);
        await expect(validateProfileArtifact(userRoot, userItem)).resolves.toEqual({fresh: true});
    });

    it("Product profile artifact 不写入构建机绝对 require 路径", async () => {
        const productRoot = join(root, "product");
        systemRoot = join(productRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        userRoot = join(productRoot, "workspace", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server"), {recursive: true});
        await writeFile(join(productRoot, "release-meta.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeProfile(systemRoot, "custom.product.profile.mjs", `
            export default {
                manifest: { key: "custom.product", name: "Product" },
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                toolKeys: [],
                prepare() { return { systemPrompt: "ok" }; },
            };
        `);

        const previousCwd = process.cwd();
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: systemRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
        } finally {
            process.chdir(previousCwd);
        }

        const artifact = await readFile(join(systemRoot, ".compiled", "custom.product.mjs"), "utf8");
        expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
        expect(artifact.slice(0, 2048)).not.toMatch(/file:\/\/\/[A-Za-z]:/u);
        expect(artifact).not.toContain("D:/a/neuro-book/");
    });

    it("通用 .output Product runner 无根 release-meta 时仍从 output vendor 解析 require", async () => {
        const productRoot = join(root, "product-output-runner");
        systemRoot = join(productRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        userRoot = join(productRoot, "workspace", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server", "node_modules", "@nbook", "output-marker"), {recursive: true});
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeFile(join(productRoot, ".output", "server", "release-meta.json"), "{\"versionKind\":\"release\"}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "node_modules", "@nbook", "output-marker", "index.js"), `module.exports = {marker: "output-vendor"};\n`, "utf8");
        await writeProfile(systemRoot, "custom.output.profile.mjs", `
            export default {
                manifest: { key: "custom.output", name: "Output" },
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                toolKeys: [],
                prepare() {
                    const marker = require("@nbook/" + "output-marker");
                    return { systemPrompt: marker.marker };
                },
            };
        `);

        const previousCwd = process.cwd();
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: systemRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
            const artifact = await readFile(join(systemRoot, ".compiled", "custom.output.mjs"), "utf8");
            const catalog = new AgentProfileCatalog(systemRoot, userRoot);
            const profile = await catalog.get("custom.output");

            expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
            expect(await profile.prepare!(context())).toEqual(expect.objectContaining({
                systemPrompt: "output-vendor",
            }));
        } finally {
            process.chdir(previousCwd);
        }
    });

    it("通用 .output Product runner 会重编源码模式遗留 artifact", async () => {
        const productRoot = join(root, "product-output-stale-artifact");
        const sourceRoot = join(root, "source-artifact-root");
        systemRoot = join(productRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server"), {recursive: true});
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeFile(join(productRoot, ".output", "server", "release-meta.json"), "{\"versionKind\":\"release\"}\n", "utf8");
        await writeProfile(systemRoot, "custom.output.profile.mjs", `
            export default {
                manifest: { key: "custom.output", name: "Output" },
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                toolKeys: [],
                prepare() { return { systemPrompt: "ok" }; },
            };
        `);
        await mkdir(join(sourceRoot, "assets", "workspace", ".nbook", "agent"), {recursive: true});
        await writeFile(join(sourceRoot, "tsconfig.json"), "{}\n", "utf8");
        await cp(systemRoot, join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles"), {recursive: true});

        const previousCwd = process.cwd();
        process.chdir(sourceRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles"),
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
        } finally {
            process.chdir(previousCwd);
        }
        await cp(
            join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles", ".compiled"),
            join(systemRoot, ".compiled"),
            {recursive: true},
        );
        process.chdir(productRoot);
        try {
            const staleManifest = await readProfileArtifactManifest(systemRoot);
            await expect(validateProfileArtifact(systemRoot, staleManifest.profiles[0]!)).resolves.toEqual({
                fresh: false,
                reason: "artifact_changed",
            });
            await compileProfileArtifacts({
                profileRoot: systemRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
                skipFresh: true,
            });
            const artifact = await readFile(join(systemRoot, ".compiled", "custom.output.mjs"), "utf8");
            expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
        } finally {
            process.chdir(previousCwd);
        }
    });

    it("Product 用户层 artifact 经过 portable workspace junction 后仍从 app vendor 解析 require", async () => {
        const portableRoot = join(root, "portable");
        const productRoot = join(portableRoot, "app");
        const dataWorkspaceRoot = join(portableRoot, "data", "workspace");
        systemRoot = join(productRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        userRoot = join(productRoot, "workspace", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server", "node_modules", "@nbook", "portable-marker"), {recursive: true});
        await mkdir(dataWorkspaceRoot, {recursive: true});
        await symlink(dataWorkspaceRoot, join(productRoot, "workspace"), process.platform === "win32" ? "junction" : "dir");
        await writeFile(join(productRoot, "release-meta.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeFile(join(productRoot, ".output", "server", "node_modules", "@nbook", "portable-marker", "index.js"), `module.exports = {marker: "portable-vendor"};\n`, "utf8");
        await writeProfile(userRoot, "custom.portable.profile.mjs", `
            export default {
                manifest: { key: "custom.portable", name: "Portable" },
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                toolKeys: [],
                prepare() {
                    const marker = require("@nbook/" + "portable-marker");
                    return { systemPrompt: marker.marker };
                },
            };
        `);

        const previousCwd = process.cwd();
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: userRoot,
                rootLabel: "workspace/.nbook/agent/profiles",
            });
            const catalog = new AgentProfileCatalog(systemRoot, userRoot);
            const profile = await catalog.get("custom.portable");
            expect(await profile.prepare!(context())).toEqual(expect.objectContaining({
                systemPrompt: "portable-vendor",
            }));
        } finally {
            process.chdir(previousCwd);
        }
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
            import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
        export const profileManifest = { key: ${JSON.stringify(key)}, name: ${JSON.stringify(name)} } as const;
        export type Input = {};
        export type Output = {};
        export default defineAgentProfile({
            manifest: profileManifest,
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() { return { systemPrompt: ${JSON.stringify(name)} }; },
        });
    `;
}

function context() {
    const session = {
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
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: "custom.jsx",
                        input: {},
                        workspaceRoot: "workspace",
                        workspaceKey: "test",
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return {
        session,
        input: {},
        vars: createTestVariableAccessor(),
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
