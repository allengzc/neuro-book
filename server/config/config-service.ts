import {readFileSync} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {AgentCatalogItem} from "nbook/server/agent/profiles/types";
import {resolveProfileSettings} from "nbook/server/agent/profiles/profile-settings";
import {
    USER_ASSETS_WORKSPACE_KIND,
    USER_ASSETS_WORKSPACE_ROOT,
    WORKSPACE_CONTAINER_ROOT,
    type WorkspaceRootKind,
} from "nbook/server/workspace-files/novel-workspace";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import {GlobalConfigDtoSchema} from "nbook/shared/dto/config.dto";
import type {
    ConfigAgentProfileSettingsDto,
    ConfigBootstrapDto,
    ConfigDefaultProfileSettingsDto,
    ConfigEditorSnapshotDto,
    ConfigEmbeddingSettingsDto,
    ConfigModelSettingsDto,
    ConfigSnapshotDto,
    ConfigWorkspaceQueryDto,
    GlobalConfigDto,
    GlobalConfigUpdateDto,
    ProjectConfigDto,
} from "nbook/shared/dto/config.dto";
import {CONFIG_REGISTRY, CONFIG_VERSION} from "nbook/server/config/registry";
import {
    normalizeAgentProfileModelConfig,
    normalizeAgentProfiles,
    normalizeAgentProfileSettings,
    normalizeEmbeddingModelConfig,
    normalizeEmbeddingService,
    normalizeGlobalConfig,
    normalizeProjectConfig,
    resolveEffectiveConfig,
    serializeModelSettings,
} from "nbook/server/config/normalizer";
import type {
    AgentProfileConfig,
    ConfigTarget,
    ConfiguredModelConfig,
    EmbeddingServiceConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
    StoredGlobalConfig,
    StoredProjectConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";
import {
    applyLowCodeResourceMutations,
    resolveLowCodeForm,
    validateLowCodeResourceMutations,
    validateLowCodeFormValue,
    type LowCodeFormDefinition,
    type LowCodeFormResolveContext,
    type LowCodeResourceMutationKeyView,
} from "nbook/server/low-code-form";
import type {LowCodeJsonObject, LowCodeJsonValue, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import {ensureGlobalProfileHome, ensureProfileHome, resetProfileHome, resolveProjectRootForProfileHome, type ProfileHomeDefinition} from "nbook/server/agent/profiles/profile-home";
import {
    buildModelLabel,
    listEnabledModels,
    resolveConfiguredModel,
} from "nbook/server/utils/model-settings";

const GLOBAL_CONFIG_PATH = path.resolve(process.cwd(), "workspace", ".nbook", "config.json");

type ConfigEditorSnapshotOptions = {
    includeAgentProfileSettings?: boolean;
    agentProfileSettingsScope?: "global" | "project";
};

/**
 * 读取业务运行使用的最新配置快照。
 */
export async function readConfigSnapshot(query: ConfigWorkspaceQueryDto): Promise<ConfigSnapshotDto> {
    const {global, project} = await readConfigFiles(query);
    const effective = resolveEffectiveConfig(global, project);
    return {
        version: CONFIG_VERSION,
        effective: effective as unknown as Record<string, never>,
        meta: CONFIG_REGISTRY,
    };
}

/**
 * 读取设置页使用的编辑快照，包含 raw global/project 与衍生面板数据。
 */
export async function readConfigEditorSnapshot(
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
    options: ConfigEditorSnapshotOptions = {},
): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    const effective = resolveEffectiveConfig(global, project);
    const catalog = await profiles.snapshot();

    return {
        version: CONFIG_VERSION,
        workspaceKind: target.workspaceKind,
        global: redactGlobalConfig(global),
        project: project as ProjectConfigDto | null,
        effective: effective as unknown as Record<string, never>,
        meta: CONFIG_REGISTRY,
        modelSettings: buildConfigModelSettingsDto(effective),
        embeddingSettings: buildConfigEmbeddingSettingsDto(global, project, effective),
        agentProfileSettings: await buildConfigAgentProfileSettingsDto({
            effective,
            global,
            project,
            profiles,
            catalogProfiles: catalog.profiles,
            query,
            includeSettings: options.includeAgentProfileSettings === true,
            settingsScope: options.agentProfileSettingsScope ?? (target.workspaceKind === "novel" ? "project" : "global"),
        }),
        defaultProfileSettings: buildDefaultProfileSettingsDto({
            workspaceKind: target.workspaceKind,
            projectConfigAvailable: Boolean(target.projectConfigPath),
            global,
            project,
            catalog,
        }),
    };
}

/**
 * 读取首页启动所需的轻量配置。
 */
export async function readConfigBootstrap(
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigBootstrapDto> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    const effective = resolveEffectiveConfig(global, project);

    return {
        modelSettings: {
            defaultModelLabel: buildConfigModelSettingsDto(effective).defaultModelLabel,
            enabledModels: listEnabledModels(effective.models),
        },
        defaultProfileSettings: {
            effectiveProfileKey: resolveDefaultProfileKeyFromConfig(target.workspaceKind, global, project),
        },
        ui: {
            costCurrency: effective.ui.costCurrency,
        },
    };
}

/**
 * 保存 Global Config。secret value 缺失时保留原值。
 */
export async function saveGlobalConfig(
    input: GlobalConfigUpdateDto,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
    options: ConfigEditorSnapshotOptions = {},
): Promise<ConfigEditorSnapshotDto> {
    await assertProfileSettingsInput(input.agent?.profiles, query, profiles, undefined, {
        includeResourceMutationFinalKeys: true,
    }, "global");
    await applyProfileResourceMutations(input.agent?.profiles, query, profiles, undefined, "global");
    const current = await readGlobalConfigFile();
    const next = normalizeGlobalConfig({
        ...current,
        ...(input.auth !== undefined ? {auth: input.auth} : {}),
        ...(input.agent !== undefined ? {agent: input.agent} : {}),
        ...(input.ui !== undefined ? {ui: input.ui} : {}),
        ...(input.editor !== undefined ? {editor: input.editor} : {}),
        ...(input.web !== undefined ? {web: normalizeGlobalWebForWrite(input.web, current)} : {}),
        ...(input.models !== undefined ? {models: normalizeGlobalModelsForWrite(input.models, current)} : {}),
        ...(input.embedding !== undefined ? {embedding: normalizeGlobalEmbeddingForWrite(input.embedding, current)} : {}),
    });
    await writeJsonFile(GLOBAL_CONFIG_PATH, next);
    return readConfigEditorSnapshot(query, profiles, {...options, agentProfileSettingsScope: "global"});
}

/**
 * 保存 Project Config。包含 global-only 字段时直接拒绝。
 */
export async function saveProjectConfig(
    input: ProjectConfigDto,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
    options: ConfigEditorSnapshotOptions = {},
): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    if (!target.projectConfigPath) {
        throw createError({
            statusCode: 400,
            message: "user-assets 入口没有独立 Project Config",
        });
    }
    assertProjectConfigDoesNotContainGlobalOnly(input);
    const global = await readGlobalConfigFile();
    await assertProfileSettingsInput(input.agent?.profiles, query, profiles, global.agent?.profiles, {
        includeResourceMutationFinalKeys: true,
    }, "project");
    await applyProfileResourceMutations(input.agent?.profiles, query, profiles, global.agent?.profiles);
    await writeJsonFile(target.projectConfigPath, normalizeProjectConfig(stripProfileResourceMutations(input) as StoredProjectConfig));
    return readConfigEditorSnapshot(query, profiles, {...options, agentProfileSettingsScope: "project"});
}

/**
 * 重置指定 Project Workspace 下的 profile home，并返回刷新后的完整 Agent Profile settings snapshot。
 */
export async function resetProjectProfileHome(
    input: {profileKey: string},
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog = useAgentHarness().profiles,
): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    if (!target.projectConfigPath || target.workspaceKind !== "novel") {
        throw createError({statusCode: 400, message: "只有 Project Config 支持重置 profile home。"});
    }
    const projectRoot = resolveProjectRootForProfileHome(query.projectPath);
    if (!projectRoot) {
        throw createError({statusCode: 400, message: "重置 profile home 需要 Project Workspace。"});
    }
    const profile = await profiles.get(input.profileKey).catch(() => null);
    if (!profile) {
        throw createError({statusCode: 404, message: `profile ${input.profileKey} 不存在。`});
    }
    if (!profile.home?.reset) {
        throw createError({statusCode: 400, message: `profile ${input.profileKey} 未声明 home reset。`});
    }
    await resetProfileHome({
        projectRoot,
        profileKey: profile.manifest.key,
        profileVersion: profile.manifest.version ?? 1,
        definition: profile.home,
    });
    return readConfigEditorSnapshot(query, profiles, {
        includeAgentProfileSettings: true,
        agentProfileSettingsScope: "project",
    });
}

/**
 * 读取 effective config，供后端运行路径直接使用。
 */
export async function loadEffectiveConfig(query: ConfigWorkspaceQueryDto = {workspaceKind: "user-assets"}): Promise<EffectiveConfig> {
    const {global, project} = await readConfigFiles(query);
    return resolveEffectiveConfig(global, project);
}

/**
 * 只按 workspaceRoot 读取 effective config。
 *
 * 普通 Project agent session 的 workspaceRoot 通常是容器 `workspace`，
 * Project 覆盖必须走 loadEffectiveConfigForAgentRuntime()。
 */
export async function loadEffectiveConfigForWorkspaceRoot(workspaceRoot: string | undefined): Promise<EffectiveConfig> {
    const externalWorkspaceRoot = resolveExternalWorkspaceRoot(workspaceRoot);
    if (externalWorkspaceRoot) {
        const global = normalizeGlobalConfig(await readJsonFile<StoredGlobalConfig>(path.join(externalWorkspaceRoot, ".nbook", "config.json")));
        return resolveEffectiveConfig(global, null);
    }

    const global = await readGlobalConfigFile();
    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    if (!normalizedRoot || normalizedRoot === USER_ASSETS_WORKSPACE_ROOT || normalizedRoot === WORKSPACE_CONTAINER_ROOT) {
        return resolveEffectiveConfig(global, null);
    }
    const configPath = normalizedRoot.endsWith("/.nbook")
        ? path.resolve(process.cwd(), normalizedRoot, "config.json")
        : path.resolve(process.cwd(), normalizedRoot, ".nbook", "config.json");
    return resolveEffectiveConfig(global, await readProjectConfigFile(configPath));
}

/**
 * 按 Agent runtime metadata 的 workspaceRoot + projectPath 读取 effective config。
 */
export async function loadEffectiveConfigForAgentRuntime(input: {workspaceRoot?: string; projectPath?: string}): Promise<EffectiveConfig> {
    if (!input.projectPath) {
        return loadEffectiveConfigForWorkspaceRoot(input.workspaceRoot);
    }

    if (path.isAbsolute(input.projectPath)) {
        const [global, project] = await Promise.all([
            readGlobalConfigFile(),
            readProjectConfigFile(path.join(path.resolve(input.projectPath), ".nbook", "config.json")),
        ]);
        return resolveEffectiveConfig(global, project);
    }

    const externalWorkspaceRoot = resolveExternalWorkspaceRoot(input.workspaceRoot);
    if (externalWorkspaceRoot) {
        const projectSlug = extractProjectSlug(input.projectPath);
        const [global, project] = await Promise.all([
            normalizeGlobalConfig(await readJsonFile<StoredGlobalConfig>(path.join(externalWorkspaceRoot, ".nbook", "config.json"))),
            readProjectConfigFile(path.join(externalWorkspaceRoot, projectSlug, ".nbook", "config.json")),
        ]);
        return resolveEffectiveConfig(global, project);
    }

    return loadEffectiveConfig({workspaceKind: "novel", projectPath: input.projectPath});
}

/**
 * 同步读取 Global Config。仅用于 auth middleware 和 provider key 这类同步入口。
 */
export function loadGlobalEffectiveConfigSync(): EffectiveConfig {
    const global = readJsonFileSync<StoredGlobalConfig>(GLOBAL_CONFIG_PATH);
    return resolveEffectiveConfig(normalizeGlobalConfig(global), null);
}

/**
 * 保存模型设置到 Global Config。
 */
export async function saveModelSettings(config: ModelSettingsConfig, query: ConfigWorkspaceQueryDto): Promise<ConfigEditorSnapshotDto> {
    const current = await readGlobalConfigFile();
    const next = normalizeGlobalConfig({
        ...current,
        models: serializeModelSettings(config),
    });
    await writeJsonFile(GLOBAL_CONFIG_PATH, next);
    return readConfigEditorSnapshot(query);
}

/**
 * 保存 Agent Profile 模型设置到 Global Config。
 */
export async function saveAgentProfileSettings(
    config: Record<string, AgentProfileConfig>,
    query: ConfigWorkspaceQueryDto,
): Promise<ConfigEditorSnapshotDto> {
    const current = await readGlobalConfigFile();
    const next = normalizeGlobalConfig({
        ...current,
        agent: {
            ...(current.agent ?? {}),
            profiles: normalizeAgentProfiles(config),
        },
    });
    await writeJsonFile(GLOBAL_CONFIG_PATH, next);
    return readConfigEditorSnapshot(query);
}

/**
 * 当前 Project Workspace / user-assets 的默认 profile。
 */
export async function resolveDefaultProfileKey(query: ConfigWorkspaceQueryDto): Promise<string> {
    const target = await resolveConfigTarget(query);
    const {global, project} = await readConfigFiles(query, target);
    return resolveDefaultProfileKeyFromConfig(target.workspaceKind, global, project);
}

/**
 * 解析配置目标路径。user-assets 只对应 Workspace Root `.nbook`。
 */
export async function resolveConfigTarget(query: ConfigWorkspaceQueryDto): Promise<ConfigTarget> {
    const workspaceKind: WorkspaceRootKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? USER_ASSETS_WORKSPACE_KIND : "novel";
    if (workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        return {
            workspaceKind,
            projectConfigPath: null,
        };
    }

    if (!query.projectPath) {
        throw createError({
            statusCode: 400,
            message: "Project Workspace 配置必须提供有效 projectPath",
        });
    }
    const projectPath = await assertProjectWorkspaceDirectory(query.projectPath);
    return {
        workspaceKind,
        projectConfigPath: path.resolve(process.cwd(), projectPath, ".nbook", "config.json"),
    };
}

async function readConfigFiles(query: ConfigWorkspaceQueryDto, knownTarget?: ConfigTarget): Promise<{
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
}> {
    const target = knownTarget ?? await resolveConfigTarget(query);
    const [global, project] = await Promise.all([
        readGlobalConfigFile(),
        target.projectConfigPath ? readProjectConfigFile(target.projectConfigPath) : Promise.resolve(null),
    ]);
    return {global, project};
}

async function readGlobalConfigFile(): Promise<StoredGlobalConfig> {
    return normalizeGlobalConfig(await readJsonFile<StoredGlobalConfig>(GLOBAL_CONFIG_PATH));
}

async function readProjectConfigFile(configPath: string): Promise<StoredProjectConfig> {
    return normalizeProjectConfig(await readJsonFile<StoredProjectConfig>(configPath));
}

function redactGlobalConfig(config: StoredGlobalConfig): GlobalConfigDto {
    return GlobalConfigDtoSchema.parse({
        auth: config.auth,
        agent: config.agent,
        ui: config.ui,
        editor: config.editor,
        web: {
            search: {
                order: config.web?.search?.order ?? [],
                providers: {
                    tavily: {
                        ...config.web?.search?.providers?.tavily,
                        apiKey: maskSecret(config.web?.search?.providers?.tavily?.apiKey),
                    },
                    brave: {
                        ...config.web?.search?.providers?.brave,
                        apiKey: maskSecret(config.web?.search?.providers?.brave?.apiKey),
                    },
                },
            },
            fetch: config.web?.fetch,
        },
        embedding: {
            ...config.embedding,
            apiKey: maskSecret(config.embedding?.apiKey),
        },
        models: {
            default: config.models?.default ?? null,
            providers: (config.models?.providers ?? []).map((provider) => ({
                ...provider,
                api: provider.api ?? null,
                options: {
                    ...provider.options,
                    apiKey: maskSecret(provider.options.apiKey),
                },
            })),
        },
    });
}

function buildConfigModelSettingsDto(effective: EffectiveConfig): ConfigModelSettingsDto {
    const providers = Object.entries(effective.models.providers).map(([providerId, provider]) => ({
        id: providerId,
        name: provider.name,
        api: provider.api,
        options: {
            apiKey: maskSecret(provider.options.apiKey),
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
        models: Object.values(provider.models).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const defaultModel = resolveConfiguredModel(effective.models, effective.models.defaultModelKey);

    return {
        defaultModelKey: effective.models.defaultModelKey,
        defaultModelLabel: defaultModel ? buildModelLabel(defaultModel.provider.name, defaultModel.model.name) : null,
        enabledModels: listEnabledModels(effective.models),
        providers,
    };
}

function buildConfigEmbeddingSettingsDto(
    global: StoredGlobalConfig,
    project: StoredProjectConfig | null,
    effective: EffectiveConfig,
): ConfigEmbeddingSettingsDto {
    const globalEmbedding = normalizeEmbeddingService(global.embedding);
    const projectEmbedding = project?.embedding ? normalizeEmbeddingModelConfig(project.embedding) : null;
    return {
        global: {
            ...globalEmbedding,
            apiKey: maskSecret(globalEmbedding.apiKey),
        },
        project: projectEmbedding,
        effective: {
            ...effective.embedding,
            apiKey: maskSecret(effective.embedding.apiKey),
        },
    };
}

async function buildConfigAgentProfileSettingsDto(input: {
    effective: EffectiveConfig;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    profiles: AgentProfileCatalog;
    catalogProfiles: AgentCatalogItem[];
    query: ConfigWorkspaceQueryDto;
    includeSettings: boolean;
    settingsScope: "global" | "project";
}): Promise<ConfigAgentProfileSettingsDto> {
    return {
        enabledModels: listEnabledModels(input.effective.models),
        profileModelDefaults: normalizeAgentProfileModelConfig(input.effective.agent.profileModelDefaults),
        agentProfiles: await Promise.all(input.catalogProfiles.map(async (definition) => ({
            profileKey: definition.key,
            name: definition.name,
            canResetHome: definition.canResetHome,
            model: normalizeAgentProfileModelConfig({
                ...input.effective.agent.profileModelDefaults,
                ...(input.effective.agent.profiles[definition.key]?.model ?? {}),
            }),
            settings: input.includeSettings ? await buildProfileSettingsDto(input, definition) : null,
        }))),
    };
}

/**
 * 构造单个 profile 的 settings 编辑 DTO。
 */
async function buildProfileSettingsDto(input: {
    effective: EffectiveConfig;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    profiles: AgentProfileCatalog;
    query: ConfigWorkspaceQueryDto;
    settingsScope: "global" | "project";
}, definition: AgentCatalogItem): Promise<ConfigAgentProfileSettingsDto["agentProfiles"][number]["settings"]> {
    if (definition.loadStatus !== "loaded") {
        return null;
    }
    if (!definition.hasSettingsForm) {
        return null;
    }
    const profile = await input.profiles.get(definition.key).catch(() => null);
    if (!profile?.settingsForm) {
        return null;
    }
    const effectivePatch = normalizeAgentProfileSettings(input.effective.agent.profiles[definition.key]?.settings);
    const globalPatch = normalizeAgentProfileSettings(input.global.agent?.profiles?.[definition.key]?.settings);
    const projectPatch = normalizeAgentProfileSettings(input.project?.agent?.profiles?.[definition.key]?.settings);
    const ctx = {
        ...await lowCodeFormContext(definition.key, input.query, input.settingsScope, profile, effectivePatch),
        allowGlobalResourceKeys: input.settingsScope === "project",
    };
    const resolution = await resolveProfileSettings(profile, effectivePatch, ctx);
    const inheritedResolution = await resolveProfileSettings(profile, input.project ? globalPatch : {}, ctx);
    return {
        form: await resolveLowCodeForm(profile.settingsForm, ctx),
        value: resolution.value,
        inheritedValue: inheritedResolution.value,
        effectivePatch,
        globalPatch,
        projectPatch,
        issues: resolution.issues,
    };
}

/**
 * 校验写入请求里的 profile settings patch。
 */
async function assertProfileSettingsInput(
    profilesInput: Record<string, {settings?: LowCodeJsonObject; resourceMutations?: LowCodeResourceMutationDto[]}> | undefined,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog,
    inheritedProfilesInput?: Record<string, {settings?: LowCodeJsonObject}>,
    options: {includeResourceMutationFinalKeys?: boolean} = {},
    scope: "global" | "project" = "global",
): Promise<void> {
    if (!profilesInput) {
        return;
    }
    for (const [profileKey, profileConfig] of Object.entries(profilesInput)) {
        if (profileConfig.settings === undefined) {
            continue;
        }
        const profile = await profiles.get(profileKey).catch(() => null);
        if (!profile?.settingsForm) {
            if (Object.keys(profileConfig.settings).length === 0) {
                continue;
            }
            throw createError({
                statusCode: 400,
                message: `profile ${profileKey} 未声明 settingsForm，不能保存 settings。`,
            });
        }
        const settingsForValidation = inheritedProfilesInput
            ? {
                ...normalizeAgentProfileSettings(inheritedProfilesInput[profileKey]?.settings),
                ...normalizeAgentProfileSettings(profileConfig.settings),
            }
            : profileConfig.settings;
        const ctx = await lowCodeFormContext(profileKey, query, scope, profile, settingsForValidation);
        const resourceKeyView = options.includeResourceMutationFinalKeys
            ? await buildResourceMutationKeyView(profile.settingsForm, profileConfig.resourceMutations, ctx, settingsForValidation)
            : null;
        const validationCtx = {
            ...(resourceKeyView ? withResourceMutationKeyView(ctx, resourceKeyView) : ctx),
            allowGlobalResourceKeys: scope === "project",
        };
        const result = await validateLowCodeFormValue(
            profile.settingsForm,
            settingsForValidation,
            validationCtx,
        );
        const error = result.issues.find((issue) => issue.severity === "error");
        if (error) {
            throw createError({
                statusCode: 400,
                message: `profile ${profileKey} settings 校验失败：${error.message}`,
            });
        }
        if (scope === "project") {
            await assertProjectProfileResourceKeys(profile.settingsForm, profileConfig.settings, resourceKeyView ? withResourceMutationKeyView(ctx, resourceKeyView) : ctx);
        }
    }
}

async function applyProfileResourceMutations(
    profilesInput: Record<string, {settings?: LowCodeJsonObject; resourceMutations?: LowCodeResourceMutationDto[]}> | undefined,
    query: ConfigWorkspaceQueryDto,
    profiles: AgentProfileCatalog,
    inheritedProfilesInput?: Record<string, {settings?: LowCodeJsonObject}>,
    scope: "global" | "project" = "project",
): Promise<void> {
    if (!profilesInput) {
        return;
    }
    for (const [profileKey, profileConfig] of Object.entries(profilesInput)) {
        if (!profileConfig.resourceMutations?.length) {
            continue;
        }
        const profile = await profiles.get(profileKey).catch(() => null);
        if (!profile?.settingsForm) {
            throw createError({statusCode: 400, message: `profile ${profileKey} 未声明 settingsForm，不能保存资源。`});
        }
        const currentValues = {
            ...normalizeAgentProfileSettings(inheritedProfilesInput?.[profileKey]?.settings),
            ...normalizeAgentProfileSettings(profileConfig.settings),
        };
        const results = await applyLowCodeResourceMutations(
            profile.settingsForm,
            profileConfig.resourceMutations,
            await lowCodeFormContext(profileKey, query, scope, profile, currentValues),
            currentValues,
        );
        const issue = results.flatMap((result) => result.issues).find((item) => item.severity === "error");
        if (issue) {
            throw createError({statusCode: 400, message: `profile ${profileKey} 资源操作失败：${issue.message}`});
        }
    }
}

async function assertProjectProfileResourceKeys(
    form: LowCodeFormDefinition,
    settings: LowCodeJsonObject | undefined,
    ctx: LowCodeFormResolveContext,
): Promise<void> {
    if (!settings) {
        return;
    }
    for (const field of form.fields) {
        if (field.component !== "resource-preset" || !field.resource) {
            continue;
        }
        const current = readLowCodePath(settings, field.path);
        if (current === undefined || current === null || current === "") {
            continue;
        }
        if (typeof current !== "string") {
            continue;
        }
        const valid = await projectResourceKeyExists(field.resource, ctx, resourceKeyCandidates(field.resource, current));
        if (!valid) {
            throw createError({
                statusCode: 400,
                message: `profile ${ctx.profileKey} settings 校验失败：字段 ${field.label} 选择的资源只存在于全局库，请先复制到项目并选中。`,
            });
        }
    }
}

async function projectResourceKeyExists(
    resource: NonNullable<LowCodeFormDefinition["fields"][number]["resource"]>,
    ctx: LowCodeFormResolveContext,
    candidateKeys: readonly string[],
): Promise<boolean> {
    const mutationKeyResult = resourceMutationKeyResult(ctx, candidateKeys);
    if (mutationKeyResult !== null) {
        return mutationKeyResult;
    }
    if (!ctx.home) {
        return false;
    }
    try {
        if (resource.validateKey) {
            for (const key of candidateKeys) {
                if (await resource.validateKey(ctx, key)) {
                    return true;
                }
            }
            return false;
        }
        return (await resource.list(ctx)).some((option) => candidateKeys.includes(option.key));
    } catch {
        return false;
    }
}

function resourceMutationKeyResult(ctx: LowCodeFormResolveContext, candidateKeys: readonly string[]): boolean | null {
    if (!ctx.resourceMutationKeyView) {
        return null;
    }
    const normalizedKeys = candidateKeys.map(normalizeResourceKeyForView);
    if (!normalizedKeys.some((key) => ctx.resourceMutationKeyView!.knownKeys.has(key))) {
        return null;
    }
    return normalizedKeys.some((key) => ctx.resourceMutationKeyView!.finalKeys.has(key));
}

function resourceKeyCandidates(
    resource: NonNullable<LowCodeFormDefinition["fields"][number]["resource"]>,
    current: string,
): string[] {
    const candidateKeys = [current];
    if (!current.includes("/") && resource.createKeyPrefix && resource.createKeySuffix) {
        const suffix = resource.createKeySuffix;
        const slug = current.endsWith(suffix) ? current.slice(0, -suffix.length) : current;
        candidateKeys.push(`${resource.createKeyPrefix}${slug}${suffix}`);
    }
    return [...new Set(candidateKeys)];
}

/**
 * 按低代码表单点路径读取对象字段，用于 Project 显式覆盖校验。
 */
function readLowCodePath(value: LowCodeJsonObject, fieldPath: string): LowCodeJsonValue | undefined {
    const segments = fieldPath.split(".").filter(Boolean);
    let current: LowCodeJsonValue | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

/**
 * 根据 Config query 构造低代码 form 解析上下文。
 */
async function lowCodeFormContext(
    profileKey: string,
    query: ConfigWorkspaceQueryDto,
    scope: "global" | "project",
    profile?: {manifest: {version?: number}; home?: ProfileHomeDefinition; settingsForm?: LowCodeFormDefinition},
    values?: LowCodeJsonObject,
): Promise<LowCodeFormResolveContext> {
    const workspaceRoot = query.workspaceKind === "novel" ? WORKSPACE_CONTAINER_ROOT : USER_ASSETS_WORKSPACE_ROOT;
    const needsHome = profileNeedsHome(profile);
    const projectRoot = scope === "project" && query.workspaceKind === "novel" ? resolveProjectRootForProfileHome(query.projectPath) : null;
    const projectHome = projectRoot && profile && needsHome
        ? await ensureProfileHome({
            projectRoot,
            profileKey,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const globalHome = profile && needsHome
        ? await ensureGlobalProfileHome({
            workspaceRoot,
            profileKey,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const home = scope === "global" ? globalHome : projectHome;
    return {
        profileKey,
        scope,
        workspaceRoot,
        ...(query.projectPath ? {projectPath: query.projectPath} : {}),
        ...(values ? {values} : {}),
        ...(home ? {home} : {}),
        ...(scope === "project" && globalHome ? {globalHome} : {}),
    };
}

function profileNeedsHome(profile: {home?: ProfileHomeDefinition; settingsForm?: LowCodeFormDefinition} | undefined): boolean {
    return Boolean(profile?.home) || Boolean(profile?.settingsForm?.fields.some((field) => field.component === "resource-preset"));
}

async function buildResourceMutationKeyView(
    form: LowCodeFormDefinition,
    mutations: readonly LowCodeResourceMutationDto[] | undefined,
    ctx: LowCodeFormResolveContext,
    currentValues: LowCodeJsonObject,
): Promise<{knownKeys: Set<string>; finalKeys: Set<string>} | null> {
    if (!mutations?.length) {
        return null;
    }
    const results = await validateLowCodeResourceMutations(form, mutations, ctx, currentValues);
    const issue = results.flatMap((result) => result.issues).find((item) => item.severity === "error");
    if (issue) {
        throw createError({statusCode: 400, message: `profile ${ctx.profileKey} 资源操作失败：${issue.message}`});
    }
    const knownKeys = new Set<string>();
    const finalKeys = new Set<string>();
    const fieldPaths = new Set(mutations.map((mutation) => mutation.fieldPath));
    for (const fieldPath of fieldPaths) {
        const field = form.fields.find((item) => item.path === fieldPath);
        if (!field?.resource) {
            continue;
        }
        for (const option of await field.resource.list(ctx)) {
            knownKeys.add(normalizeResourceKeyForView(option.key));
        }
        const result = results.findLast((item) => item.fieldPath === fieldPath);
        for (const key of result?.finalKeys ?? []) {
            const normalizedKey = normalizeResourceKeyForView(key);
            knownKeys.add(normalizedKey);
            finalKeys.add(normalizedKey);
        }
    }
    return {knownKeys, finalKeys};
}

function withResourceMutationKeyView(
    ctx: LowCodeFormResolveContext,
    keyView: LowCodeResourceMutationKeyView,
): LowCodeFormResolveContext {
    if (!ctx.home || keyView.knownKeys.size === 0) {
        return ctx;
    }
    return {
        ...ctx,
        resourceMutationKeyView: keyView,
        home: {
            ...ctx.home,
            async exists(filePath) {
                const key = normalizeResourceKeyForView(filePath);
                if (keyView.knownKeys.has(key)) {
                    return keyView.finalKeys.has(key);
                }
                return ctx.home!.exists(filePath);
            },
        },
    };
}

function normalizeResourceKeyForView(filePath: string): string {
    return filePath.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function stripProfileResourceMutations(input: ProjectConfigDto): ProjectConfigDto {
    if (!input.agent?.profiles) {
        return input;
    }
    return {
        ...input,
        agent: {
            ...input.agent,
            profiles: Object.fromEntries(Object.entries(input.agent.profiles).map(([profileKey, profileConfig]) => ([
                profileKey,
                {
                    model: profileConfig.model,
                    ...(profileConfig.settings !== undefined ? {settings: profileConfig.settings} : {}),
                },
            ]))),
        },
    };
}

function buildDefaultProfileSettingsDto(input: {
    workspaceKind: WorkspaceRootKind;
    projectConfigAvailable: boolean;
    global: StoredGlobalConfig;
    project: StoredProjectConfig | null;
    catalog: Awaited<ReturnType<AgentProfileCatalog["snapshot"]>>;
}): ConfigDefaultProfileSettingsDto {
    const systemDefaultProfileKey = systemDefaultProfileKeyFor(input.workspaceKind);
    return {
        workspaceKind: input.workspaceKind,
        projectConfigAvailable: input.projectConfigAvailable,
        systemDefaultProfileKey,
        globalDefaultProfileKey: input.workspaceKind === USER_ASSETS_WORKSPACE_KIND
            ? input.global.agent?.defaultProfileKey?.userAssets ?? null
            : input.global.agent?.defaultProfileKey?.novel ?? null,
        projectDefaultProfileKey: input.project?.agent?.defaultProfileKey ?? null,
        effectiveProfileKey: resolveDefaultProfileKeyFromConfig(input.workspaceKind, input.global, input.project),
        profiles: input.catalog.profiles.map((profile) => ({
            profileKey: profile.key,
            name: profile.name,
            description: profile.description ?? null,
            loadStatus: profile.loadStatus,
        })),
    };
}

function resolveDefaultProfileKeyFromConfig(workspaceKind: WorkspaceRootKind, global: StoredGlobalConfig, project: StoredProjectConfig | null): string {
    const systemDefaultProfileKey = systemDefaultProfileKeyFor(workspaceKind);
    if (workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        return global.agent?.defaultProfileKey?.userAssets ?? systemDefaultProfileKey;
    }
    return project?.agent?.defaultProfileKey
        ?? global.agent?.defaultProfileKey?.novel
        ?? systemDefaultProfileKey;
}

function systemDefaultProfileKeyFor(workspaceKind: WorkspaceRootKind): string {
    return workspaceKind === USER_ASSETS_WORKSPACE_KIND ? "leader.assets" : "leader.default";
}

function maskSecret(value: string | null | undefined): {configured: boolean; maskedValue: string | null} {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
        return {
            configured: false,
            maskedValue: null,
        };
    }
    return {
        configured: true,
        maskedValue: normalized.length <= 8 ? "********" : `${normalized.slice(0, 4)}...${normalized.slice(-4)}`,
    };
}

function resolveSecretWrite(input: {previousValue: string; configured: boolean; value?: string}): string {
    if (input.value === undefined) {
        return input.previousValue;
    }
    return input.value.trim();
}

function normalizeGlobalModelsForWrite(
    models: NonNullable<GlobalConfigDto["models"]>,
    current: StoredGlobalConfig,
): NonNullable<StoredGlobalConfig["models"]> {
    return {
        default: models.default ?? null,
        providers: models.providers.map((provider): StoredProviderConfig => ({
            ...provider,
            api: provider.api,
            options: {
                ...provider.options,
                apiKey: resolveSecretWrite({
                    previousValue: findProviderApiKey(current, provider.id),
                    configured: provider.options.apiKey.configured,
                    value: provider.options.apiKey.value,
                }),
                requestOptions: normalizeJsonRecord(provider.options.requestOptions),
            } satisfies ModelProviderOptionsConfig,
            models: provider.models.map((model): ConfiguredModelConfig => ({
                name: model.name,
                id: model.id,
                group: model.group,
                enabled: model.enabled,
                provider: model.provider,
                api: model.api,
                baseUrl: model.baseUrl,
                reasoning: model.reasoning,
                input: model.input,
                maxTokens: model.maxTokens,
                cost: model.cost,
                compat: model.compat,
                contextWindowTokens: model.contextWindowTokens,
            })),
        })),
    };
}

function findProviderApiKey(config: StoredGlobalConfig, providerId: string): string {
    return config.models?.providers?.find((provider) => provider.id === providerId)?.options.apiKey ?? "";
}

const DEFAULT_GLOBAL_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS = 1536;

function normalizeGlobalEmbeddingForWrite(
    embedding: NonNullable<GlobalConfigDto["embedding"]>,
    current: StoredGlobalConfig,
): EmbeddingServiceConfig {
    return normalizeEmbeddingService({
        enabled: embedding.enabled,
        provider: embedding.provider,
        model: embedding.model ?? (embedding.enabled ? DEFAULT_GLOBAL_EMBEDDING_MODEL : null),
        dimensions: embedding.dimensions ?? (embedding.enabled ? DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS : null),
        apiKey: resolveSecretWrite({
            previousValue: current.embedding?.apiKey ?? "",
            configured: embedding.apiKey?.configured ?? false,
            value: embedding.apiKey?.value,
        }),
        baseURL: embedding.baseURL,
        timeoutMs: embedding.timeoutMs,
        requestOptions: normalizeJsonRecord(embedding.requestOptions),
    });
}

function normalizeGlobalWebForWrite(web: NonNullable<GlobalConfigDto["web"]>, current: StoredGlobalConfig): NonNullable<StoredGlobalConfig["web"]> {
    return {
        search: {
            order: web.search?.order,
            providers: {
                tavily: {
                    enabled: web.search?.providers?.tavily?.enabled,
                    apiKey: resolveSecretWrite({
                        previousValue: current.web?.search?.providers?.tavily?.apiKey ?? "",
                        configured: web.search?.providers?.tavily?.apiKey?.configured ?? false,
                        value: web.search?.providers?.tavily?.apiKey?.value,
                    }),
                    timeoutMs: web.search?.providers?.tavily?.timeoutMs,
                },
                brave: {
                    enabled: web.search?.providers?.brave?.enabled,
                    apiKey: resolveSecretWrite({
                        previousValue: current.web?.search?.providers?.brave?.apiKey ?? "",
                        configured: web.search?.providers?.brave?.apiKey?.configured ?? false,
                        value: web.search?.providers?.brave?.apiKey?.value,
                    }),
                    country: web.search?.providers?.brave?.country,
                    searchLang: web.search?.providers?.brave?.searchLang,
                    timeoutMs: web.search?.providers?.brave?.timeoutMs,
                },
            },
        },
        fetch: web.fetch,
    };
}

function normalizeJsonRecord(input: Record<string, unknown> | undefined): ModelProviderOptionsConfig["requestOptions"] {
    if (!input) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(input).filter((entry): entry is [string, ModelProviderOptionsConfig["requestOptions"][string]] => isJsonValue(entry[1])),
    );
}

function isJsonValue(value: unknown): value is ModelProviderOptionsConfig["requestOptions"][string] {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value === "object") {
        return Object.values(value).every(isJsonValue);
    }
    return false;
}

function assertProjectConfigDoesNotContainGlobalOnly(input: ProjectConfigDto): void {
    const record = input as Record<string, unknown>;
    if ("auth" in record) {
        throw createError({
            statusCode: 400,
            message: "Project Config 不能覆盖 auth 配置",
        });
    }
    const models = record.models as Record<string, unknown> | undefined;
    if (models && "providers" in models) {
        throw createError({
            statusCode: 400,
            message: "Project Config 不能覆盖 models.providers",
        });
    }
    const embedding = record.embedding as Record<string, unknown> | undefined;
    if (embedding && ("apiKey" in embedding || "baseURL" in embedding || "provider" in embedding || "enabled" in embedding || "timeoutMs" in embedding || "requestOptions" in embedding)) {
        throw createError({
            statusCode: 400,
            message: "Project Config 只能覆盖 embedding.model 和 embedding.dimensions",
        });
    }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function readJsonFileSync<T>(filePath: string): T | null {
    try {
        return JSON.parse(readFileSync(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf-8");
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string | null {
    const normalized = workspaceRoot?.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/g, "") ?? "";
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
        return null;
    }
    return normalized;
}

function resolveExternalWorkspaceRoot(workspaceRoot: string | undefined): string | null {
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
        return null;
    }
    const absoluteRoot = path.resolve(workspaceRoot);
    const repoWorkspaceRoot = path.resolve(process.cwd(), "workspace");
    const relativeToRepoWorkspace = path.relative(repoWorkspaceRoot, absoluteRoot);
    if (!relativeToRepoWorkspace || !relativeToRepoWorkspace.startsWith("..") && !path.isAbsolute(relativeToRepoWorkspace)) {
        return null;
    }
    return absoluteRoot;
}

function extractProjectSlug(projectPath: string): string {
    const normalized = projectPath.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (path.posix.isAbsolute(normalized) || normalized.includes("..")) {
        throw createError({statusCode: 400, message: "projectPath 必须形如 workspace/<project>"});
    }
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "workspace") {
        return parts[1] ?? "";
    }
    if (parts.length === 1 && parts[0]) {
        return parts[0];
    }
    throw createError({statusCode: 400, message: "projectPath 必须形如 workspace/<project>"});
}
