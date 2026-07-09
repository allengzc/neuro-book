import {readFile} from "node:fs/promises";
import {basename, relative, resolve, sep} from "node:path";
import {createError} from "h3";
import type {TSchema} from "typebox";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {AgentCatalogItem, AgentCatalogSnapshot, AgentProfile, AgentProfileIssue, ProfileCompactionPlan, ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {createVariableRegistryForProfile, createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";
import {resolveCompactionOptions} from "nbook/server/agent/harness/compaction";
import {createAssistantTextMessage, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, JsonValue, Message, Model} from "nbook/server/agent/messages/types";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {NeuroSessionContext, SessionSnapshot} from "nbook/server/agent/session/types";
import {buildAgentDialogueContent, type AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {VariableRegistry} from "nbook/server/agent/variables/registry";
import type {
    AgentProfileCatalogItemDto,
    AgentProfileDetailDto,
    AgentProfileDetailRequestDto,
    AgentProfileIssueDto,
    AgentProfilePreparePreviewDto,
    AgentProfilePreparePreviewRequestDto,
    AgentProfileSchemaDetailDto,
    AgentProfileVariableGroupDto,
} from "nbook/shared/dto/agent-profile.dto";
import {reportResultSchemaForProfile, reportSidecarResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {resolveRuntimeProfileSettings} from "nbook/server/agent/profiles/profile-settings";
import {createLayeredProfileHomeFacade, ensureGlobalProfileHome, ensureProfileHome, resolveProjectRootForProfileHome} from "nbook/server/agent/profiles/profile-home";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";
import {buildProfilePromptRoot} from "nbook/server/agent/profiles/profile-dsl-source-parser";
import {resolveSystemNbookRoot, resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {assertManagedProjectDataPlaneOpen} from "nbook/server/workspace-files/project-data-plane-guard";

/**
 * 列出 v3 Agent Profile catalog，并适配旧 profile 工作台 DTO。
 */
export async function listAgentProfileCatalog(profiles: AgentProfileCatalog): Promise<AgentProfileCatalogItemDto[]> {
    const snapshot = await profiles.snapshot({includeFileIssues: false});
    const loadedItems = snapshot.profiles.map((profile) => toCatalogItem(snapshot, profile));
    return loadedItems.sort((left, right) => {
        const sourceCompare = left.source.localeCompare(right.source);
        return sourceCompare || left.profileKey.localeCompare(right.profileKey);
    });
}

/**
 * 读取单个 v3 Agent Profile 的源码和 schema 摘要。
 */
export async function readAgentProfileDetail(
    profiles: AgentProfileCatalog,
    request: AgentProfileDetailRequestDto,
): Promise<AgentProfileDetailDto> {
    const snapshot = await profiles.snapshot();
    const catalog = await listAgentProfileCatalog(profiles);
    const catalogItem = resolveCatalogItem(catalog, request);
    const profile = snapshot.profiles.find((item) => item.key === catalogItem.profileKey);
    const source = profile?.sourcePath ? await readFile(profile.sourcePath, "utf-8") : "";
    const runtimeProfile = catalogItem.loadStatus === "loaded" ? await profiles.get(catalogItem.profileKey) : null;

    return {
        catalogItem,
        manifest: profile
            ? {
                key: profile.key,
                kind: "agent",
                name: profile.name,
                description: profile.description ?? null,
            }
            : null,
        fileName: catalogItem.fileName,
        source,
        issues: catalogItem.issues,
        variables: buildProfileVariableGroups(profile),
        toolKeys: runtimeProfile ? [...runtimeProfile.rootToolKeys] : [],
        initialSchema: buildSchemaDetail({
            schema: profile?.initialSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "InitialSchema",
        }),
        payloadSchema: buildSchemaDetail({
            schema: profile?.payloadSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "PayloadSchema",
        }),
        outputSchema: buildSchemaDetail({
            schema: profile?.outputSchema ?? null,
            locked: catalogItem.schemaLocked,
            sourceAvailable: Boolean(source),
            label: "OutputSchema",
        }),
        reportResultSchema: runtimeProfile && runtimeProfile.rootToolKeys.includes("report_result")
            ? cloneJsonObject(reportResultSchemaForProfile(runtimeProfile))
            : null,
        reportSidecarResultSchema: runtimeProfile && runtimeProfile.rootToolKeys.includes("report_sidecar_result")
            ? cloneJsonObject(reportSidecarResultSchemaForProfile(runtimeProfile))
            : null,
        root: buildSystemPromptRoot(source),
    };
}

/**
 * 调用真实 profile.prepare，给 TSX Profile 工作台生成消息预览。
 */
export async function previewAgentProfilePrepare(
    harness: NeuroAgentHarness,
    request: AgentProfilePreparePreviewRequestDto,
): Promise<AgentProfilePreparePreviewDto> {
    const profile = await harness.profiles.get(request.profileKey);
    const initial = harness.profiles.parseInitial(profile, buildPreviewInitial(request));
    const previewSnapshot = request.sessionId ? await harness.repo.readSession(Number(request.sessionId)).catch(() => null) : null;
    const sessionContext = previewSnapshot ? harness.repo.reduce(previewSnapshot) : await buildPreviewSession(harness, request);
    const session = createProfilePreviewSessionFacade(harness, request.profileKey, initial, previewSnapshot, sessionContext);
    const catalog = await harness.profiles.snapshot();
    const skills = await harness.skills.list();
    const effectiveConfig = await loadPreviewEffectiveConfig(sessionContext);
    const needsHome = profileNeedsHome(profile);
    const projectRoot = resolveProjectRootForProfileHome(sessionContext.projectPath);
    if (projectRoot && needsHome) {
        assertManagedProjectDataPlaneOpen(sessionContext.projectPath);
    }
    const globalHome = needsHome
        ? await ensureGlobalProfileHome({
            workspaceRoot: sessionContext.workspaceRoot,
            profileKey: profile.manifest.key,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const projectHome = projectRoot && needsHome
        ? await ensureProfileHome({
            projectRoot,
            profileKey: profile.manifest.key,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        })
        : undefined;
    const home = projectHome ? createLayeredProfileHomeFacade(projectHome, globalHome) : globalHome;
    const settings = await resolveRuntimeProfileSettings(profile, effectiveConfig.agent.profiles[request.profileKey]?.settings, {
        profileKey: request.profileKey,
        scope: sessionContext.projectPath ? "project" : "global",
        workspaceRoot: sessionContext.workspaceRoot,
        ...(sessionContext.projectPath ? {projectPath: sessionContext.projectPath} : {}),
        ...(home ? {home, allowGlobalResourceKeys: true} : {}),
    });

    try {
        const prepared = await profile.prepare!({
            session,
            initial,
            settings: settings as never,
            ...(home ? {home} : {}),
            vars: createProfileVariableAccessor({
                repo: harness.repo,
                snapshot: previewSnapshot ?? previewSessionSnapshot(request.profileKey, sessionContext),
                registry: await createPreviewVariableRegistry(profile, sessionContext.workspaceRoot),
                dryRun: true,
            }),
            catalog,
            skills,
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: sessionContext.messages.filter((message) => message.role === "user").length,
            },
        });
        const historyMessages = prepared.historyInitMessages ?? [];
        const modelContextAppendingMessages = prepared.modelContextAppendingMessages ?? [];
        const explicitAppendingMessages = prepared.appendingMessages ?? [];
        const appendingMessages = [
            ...modelContextAppendingMessages,
            ...explicitAppendingMessages,
        ];
        const modelContextMessages = prepared.modelContextMessages ?? [];
        const historyMessagesForReact = sessionContext.messages.length === 0 ? historyMessages : [];
        const finalMessages = [
            ...sessionContext.messages,
            ...historyMessagesForReact,
            ...appendingMessages,
            ...modelContextMessages,
        ];
        const messages = [
            ...prepared.systemPrompt ? [systemPromptPreviewMessage(prepared.systemPrompt)] : [],
            ...historyMessages.map((message) => toPreviewMessage(message, "history")),
            ...modelContextAppendingMessages.map((message) => toPreviewMessage(message, "modelContextAppending")),
            ...explicitAppendingMessages.map((message) => toPreviewMessage(message, "appending")),
            ...modelContextMessages.map((message) => toPreviewMessage(message, "modelContext")),
            ...profile.compaction ? [compactionPreviewMessage(profile.compaction, session.model)] : [],
            ...finalMessages.map((message) => toPreviewMessage(message, "reactMessages")),
            ...(prepared.stateWrites ?? []).map((write) => ({
                role: "custom",
                text: JSON.stringify(write, null, 2),
                source: "stateWrites",
            })),
        ];

        return {
            profileKey: request.profileKey,
            ok: true,
            issues: [],
            messages,
            persistedMessageCount: historyMessages.length + appendingMessages.length,
            variables: buildProfileVariableGroups(catalog.profiles.find((item) => item.key === request.profileKey), profile),
            reportResultSchema: profile.rootToolKeys.includes("report_result")
                ? cloneJsonObject(reportResultSchemaForProfile(profile))
                : null,
            reportSidecarResultSchema: profile.rootToolKeys.includes("report_sidecar_result")
                ? cloneJsonObject(reportSidecarResultSchemaForProfile(profile))
                : null,
        };
    } catch (error) {
        return {
            profileKey: request.profileKey,
            ok: false,
            issues: [{
                severity: "error",
                message: error instanceof Error ? error.message : String(error),
                code: "prepare_failed",
                profileKey: request.profileKey,
            }],
            messages: [],
            persistedMessageCount: 0,
            variables: buildProfileVariableGroups(catalog.profiles.find((item) => item.key === request.profileKey), profile),
            reportResultSchema: profile.rootToolKeys.includes("report_result")
                ? cloneJsonObject(reportResultSchemaForProfile(profile))
                : null,
            reportSidecarResultSchema: profile.rootToolKeys.includes("report_sidecar_result")
                ? cloneJsonObject(reportSidecarResultSchemaForProfile(profile))
                : null,
        };
    }
}

function profileNeedsHome(profile: AgentProfile): boolean {
    return Boolean(profile.home) || Boolean(profile.settingsForm?.fields.some((field) => field.component === "resource-preset"));
}

/**
 * 将 v3 catalog item 映射为前端工作台 catalog DTO。
 */
function toCatalogItem(snapshot: AgentCatalogSnapshot, profile: AgentCatalogItem): AgentProfileCatalogItemDto {
    const fileName = profile.sourcePath ? relativeProfilePath(profile.sourcePath, profile.source) : null;
    const issues = snapshot.issues
        .filter((issue) => issue.profileKey === profile.key || issue.sourcePath === profile.sourcePath)
        .map((issue) => toProfileIssueDto(issue, profile.key, fileName));
    const source = profile.source === "memory" ? "contract" : profile.source;

    return {
        profileKey: profile.key,
        kind: "agent",
        name: profile.name,
        description: profile.description ?? null,
        fileName,
        source,
        overrideState: resolveOverrideState(profile),
        loadStatus: profile.loadStatus,
        schemaLocked: profile.builtin,
        canEdit: source === "user" && Boolean(fileName),
        canRestore: false,
        issues,
    };
}

/**
 * 根据 profileKey 或 fileName 定位 catalog 项。
 */
function resolveCatalogItem(catalog: AgentProfileCatalogItemDto[], request: AgentProfileDetailRequestDto): AgentProfileCatalogItemDto {
    const item = request.profileKey
        ? catalog.find((profile) => profile.profileKey === request.profileKey)
        : catalog.find((profile) => profile.fileName === request.fileName);
    if (!item) {
        throw createError({
            statusCode: 404,
            message: `未找到 agent profile: ${request.profileKey ?? request.fileName}`,
        });
    }
    return item;
}

/**
 * 生成 profile schema 详情。v3 第一版只读展示，不重接低代码 schema 改写。
 */
function buildSchemaDetail(input: {
    schema: TSchema | null;
    locked: boolean;
    sourceAvailable: boolean;
    label: "InitialSchema" | "PayloadSchema" | "OutputSchema";
}): AgentProfileSchemaDetailDto {
    if (input.locked) {
        return {
            jsonSchema: cloneJsonObject(input.schema),
            editMode: "locked",
            reason: "builtin profile 的 Initial/Payload/Output schema 由静态 contract 锁定。",
            sourceRange: null,
        };
    }
    return {
        jsonSchema: cloneJsonObject(input.schema),
        editMode: input.sourceAvailable ? "source" : "unavailable",
        reason: input.sourceAvailable
            ? `${input.label} 需要在 TSX 源码中编辑；Schema Builder 会在新 profile 工作台中重接。`
            : `当前 profile 没有可读取源码，无法编辑 ${input.label}。`,
        sourceRange: null,
    };
}

/**
 * 构造预览用 session context。传 sessionId 时复用真实 session，否则用请求中的临时历史。
 */
async function buildPreviewSession(harness: NeuroAgentHarness, request: AgentProfilePreparePreviewRequestDto): Promise<NeuroSessionContext> {
    if (request.sessionId) {
        const snapshot = await harness.repo.readSession(Number(request.sessionId));
        return harness.repo.reduce(snapshot);
    }
    return {
        systemPrompt: "",
        messages: (request.historyMessages ?? []).map(toPreviewHistoryMessage),
        model: null,
        thinkingLevel: "off",
        profileKey: request.profileKey,
        workspaceRoot: resolve(process.cwd(), "workspace"),
        customState: {},
        linkedAgents: [],
        archived: false,
        agentMode: "normal",
    };
}

function createProfilePreviewSessionFacade(
    harness: NeuroAgentHarness,
    profileKey: string,
    initial: JsonValue,
    snapshot: SessionSnapshot | null,
    context: NeuroSessionContext,
): ProfilePrepareContext["session"] {
    const facade: ProfilePrepareContext["session"] = {
        ...context,
        read: async (sessionId) => {
            if (typeof sessionId === "number" && sessionId > 0) {
                const realSnapshot = await harness.repo.readSession(sessionId);
                return {
                    snapshot: realSnapshot,
                    context: harness.repo.reduce(realSnapshot),
                };
            }
            return {
                snapshot: snapshot ?? previewSessionSnapshot(profileKey, context),
                context,
            };
        },
        agentDialogueContent: async (contentInput = {}): Promise<AgentDialogueContent> => {
            const sourceSnapshot = contentInput.snapshot
                ?? (typeof contentInput.sessionId === "number" && contentInput.sessionId > 0
                    ? await harness.repo.readSession(contentInput.sessionId)
                    : snapshot ?? previewSessionSnapshot(profileKey, context));
            return buildAgentDialogueContent({
                repo: harness.repo,
                snapshot: sourceSnapshot,
                summarizerProfileKey: contentInput.profileKey ?? profileKey,
                summarizerInput: contentInput.initial ?? initial,
            });
        },
    };
    return facade;
}

/**
 * 请求 initial 优先，其次用 initialOverrides 的自由文本字段构造 JSON 对象。
 */
function buildPreviewInitial(request: AgentProfilePreparePreviewRequestDto): JsonValue {
    if (request.initial !== undefined) {
        return request.initial as JsonValue;
    }
    return JSON.parse(JSON.stringify(request.initialOverrides ?? {})) as JsonValue;
}

/**
 * 将工作台临时历史转换为 v3 message。v3 不允许 SystemMessage，因此 system 作为 user 文本预览。
 */
function toPreviewHistoryMessage(input: {role: "system" | "human" | "assistant"; text: string}): Message {
    if (input.role === "assistant") {
        return createAssistantTextMessage({text: input.text});
    }
    return createUserMessage({
        text: input.role === "system" ? `[system preview]\n${input.text}` : input.text,
    });
}

/**
 * 将 v3 Message 映射到 profile 工作台预览消息。
 */
function toPreviewMessage(message: AgentMessage, source: string): AgentProfilePreparePreviewDto["messages"][number] {
    if (message.role === "assistant") {
        return {
            role: message.role,
            text: messageText(message as Message),
            source,
            toolCalls: message.content
                .filter((block) => block.type === "toolCall")
                .map((block) => ({
                    id: block.id,
                    name: block.name,
                    argsText: JSON.stringify(block.arguments ?? {}, null, 2),
                })),
        };
    }
    if (message.role === "custom") {
        return {
            role: "custom",
            text: JSON.stringify(message, null, 2),
            source,
        };
    }
    return {
        role: message.role,
        text: messageText(message as Message),
        source,
    };
}

/**
 * systemPrompt 在 v3 中是独立字段，预览时作为只读 system-prompt 卡片展示。
 */
function systemPromptPreviewMessage(systemPrompt: string): AgentProfilePreparePreviewDto["messages"][number] {
    return {
        role: "systemPrompt",
        text: systemPrompt,
        source: "systemPrompt",
    };
}

/**
 * Compaction policy 在工作台预览中作为独立配置卡片展示。
 */
function compactionPreviewMessage(compaction: ProfileCompactionPlan, model: NeuroSessionContext["model"]): AgentProfilePreparePreviewDto["messages"][number] {
    const options = resolveCompactionOptions(compaction, model ?? PREVIEW_COMPACTION_MODEL);
    return {
        role: "compaction",
        text: JSON.stringify({
            enabled: options.enabled,
            triggerPercent: options.triggerPercent ?? null,
            triggerTokens: options.triggerTokens ?? null,
            reserveTokens: options.reserveTokens,
            keepRecentTokens: options.keepRecentTokens,
            promptSource: options.promptSource,
            summaryPrefixSource: options.summaryPrefixSource,
        }, null, 2),
        source: "compaction",
    };
}

const PREVIEW_COMPACTION_MODEL = {
    id: "preview",
    name: "Preview",
    api: "openai-completions",
    provider: "custom",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_000,
} satisfies Model<any>;

/**
 * 工作台变量面板先展示 profile schema 摘要。
 */
function buildProfileVariableGroups(profile: AgentCatalogItem | undefined, runtimeProfile?: AgentProfile): AgentProfileVariableGroupDto[] {
    if (!profile) {
        return [];
    }
    const groups: AgentProfileVariableGroupDto[] = [{
        group: "Profile Schema",
        items: [
            {
                label: "InitialSchema",
                value: "initialSchema",
                path: "initialSchema",
                token: "{{initialSchema}}",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.initialSchema),
            },
            {
                label: "PayloadSchema",
                value: "payloadSchema",
                path: "payloadSchema",
                token: "{{payloadSchema}}",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.payloadSchema),
            },
            {
                label: "OutputSchema",
                value: "outputSchema",
                path: "outputSchema",
                token: "{{outputSchema}}",
                editable: false,
                valueType: "jsonSchema",
                source: "profile",
                schema: cloneJsonObject(profile.outputSchema),
            },
        ],
    }];
    if (runtimeProfile) {
        const catalog = createVariableRegistryForProfile(runtimeProfile).catalog();
        const variableGroups = [
            {namespace: "client", variables: catalog.clientVariables},
            {namespace: "global", variables: catalog.globalVariables},
            {namespace: "project", variables: catalog.projectVariables},
            {namespace: "session", variables: catalog.sessionVariables},
        ] as const;
        groups.push({
            group: "Variable Registry",
            items: variableGroups.flatMap(({namespace, variables}) => Object.entries(variables).map(([key, item]) => {
                const fullPath = `${namespace}.${key}`;
                return {
                    label: fullPath,
                    value: key,
                    path: fullPath,
                    token: `<VariableSchema paths={["${fullPath}"]} />`,
                    editable: false,
                    valueType: "jsonSchema",
                    source: "runtime",
                    schema: cloneJsonObject(item),
                };
            })),
        });
    }
    return groups;
}

async function createPreviewVariableRegistry(profile: AgentProfile, workspaceRoot: string): Promise<VariableRegistry> {
    return createVariableRegistryForSession({profile, workspaceRoot, currentProjectWorkspace: null});
}

function previewSessionSnapshot(profileKey: string, session: NeuroSessionContext): SessionSnapshot {
    return {
        metadata: {
            sessionId: -1,
            profileKey,
            initial: {},
            workspaceRoot: session.workspaceRoot,
            workspaceKey: "preview",
            createdAt: Date.now(),
        },
        entries: [],
        leafId: null,
    };
}

/**
 * 工作台 prepare 预览应尽量复用真实运行的 profile settings。
 */
async function loadPreviewEffectiveConfig(session: Pick<NeuroSessionContext, "workspaceRoot" | "projectPath">) {
    const {loadEffectiveConfigForAgentRuntime} = await import("nbook/server/config/config-service");
    return loadEffectiveConfigForAgentRuntime({
        workspaceRoot: session.workspaceRoot,
        ...(session.projectPath ? {projectPath: session.projectPath} : {}),
    });
}

function cloneJsonObject(value: unknown): Record<string, JsonValue> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/**
 * 解析 profile 覆盖状态。
 */
function resolveOverrideState(profile: AgentCatalogItem): AgentProfileCatalogItemDto["overrideState"] {
    if (profile.source === "memory") {
        return "contract_only";
    }
    if (profile.source === "user") {
        return "user_only";
    }
    return "system";
}

/**
 * 统一 issue DTO。
 */
function toProfileIssueDto(issue: AgentProfileIssue, profileKey: string, fileName: string | null): AgentProfileIssueDto {
    return {
        severity: issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "system_profile_shadowed" || issue.code === "source_stale" || issue.code === "dependency_stale" || issue.code === "not_compiled" || issue.code === "compile_stale" ? "warning" : "error",
        message: issue.message,
        code: issue.code,
        profileKey: issue.profileKey ?? profileKey,
        fileName: fileName ?? undefined,
    };
}

/**
 * 计算 profile root 相对路径，保持前端文件选择器的 fileName 语义。
 */
function relativeProfilePath(sourcePath: string, source: AgentCatalogItem["source"] | AgentProfileIssue["source"]): string {
    const root = source === "user" ? defaultUserProfileRoot() : source === "system" ? defaultSystemProfileRoot() : null;
    if (!root) {
        return basename(sourcePath);
    }
    return relative(root, sourcePath).split(sep).join("/");
}

function defaultSystemProfileRoot(): string {
    return resolve(resolveSystemNbookRoot(), "agent", "profiles");
}

function defaultUserProfileRoot(): string {
    return resolve(resolveUserNbookRoot(), "agent", "profiles");
}

/**
 * 为旧三栏 UI 提供一个源码优先的 ProfilePrompt 可视化树。
 */
function parseProfilePromptTree(source: string, fileName: string | null): ProfileTemplateNodeDto | null {
    if (!fileName || !/\.(tsx|ts|jsx|js)$/.test(fileName)) {
        return null;
    }
    try {
        return buildProfilePromptRoot(source);
    } catch {
        return null;
    }
}
export function buildSystemPromptRoot(source: string): ProfileTemplateNodeDto | null {
    return buildProfilePromptRoot(source);
}
