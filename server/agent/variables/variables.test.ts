import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntryDraft} from "nbook/server/agent/session/types";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {compileVariableDefinitions, loadCompiledVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import {generateVariableTypes} from "nbook/server/agent/variables/generated-types";
import {applyVariableJsonPatch} from "nbook/server/agent/variables/json-patch";
import {defineClientVariable, defineProjectVariable, defineSessionVariable, VariableRegistry} from "nbook/server/agent/variables/registry";
import {createVariableTools} from "nbook/server/agent/variables/tools";
import {resolveAgentNbookRoot} from "nbook/server/agent/variables/workspace-paths";
import type {VariableInvocationState} from "nbook/server/agent/variables/types";

describe("Agent variable system", () => {
    it("VariableCatalog 顶层直接暴露四类变量根", () => {
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);

        const catalog = registry.catalog({namespace: "project"});

        expect(catalog).toHaveProperty("clientVariables");
        expect(catalog).toHaveProperty("globalVariables");
        expect(catalog).toHaveProperty("projectVariables");
        expect(catalog.projectVariables.affections).toEqual(expect.objectContaining({
            $ref: "#/projectVariables/affections",
            readable: true,
            writableByAgent: true,
        }));
        expect(catalog).not.toHaveProperty("namespaces");
    });

    it("JSON Patch 支持空 path 完整替换 target", () => {
        const result = applyVariableJsonPatch({score: 1}, [{
            op: "replace",
            path: "",
            value: {score: 2},
        }]);

        expect(result).toEqual({score: 2});
    });

    it("variable_schema 支持按子路径返回推导后的 schema", () => {
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);

        const result = registry.query({
            paths: ["project.affections.alice"],
            detail: true,
        });

        expect(result.schemas[0]).toEqual(expect.objectContaining({
            path: "project.affections.alice",
            key: "affections.alice",
            writableByAgent: true,
        }));
        expect(result.schemas[0]?.schema).toEqual(expect.objectContaining({
            type: "number",
        }));
    });

    it("变量类型生成器把 TypeBox 常用子集映射为 TS 类型", () => {
        const generated = generateVariableTypes([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
            }),
            defineSessionVariable({
                key: "draft",
                schema: Type.Object({
                    title: Type.String(),
                    done: Type.Optional(Type.Boolean()),
                    tags: Type.Array(Type.String()),
                    mode: Type.Union([Type.Literal("fast"), Type.Literal("slow"), Type.Null()]),
                }),
            }),
        ]);

        expect(generated.text).toContain("\"project.affections\": Record<string, number>;");
        expect(generated.text).toContain("\"session.draft\": {\"title\": string; \"done\"?: boolean; \"tags\": Array<string>; \"mode\": \"fast\" | \"slow\" | null};");
        expect(generated.diagnostics).toEqual([]);
    });

    it("Workspace Root .nbook 路径不会被重复追加 .nbook", () => {
        expect(resolveAgentNbookRoot("workspace/.nbook").replace(/\\/g, "/")).toMatch(/workspace\/\.nbook$/);
        expect(resolveAgentNbookRoot("workspace").replace(/\\/g, "/")).toMatch(/workspace\/\.nbook$/);
    });

    it("读取子路径时会使用注册根 default 的子字段", async () => {
        const root = resolve(".agent", "workspace", "variable-default-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const registry = new VariableRegistry([
            defineClientVariable({
                key: "ide",
                schema: Type.Object({
                    fontFamily: Type.String(),
                }),
                default: {
                    fontFamily: "monospace",
                },
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            await expect(accessor.get("client.ide.fontFamily")).resolves.toBe("monospace");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("session variable_patch 跟随 active path reduce", async () => {
        const root = resolve(".agent", "workspace", "variable-session-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            await accessor.patch("session", "affections", [{
                op: "replace",
                path: "",
                value: {alice: 1},
            }]);
            const nextSnapshot = await repo.readSession(snapshot.metadata.sessionId, snapshot.metadata.workspaceKey);
            const nextAccessor = createProfileVariableAccessor({
                repo,
                snapshot: nextSnapshot,
                registry,
            });

            await expect(nextAccessor.get("session.affections.alice")).resolves.toBe(1);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("patch 后值不符合注册 schema 时阻塞写入", async () => {
        const root = resolve(".agent", "workspace", "variable-schema-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            const result = await accessor.patch("session", "affections", [{
                op: "replace",
                path: "",
                value: {alice: "high"},
            }]);

            expect(result.issue).toEqual(expect.objectContaining({
                code: "schema_mismatch",
                path: "session.affections",
            }));
            await expect(accessor.get("session.affections")).resolves.toBeUndefined();
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("变量文件 JSON 损坏时返回 storage_error，而不是 not_registered", async () => {
        const root = resolve(".agent", "workspace", "variable-storage-error-test", randomUUID());
        const projectRoot = resolve(".agent", "workspace", "variable-storage-error-project", randomUUID());
        await mkdir(resolve(projectRoot, ".nbook", "agent"), {recursive: true});
        await writeFile(resolve(projectRoot, ".nbook", "agent", "variables.json"), "{ broken", "utf8");
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                clientState: {
                    studio: {workspace: projectRoot},
                },
            });

            const result = await accessor.read("project.affections");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "storage_error",
                path: "project.affections",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("variable_patch schema mismatch 会抛错，交给 harness 生成 error tool result", async () => {
        const root = resolve(".agent", "workspace", "variable-tool-error-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const vars = createProfileVariableAccessor({
            repo,
            snapshot,
            registry: new VariableRegistry([
                defineSessionVariable({
                    key: "affections",
                    schema: Type.Record(Type.String(), Type.Number()),
                    writableBy: ["agent"],
                }),
            ]),
        });
        try {
            const patchTool = createVariableTools().find((tool) => tool.key === "variable_patch");
            await expect(patchTool?.executeWithContext?.({
                harness: null as never,
                sessionId: snapshot.metadata.sessionId,
                workspaceRoot: root,
                workspaceKey: "test",
                vars,
            }, "tool-1", {
                namespace: "session",
                path: "affections",
                patch: [{op: "replace", path: "", value: {alice: "high"}}],
            })).rejects.toThrow("不符合注册 schema");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("Agent patch 必须先在同一 invocation 读取变量", async () => {
        const root = resolve(".agent", "workspace", "variable-read-before-patch-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {},
        };
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                default: {},
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
            });

            const blocked = await accessor.patch("session", "affections", [{
                op: "add",
                path: "/alice",
                value: 1,
            }]);
            expect(blocked.issue).toEqual(expect.objectContaining({
                code: "stale_read_required",
            }));

            const read = await accessor.read("session.affections");
            expect(read.fingerprint).toBeTruthy();
            const patched = await accessor.patch("session", "affections", [{
                op: "add",
                path: "/alice",
                value: 1,
            }]);

            expect(patched.issue).toBeUndefined();
            expect(patched.value).toEqual({alice: 1});
            expect(variableState.readFingerprints.get("session.affections")).toBe(patched.fingerprint);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("client.* patch ack 后同一 invocation 的新 accessor 能 read-after-write", async () => {
        const root = resolve(".agent", "workspace", "variable-client-overlay-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {
                ide: {
                    theme: "light",
                },
            },
        };
        const registry = new VariableRegistry([
            defineClientVariable({
                key: "ide",
                schema: Type.Record(Type.String(), Type.Unknown()),
                writableBy: ["agent", "frontend"],
            }),
        ]);
        try {
            const firstAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
                onClientPatch: async () => ({
                    namespace: "client",
                    path: "ide.theme",
                    operations: [{op: "replace", path: "", value: "dark"}],
                    appliedValue: "dark",
                    invocationId: "invoke-1",
                    toolCallId: "tool-1",
                }),
            });

            await firstAccessor.read("client.ide.theme");
            const patched = await firstAccessor.patch("client", "ide.theme", [{
                op: "replace",
                path: "",
                value: "dark",
            }], "agent", "tool-1");
            expect(patched.value).toBe("dark");

            const secondAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
            });

            await expect(secondAccessor.get("client.ide.theme")).resolves.toBe("dark");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("global/project 变量文件已写但 audit 失败时返回明确半提交错误", async () => {
        const root = resolve(".agent", "workspace", "variable-audit-failure-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const brokenRepo = Object.create(repo) as JsonlSessionRepository;
        brokenRepo.appendEntry = async (_sessionId: number, _input: SessionEntryDraft, _workspaceKey?: string) => {
            throw new Error("audit disk full");
        };
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {},
        };
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                default: {},
                writableBy: ["agent"],
            }),
        ]);
        const projectRoot = resolve(".agent", "workspace", "variable-audit-failure-project", randomUUID());
        variableState.clientOverlay = {
            studio: {workspace: projectRoot},
            currentProjectWorkspace: projectRoot,
        };
        try {
            const accessor = createProfileVariableAccessor({
                repo: brokenRepo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
                clientState: {
                    studio: {workspace: projectRoot},
                },
            });

            await accessor.read("project.affections");
            const result = await accessor.patch("project", "affections", [{
                op: "replace",
                path: "",
                value: {alice: 1},
            }], "agent", "tool-1");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "storage_error",
                message: expect.stringContaining("变量文件已经写入，但 session audit entry 写入失败"),
            }));
            const confirmAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                clientState: {
                    studio: {workspace: projectRoot},
                },
            });
            await expect(confirmAccessor.get("project.affections.alice")).resolves.toBe(1);
        } finally {
            await rm(root, {recursive: true, force: true});
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("variable_schema 不被无关 namespace 的 definition issue 阻塞", async () => {
        const schemaTool = createVariableTools().find((tool) => tool.key === "variable_schema");
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
            }),
        ], [{
            code: "compile_stale",
            path: "project.definitions.ts",
            message: "project definition 已过期",
        }]);
        const root = resolve(".agent", "workspace", "variable-schema-issue-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        try {
            const vars = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });
            const result = await schemaTool?.executeWithContext?.({
                harness: null as never,
                sessionId: snapshot.metadata.sessionId,
                workspaceRoot: root,
                workspaceKey: "test",
                vars,
            }, "tool-1", {
                namespace: "session",
            });

            expect(result?.details).toEqual(expect.objectContaining({
                issues: [],
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("project.* 缺少本轮 Project Workspace 时返回 unavailable", async () => {
        const root = resolve(".agent", "workspace", "variable-project-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            input: {},
            workspaceRoot: root,
            workspaceKey: "test",
        });
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                clientState: {
                    studio: {},
                },
            });

            const result = await accessor.read("project.affections");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "unavailable",
                path: "project.affections",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("Workspace Root / Project definition 只加载 hash 匹配的 .compiled artifact", async () => {
        const root = resolve(".agent", "workspace", "variable-definition-test", randomUUID());
        await mkdir(root, {recursive: true});
        const definitionPath = resolve(root, "definitions.ts");
        await writeFile(definitionPath, [
            "import {Type} from \"typebox\";",
            "import {defineProjectVariable} from \"nbook/server/agent/variables/registry\";",
            "export const definitions = [defineProjectVariable({",
            "    key: \"affections\",",
            "    schema: Type.Record(Type.String(), Type.Number()),",
            "    writableBy: [\"agent\"],",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        try {
            await compileVariableDefinitions({definitionRoot: root});
            const manifestText = await readFile(resolve(root, ".compiled", "manifest.json"), "utf8");
            const manifest = JSON.parse(manifestText) as {definitions: Array<{typeFileName?: string; typeDiagnostics?: unknown[]}>};
            const typeFileName = manifest.definitions[0]?.typeFileName;
            expect(typeFileName).toMatch(/types\.d\.ts$/);
            expect(await readFile(resolve(root, ".compiled", typeFileName!), "utf8")).toContain("\"project.affections\": Record<string, number>;");
            const loaded = await loadCompiledVariableDefinitions({definitionRoot: root, namespace: "project"});

            expect(loaded.issues).toEqual([]);
            expect(loaded.definitions.map((definition) => `${definition.namespace}.${definition.key}`)).toContain("project.affections");

            const source = await readFile(definitionPath, "utf8");
            await writeFile(definitionPath, source.replace("affections", "relationships"), "utf8");
            const stale = await loadCompiledVariableDefinitions({definitionRoot: root, namespace: "project"});

            expect(stale.definitions).toEqual([]);
            expect(stale.issues[0]).toEqual(expect.objectContaining({
                code: "compile_stale",
                path: "project.definitions.ts",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
