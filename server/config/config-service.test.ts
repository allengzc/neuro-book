import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {toolset} from "nbook/server/agent/profiles/profile-tools";
import {defineLowCodeForm, defineResourcePreset, profileHomeResource, type LowCodeFieldDefinition} from "nbook/server/low-code-form";
import {
    readConfigAgentProfileSettings,
    loadEffectiveConfigForAgentRuntime,
    readConfigBootstrap,
    readConfigEditorSnapshot,
    resetProjectProfileHome,
    saveGlobalConfig,
    saveProjectConfig,
} from "nbook/server/config/config-service";

const createdRoots: string[] = [];
const catalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
let globalConfigBackupPath: string | null = null;
let globalAgentsBackupPath: string | null = null;

describe("config service", {timeout: 30_000}, () => {
    beforeEach(async () => {
        globalConfigBackupPath = await moveGlobalConfigAside();
        globalAgentsBackupPath = await moveGlobalAgentsAside();
        await createProjectFixture();
    });

    afterEach(async () => {
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
        await fs.rm(path.join("workspace", ".nbook", "config.json"), {force: true});
        await fs.rm(path.join("workspace", ".nbook", "agents"), {recursive: true, force: true});
        await fs.rm(path.join("workspace", "config-test-project"), {recursive: true, force: true});
        if (globalAgentsBackupPath) {
            await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
            await fs.rename(globalAgentsBackupPath, path.join("workspace", ".nbook", "agents"));
            globalAgentsBackupPath = null;
        }
        if (globalConfigBackupPath) {
            await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
            await fs.rename(globalConfigBackupPath, path.join("workspace", ".nbook", "config.json"));
            globalConfigBackupPath = null;
        }
    });

    it("无配置文件时返回默认 Global + Project 快照且不创建文件", async () => {
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Provider enabled 旧配置默认 true，保存 false 时会持久化", async () => {
        await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "legacy-provider/legacy-model",
                providers: [{
                    id: "legacy-provider",
                    name: "Legacy Provider",
                    api: "openai-completions",
                    options: {
                        apiKey: "",
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "legacy-model",
                        name: "Legacy Model",
                        enabled: true,
                    }],
                }],
            },
        }, null, 4), "utf8");
        const legacySnapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, catalog);
        expect(legacySnapshot.modelSettings.providers[0]?.enabled).toBe(true);

        const saved = await saveGlobalConfig({
            models: {
                default: null,
                providers: [{
                    id: "legacy-provider",
                    name: "Legacy Provider",
                    enabled: false,
                    api: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: ""},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "legacy-model",
                        name: "Legacy Model",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"}, catalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf8")) as {models?: {providers?: Array<{enabled?: boolean}>}};

        expect(saved.modelSettings.providers[0]?.enabled).toBe(false);
        expect(saved.modelSettings.enabledModels).toEqual([]);
        expect(raw.models?.providers?.[0]?.enabled).toBe(false);
    });

    it("Global UI 费用显示币种可以保存并被 bootstrap 读回", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "custom-editor",
                customThemes: [{
                    id: "custom-editor",
                    name: "Editor Custom",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#101014",
                        "accent-main": "#88ccff",
                    },
                }],
                costCurrency: "CNY",
            },
        }, {workspaceKind: "user-assets"});
        const bootstrap = await readConfigBootstrap({workspaceKind: "user-assets"}, catalog);

        expect(snapshot.global.ui?.theme).toBe("custom-editor");
        expect(snapshot.global.ui?.customThemes).toHaveLength(1);
        expect(snapshot.global.ui?.costCurrency).toBe("CNY");
        expect(snapshot.effective.ui).toMatchObject({theme: "custom-editor", costCurrency: "CNY"});
        expect(bootstrap.ui.theme).toBe("custom-editor");
        expect(bootstrap.ui.customThemes).toHaveLength(1);
        expect(bootstrap.ui.costCurrency).toBe("CNY");
    });

    it("非法 UI 费用显示币种会回退为 USD", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "sepia",
                costCurrency: "EUR",
            },
        } as never, {workspaceKind: "user-assets"});

        expect(snapshot.global.ui?.costCurrency).toBe("USD");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
    });

    it("Project Config 在 project.yaml 损坏时仍可读写", async () => {
        await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), "kind: novel\ntitle: Config\nsummary: ''\na'a\n", "utf-8");

        const snapshot = await saveProjectConfig({
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"));
    });

    it("Global secret 写回缺失 value 时保留旧 API key", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
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
                    api: null,
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

    it("Global web secret 写回缺失 value 时保留旧 API key 并脱敏展示", async () => {
        await saveGlobalConfig({
            web: {
                search: {
                    order: ["tavily", "brave"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "tvly-secret-123456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-secret-123456"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "tvly...3456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "brav...3456"},
                            country: "JP",
                            searchLang: "ja",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            web?: {search?: {providers?: {tavily?: {apiKey?: string}; brave?: {apiKey?: string}}}}
        };

        expect(raw.web?.search?.providers?.tavily?.apiKey).toBe("tvly-secret-123456");
        expect(raw.web?.search?.providers?.brave?.apiKey).toBe("brave-secret-123456");
        expect(snapshot.global.web?.search?.providers?.tavily?.apiKey).toEqual({
            configured: true,
            maskedValue: "tvly...3456",
        });
        expect(snapshot.effective.web.search.order).toEqual(["brave", "tavily"]);
        expect(snapshot.effective.web.search.providers.brave.country).toBe("JP");
    });

    it("Global web 部分写回会保留模型配置段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-model"},
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
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-web-key"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey.configured).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.enabled).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.apiKey).toBe("brave-web-key");
    });

    it("Global 部分写回会保留未提交的配置段", async () => {
        await saveGlobalConfig({
            auth: {enabled: true},
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
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
                    api: "openai-completions",
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

        const visionModel = snapshot.modelSettings.providers[0]?.models.find((model) => model.id === "mimo-vl");

        expect(visionModel).toMatchObject({
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
        expect(snapshot.modelSettings.providers[0]?.api).toBe("openai-completions");
    });

    it("Project Config 可以覆盖默认模型、embedding 模型与默认 profile，但拒绝全局字段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, contextWindowTokens: null},
                        {id: "b", name: "B", group: null, enabled: true, contextWindowTokens: null},
                    ],
                }],
            },
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {encoding_format: "float"},
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: "deepseek/b"},
            embedding: {model: "project-embed", dimensions: 768},
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/b");
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
            timeoutMs: 30000,
            requestOptions: {encoding_format: "float"},
        });
        expect(snapshot.embeddingSettings.global.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-e...ding",
        });
        expect(snapshot.embeddingSettings.project).toEqual({
            model: "project-embed",
            dimensions: 768,
        });
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("custom.agent");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await expect(saveProjectConfig({
            models: {
                default: "deepseek/b",
                providers: [],
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
        await expect(saveProjectConfig({
            embedding: {
                model: "bad",
                baseURL: "https://project-should-not-own-service.example/v1",
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
    });

    it("Project Config 的 null 覆盖会回落到 Global Config", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
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
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: null},
            agent: {defaultProfileKey: null},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/a");
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("leader.default");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
    });

    it("Global embedding 启用后空模型和空维度会写入默认值", async () => {
        const snapshot = await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: null,
                dimensions: null,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.global.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
    });

    it("Agent runtime 配置读取会合并 Project embedding 覆盖", async () => {
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await saveProjectConfig({
            embedding: {
                model: "project-embed",
                dimensions: 768,
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const effective = await loadEffectiveConfigForAgentRuntime({
            workspaceRoot: "workspace",
            projectPath: "workspace/config-test-project",
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent runtime 配置读取支持外部 Project Workspace 绝对 projectPath", async () => {
        const externalProjectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nbook-external-project-")), "external-project");
        createdRoots.push(path.dirname(externalProjectRoot));
        await fs.mkdir(path.join(externalProjectRoot, ".nbook"), {recursive: true});
        await fs.writeFile(path.join(externalProjectRoot, "project.yaml"), [
            "kind: novel",
            "title: External Project",
            "summary: ''",
            "",
        ].join("\n"), "utf-8");
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await fs.writeFile(path.join(externalProjectRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "external-embed",
                dimensions: 384,
            },
        }, null, 4), "utf-8");

        const effective = await loadEffectiveConfigForAgentRuntime({
            workspaceRoot: "workspace",
            projectPath: externalProjectRoot,
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "external-embed",
            dimensions: 384,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent Profile 模型默认参数支持 Project 覆盖并被 profile 继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "high",
                    stream: false,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.4,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    topK: 5,
                    reasoningEffort: "low",
                },
                profiles: {
                    "leader.default": {
                        model: {
                            reasoningEffort: "medium",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const leader = settings.agentProfiles.find((profile) => profile.profileKey === "leader.default");
        const assets = settings.agentProfiles.find((profile) => profile.profileKey === "leader.assets");

        expect(settings.profileModelDefaults).toMatchObject({
            reasoningEffort: "low",
            stream: false,
            topK: 5,
        });
        expect(leader?.model).toMatchObject({
            temperature: 0.4,
            topK: 5,
            reasoningEffort: "medium",
            stream: false,
        });
        expect(assets?.model).toMatchObject({
            topK: 5,
            reasoningEffort: "low",
            stream: false,
        });
    });

    it("Project 只覆盖 Agent Profile 默认参数时也会更新已有 Global profile 的 effective model", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "off",
                    stream: true,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.3,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    reasoningEffort: "xhigh",
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const leader = settings.agentProfiles.find((profile) => profile.profileKey === "leader.default");

        expect(leader?.model).toMatchObject({
            temperature: 0.3,
            reasoningEffort: "xhigh",
            stream: true,
        });
    });

    it("editor snapshot 不读取 Agent Profile catalog", async () => {
        const optionsProvider = vi.fn(() => [
            {value: "default-style", label: "默认文风"},
            {value: "cinematic", label: "电影感"},
        ]);
        const lightCatalog = createCatalog(["writer"], {writingStyleOptions: optionsProvider});
        const snapshotSpy = vi.spyOn(lightCatalog, "snapshot");
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, lightCatalog);

        expect(snapshotSpy).not.toHaveBeenCalled();
        expect("agentProfileSettings" in snapshot).toBe(false);
        expect(optionsProvider).not.toHaveBeenCalled();
    });

    it("Agent Profile settings 专用接口只读取带 settings form 的 runtime profile", async () => {
        const profileCatalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
        const getSpy = vi.spyOn(profileCatalog, "get");

        try {
            const settings = await readConfigAgentProfileSettings({workspaceKind: "user-assets"}, profileCatalog);
            const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

            expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
            expect(writer?.loadStatus).toBe("loaded");
            expect(writer?.hasSettingsForm).toBe(true);
            expect(getSpy).toHaveBeenCalledTimes(1);
            expect(getSpy).toHaveBeenCalledWith("writer");
        } finally {
            getSpy.mockRestore();
        }
    });

    it("Agent Profile settings 支持 Global 保存并返回 form 与 effective value", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, catalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "user-assets"}, catalog);
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
        expect(writer?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(writer?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "default-style",
            narrativePerson: "third",
        });
        expect(writer?.settings?.globalPatch).toEqual({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
    });

    it("Agent Profile settings 支持 Project patch 覆盖与继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);
        const overrideSettings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const overridden = overrideSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(overridden?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "second",
        });
        expect(overridden?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(overridden?.settings?.projectPatch).toEqual({
            narrativePerson: "second",
        });

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {},
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);
        const inheritedSettings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const inherited = inheritedSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(inherited?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(inherited?.settings?.projectPatch).toEqual({});
    });

    it("Agent Profile settings 保存 Project patch 时按继承后的 effective value 校验", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cross-invalid",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });

    it("Agent Profile settings 保存时拒绝非法 option 与自定义校验错误", async () => {
        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "missing",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});

        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "forbidden",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });

    it("Project 保存应用 resource mutations 且不把 mutations 写入 config", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "新的文风正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", "config-test-project", ".nbook", "config.json"), "utf-8")) as {
            agent?: {profiles?: {writer?: {resourceMutations?: unknown; settings?: {writingStylePreset?: string}}}}
        };

        expect(raw.agent?.profiles?.writer?.settings?.writingStylePreset).toBe("styles/new.md");
        expect(raw.agent?.profiles?.writer?.resourceMutations).toBeUndefined();
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "new.md"), "utf-8")).resolves.toContain("新的文风正文");
    });

    it("Project 保存 settings 校验失败时不会先写入 resource mutations", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        const resourcePath = path.join("workspace", "config-test-project", "agents", "writer", "styles", "invalid-save.md");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/invalid-save.md",
                            narrativePerson: "bad",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "不应落盘",
                            slug: "invalid-save",
                            content: "这段内容不应该写入 profile home",
                        }],
                    },
                },
            },
        } as never, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});
        await expect(fs.access(resourcePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project 保存按 resource mutations 最终 key 校验 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/first.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "先创建",
                            slug: "first",
                            content: "不应该落盘",
                        }, {
                            type: "rename",
                            fieldPath: "writingStylePreset",
                            key: "styles/first.md",
                            label: "最终资源",
                            slug: "second",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "styles", "first.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "styles", "second.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project 保存按 resource mutations 最终 key 校验没有 validateKey 的 resolver", async () => {
        const resourceCatalog = createCatalog(["writer"], {customWritingStyleResourceWithoutValidateKey: true});

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "新的正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.projectPatch).toEqual({writingStylePreset: "styles/new.md"});
    });

    it("Project 保存拒绝 rename 后继续保存旧 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await fs.mkdir(path.join("workspace", "config-test-project", "agents", "writer", "styles"), {recursive: true});
        await fs.writeFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "旧正文", "utf-8");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/old.md",
                        },
                        resourceMutations: [{
                            type: "rename",
                            fieldPath: "writingStylePreset",
                            key: "styles/old.md",
                            label: "新资源",
                            slug: "new",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "utf-8")).resolves.toBe("旧正文");
    });

    it("Project 保存拒绝删除当前最终 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await fs.mkdir(path.join("workspace", "config-test-project", "agents", "writer", "styles"), {recursive: true});
        await fs.writeFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "旧正文", "utf-8");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/old.md",
                        },
                        resourceMutations: [{
                            type: "remove",
                            fieldPath: "writingStylePreset",
                            key: "styles/old.md",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "utf-8")).resolves.toBe("旧正文");
    });

    it("Project 显式保存 global-only resource key 时要求先复制到项目", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("请先复制到项目"),
        });
    });

    it("Project 复制 global resource 到项目后允许保存同 key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "项目固化正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.projectPatch).toEqual({writingStylePreset: "styles/global-only.md"});
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "global-only.md"), "utf-8")).resolves.toContain("项目固化正文");
    });

    it("Project 可以重置 profile home 并刷新完整 settings snapshot", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true, homeReset: true});
        const customPath = path.join("workspace", "config-test-project", "agents", "writer", "styles", "custom.md");
        await fs.mkdir(path.dirname(customPath), {recursive: true});
        await fs.writeFile(customPath, "用户自定义", "utf-8");

        await resetProjectProfileHome({
            profileKey: "writer",
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        await expect(fs.access(customPath)).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "reset.md"), "utf-8")).resolves.toBe("reset");
        expect(writer?.canResetHome).toBe(true);
        expect(writer?.settings?.form.fields[0]?.resource?.options).toEqual([expect.objectContaining({key: "styles/reset.md"})]);
    });

    it("Global 保存完整 Agent Profile settings 时初始化 Global profile home 且不初始化 Project profile home", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                            narrativePerson: "first",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "global",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.form.fields[0]?.resource?.options).toEqual([expect.objectContaining({
            key: "styles/global-only.md",
            origin: "global",
        })]);
        await fs.access(path.join("workspace", ".nbook", "agents", "writer", "home.json"));
        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "home.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global 保存应用 resource mutations 且不把 mutations 写入 config", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "全局新文风正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            agent?: {profiles?: {writer?: {resourceMutations?: unknown; settings?: {writingStylePreset?: string}}}}
        };

        expect(raw.agent?.profiles?.writer?.settings?.writingStylePreset).toBe("styles/new.md");
        expect(raw.agent?.profiles?.writer?.resourceMutations).toBeUndefined();
        await expect(fs.readFile(path.join("workspace", ".nbook", "agents", "writer", "styles", "new.md"), "utf-8")).resolves.toContain("全局新文风正文");
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

async function moveGlobalAgentsAside(): Promise<string | null> {
    const agentsPath = path.join("workspace", ".nbook", "agents");
    try {
        await fs.access(agentsPath);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-agents-test-"));
    const backupPath = path.join(tempDir, "agents");
    await fs.rename(agentsPath, backupPath);
    return backupPath;
}

async function createProjectFixture(): Promise<void> {
    await fs.mkdir(path.join("workspace", "config-test-project"), {recursive: true});
    await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), [
        "kind: novel",
        "title: Config Test Project",
        "summary: ''",
        "",
    ].join("\n"), "utf-8");
}

function createCatalog(
    profileKeys: string[],
    options: {writingStyleOptions?: LowCodeFieldDefinition["options"]; writingStyleResource?: boolean; customWritingStyleResourceWithoutValidateKey?: boolean; homeReset?: boolean} = {},
): AgentProfileCatalog {
    const profileCatalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
    const writerSettingsForm = defineLowCodeForm({
        schema: Type.Object({
            writingStylePreset: Type.String(),
            narrativePerson: Type.Union([
                Type.Literal("first"),
                Type.Literal("second"),
                Type.Literal("third"),
            ]),
        }, {additionalProperties: false}),
        defaults: {
            writingStylePreset: "default-style",
            narrativePerson: "third",
        },
        fields: [
            {
                path: "writingStylePreset",
                component: options.writingStyleResource || options.customWritingStyleResourceWithoutValidateKey ? "resource-preset" : "combobox",
                label: "文风预设",
                ...(options.writingStyleResource || options.customWritingStyleResourceWithoutValidateKey ? {
                    resource: options.customWritingStyleResourceWithoutValidateKey
                        ? defineResourcePreset({
                            contentType: "markdown",
                            template: "模板",
                            createKeyPrefix: "styles/",
                            createKeySuffix: ".md",
                            list: () => [{key: "styles/existing.md", label: "已有文风"}],
                            read: (_ctx, key) => ({key, contentType: "markdown", content: "正文"}),
                            create: (_ctx, mutation) => ({key: `styles/${mutation.slug}.md`, contentType: "markdown", content: mutation.content ?? ""}),
                            createKey: (_ctx, mutation) => `styles/${mutation.slug}.md`,
                        })
                        : profileHomeResource({directory: "styles", template: "模板"}),
                } : {
                    options: options.writingStyleOptions ?? [
                    {value: "default-style", label: "默认文风"},
                    {value: "cinematic", label: "电影感"},
                    {value: "cross-invalid", label: "交叉校验"},
                    {value: "forbidden", label: "禁用文风"},
                    ],
                }),
            },
            {
                path: "narrativePerson",
                component: "radio",
                label: "默认人称",
                options: [
                    {value: "third", label: "第三人称"},
                    {value: "first", label: "第一人称"},
                    {value: "second", label: "第二人称"},
                ],
            },
        ],
        validate(value) {
            const issues: Array<{path: string; severity: "error"; message: string}> = [];
            if (value.writingStylePreset === "forbidden") {
                issues.push({path: "writingStylePreset", severity: "error" as const, message: "禁用文风不可保存。"});
            }
            if (value.writingStylePreset === "cross-invalid" && value.narrativePerson === "second") {
                issues.push({path: "narrativePerson", severity: "error" as const, message: "交叉校验文风不能使用第二人称。"});
            }
            return issues;
        },
    });
    for (const profileKey of profileKeys) {
        const baseProfile = {
            manifest: {
                key: profileKey,
                name: profileKey,
            },
            initialSchema: Type.Object({}, {additionalProperties: false}),
            outputSchema: Type.Unknown(),
            tools: toolset(),
            prepare: () => ({}),
            ...(profileKey === "writer" && options.homeReset ? {
                home: defineProfileHome({
                    async reset(ctx) {
                        await ctx.home.clear();
                        await ctx.home.writeText("styles/reset.md", "reset");
                    },
                }),
            } : {}),
        } satisfies Parameters<typeof defineAgentProfile>[0];
        profileCatalog.register(profileKey === "writer"
            ? defineAgentProfile({
                ...baseProfile,
                settingsForm: writerSettingsForm,
            })
            : defineAgentProfile(baseProfile), true);
    }
    return profileCatalog;
}
