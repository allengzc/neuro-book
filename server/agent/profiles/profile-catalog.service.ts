import {createRequire} from "node:module";
import path from "node:path";
import type * as TypeScript from "typescript";
import {z, type ZodType} from "zod";
import type {AgentSystem} from "nbook/server/agent/agent-system";
import {
    normalizeUserProfileFilePath,
    previewProfileTemplate,
    readSystemProfileTemplateSource,
    readUserProfileTemplateSource,
    userProfileTemplateExists,
} from "nbook/server/agent/profile-templates/profile-template-service";
import type {RuntimeAgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {
    DynamicProfileError,
    DynamicProfileFile,
    DynamicProfileInspection,
} from "nbook/server/agent/profiles/profile-registry";
import type {
    AgentProfileCatalogItemDto,
    AgentProfileDetailDto,
    AgentProfileDetailRequestDto,
    AgentProfileIssueDto,
    AgentProfileManifestDto,
    AgentProfileSchemaDetailDto,
} from "nbook/shared/dto/agent-profile.dto";
import type {AgentThreadKind, ProfileKey} from "nbook/server/agent/types";
import type {JsonValue} from "nbook/server/agent/types";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;

type CatalogBuildContext = {
    inspection: DynamicProfileInspection;
    filesByProfileKey: Map<string, DynamicProfileFile>;
    errorsByProfileKey: Map<string, DynamicProfileError>;
    contractsByKey: Map<string, RuntimeAgentProfile>;
    profilesByKey: Map<string, RuntimeAgentProfile>;
};

/**
 * 列出合成后的 profile catalog。
 */
export async function listAgentProfileCatalog(agentSystem: AgentSystem): Promise<AgentProfileCatalogItemDto[]> {
    const context = await buildCatalogContext(agentSystem);
    const keys = new Set<string>([
        ...context.contractsByKey.keys(),
        ...context.profilesByKey.keys(),
        ...context.errorsByProfileKey.keys(),
    ]);

    const items = await Promise.all([...keys].map((profileKey) => buildCatalogItem(context, profileKey)));
    return items.sort((left, right) => {
        const kindCompare = String(left.kind ?? "").localeCompare(String(right.kind ?? ""));
        return kindCompare || left.profileKey.localeCompare(right.profileKey);
    });
}

/**
 * 读取 profile 详情，坏 TSX 也会返回源码与 issue。
 */
export async function readAgentProfileDetail(
    agentSystem: AgentSystem,
    request: AgentProfileDetailRequestDto,
): Promise<AgentProfileDetailDto> {
    const context = await buildCatalogContext(agentSystem);
    const profileKey = request.profileKey ?? resolveProfileKeyByFileName(context, request.fileName!);
    const catalogItem = await buildCatalogItem(context, profileKey);
    const fileName = catalogItem.fileName;
    const profile = context.profilesByKey.get(profileKey);
    const source = fileName ? await readProfileSource(catalogItem.source, fileName) : "";
    const staticPreview = source
        ? previewProfileTemplate({source, profile: profile as never})
        : {
            source,
            root: null,
            issues: [],
            messages: [],
            variables: [],
        };
    const issues = [
        ...staticPreview.issues.map((issue) => ({
            ...issue,
            code: "profile_template_parse",
            profileKey,
            fileName: fileName ?? undefined,
        })),
        ...catalogItem.issues,
    ];
    const manifest = buildManifest(context, profileKey);

    return {
        catalogItem,
        manifest,
        fileName,
        source,
        root: staticPreview.root,
        issues,
        variables: staticPreview.variables,
        allowedToolKeys: [...(profile?.allowedToolKeys ?? [])],
        inputSchema: buildSchemaDetail({
            source,
            schema: profile?.inputSchema ?? context.contractsByKey.get(profileKey)?.inputSchema ?? null,
            schemaName: "InputSchema",
            locked: catalogItem.schemaLocked,
            unavailableReason: catalogItem.loadStatus === "error" ? "profile 当前加载失败，修复源码后才能结构化编辑 schema。" : null,
        }),
        outputSchema: buildSchemaDetail({
            source,
            schema: profile?.outputSchema ?? context.contractsByKey.get(profileKey)?.outputSchema ?? null,
            schemaName: "OutputSchema",
            locked: catalogItem.schemaLocked,
            unavailableReason: catalogItem.loadStatus === "error" ? "profile 当前加载失败，修复源码后才能结构化编辑 schema。" : null,
        }),
    };
}

/**
 * 构造 catalog 查询上下文。
 */
async function buildCatalogContext(agentSystem: AgentSystem): Promise<CatalogBuildContext> {
    const inspection = await agentSystem.profileRegistry.inspectDynamicProfiles();
    return {
        inspection,
        filesByProfileKey: new Map(inspection.files.flatMap((file) => file.profileKey ? [[file.profileKey, file]] : [])),
        errorsByProfileKey: new Map(inspection.errors.map((error) => [error.profileKey ?? `invalid:${error.relativePath}`, error])),
        contractsByKey: new Map(inspection.contracts.map((profile) => [profile.key, profile])),
        profilesByKey: new Map(inspection.profiles.map((profile) => [profile.key, profile])),
    };
}

/**
 * 构造单个 catalog 项。
 */
async function buildCatalogItem(context: CatalogBuildContext, profileKey: string): Promise<AgentProfileCatalogItemDto> {
    const contract = context.contractsByKey.get(profileKey);
    const profile = context.profilesByKey.get(profileKey);
    const error = context.errorsByProfileKey.get(profileKey);
    const file = context.filesByProfileKey.get(profileKey)
        ?? (error ? context.inspection.files.find((item) => item.relativePath === error.relativePath) : undefined);
    const fileName = file?.relativePath ?? error?.relativePath ?? null;
    const source = file?.source ?? (contract ? "contract" : "user");
    const hasSystemFile = fileName ? await systemFileExists(fileName) : false;
    const hasUserFile = fileName ? file?.source === "user" || await userProfileTemplateExists(fileName) : false;
    const loadStatus = error ? "error" : profile ? "loaded" : "missing";
    const name = profile?.name ?? file?.name ?? contract?.name ?? profileKey;

    return {
        profileKey,
        kind: profile?.kind ?? file?.kind ?? contract?.kind ?? null,
        name,
        description: file?.description ?? null,
        fileName,
        source,
        overrideState: resolveOverrideState(source, hasSystemFile, hasUserFile),
        loadStatus,
        schemaLocked: Boolean(contract),
        canEdit: Boolean(fileName),
        canRestore: Boolean(fileName && hasSystemFile && hasUserFile),
        issues: error ? [toProfileIssue(error, profileKey, fileName ?? undefined)] : [],
    };
}

/**
 * 按文件名反查 profileKey。
 */
function resolveProfileKeyByFileName(context: CatalogBuildContext, fileName: string): string {
    const normalized = normalizeUserProfileFilePath(fileName);
    const file = context.inspection.files.find((item) => item.relativePath === normalized);
    if (file?.profileKey) {
        return file.profileKey;
    }
    const error = context.inspection.errors.find((item) => item.relativePath === normalized);
    return error?.profileKey ?? `invalid:${normalized}`;
}

/**
 * 读取 profile 源码。
 */
async function readProfileSource(source: AgentProfileCatalogItemDto["source"], fileName: string): Promise<string> {
    if (source === "user") {
        return readUserProfileTemplateSource(fileName);
    }
    if (source === "system") {
        return readSystemProfileTemplateSource(fileName);
    }
    return "";
}

/**
 * 构造 manifest 摘要。
 */
function buildManifest(context: CatalogBuildContext, profileKey: string): AgentProfileManifestDto | null {
    const profile = context.profilesByKey.get(profileKey);
    const file = context.filesByProfileKey.get(profileKey);
    const contract = context.contractsByKey.get(profileKey);
    const key = profile?.key ?? file?.profileKey ?? contract?.key;
    const kind = profile?.kind ?? file?.kind ?? contract?.kind;
    const name = profile?.name ?? file?.name ?? contract?.name;
    if (!key || !kind || !name) {
        return null;
    }
    return {
        key,
        kind,
        name,
        description: file?.description ?? null,
    };
}

/**
 * 判断系统同路径文件是否存在。
 */
async function systemFileExists(fileName: string): Promise<boolean> {
    try {
        await readSystemProfileTemplateSource(fileName);
        return true;
    } catch {
        return false;
    }
}

/**
 * 解析覆盖状态。
 */
function resolveOverrideState(
    source: AgentProfileCatalogItemDto["source"],
    hasSystemFile: boolean,
    hasUserFile: boolean,
): AgentProfileCatalogItemDto["overrideState"] {
    if (source === "contract") {
        return "contract_only";
    }
    if (source === "user" && hasSystemFile) {
        return "user_override";
    }
    if (source === "user" || hasUserFile) {
        return "user_only";
    }
    return "system";
}

/**
 * 构造 schema 详情。
 */
function buildSchemaDetail(input: {
    source: string;
    schema: ZodType | null;
    schemaName: "InputSchema" | "OutputSchema";
    locked: boolean;
    unavailableReason: string | null;
}): AgentProfileSchemaDetailDto {
    const sourceRange = input.source ? findExportedConstInitializerRange(input.source, input.schemaName) : null;
    if (input.locked) {
        return {
            jsonSchema: toJsonSchema(input.schema),
            editMode: "locked",
            reason: "builtin profile 的 schema contract 由源码静态类型锁定，用户覆盖只能改 prompt、helper 和 allowedToolKeys。",
            sourceRange,
        };
    }
    if (input.unavailableReason) {
        return {
            jsonSchema: toJsonSchema(input.schema),
            editMode: "unavailable",
            reason: input.unavailableReason,
            sourceRange,
        };
    }
    return {
        jsonSchema: toJsonSchema(input.schema),
        editMode: sourceRange ? "source" : "unavailable",
        reason: sourceRange ? "可通过源码局部替换 schema 声明。" : "未找到 exported const schema 声明，只能源码编辑。",
        sourceRange,
    };
}

/**
 * 将 Zod schema 转 JSON Schema。
 */
function toJsonSchema(schema: ZodType | null): Record<string, JsonValue> | null {
    if (!schema) {
        return null;
    }
    try {
        const result = z.toJSONSchema(schema, {
            unrepresentable: "any",
        });
        return result && typeof result === "object" ? JSON.parse(JSON.stringify(result)) as Record<string, JsonValue> : null;
    } catch {
        return null;
    }
}

/**
 * 定位 `export const InputSchema = ...` 的 initializer。
 */
function findExportedConstInitializerRange(source: string, constName: string): {start: number; end: number} | null {
    const sourceFile = ts.createSourceFile("profile.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found: {start: number; end: number} | null = null;
    const visit = (node: TypeScript.Node): void => {
        if (found) {
            return;
        }
        if (ts.isVariableStatement(node) && hasExportModifier(node)) {
            for (const declaration of node.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && declaration.name.text === constName && declaration.initializer) {
                    found = {
                        start: declaration.initializer.getStart(sourceFile),
                        end: declaration.initializer.getEnd(),
                    };
                    return;
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

/**
 * 判断节点是否有 export 修饰符。
 */
function hasExportModifier(node: TypeScript.Node): boolean {
    return Boolean(ts.getCombinedModifierFlags(node as TypeScript.Declaration) & ts.ModifierFlags.Export);
}

/**
 * 统一动态 profile 错误 DTO。
 */
function toProfileIssue(error: DynamicProfileError, profileKey: string, fileName?: string): AgentProfileIssueDto {
    return {
        severity: "error",
        message: error.message,
        code: error.code,
        profileKey,
        fileName,
        ...(process.env.NODE_ENV === "production" ? {} : {stack: error.stack}),
    };
}
