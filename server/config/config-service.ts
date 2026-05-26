import {readFileSync} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {
    USER_ASSETS_WORKSPACE_KIND,
    USER_ASSETS_WORKSPACE_ROOT,
    WORKSPACE_CONTAINER_ROOT,
    type WorkspaceRootKind,
} from "nbook/server/workspace-files/novel-workspace";
import {normalizeProjectPath, readProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {GlobalConfigDtoSchema} from "nbook/shared/dto/config.dto";
import type {
    ConfigAgentProfileSettingsDto,
    ConfigBootstrapDto,
    ConfigDefaultProfileSettingsDto,
    ConfigEditorSnapshotDto,
    ConfigModelSettingsDto,
    ConfigSnapshotDto,
    ConfigWorkspaceQueryDto,
    GlobalConfigDto,
    ProjectConfigDto,
} from "nbook/shared/dto/config.dto";
import {CONFIG_REGISTRY, CONFIG_VERSION} from "nbook/server/config/registry";
import {
    normalizeAgentProfileModelConfig,
    normalizeAgentProfiles,
    normalizeGlobalConfig,
    normalizeProjectConfig,
    resolveEffectiveConfig,
    serializeModelSettings,
} from "nbook/server/config/normalizer";
import type {
    AgentProfileConfig,
    ConfigTarget,
    ConfiguredModelConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
    StoredGlobalConfig,
    StoredProjectConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";
import {
    buildModelLabel,
    listEnabledModels,
} from "nbook/server/utils/model-settings";

const GLOBAL_CONFIG_PATH = path.resolve(process.cwd(), "workspace", ".nbook", "config.json");

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
        agentProfileSettings: buildConfigAgentProfileSettingsDto(effective, catalog.profiles.map((profile) => ({
            profileKey: profile.key,
            name: profile.name,
        }))),
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
    };
}

/**
 * 保存 Global Config。secret value 缺失时保留原值。
 */
export async function saveGlobalConfig(input: GlobalConfigDto, query: ConfigWorkspaceQueryDto): Promise<ConfigEditorSnapshotDto> {
    const current = await readGlobalConfigFile();
    const next = normalizeGlobalConfig({
        ...current,
        ...(input.auth !== undefined ? {auth: input.auth} : {}),
        ...(input.agent !== undefined ? {agent: input.agent} : {}),
        ...(input.ui !== undefined ? {ui: input.ui} : {}),
        ...(input.editor !== undefined ? {editor: input.editor} : {}),
        ...(input.models !== undefined ? {models: normalizeGlobalModelsForWrite(input.models, current)} : {}),
    });
    await writeJsonFile(GLOBAL_CONFIG_PATH, next);
    return readConfigEditorSnapshot(query);
}

/**
 * 保存 Project Config。包含 global-only 字段时直接拒绝。
 */
export async function saveProjectConfig(input: ProjectConfigDto, query: ConfigWorkspaceQueryDto): Promise<ConfigEditorSnapshotDto> {
    const target = await resolveConfigTarget(query);
    if (!target.projectConfigPath) {
        throw createError({
            statusCode: 400,
            message: "user-assets 入口没有独立 Project Config",
        });
    }
    assertProjectConfigDoesNotContainGlobalOnly(input);
    await writeJsonFile(target.projectConfigPath, normalizeProjectConfig(input as StoredProjectConfig));
    return readConfigEditorSnapshot(query);
}

/**
 * 读取 effective config，供后端运行路径直接使用。
 */
export async function loadEffectiveConfig(query: ConfigWorkspaceQueryDto = {workspaceKind: "user-assets"}): Promise<EffectiveConfig> {
    const {global, project} = await readConfigFiles(query);
    return resolveEffectiveConfig(global, project);
}

/**
 * 按 session metadata 中的 workspaceRoot 读取 effective config。
 *
 * Agent session 已经持久化 workspaceRoot，因此 invocation 不再依赖 HTTP 层继续传 projectPath。
 */
export async function loadEffectiveConfigForWorkspaceRoot(workspaceRoot: string | undefined): Promise<EffectiveConfig> {
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
    const projectPath = normalizeProjectPath(query.projectPath);
    await readProjectManifest(projectPath);
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
        models: {
            default: config.models?.default ?? null,
            providers: (config.models?.providers ?? []).map((provider) => ({
                ...provider,
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

function buildConfigAgentProfileSettingsDto(
    effective: EffectiveConfig,
    profileDefinitions: Array<{profileKey: string; name: string}>,
): ConfigAgentProfileSettingsDto {
    return {
        enabledModels: listEnabledModels(effective.models),
        agentProfiles: profileDefinitions.map((definition) => ({
            profileKey: definition.profileKey,
            name: definition.name,
            model: normalizeAgentProfileModelConfig(effective.agent.profiles[definition.profileKey]?.model),
        })),
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
