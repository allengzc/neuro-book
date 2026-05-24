import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {
    readConfigEditorSnapshot,
    saveGlobalConfig,
    saveProjectConfig,
} from "nbook/server/config/config-service";

const createdRoots: string[] = [];
const catalog = createCatalog(["leader.default", "leader.assets", "custom.agent"]);
let globalConfigBackupPath: string | null = null;

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: {
        novel: {
            findUnique: vi.fn(async () => ({workspaceSlug: "config-test-project"})),
        },
    },
}));

describe("config service", () => {
    beforeEach(async () => {
        globalConfigBackupPath = await moveGlobalConfigAside();
    });

    afterEach(async () => {
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
        await fs.rm(path.join("workspace", ".nbook", "config.json"), {force: true});
        await fs.rm(path.join("workspace", "config-test-project"), {recursive: true, force: true});
        if (globalConfigBackupPath) {
            await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
            await fs.rename(globalConfigBackupPath, path.join("workspace", ".nbook", "config.json"));
            globalConfigBackupPath = null;
        }
    });

    it("无配置文件时返回默认 Global + Project 快照且不创建文件", async () => {
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "novel", novelId: "6"}, catalog);

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global secret 写回缺失 value 时保留旧 API key", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-test-123456"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    options: {
                        apiKey: {configured: true, maskedValue: "sk-t...3456"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };

        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-test-123456");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-t...3456",
        });
    });

    it("Global 部分写回会保留未提交的配置段", async () => {
        await saveGlobalConfig({
            auth: {enabled: true},
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-me"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: 180000,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            auth: {enabled: false},
        }, {workspaceKind: "user-assets"});

        expect(snapshot.effective.auth.enabled).toBe(false);
        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers).toHaveLength(1);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            auth?: {enabled?: boolean};
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };
        expect(raw.auth?.enabled).toBe(false);
        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-keep-me");
    });

    it("Global 模型写回会保留 Pi Model 字段", async () => {
        const snapshot = await saveGlobalConfig({
            models: {
                default: "custom/mimo-vl",
                providers: [{
                    id: "custom",
                    name: "Custom",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-custom"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "mimo-vl",
                        name: "Mimo Vision",
                        group: null,
                        enabled: true,
                        provider: "xiaomi-token-plan-cn",
                        api: "openai-completions",
                        baseUrl: "https://model.example/v1",
                        reasoning: true,
                        input: ["text", "image"],
                        maxTokens: 1234,
                        cost: {
                            input: 1,
                            output: 2,
                            cacheRead: 3,
                            cacheWrite: 4,
                        },
                        compat: {
                            thinkingFormat: "deepseek",
                            supportsStrictMode: false,
                        },
                        contextWindowTokens: 98765,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.providers[0]?.models[0]).toMatchObject({
            provider: "xiaomi-token-plan-cn",
            api: "openai-completions",
            baseUrl: "https://model.example/v1",
            reasoning: true,
            input: ["text", "image"],
            maxTokens: 1234,
            cost: {
                input: 1,
                output: 2,
                cacheRead: 3,
                cacheWrite: 4,
            },
            compat: {
                thinkingFormat: "deepseek",
                supportsStrictMode: false,
            },
            contextWindowTokens: 98765,
        });
    });

    it("Project Config 可以覆盖默认模型和默认 profile，但拒绝 models.providers", async () => {
        await fs.mkdir(path.join("workspace", "config-test-project"), {recursive: true});
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, contextWindowTokens: null},
                        {id: "b", name: "B", group: null, enabled: true, contextWindowTokens: null},
                    ],
                }],
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", novelId: "6"});

        const snapshot = await saveProjectConfig({
            models: {default: "deepseek/b"},
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", novelId: "6"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/b");
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("custom.agent");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await expect(saveProjectConfig({
            models: {
                default: "deepseek/b",
                providers: [],
            } as never,
        }, {workspaceKind: "novel", novelId: "6"})).rejects.toMatchObject({statusCode: 400});
    });

    it("Project Config 的 null 覆盖会回落到 Global Config", async () => {
        await fs.mkdir(path.join("workspace", "config-test-project"), {recursive: true});
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, contextWindowTokens: null},
                    ],
                }],
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", novelId: "6"});

        const snapshot = await saveProjectConfig({
            models: {default: null},
            agent: {defaultProfileKey: null},
        }, {workspaceKind: "novel", novelId: "6"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/a");
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("leader.default");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
    });
});

async function moveGlobalConfigAside(): Promise<string | null> {
    const configPath = path.join("workspace", ".nbook", "config.json");
    try {
        await fs.access(configPath);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-config-test-"));
    const backupPath = path.join(tempDir, "config.json");
    await fs.rename(configPath, backupPath);
    return backupPath;
}

function createCatalog(profileKeys: string[]): AgentProfileCatalog {
    const profileCatalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
    for (const profileKey of profileKeys) {
        profileCatalog.register(defineAgentProfile({
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
    return profileCatalog;
}
