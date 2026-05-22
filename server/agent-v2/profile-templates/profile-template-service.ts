import {mkdir, readdir, readFile, stat, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path, {basename, resolve} from "node:path";
import {createError} from "h3";
import type * as TypeScript from "typescript";
import {z, type ZodType} from "zod";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {
    CreateUserProfileTemplateRequestDto,
    ProfileTemplateExpressionValue,
    ProfileTemplateDetailDto,
    ProfileTemplateIssueDto,
    ProfileTemplateNodeDto,
    ProfileTemplatePreviewDto,
    ProfileTemplatePreviewMessageDto,
    ProfileTemplatePropValue,
    ProfileTemplateSummaryDto,
    ProfileTemplateVariableGroupDto,
    ProfileTemplateVariableItemDto,
} from "nbook/shared/dto/profile-template.dto";
import type {AgentProfileSchemaFieldDto} from "nbook/shared/dto/agent-profile.dto";
import {
    AgentTaskListSchema,
    type AgentVariableScope,
    type JsonValue,
    type ProfileKey,
} from "nbook/server/agent/types";

const TEMPLATE_DIR = resolve(process.cwd(), "server/agent/profiles/templates");
const USER_PROFILE_DIR = resolve(process.cwd(), "workspace/.nbook/assets/agent/profiles");
const SYSTEM_PROFILE_DIR = resolve(process.cwd(), "assets/agent/profiles");
const BUILTIN_LEADER_PROFILE_FILE = "builtin/leader-default.profile.tsx";
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;
const JsonObjectSchema = z.record(z.string(), z.json());
const IdeVariableSchema = z.object({
    panel: z.string().nullable(),
    activePanel: z.string().nullable(),
    theme: z.string().nullable(),
    extra: JsonObjectSchema,
});
const StudioVariableSchema = z.object({
    novelId: z.string().nullable(),
    selectedChapterId: z.string().nullable(),
    previousSelectedChapterId: z.string().nullable(),
    currentChapterTitle: z.string().nullable(),
    previousChapterTitle: z.string().nullable(),
    currentChapterLabel: z.string().nullable(),
    previousChapterLabel: z.string().nullable(),
    workspace: z.string().nullable(),
    workspaceKind: z.enum(["novel", "user-assets"]).nullable(),
    didSwitchChapter: z.boolean(),
    selectionVersion: z.number().nullable(),
    extra: JsonObjectSchema,
});
const AgentThreadStatusSchema = z.enum(["idle", "running", "waiting_user", "completed", "stopped", "failed"]);
const AgentThreadVariableSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    status: AgentThreadStatusSchema,
});
const AgentSubagentVariableSchema = z.object({
    id: z.string(),
    title: z.string(),
    profileKey: z.string(),
    status: AgentThreadStatusSchema,
});
const AgentVariableSchema = z.object({
    thread: AgentThreadVariableSchema,
    profileKey: z.string(),
    kind: z.enum(["leader", "subagent"]),
    tools: z.array(z.string()),
    subagents: z.array(AgentSubagentVariableSchema),
    tasks: AgentTaskListSchema.nullable(),
});
const RuntimePreviewSchema = z.object({
    thread: z.object({
        id: z.string().nullable(),
        status: AgentThreadStatusSchema.nullable(),
    }),
    profile: z.object({
        key: z.string().nullable(),
        kind: z.enum(["leader", "subagent"]).nullable(),
        name: z.string().nullable(),
    }),
});
const COMPONENT_NAMES = new Set([
    "ProfilePrompt",
    "HistorySet",
    "DynamicSet",
    "AppendingSet",
    "Text",
    "Message",
    "AIMessage",
    "ToolCall",
    "Reminder",
    "Watch",
    "If",
    "SkillCatalog",
    "ActivatedSkills",
]);

type ParsedTemplate = {
    root: ProfileTemplateNodeDto | null;
    issues: ProfileTemplateIssueDto[];
    promptRange: SourceRange | null;
};

type ParseContext = {
    jsxBindings: Map<string, TypeScript.Expression>;
    inlineTextDepth?: number;
};

type PreviewContext = {
    scope?: AgentVariableScope;
    inputOverrides?: Record<string, JsonValue>;
    profile?: AgentProfile<ProfileKey>;
};

type SourceRange = {
    start: number;
    end: number;
};

/**
 * 列出内置 profile 模板。
 */
export async function listProfileTemplates(): Promise<ProfileTemplateSummaryDto[]> {
    const entries = await readdir(TEMPLATE_DIR, {withFileTypes: true});
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
        .map((entry) => ({
            name: entry.name.replace(/\.tsx$/, ""),
            fileName: entry.name,
            profileKey: null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 列出用户 assets 中可编辑的动态 profile。
 */
export async function listUserProfileTemplates(): Promise<ProfileTemplateSummaryDto[]> {
    const entries = await listProfileFiles(USER_PROFILE_DIR);
    return entries.map((entry) => ({
        name: entry.relativePath.replace(/\.profile\.tsx$/, ""),
        fileName: entry.relativePath,
        profileKey: null,
    }));
}

/**
 * 读取用户 assets profile 根目录。
 */
export function userProfileRoot(): string {
    return USER_PROFILE_DIR;
}

/**
 * 读取系统 assets profile 根目录。
 */
export function systemProfileRoot(): string {
    return SYSTEM_PROFILE_DIR;
}

/**
 * 公开 profile 文件路径归一化，供 profile catalog 复用同一越界规则。
 */
export function normalizeUserProfileFilePath(filePath: string): string {
    return normalizeProfileFilePath(filePath);
}

/**
 * 公开读取用户 profile 源码。
 */
export async function readUserProfileTemplateSource(filePath: string): Promise<string> {
    return readFile(resolveUserProfilePath(normalizeProfileFilePath(filePath)), "utf-8");
}

/**
 * 公开读取系统 profile 源码。
 */
export async function readSystemProfileTemplateSource(filePath: string): Promise<string> {
    return readFile(resolveSystemProfilePath(normalizeProfileFilePath(filePath)), "utf-8");
}

/**
 * 判断用户 assets 中是否存在某个 profile 文件。
 */
export async function userProfileTemplateExists(filePath: string): Promise<boolean> {
    try {
        const fileStat = await stat(resolveUserProfilePath(normalizeProfileFilePath(filePath)));
        return fileStat.isFile();
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/**
 * 确保用户 assets 中存在默认 leader profile 覆盖文件。
 */
export async function ensureDefaultUserProfileTemplates(): Promise<"copied" | "skipped"> {
    const targetPath = resolveUserProfilePath(BUILTIN_LEADER_PROFILE_FILE);
    await mkdir(path.dirname(targetPath), {recursive: true});
    try {
        await writeFile(targetPath, await readSystemProfileTemplateSource(BUILTIN_LEADER_PROFILE_FILE), {
            encoding: "utf-8",
            flag: "wx",
        });
        return "copied";
    } catch (error) {
        if (isFileExistsError(error)) {
            return "skipped";
        }
        throw error;
    }
}

/**
 * 在用户 assets 中创建一个新的动态 profile。
 */
export async function createUserProfileTemplate(input: CreateUserProfileTemplateRequestDto): Promise<ProfileTemplateDetailDto> {
    const normalizedInput = normalizeNewProfileInput(input);
    const absolutePath = resolveUserProfilePath(normalizedInput.fileName);
    await mkdir(path.dirname(absolutePath), {recursive: true});
    await writeFile(absolutePath, generateUserProfileSource(normalizedInput), {
        encoding: "utf-8",
        flag: "wx",
    });
    return readUserProfileTemplate(normalizedInput.fileName);
}

/**
 * 读取模板详情。
 */
export async function readProfileTemplate(name: string): Promise<ProfileTemplateDetailDto> {
    const fileName = normalizeTemplateFileName(name);
    const source = await readFile(resolveTemplatePath(fileName), "utf-8");
    const parsed = parseProfileTemplateSource(source);
    return {
        name: fileName.replace(/\.tsx$/, ""),
        fileName,
        source,
        root: parsed.root,
        issues: parsed.issues,
        variables: buildVariableCatalog(),
    };
}

/**
 * 读取用户 assets 中的动态 profile 详情。
 */
export async function readUserProfileTemplate(filePath: string): Promise<ProfileTemplateDetailDto> {
    const normalizedPath = normalizeProfileFilePath(filePath);
    const source = await readFile(resolveUserProfilePath(normalizedPath), "utf-8");
    const parsed = parseProfileTemplateSource(source);
    return {
        name: normalizedPath.replace(/\.profile\.tsx$/, ""),
        fileName: normalizedPath,
        source,
        root: parsed.root,
        issues: parsed.issues,
        variables: buildVariableCatalog(),
    };
}

/**
 * 保存模板源码或结构化树。
 */
export async function saveProfileTemplate(name: string, input: {
    source?: string;
    root?: ProfileTemplateNodeDto;
}): Promise<ProfileTemplateDetailDto> {
    const fileName = normalizeTemplateFileName(name);
    const source = input.source ?? generateProfileTemplateSource(fileName.replace(/\.tsx$/, ""), input.root);
    const parsed = parseProfileTemplateSource(source);
    if (parsed.issues.some((issue) => issue.severity === "error")) {
        throw createError({
            statusCode: 400,
            message: "模板校验失败",
            data: parsed.issues,
        });
    }
    await writeFile(resolveTemplatePath(fileName), source, "utf-8");
    return readProfileTemplate(fileName);
}

/**
 * 保存用户 assets 中的动态 profile。
 * 传入 root 时只替换 buildPrompt 返回的 ProfilePrompt JSX，保留其它源码区域。
 */
export async function saveUserProfileTemplate(filePath: string, input: {
    source?: string;
    root?: ProfileTemplateNodeDto;
}): Promise<ProfileTemplateDetailDto> {
    const normalizedPath = normalizeProfileFilePath(filePath);
    const absolutePath = resolveUserProfilePath(normalizedPath);
    const previousSource = input.source === undefined ? await readFile(absolutePath, "utf-8") : "";
    const source = input.source ?? replacePromptTemplateRoot(previousSource, input.root);
    const parsed = parseProfileTemplateSource(source);
    if (input.root && parsed.issues.some((issue) => issue.severity === "error")) {
        throw createError({
            statusCode: 400,
            message: "profile 校验失败",
            data: parsed.issues,
        });
    }
    await mkdir(path.dirname(absolutePath), {recursive: true});
    await writeFile(absolutePath, source, "utf-8");
    return readUserProfileTemplate(normalizedPath);
}

/**
 * 从系统 assets 恢复用户 profile 覆盖文件。
 */
export async function restoreUserProfileTemplate(filePath: string): Promise<ProfileTemplateDetailDto> {
    const normalizedPath = normalizeProfileFilePath(filePath);
    const targetPath = resolveUserProfilePath(normalizedPath);
    await mkdir(path.dirname(targetPath), {recursive: true});
    await writeFile(targetPath, await readSystemProfileTemplateSource(normalizedPath), "utf-8");
    return readUserProfileTemplate(normalizedPath);
}

/**
 * 局部替换用户 profile 的 InputSchema 或 OutputSchema 声明。
 */
export async function updateUserProfileSchema(filePath: string, schemaName: "InputSchema" | "OutputSchema", fields: AgentProfileSchemaFieldDto[]): Promise<ProfileTemplateDetailDto> {
    const normalizedPath = normalizeProfileFilePath(filePath);
    const absolutePath = resolveUserProfilePath(normalizedPath);
    const previousSource = await readFile(absolutePath, "utf-8");
    const sourceRange = findExportedConstInitializerRange(previousSource, schemaName);
    if (!sourceRange) {
        throw createError({
            statusCode: 400,
            message: `未找到 export const ${schemaName} = ... 声明，只能源码编辑。`,
        });
    }

    const schemaSource = generateZodObjectSchemaSource(fields);
    const nextSource = ensureZodImport(`${previousSource.slice(0, sourceRange.start)}${schemaSource}${previousSource.slice(sourceRange.end)}`);
    await writeFile(absolutePath, nextSource, "utf-8");
    return readUserProfileTemplate(normalizedPath);
}

/**
 * 校验模板源码或结构化树。
 */
export function validateProfileTemplate(input: {
    source?: string;
    root?: ProfileTemplateNodeDto;
}): ProfileTemplateDetailDto {
    const source = input.source ?? generateProfileTemplateSource("draft-template", input.root);
    const parsed = parseProfileTemplateSource(source);
    return {
        name: "draft-template",
        fileName: "draft-template.tsx",
        source,
        root: parsed.root,
        issues: parsed.issues,
        variables: buildVariableCatalog(),
    };
}

/**
 * 预览模板渲染结果。
 */
export function previewProfileTemplate(input: {
    source?: string;
    root?: ProfileTemplateNodeDto;
    scope?: AgentVariableScope;
    inputOverrides?: Record<string, JsonValue>;
    profile?: AgentProfile<ProfileKey>;
}): ProfileTemplatePreviewDto {
    const source = input.source ?? generateProfileTemplateSource("preview-template", input.root);
    const parsed = parseProfileTemplateSource(source);
    const messages: ProfileTemplatePreviewMessageDto[] = [];
    const previewContext = {
        scope: input.scope,
        inputOverrides: input.inputOverrides,
        profile: input.profile,
    };
    if (parsed.root && !parsed.issues.some((issue) => issue.severity === "error")) {
        messages.push(...collectPreviewMessages(parsed.root, previewContext));
    }
    return {
        source,
        root: parsed.root,
        issues: parsed.issues,
        messages,
        variables: buildVariableCatalog(previewContext),
    };
}

/**
 * 解析 TSX 模板源码。
 */
export function parseProfileTemplateSource(source: string): ParsedTemplate {
    const sourceFile = ts.createSourceFile("template.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const issues: ProfileTemplateIssueDto[] = [];
    const rootExpression = findPromptRootExpression(sourceFile);
    if (!rootExpression?.expression) {
        return {
            root: null,
            promptRange: null,
            issues: [{
                severity: "error",
                message: "模板必须在 buildPrompt 或默认函数中 return <ProfilePrompt> 根节点",
            }],
        };
    }
    const context = createParseContext(sourceFile, rootExpression.scope);
    const root = parseJsxExpression(sourceFile, rootExpression.expression, issues, context);
    validateTemplateTree(root, issues);
    return {
        root,
        issues,
        promptRange: {
            start: rootExpression.expression.getStart(sourceFile),
            end: rootExpression.expression.getEnd(),
        },
    };
}

/**
 * 从结构化树生成规范 TSX 模板。
 */
export function generateProfileTemplateSource(templateName: string, root: ProfileTemplateNodeDto | undefined): string {
    const componentNames = collectComponentNames(root);
    const promptImportNames = ["Message", ...(componentNames.has("AIMessage") ? ["AIMessage"] : []), ...(componentNames.has("If") ? ["If"] : [])];
    const profileImportNames = [...componentNames].filter((name) => !["Text", "Message", "AIMessage", "If", "ToolCall"].includes(name)).sort();
    const functionName = toPascalCase(templateName || "ProfileTemplate");
    return [
        "/** @jsxRuntime automatic */",
        "/** @jsxImportSource nbook/server/agent/prompts */",
        "",
        `import {${promptImportNames.join(", ")}} from "nbook/server/agent/prompts";`,
        `import {${profileImportNames.join(", ")}} from "nbook/server/agent/profiles/simple-profile";`,
        "import type {ProfilePromptContext} from \"nbook/server/agent/profiles/simple-profile\";",
        "",
        `export default async function ${functionName}(ctx: ProfilePromptContext<"leader.default">) {`,
        "    const input = ctx.input;",
        "    const runtime = ctx.runtime;",
        "    const scope = ctx.scope;",
        "    const skillCatalogText = ctx.skillCatalogText;",
        "    const activatedSkillsText = await ctx.activatedSkillsText();",
        "",
        "    return (",
        root ? indent(generateNodeSource(root), 2) : "        <ProfilePrompt />",
        "    );",
        "}",
    ].join("\n");
}

/**
 * 解析模板名，避免 API 写出模板目录。
 */
function normalizeTemplateFileName(name: string): string {
    const fileName = basename(name.trim());
    if (!/^[A-Za-z0-9._-]+(\.tsx)?$/.test(fileName)) {
        throw createError({statusCode: 400, message: "模板名格式不合法"});
    }
    return fileName.endsWith(".tsx") ? fileName : `${fileName}.tsx`;
}

/**
 * 解析模板路径并限制在模板目录内。
 */
function resolveTemplatePath(fileName: string): string {
    const resolvedPath = resolve(TEMPLATE_DIR, fileName);
    if (!resolvedPath.startsWith(TEMPLATE_DIR)) {
        throw createError({statusCode: 400, message: "模板路径越界"});
    }
    return resolvedPath;
}

/**
 * 归一化用户 profile 文件路径，禁止逃逸用户 assets profile 目录。
 */
function normalizeProfileFilePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalized || normalized.includes("..") || path.isAbsolute(normalized) || !normalized.endsWith(".profile.tsx")) {
        throw createError({statusCode: 400, message: "非法 profile 文件路径"});
    }
    return normalized;
}

/**
 * 规范化新建 profile 的参数。
 */
function normalizeNewProfileInput(input: CreateUserProfileTemplateRequestDto): CreateUserProfileTemplateRequestDto & {fileName: string} {
    const profileKey = input.profileKey.trim();
    const kind = input.kind;
    if (!profileKey.startsWith(`${kind}.`)) {
        throw createError({statusCode: 400, message: `profileKey 必须以 ${kind}. 开头`});
    }
    if (["leader.default", "leader.assets", "subagent.writer", "subagent.retrieval"].includes(profileKey)) {
        throw createError({statusCode: 400, message: "不能通过新建入口覆盖 builtin profile，请先从系统版本复制或恢复。"});
    }
    const defaultFileName = `${profileKey.replace(/\./g, "/")}.profile.tsx`;
    return {
        ...input,
        profileKey,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        prompt: input.prompt.trim(),
        fileName: normalizeProfileFilePath(input.fileName || defaultFileName),
    };
}

/**
 * 生成新动态 profile 的标准 TSX 骨架。
 */
function generateUserProfileSource(input: CreateUserProfileTemplateRequestDto & {fileName: string}): string {
    const inputSchemaSource = input.kind === "leader"
        ? "LeaderInputSchema"
        : "z.object({\n    prompt: z.string().trim().min(1, \"prompt 不能为空\").describe(\"交给该 subagent 的任务说明。\"),\n})";
    const allowedToolKeys = input.kind === "leader"
        ? [
            "request_user_input",
            "skill",
            "task_create",
            "task_set_status",
            "execute_shell",
            "read_file",
            "edit_file",
            "apply_patch",
            "write_file",
            "report_result",
        ]
        : [
            "read_file",
            "edit_file",
            "apply_patch",
            "write_file",
            "report_result",
        ];

    return [
        "/** @jsxRuntime automatic */",
        "/** @jsxImportSource nbook/server/agent/prompts */",
        "",
        "import {z} from \"zod\";",
        "import {Message} from \"nbook/server/agent/prompts\";",
        ...(input.kind === "leader" ? ["import {LeaderInputSchema} from \"nbook/server/agent/types\";"] : []),
        "import {defineAgentProfile} from \"nbook/server/agent/profiles/define-agent-profile\";",
        "import {AppendingSet, DynamicSet, HistorySet, ProfilePrompt, SkillCatalog} from \"nbook/server/agent/profiles/simple-profile\";",
        "",
        "export const profileManifest = {",
        `    key: ${JSON.stringify(input.profileKey)},`,
        `    kind: ${JSON.stringify(input.kind)},`,
        `    name: ${JSON.stringify(input.name)},`,
        ...(input.description ? [`    description: ${JSON.stringify(input.description)},`] : []),
        "} as const;",
        "",
        "export const InputSchema = " + inputSchemaSource + ";",
        "export const OutputSchema = undefined;",
        "",
        "export type Input = z.infer<typeof InputSchema>;",
        "export type Output = undefined;",
        "",
        "export default defineAgentProfile<typeof profileManifest.key, Input, Output>({",
        "    manifest: profileManifest,",
        "    inputSchema: InputSchema,",
        "    allowedToolKeys: [",
        ...allowedToolKeys.map((toolKey) => `        ${JSON.stringify(toolKey)},`),
        "    ],",
        "    async buildPrompt(ctx) {",
        "        const input = ctx.input;",
        "",
        "        return (",
        "            <ProfilePrompt>",
        "                <HistorySet>",
        "                    <Message role=\"system\">",
        input.prompt
            .split("\n")
            .map((line) => `                        {${JSON.stringify(line)}}`)
            .join("\n                        {\"\\n\"}\n"),
        "                    </Message>",
        "                    {ctx.skillCatalogText ? (",
        "                        <Message role=\"system\">",
        "                            <SkillCatalog text={ctx.skillCatalogText} />",
        "                        </Message>",
        "                    ) : null}",
        "                </HistorySet>",
        "                <DynamicSet />",
        "                <AppendingSet>",
        ...(input.kind === "leader"
            ? [
                "                    {\"prompt\" in input ? (",
                "                        <Message role=\"human\" source=\"input\">",
                "                            {input.prompt}",
                "                        </Message>",
                "                    ) : null}",
            ]
            : [
                "                    <Message role=\"human\" source=\"input\">",
                "                        {input.prompt}",
                "                    </Message>",
            ]),
        "                </AppendingSet>",
        "            </ProfilePrompt>",
        "        );",
        "    },",
        "});",
        "",
    ].join("\n");
}

/**
 * 返回用户 assets profile 绝对路径。
 */
function resolveUserProfilePath(filePath: string): string {
    return resolveProfilePath(USER_PROFILE_DIR, filePath);
}

/**
 * 返回系统 assets profile 绝对路径。
 */
function resolveSystemProfilePath(filePath: string): string {
    return resolveProfilePath(SYSTEM_PROFILE_DIR, filePath);
}

/**
 * 解析 profile 路径并确认仍在根目录内。
 */
function resolveProfilePath(root: string, filePath: string): string {
    const absolutePath = resolve(root, filePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
        throw createError({statusCode: 400, message: "非法 profile 文件路径"});
    }
    return absolutePath;
}

/**
 * 定位 `export const InputSchema = ...` 的 initializer。
 */
function findExportedConstInitializerRange(source: string, constName: string): SourceRange | null {
    const sourceFile = ts.createSourceFile("profile.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found: SourceRange | null = null;
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
 * 判断节点是否带 export 修饰符。
 */
function hasExportModifier(node: TypeScript.Node): boolean {
    return Boolean(ts.getCombinedModifierFlags(node as TypeScript.Declaration) & ts.ModifierFlags.Export);
}

/**
 * 生成 schema builder 支持子集对应的 Zod object 源码。
 */
function generateZodObjectSchemaSource(fields: AgentProfileSchemaFieldDto[]): string {
    if (fields.length === 0) {
        return "z.object({})";
    }
    return [
        "z.object({",
        ...fields.map((field) => `    ${JSON.stringify(field.name)}: ${generateZodFieldSource(field)},`),
        "})",
    ].join("\n");
}

/**
 * 生成单个字段的 Zod 源码。
 */
function generateZodFieldSource(field: AgentProfileSchemaFieldDto): string {
    let source = generateZodRequiredFieldSource(field);
    if (field.description) {
        source += `.describe(${JSON.stringify(field.description)})`;
    }
    if (field.defaultValue !== undefined) {
        source += `.default(${JSON.stringify(field.defaultValue)})`;
    }
    if (!field.required && field.defaultValue === undefined) {
        source += ".optional()";
    }
    return source;
}

/**
 * 生成字段 required 部分的 Zod 源码。
 */
function generateZodRequiredFieldSource(field: AgentProfileSchemaFieldDto): string {
    if (field.type === "string") {
        return "z.string()";
    }
    if (field.type === "number") {
        return "z.number()";
    }
    if (field.type === "boolean") {
        return "z.boolean()";
    }
    if (field.type === "enum") {
        const enumValues = [...new Set(field.enumValues ?? [])].filter(Boolean);
        if (enumValues.length === 0) {
            throw createError({statusCode: 400, message: `枚举字段 ${field.name} 至少需要一个选项`});
        }
        if (enumValues.length === 1) {
            return `z.literal(${JSON.stringify(enumValues[0])})`;
        }
        return `z.enum([${enumValues.map((value) => JSON.stringify(value)).join(", ")}])`;
    }
    if (field.type === "array") {
        const item = field.item ?? {
            name: "item",
            type: "string",
            required: true,
        } satisfies AgentProfileSchemaFieldDto;
        return `z.array(${generateZodRequiredFieldSource(item)})`;
    }
    if (field.type === "object") {
        return generateZodObjectSchemaSource(field.fields ?? []);
    }
    throw createError({statusCode: 400, message: `不支持的 schema 字段类型：${field.type}`});
}

/**
 * schema builder 生成 z.xxx，因此目标文件必须有 z import。
 */
function ensureZodImport(source: string): string {
    if (/import\s+\{[^}]*\bz\b[^}]*\}\s+from\s+["']zod["'];?/u.test(source)) {
        return source;
    }
    return `import {z} from "zod";\n${source}`;
}

/**
 * 列出 profile 文件。
 */
async function listProfileFiles(root: string, current: string = root): Promise<Array<{relativePath: string; absolutePath: string}>> {
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await readdir(current, {withFileTypes: true});
    } catch (error) {
        if (isMissingPathError(error)) {
            return [];
        }
        throw error;
    }
    const files: Array<{relativePath: string; absolutePath: string}> = [];
    for (const entry of entries) {
        const absolutePath = resolve(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listProfileFiles(root, absolutePath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".profile.tsx")) {
            files.push({
                absolutePath,
                relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
            });
        }
    }
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/**
 * 判断文件系统错误是否是路径不存在。
 */
function isMissingPathError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && (error as {code?: unknown}).code === "ENOENT",
    );
}

/**
 * 判断文件系统错误是否是文件已存在。
 */
function isFileExistsError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && (error as {code?: unknown}).code === "EEXIST",
    );
}

/**
 * 将新的 ProfilePrompt JSX 写回完整 profile 源码。
 */
function replacePromptTemplateRoot(source: string, root: ProfileTemplateNodeDto | undefined): string {
    if (!root) {
        throw createError({statusCode: 400, message: "缺少 profile prompt 根节点"});
    }
    const parsed = parseProfileTemplateSource(source);
    if (!parsed.promptRange) {
        throw createError({statusCode: 400, message: "无法定位 buildPrompt 中的 ProfilePrompt"});
    }
    return `${source.slice(0, parsed.promptRange.start)}${indent(generateNodeSource(root), 3)}${source.slice(parsed.promptRange.end)}`;
}

/**
 * 找到导出函数里的 return JSX。
 */
function findPromptRootExpression(sourceFile: TypeScript.SourceFile): {expression: TypeScript.Expression; scope: TypeScript.Node; inBuildPrompt: boolean} | null {
    for (const buildPrompt of findBuildPromptLikeFunctions(sourceFile)) {
        const expression = findReturnedProfilePrompt(buildPrompt, sourceFile);
        if (expression) {
            return {expression, scope: buildPrompt, inBuildPrompt: true};
        }
    }
    const expression = findReturnedJsx(sourceFile);
    return expression ? {expression, scope: sourceFile, inBuildPrompt: false} : null;
}

/**
 * 查找第一个 return JSX，保留模板编辑器对非法根节点的错误提示。
 */
function findReturnedJsx(root: TypeScript.Node): TypeScript.Expression | null {
    let found: TypeScript.Expression | null = null;
    const visit = (node: TypeScript.Node): void => {
        if (found) {
            return;
        }
        if (ts.isReturnStatement(node) && node.expression) {
            found = unwrapParenthesized(node.expression);
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

/**
 * 查找完整 profile 文件中的 prompt 构造函数或方法。
 */
function findBuildPromptLikeFunctions(sourceFile: TypeScript.SourceFile): TypeScript.Node[] {
    const found: TypeScript.Node[] = [];
    const visit = (node: TypeScript.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.body && node.name && isPromptBuilderName(node.name.getText(sourceFile))) {
            found.push(node.body);
            return;
        }
        if (ts.isMethodDeclaration(node) && node.body && isPromptBuilderName(node.name.getText(sourceFile))) {
            found.push(node.body);
            return;
        }
        if (ts.isPropertyAssignment(node) && isPromptBuilderName(node.name.getText(sourceFile))) {
            found.push(node.initializer);
            return;
        }
        if (ts.isShorthandPropertyAssignment(node) && node.name.getText(sourceFile) === "buildPrompt") {
            found.push(node);
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

/**
 * 动态 profile 中可承载 ProfilePrompt 的构造入口名。
 */
function isPromptBuilderName(name: string): boolean {
    return ["buildPrompt", "buildLeaderPrompt", "buildLeaderDefaultPrompt", "buildAssetsEditorPrompt", "buildWriterPrompt", "buildRetrievalPrompt"].includes(name);
}

/**
 * 查找返回 ProfilePrompt 的 return 表达式。
 */
function findReturnedProfilePrompt(root: TypeScript.Node, sourceFile: TypeScript.SourceFile): TypeScript.Expression | null {
    let found: TypeScript.Expression | null = null;
    const visit = (node: TypeScript.Node): void => {
        if (found) {
            return;
        }
        if (ts.isReturnStatement(node) && node.expression) {
            const expression = unwrapParenthesized(node.expression);
            if (isProfilePromptExpression(expression, sourceFile)) {
                found = expression;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

/**
 * 判断表达式是否是 ProfilePrompt 根节点。
 */
function isProfilePromptExpression(expression: TypeScript.Expression, sourceFile: TypeScript.SourceFile): boolean {
    if (ts.isJsxElement(expression)) {
        return expression.openingElement.tagName.getText(sourceFile) === "ProfilePrompt";
    }
    if (ts.isJsxSelfClosingElement(expression)) {
        return expression.tagName.getText(sourceFile) === "ProfilePrompt";
    }
    return false;
}

/**
 * 移除表达式外层括号。
 */
function unwrapParenthesized(expression: TypeScript.Expression): TypeScript.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

/**
 * 建立当前 prompt 构造函数内的 JSX 局部变量表。
 */
function createParseContext(sourceFile: TypeScript.SourceFile, scope: TypeScript.Node): ParseContext {
    const jsxBindings = new Map<string, TypeScript.Expression>();
    const visit = (node: TypeScript.Node): void => {
        if (node !== scope && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))) {
            return;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const initializer = unwrapParenthesized(node.initializer);
            if (ts.isJsxElement(initializer) || ts.isJsxSelfClosingElement(initializer)) {
                jsxBindings.set(node.name.getText(sourceFile), initializer);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(scope);
    return {jsxBindings};
}

/**
 * 解析 JSX 表达式为低代码节点。
 */
function parseJsxExpression(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): ProfileTemplateNodeDto | null {
    if (ts.isJsxElement(expression)) {
        return parseJsxElement(sourceFile, expression, issues, context);
    }
    if (ts.isJsxSelfClosingElement(expression)) {
        return parseSelfClosingElement(sourceFile, expression, issues, context);
    }
    issues.push({
        severity: "error",
        message: "return 语句必须返回 JSX 组件",
    });
    return null;
}

/**
 * 解析普通 JSX 节点。
 */
function parseJsxElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxElement,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): ProfileTemplateNodeDto | null {
    const type = element.openingElement.tagName.getText(sourceFile);
    if (!isComponentType(type)) {
        issues.push(buildUnsupportedComponentIssue(sourceFile, type, element));
        return null;
    }
    if (type === "If" && (context.inlineTextDepth ?? 0) > 0) {
        return {
            id: createNodeId(type),
            type,
            props: parseAttributes(sourceFile, element.openingElement.attributes, issues),
            children: parseMessageChildren(sourceFile, element.children, issues, {
                ...context,
                inlineTextDepth: (context.inlineTextDepth ?? 0) + 1,
            }).children,
            editable: true,
            sourceRange: {
                start: element.getStart(sourceFile),
                end: element.getEnd(),
            },
        };
    }
    const parsedChildren = type === "Message" || type === "AIMessage" || type === "ToolCall"
        ? parseMessageChildren(sourceFile, element.children, issues, context)
        : {text: undefined, children: parseChildren(sourceFile, element.children, issues, context)};
    return {
        id: createNodeId(type),
        type,
        props: parseAttributes(sourceFile, element.openingElement.attributes, issues),
        children: parsedChildren.children,
        ...(parsedChildren.text ? {text: parsedChildren.text} : {}),
        ...(parsedChildren.textKind ? {textKind: parsedChildren.textKind} : {}),
        editable: true,
        sourceRange: {
            start: element.getStart(sourceFile),
            end: element.getEnd(),
        },
    };
}

/**
 * 解析 Message 内部文本和片段。
 */
function parseMessageChildren(
    sourceFile: TypeScript.SourceFile,
    children: TypeScript.NodeArray<TypeScript.JsxChild>,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): {
    text?: string;
    textKind?: "text" | "source" | "template";
    children: ProfileTemplateNodeDto[];
} {
    const childContext = {
        ...context,
        inlineTextDepth: (context.inlineTextDepth ?? 0) + 1,
    };
    const nestedChildren: ProfileTemplateNodeDto[] = [];
    let pendingText = "";
    let pendingTextKind: ProfileTemplateNodeDto["textKind"] = "text";
    let lastAppendedFromExpression = false;
    const flushText = (end: number): void => {
        if (!pendingText) {
            return;
        }
        nestedChildren.push(createTextNode(pendingText, pendingTextKind, end - pendingText.length, end));
        pendingText = "";
        pendingTextKind = "text";
    };
    const appendText = (text: string, textKind: ProfileTemplateNodeDto["textKind"], end: number, fromExpression: boolean = false): void => {
        if (!text) {
            return;
        }
        if (textKind === "template" && text.startsWith("${") && pendingText.endsWith("$")) {
            pendingText = pendingText.slice(0, -1);
            pendingTextKind = "template";
        }
        if (pendingText && pendingTextKind !== textKind && !canMergeTextKinds(pendingTextKind, textKind)) {
            flushText(end);
        }
        pendingText += text;
        pendingTextKind = mergeTextKind(pendingTextKind, textKind);
        lastAppendedFromExpression = fromExpression;
    };
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex];
        if (!child) {
            continue;
        }
        if (ts.isJsxText(child)) {
            const rawText = sourceFile.text.slice(child.pos, child.end).replace(/\r\n/g, "\n");
            const decodedText = decodeJsxTextEntities(rawText);
            const nextChild = children[childIndex + 1] ?? null;
            const shouldPreserveExpressionGap = lastAppendedFromExpression
                && Boolean(nextChild && ts.isJsxExpression(nextChild) && nextChild.expression)
                && (!nextChild || !isExplicitNewlineExpression(sourceFile, nextChild))
                && !pendingText.endsWith("\n");
            let text = normalizeMessageTextSegment(decodedText, Boolean(pendingText), shouldPreserveExpressionGap);
            if (text && lastAppendedFromExpression && decodedText.includes("\n") && !text.startsWith("\n") && !pendingText.endsWith("\n")) {
                text = `\n${text}`;
            }
            if (text) {
                appendText(text, "text", child.getEnd());
            }
            continue;
        }
        if (ts.isJsxExpression(child) && child.expression) {
            const expression = child.expression;
            if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
                const text = ts.isNoSubstitutionTemplateLiteral(expression)
                    ? decodeTemplateText(expression.getText(sourceFile).slice(1, -1))
                    : expression.text;
                appendText(text, "text", child.getEnd(), true);
                continue;
            }
            if (ts.isTemplateExpression(expression)) {
                appendText(renderTemplateExpressionText(sourceFile, expression), "template", child.getEnd(), true);
                continue;
            }
            appendText("${" + expression.getText(sourceFile) + "}", "template", child.getEnd(), true);
            continue;
        }
        if (ts.isJsxElement(child)) {
            if (isInlineTextElement(sourceFile, child)) {
                const text = renderInlineTextElement(sourceFile, child);
                appendText(text, "text", child.getEnd());
                continue;
            }
            flushText(child.getStart(sourceFile));
            const node = parseJsxElement(sourceFile, child, issues, childContext);
            if (node) {
                nestedChildren.push(node);
            }
            continue;
        }
        if (ts.isJsxSelfClosingElement(child)) {
            if (isInlineTextElement(sourceFile, child)) {
                const text = renderInlineTextElement(sourceFile, child);
                appendText(text, "text", child.getEnd());
                continue;
            }
            flushText(child.getStart(sourceFile));
            const node = parseSelfClosingElement(sourceFile, child, issues, childContext);
            if (node) {
                nestedChildren.push(node);
            }
        }
    }
    flushText(children.end);
    return {
        children: nestedChildren,
    };
}

/**
 * Message 正文中的普通文本和模板表达式属于同一个可编辑文本块。
 */
function canMergeTextKinds(left: ProfileTemplateNodeDto["textKind"], right: ProfileTemplateNodeDto["textKind"]): boolean {
    return (left === "text" || left === "template") && (right === "text" || right === "template");
}

/**
 * 合并文本类型；只要包含模板表达式，整体按 template 生成。
 */
function mergeTextKind(left: ProfileTemplateNodeDto["textKind"], right: ProfileTemplateNodeDto["textKind"]): ProfileTemplateNodeDto["textKind"] {
    if (left === "source" || right === "source") {
        return right;
    }
    return left === "template" || right === "template" ? "template" : "text";
}

/**
 * 判断 JSX 表达式是否是生成器用于保真换行的 {"\n"}。
 */
function isExplicitNewlineExpression(sourceFile: TypeScript.SourceFile, child: TypeScript.JsxChild): boolean {
    if (!ts.isJsxExpression(child) || !child.expression) {
        return false;
    }
    const expression = child.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text === "\n";
    }
    return expression.getText(sourceFile) === "\"\\n\"";
}

/**
 * 解析自闭合 JSX 节点。
 */
function parseSelfClosingElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxSelfClosingElement,
    issues: ProfileTemplateIssueDto[],
    _context: ParseContext,
): ProfileTemplateNodeDto | null {
    const type = element.tagName.getText(sourceFile);
    if (!isComponentType(type)) {
        issues.push(buildUnsupportedComponentIssue(sourceFile, type, element));
        return null;
    }
    return {
        id: createNodeId(type),
        type,
        props: parseAttributes(sourceFile, element.attributes, issues),
        children: [],
        editable: true,
        sourceRange: {
            start: element.getStart(sourceFile),
            end: element.getEnd(),
        },
    };
}

/**
 * 解析 JSX children。
 */
function parseChildren(
    sourceFile: TypeScript.SourceFile,
    children: TypeScript.NodeArray<TypeScript.JsxChild>,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): ProfileTemplateNodeDto[] {
    const result: ProfileTemplateNodeDto[] = [];
    for (const child of children) {
        if (ts.isJsxText(child)) {
            const text = child.getText(sourceFile).replace(/\r\n/g, "\n");
            if (text.trim()) {
                result.push(createTextNode(normalizeText(text), "text", child.getStart(sourceFile), child.getEnd()));
            }
            continue;
        }
        if (ts.isJsxElement(child)) {
            const node = parseJsxElement(sourceFile, child, issues, context);
            if (node) {
                result.push(node);
            }
            continue;
        }
        if (ts.isJsxSelfClosingElement(child)) {
            const node = parseSelfClosingElement(sourceFile, child, issues, context);
            if (node) {
                result.push(node);
            }
            continue;
        }
        if (ts.isJsxExpression(child) && child.expression) {
            const nodes = parseExpressionChild(sourceFile, child.expression, issues, context);
            if (nodes.length > 0) {
                result.push(...nodes);
            }
        }
    }
    return result;
}

/**
 * 解析 JSX 表达式 child。
 */
function parseExpressionChild(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): ProfileTemplateNodeDto[] {
    if (ts.isIdentifier(expression)) {
        const boundExpression = context.jsxBindings.get(expression.getText(sourceFile));
        if (boundExpression) {
            return parseExpressionAsChildren(sourceFile, boundExpression, issues, context);
        }
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return [createTextNode(expression.getText(sourceFile), "source", expression.getStart(sourceFile), expression.getEnd())];
    }
    if (ts.isConditionalExpression(expression)) {
        const whenTrue = parseExpressionAsChildren(sourceFile, expression.whenTrue, issues, context);
        return [{
            id: createNodeId("If"),
            type: "If",
            props: {condition: {
                kind: "expression",
                code: expression.condition.getText(sourceFile),
            }},
            children: whenTrue,
            editable: true,
            sourceRange: {start: expression.getStart(sourceFile), end: expression.getEnd()},
        }];
    }
    const text = `{${expression.getText(sourceFile)}}`;
    return [createTextNode(text, "source", expression.getStart(sourceFile), expression.getEnd())];
}

/**
 * 创建字符串片段节点。
 */
function createTextNode(text: string, textKind: ProfileTemplateNodeDto["textKind"], start: number, end: number): ProfileTemplateNodeDto {
    return {
        id: createNodeId("Text"),
        type: "Text",
        props: {},
        children: [],
        text,
        ...(textKind ? {textKind} : {}),
        editable: true,
        sourceRange: {start, end},
    };
}

/**
 * 把表达式解析为节点数组。
 */
function parseExpressionAsChildren(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    issues: ProfileTemplateIssueDto[],
    context: ParseContext,
): ProfileTemplateNodeDto[] {
    const unwrapped = unwrapParenthesized(expression);
    if (ts.isJsxElement(unwrapped)) {
        const node = parseJsxElement(sourceFile, unwrapped, issues, context);
        return node ? [node] : [];
    }
    if (ts.isJsxSelfClosingElement(unwrapped)) {
        const node = parseSelfClosingElement(sourceFile, unwrapped, issues, context);
        return node ? [node] : [];
    }
    return [];
}

/**
 * 解析 JSX 属性。
 */
function parseAttributes(
    sourceFile: TypeScript.SourceFile,
    attributes: TypeScript.JsxAttributes,
    issues: ProfileTemplateIssueDto[],
): Record<string, ProfileTemplatePropValue> {
    const props: Record<string, ProfileTemplatePropValue> = {};
    for (const property of attributes.properties) {
        if (!ts.isJsxAttribute(property)) {
            issues.push({
                severity: "warning",
                message: "暂不支持 JSX spread 属性",
            });
            continue;
        }
        const name = property.name.getText(sourceFile);
        if (!property.initializer) {
            props[name] = true;
            continue;
        }
        if (ts.isStringLiteral(property.initializer)) {
            props[name] = property.initializer.text;
            continue;
        }
        if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
            props[name] = parsePropExpression(sourceFile, property.initializer.expression);
        }
    }
    return props;
}

/**
 * 解析属性表达式。
 */
function parsePropExpression(sourceFile: TypeScript.SourceFile, expression: TypeScript.Expression): ProfileTemplatePropValue {
    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
    }
    if (ts.isNumericLiteral(expression)) {
        return Number(expression.text);
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
    }
    return {
        kind: "expression",
        code: expression.getText(sourceFile),
    };
}

/**
 * 判断 Message 内的小写 JSX 标签是否应该作为正文片段保留。
 */
function isInlineTextElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement,
): boolean {
    const tagName = ts.isJsxElement(element)
        ? element.openingElement.tagName.getText(sourceFile)
        : element.tagName.getText(sourceFile);
    return /^[a-z][A-Za-z0-9-]*$/.test(tagName) && !isComponentType(tagName);
}

/**
 * 把 Message 内的小写 JSX 标签还原成用户可编辑正文。
 */
function renderInlineTextElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement,
): string {
    return decodeJsxTextEntities(element.getText(sourceFile).replace(/\r\n/g, "\n"));
}

/**
 * 生成源码行列位置。
 */
function buildSourceLocation(sourceFile: TypeScript.SourceFile, position: number): string {
    const location = sourceFile.getLineAndCharacterOfPosition(position);
    return `template.tsx:${location.line + 1}:${location.character + 1}`;
}

/**
 * 构造不支持 JSX 组件的诊断信息。
 */
function buildUnsupportedComponentIssue(
    sourceFile: TypeScript.SourceFile,
    type: string,
    element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement,
): ProfileTemplateIssueDto {
    const start = element.getStart(sourceFile);
    const message = /^[a-z][A-Za-z0-9-]*$/.test(type)
        ? `不支持的模板组件：${type}。小写标签只有放在 Message 正文中才会按文本保留；其他位置请写成字符串表达式。`
        : `不支持的模板组件：${type}`;
    return {
        severity: "error",
        message,
        path: buildSourceLocation(sourceFile, start),
        sourceText: buildSourceSnippet(sourceFile, element),
        sourceRange: {start, end: element.getEnd()},
    };
}

/**
 * 生成用于问题面板展示的短源码片段。
 */
function buildSourceSnippet(sourceFile: TypeScript.SourceFile, node: TypeScript.Node): string {
    const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * 校验模板树。
 */
function validateTemplateTree(root: ProfileTemplateNodeDto | null, issues: ProfileTemplateIssueDto[]): void {
    if (!root) {
        return;
    }
    if (root.type !== "ProfilePrompt") {
        issues.push({
            severity: "error",
            message: "模板根节点必须是 ProfilePrompt",
            nodeId: root.id,
        });
    }
    const historyCount = countNodes(root, "HistorySet");
    if (historyCount > 1) {
        issues.push({
            severity: "error",
            message: "ProfilePrompt 只能包含一个 HistorySet",
            nodeId: root.id,
        });
    }
    walkTemplate(root, (node, ancestors) => {
        if (node.type === "Message") {
            const role = node.props.role;
            if (role !== "system" && role !== "human" && role !== "assistant") {
                issues.push({
                    severity: "error",
                    message: "Message.role 必须是 system、human 或 assistant",
                    nodeId: node.id,
                });
            }
            const invalidChild = node.children.find((child) => !isInlineStringNodeType(child.type) && child.type !== "If");
            if (invalidChild) {
                issues.push({
                    severity: "error",
                    message: "Message 节点内只能放字符串型内联节点",
                    nodeId: invalidChild.id,
                });
            }
        }
        if (node.type === "AIMessage") {
            if (node.children.some((child) => child.type !== "ToolCall" && child.type !== "Text" && child.type !== "If")) {
                issues.push({
                    severity: "error",
                    message: "AIMessage 只能包含 Text、If 或 ToolCall 子节点",
                    nodeId: node.id,
                });
            }
        }
        if (node.type === "ToolCall" && ancestors.at(-1)?.type !== "AIMessage") {
            issues.push({
                severity: "error",
                message: "ToolCall 必须放在 AIMessage 内",
                nodeId: node.id,
            });
        }
        if (node.type === "SkillCatalog" && !isInsideInlineTextContext(ancestors)) {
            issues.push({
                severity: "error",
                message: "SkillCatalog 返回字符串，必须放在 Message 内",
                nodeId: node.id,
            });
        }
        if (node.type === "ActivatedSkills" && !isInsideInlineTextContext(ancestors)) {
            issues.push({
                severity: "error",
                message: "ActivatedSkills 返回字符串，必须放在 Message 内",
                nodeId: node.id,
            });
        }
        const parent = ancestors.at(-1);
        if (parent && !canContainChild(ancestors, node.type)) {
            issues.push({
                severity: "error",
                message: `${node.type} 不能放在 ${parent.type} 内`,
                nodeId: node.id,
            });
        }
        if (node.type === "Watch") {
            const path = node.props.path;
            if (typeof path !== "string" || !path.startsWith("scope.")) {
                issues.push({
                    severity: "error",
                    message: "Watch.path 必须以 scope. 开头",
                    nodeId: node.id,
                });
            }
        }
        if (node.type === "Reminder") {
            const id = node.props.id;
            if (typeof id !== "string" || !id.trim()) {
                issues.push({
                    severity: "error",
                    message: "Reminder.id 不能为空",
                    nodeId: node.id,
                });
            }
        }
        if (node.text?.trim() && node.type !== "Text" && node.type !== "Message" && node.type !== "AIMessage" && node.type !== "ToolCall" && !isInsideInlineTextContext(ancestors) && node.editable) {
            issues.push({
                severity: "error",
                message: "非空文本必须放在 Message 内",
                nodeId: node.id,
            });
        }
    });
}

/**
 * 收集轻量预览消息。
 */
function collectPreviewMessages(node: ProfileTemplateNodeDto, context: PreviewContext): ProfileTemplatePreviewMessageDto[] {
    if (node.type === "Message") {
        const source = node.props.source === "input" ? "input" : null;
        const inlineText = renderInlineText(node, context);
        const ownText = source === "input" && !inlineText
            ? readVariableAsText("input.prompt", context)
            : replaceVariableTokens(inlineText, context);
        return [{
            role: String(node.props.role ?? "system"),
            text: ownText,
            source,
        }];
    }
    if (node.type === "AIMessage") {
        return [{
            role: "assistant",
            text: replaceVariableTokens(renderInlineText(node, context), context),
            source: null,
            toolCalls: node.children
                .filter((child) => child.type === "ToolCall")
                .map((child) => ({
                    id: String(child.props.id || child.id),
                    name: String(child.props.name ?? "tool"),
                    argsText: replaceVariableTokens(renderInlineText(child, context) || String(child.props.args ?? "{}"), context),
                })),
        }];
    }
    if (node.type === "SkillCatalog") {
        return [{role: "system", text: replaceVariableTokens(String(node.props.text ?? "${skillCatalogText}"), context), source: null}];
    }
    if (node.type === "ActivatedSkills") {
        return [{role: "human", text: replaceVariableTokens(String(node.props.text ?? "${activatedSkillsText}"), context), source: null}];
    }
    if (node.type === "Text") {
        return [{role: "system", text: replaceVariableTokens(renderPreviewMessageText(node), context), source: null}];
    }
    if (node.type === "Watch") {
        const text = String(node.props.previewText ?? `Watch: ${String(node.props.path ?? "")}`);
        return [{role: "system", text: replaceVariableTokens(text, context), source: null}];
    }
    return node.children.flatMap((child) => collectPreviewMessages(child, context));
}

/**
 * 渲染预览消息正文。预览关心最终消息内容，不复用 TSX 源码生成转义规则。
 */
function renderPreviewMessageText(node: ProfileTemplateNodeDto): string {
    return node.text ?? "";
}

/**
 * 渲染 Message/AIMessage 内联文本片段。
 */
function renderInlineText(node: ProfileTemplateNodeDto, context: PreviewContext): string {
    return [
        renderPreviewMessageText(node),
        ...node.children
            .filter((child) => child.type !== "ToolCall")
            .flatMap((child) => collectPreviewMessages(child, context).map((message) => message.text)),
    ].filter(Boolean).join("");
}

/**
 * 生成节点 TSX。
 */
function generateNodeSource(node: ProfileTemplateNodeDto): string {
    if (node.type === "Text") {
        return renderNodeText(node);
    }
    const props = generateProps(node.props);
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
    }
    if (node.type === "ToolCall" && node.text) {
        const textSource = renderNodeText(node);
        const childLines = [
            indent(textSource, 1),
            ...node.children.map((child) => indent(generateNodeSource(child), 1)),
        ];
        return [
            `<${node.type}${props}>`,
            ...childLines,
            `</${node.type}>`,
        ].join("\n");
    }
    const childLines = [
        node.text ? renderNodeText(node) : "",
        ...node.children.map((child) => generateNodeSource(child)),
    ].filter(Boolean);
    return [
        `<${node.type}${props}>`,
        ...childLines.map((line) => indent(line, 1)),
        `</${node.type}>`,
    ].join("\n");
}

/**
 * 生成 JSX 属性。
 */
function generateProps(props: Record<string, ProfileTemplatePropValue>): string {
    const chunks: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === "") {
            continue;
        }
        if (isExpressionValue(value)) {
            chunks.push(`${key}={${value.code}}`);
            continue;
        }
        if (typeof value === "string") {
            chunks.push(`${key}=${JSON.stringify(value)}`);
        } else {
            chunks.push(`${key}={${String(value)}}`);
        }
    }
    return chunks.length ? ` ${chunks.join(" ")}` : "";
}

/**
 * 收集组件名。
 */
function collectComponentNames(root: ProfileTemplateNodeDto | undefined): Set<string> {
    const names = new Set<string>(["ProfilePrompt"]);
    if (!root) {
        return names;
    }
    walkTemplate(root, (node) => {
        names.add(node.type);
    });
    return names;
}

/**
 * 遍历模板树。
 */
function walkTemplate(
    node: ProfileTemplateNodeDto,
    visit: (node: ProfileTemplateNodeDto, ancestors: ProfileTemplateNodeDto[]) => void,
    ancestors: ProfileTemplateNodeDto[] = [],
): void {
    visit(node, ancestors);
    for (const child of node.children) {
        walkTemplate(child, visit, [...ancestors, node]);
    }
}

/**
 * 统计节点数量。
 */
function countNodes(root: ProfileTemplateNodeDto, type: ProfileTemplateNodeDto["type"]): number {
    let count = 0;
    walkTemplate(root, (node) => {
        if (node.type === type) {
            count += 1;
        }
    });
    return count;
}

/**
 * 判断组件是否属于受限 DSL。
 */
function isComponentType(type: string): type is ProfileTemplateNodeDto["type"] {
    return COMPONENT_NAMES.has(type);
}

/**
 * 运行时直接返回 string 的节点，只能作为 Message 的内联内容。
 */
function isInlineStringNodeType(type: ProfileTemplateNodeDto["type"]): boolean {
    return type === "Text" || type === "SkillCatalog" || type === "ActivatedSkills";
}

/**
 * 判断当前祖先链是否位于 Message 的内联文本区域。
 */
function isInsideInlineTextContext(ancestors: ProfileTemplateNodeDto[]): boolean {
    return ancestors.some((node) => node.type === "Message");
}

/**
 * 校验节点嵌套关系，保持与可视化编辑器拖拽规则一致。
 */
function canContainChild(ancestors: ProfileTemplateNodeDto[], child: ProfileTemplateNodeDto["type"]): boolean {
    const parent = ancestors.at(-1)?.type;
    if (!parent) {
        return true;
    }
    if (child === "ProfilePrompt") {
        return false;
    }
    if (parent === "If") {
        const inheritedParent = [...ancestors].reverse().slice(1).find((node) => node.type !== "If")?.type;
        if (inheritedParent === "Message") {
            return child === "If" || isInlineStringNodeType(child);
        }
        if (inheritedParent === "AIMessage") {
            return child === "If" || child === "Text" || child === "ToolCall";
        }
        if (inheritedParent === "ToolCall") {
            return child === "Text";
        }
        return inheritedParent ? canContainChild([{id: "parent", type: inheritedParent, props: {}, children: [], editable: true}], child) : false;
    }
    if (parent === "ProfilePrompt") {
        return ["HistorySet", "DynamicSet", "AppendingSet", "Message", "AIMessage", "If"].includes(child);
    }
    if (parent === "HistorySet" || parent === "DynamicSet") {
        return ["Message", "AIMessage", "If"].includes(child);
    }
    if (parent === "AppendingSet") {
        return ["Message", "AIMessage", "Reminder", "Watch", "If"].includes(child);
    }
    if (parent === "Reminder" || parent === "Watch") {
        return ["Message", "AIMessage", "If"].includes(child);
    }
    if (parent === "Message") {
        return isInlineStringNodeType(child) || child === "If";
    }
    if (parent === "AIMessage") {
        return child === "Text" || child === "If" || child === "ToolCall";
    }
    if (parent === "ToolCall") {
        return child === "Text";
    }
    return false;
}

/**
 * 创建稳定但无需持久语义的节点 id。
 */
function createNodeId(prefix: string): string {
    return `${prefix.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 判断是否为表达式属性值。
 */
function isExpressionValue(value: ProfileTemplatePropValue): value is ProfileTemplateExpressionValue {
    return typeof value === "object" && value !== null && "kind" in value && value.kind === "expression";
}

/**
 * 渲染 Message 的正文片段。
 */
function renderNodeText(node: ProfileTemplateNodeDto): string {
    if (node.textKind === "source") {
        return `{${node.text ?? ""}}`;
    }
    return node.text ? renderMessageTextExpressions(node.text) : "";
}

/**
 * 按行生成 Message 正文表达式，兼顾源码可读性与换行保真。
 */
function renderMessageTextExpressions(text: string): string {
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const chunks: string[] = [];
    lines.forEach((line, index) => {
        if (line) {
            chunks.push("{`" + escapeTemplateLine(line) + "`}");
        }
        if (index < lines.length - 1) {
            chunks.push("{\"\\n\"}");
        }
    });
    return chunks.join("\n");
}

/**
 * 转义单行模板字符串正文，保留 ${...} 作为 TSX 运行时插值。
 */
function escapeTemplateLine(text: string): string {
    return text
        .replaceAll("\\", "\\\\")
        .replaceAll("`", "\\`");
}

/**
 * 反解生成器写入模板字符串的常见转义，恢复编辑器中的真实正文。
 */
function decodeTemplateText(text: string): string {
    return text
        .replaceAll("\\n", "\n")
        .replaceAll("\\`", "`")
        .replaceAll("\\\\", "\\");
}

/**
 * 从模板字符串 AST 重建正文，只解码模板正文，不改写 ${...} 内的表达式源码。
 */
function renderTemplateExpressionText(sourceFile: TypeScript.SourceFile, expression: TypeScript.TemplateExpression): string {
    return [
        expression.head.text,
        ...expression.templateSpans.map((span) => {
            return "${" + span.expression.getText(sourceFile) + "}" + span.literal.text;
        }),
    ].join("");
}

/**
 * 预览阶段替换常见变量 token。
 */
function replaceVariableTokens(text: string, context: PreviewContext): string {
    return text.replace(/\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)}/g, (_match, rawPath: string) => {
        return readVariableAsText(rawPath.trim(), context);
    });
}

/**
 * 将变量路径读成适合展示在 prompt 预览里的文本。
 */
function readVariableAsText(path: string, context: PreviewContext): string {
    const value = readPreviewVariable(path, context);
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value, null, 2);
}

/**
 * 读取预览上下文中的变量值。
 */
function readPreviewVariable(path: string, context: PreviewContext): JsonValue | undefined {
    if (path in (context.inputOverrides ?? {})) {
        return context.inputOverrides?.[path];
    }
    if (path === "input.text") {
        return context.inputOverrides?.["input.prompt"] ?? readPathValue(context.scope, "input.prompt");
    }
    if (path === "runtime.thread.id" || path === "runtime.session.id") {
        return readPathValue(context.scope, "agent.thread.id");
    }
    if (path === "runtime.user.id" || path === "skillCatalogText" || path === "activatedSkillsText" || path === "activatedSkills") {
        return context.inputOverrides?.[path] ?? "";
    }
    return readPathValue(context.scope, path);
}

/**
 * 按点路径读取 JSON 兼容值。
 */
function readPathValue(source: unknown, path: string): JsonValue | undefined {
    if (!source) {
        return undefined;
    }
    const normalizedPath = path.startsWith("scope.") ? path.slice("scope.".length) : path;
    let current: unknown = source;
    for (const segment of normalizedPath.split(".")) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return isJsonValue(current) ? current : JSON.parse(JSON.stringify(current)) as JsonValue;
}

/**
 * 判断一个值是否可安全放进 JSON DTO。
 */
function isJsonValue(value: unknown): value is JsonValue {
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

/**
 * 文本规范化。
 */
function normalizeText(text: string): string {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && !lines[0]?.trim()) {
        lines.shift();
    }
    while (lines.length > 0 && !lines.at(-1)?.trim()) {
        lines.pop();
    }
    const indents = lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
    const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(Math.min(commonIndent, line.length))).join("\n");
}

/**
 * 规范化 Message 正文片段。JSX 会把表达式之间的换行放进纯空白 JsxText；
 * 这些换行在 Markdown 代码围栏中是有效内容，不能简单丢弃。
 */
function normalizeMessageTextSegment(text: string, hasPendingText: boolean, shouldPreserveExpressionGap: boolean): string {
    const hasTrailingNewline = /\n[ \t]*$/.test(text);
    const normalized = normalizeText(text);
    if (normalized) {
        return hasTrailingNewline ? `${normalized}\n` : normalized;
    }
    if (hasPendingText && shouldPreserveExpressionGap && text.includes("\n")) {
        return "\n";
    }
    return "";
}

/**
 * 解码 JSX 文本里最常见的实体，让可视化编辑器展示真实正文。
 */
function decodeJsxTextEntities(text: string): string {
    return text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", "\"")
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

/**
 * 渲染普通文本；遇到 TSX 保留字符时改用字符串表达式，允许 Message 正文直接包含尖括号。
 */
function renderPlainTextForJsx(text: string): string {
    if (/[<>{}]/.test(text)) {
        return `{${JSON.stringify(text)}}`;
    }
    return escapeTextForJsx(text);
}

/**
 * JSX 文本基础转义。
 */
function escapeTextForJsx(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

/**
 * 缩进多行文本。
 */
function indent(text: string, level: number): string {
    const prefix = "    ".repeat(level);
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

/**
 * 转 PascalCase。
 */
function toPascalCase(value: string): string {
    const normalized = value
        .replace(/\.tsx$/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join("");
    return normalized || "ProfileTemplate";
}

/**
 * 变量插入面板数据。
 */
function buildVariableCatalog(context: PreviewContext = {}): ProfileTemplateDetailDto["variables"] {
    const inputSchema = context.profile?.inputSchema ?? null;
    const runtimeValue = buildRuntimePreviewValue(context);
    const groups: ProfileTemplateVariableGroupDto[] = [
        {
            group: "Input",
            items: buildSchemaItems({
                label: "ctx.input",
                path: "input",
                value: context.scope?.input ?? {},
                schema: inputSchema,
                source: "profile.inputSchema",
                editable: true,
                description: "当前 profile 的输入参数。schema 来自 profile.inputSchema，预览时可用本地覆盖值。",
                context,
            }),
        },
        {
            group: "IDE",
            items: buildSchemaItems({
                label: "scope.ide",
                path: "scope.ide",
                value: context.scope?.ide ?? {},
                schema: IdeVariableSchema,
                source: "clientVariables.ide",
                editable: false,
                description: "Novel IDE 客户端状态，来自 x-agent-client-variables。",
                context,
            }),
        },
        {
            group: "Studio",
            items: buildSchemaItems({
                label: "scope.studio",
                path: "scope.studio",
                value: context.scope?.studio ?? {},
                schema: StudioVariableSchema,
                source: "clientVariables.studio",
                editable: false,
                description: "写作工作台客户端状态，来自 x-agent-client-variables。",
                context,
            }),
        },
        {
            group: "Agent",
            items: buildSchemaItems({
                label: "scope.agent",
                path: "scope.agent",
                value: context.scope?.agent ?? {},
                schema: AgentVariableSchema,
                source: "server.threadContext",
                editable: false,
                description: "服务端线程状态、可用工具、subagent 和任务列表。",
                context,
            }),
        },
        {
            group: "Skills",
            items: [
                createVariableItem({
                    label: "skillCatalogText",
                    path: "skillCatalogText",
                    value: readPreviewVariable("skillCatalogText", context) ?? "",
                    schema: z.string(),
                    source: "ctx.skillCatalogText",
                    editable: false,
                    description: "当前 profile 可见的 skill catalog 文本。",
                    context,
                }),
                createVariableItem({
                    label: "activatedSkillsText",
                    path: "activatedSkillsText",
                    value: readPreviewVariable("activatedSkillsText", context) ?? "",
                    schema: z.string(),
                    source: "ctx.activatedSkillsText",
                    editable: false,
                    description: "当前轮次显式激活的 skill 内容文本。",
                    context,
                }),
                createVariableItem({
                    label: "activatedSkills",
                    path: "activatedSkills",
                    value: readPreviewVariable("activatedSkills", context) ?? "",
                    schema: z.string(),
                    source: "legacy.alias",
                    editable: false,
                    description: "兼容旧模板的 activatedSkills 变量别名。",
                    context,
                }),
            ],
        },
        {
            group: "Runtime",
            items: buildSchemaItems({
                label: "ctx.runtime",
                path: "runtime",
                value: runtimeValue,
                schema: RuntimePreviewSchema,
                source: "runtime.summary",
                editable: false,
                description: "预览安全摘要；不展开完整 runtime 服务对象。",
                context,
            }),
        },
    ];
    return groups;
}

/**
 * 递归构造 schema 驱动的变量树。
 */
function buildSchemaItems(input: {
    label: string;
    path: string;
    value: unknown;
    schema: ZodType | null;
    source: string;
    editable: boolean;
    description: string;
    context: PreviewContext;
}): ProfileTemplateVariableItemDto[] {
    const root = createVariableItem({
        ...input,
        value: input.value,
    });
    const children = buildChildItems({
        parentPath: input.path,
        value: input.value,
        schema: input.schema,
        source: input.source,
        editable: input.editable,
        context: input.context,
    });
    root.children = children;
    return [root, ...flattenVariableItems(children)];
}

/**
 * 构造对象变量的叶子条目。
 */
function buildChildItems(input: {
    parentPath: string;
    value: unknown;
    schema: ZodType | null;
    source: string;
    editable: boolean;
    context: PreviewContext;
}): ProfileTemplateVariableItemDto[] {
    const entries = readObjectEntries(input.value);
    if (entries.length === 0) {
        return [];
    }
    const shape = readZodShape(input.schema);
    return entries.map(([key, value]) => {
        const path = `${input.parentPath}.${key}`;
        const schema = shape?.[key] ?? null;
        const item = createVariableItem({
            label: key,
            path,
            value,
            schema,
            source: input.source,
            editable: input.editable,
            description: readSchemaDescription(schema),
            context: input.context,
        });
        item.children = buildChildItems({
            parentPath: path,
            value,
            schema,
            source: input.source,
            editable: input.editable,
            context: input.context,
        });
        return item;
    });
}

/**
 * 将变量树扁平化，保持旧侧栏和 token 搜索都能看到深层叶子。
 */
function flattenVariableItems(items: ProfileTemplateVariableItemDto[]): ProfileTemplateVariableItemDto[] {
    const flattened: ProfileTemplateVariableItemDto[] = [];
    for (const item of items) {
        flattened.push(item);
        if (item.children?.length) {
            flattened.push(...flattenVariableItems(item.children));
        }
    }
    return flattened;
}

/**
 * 构造单个变量展示条目。
 */
function createVariableItem(input: {
    label: string;
    path: string;
    value: unknown;
    schema: ZodType | null;
    source: string;
    editable: boolean;
    description?: string;
    context: PreviewContext;
}): ProfileTemplateVariableItemDto {
    const currentValue = readPreviewVariable(input.path, input.context) ?? toJsonValue(input.value) ?? null;
    return {
        label: input.label,
        value: toVariableToken(input.path),
        token: toVariableToken(input.path),
        path: input.path,
        editable: input.editable && isEditablePreviewPath(input.path),
        currentValue,
        description: input.description || readSchemaDescription(input.schema),
        valueType: readValueType(currentValue),
        source: input.source,
        schema: toJsonSchema(input.schema),
    };
}

/**
 * 构造 runtime 的安全摘要，避免把服务对象暴露给预览面板。
 */
function buildRuntimePreviewValue(context: PreviewContext): JsonValue {
    return {
        thread: {
            id: context.scope?.agent.thread.id ?? null,
            status: context.scope?.agent.thread.status ?? null,
        },
        profile: {
            key: context.profile?.key ? String(context.profile.key) : context.scope?.agent.profileKey ? String(context.scope.agent.profileKey) : null,
            kind: context.profile?.kind ?? context.scope?.agent.kind ?? null,
            name: context.profile?.name ?? null,
        },
    } satisfies JsonValue;
}

/**
 * 判断变量是否允许在预览调试面板覆盖。
 */
function isEditablePreviewPath(path: string): boolean {
    return path === "input.prompt" || path === "input.text";
}

/**
 * 变量 path 转模板 token。
 */
function toVariableToken(path: string): string {
    return `\${${path}}`;
}

/**
 * 从 Zod schema 读取 JSON Schema。
 */
function toJsonSchema(schema: ZodType | null): Record<string, unknown> | null {
    if (!schema) {
        return null;
    }
    try {
        const result = z.toJSONSchema(schema, {
            unrepresentable: "any",
        });
        return result && typeof result === "object" ? result as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

/**
 * 读取 schema 描述。
 */
function readSchemaDescription(schema: ZodType | null): string | undefined {
    return typeof schema?.description === "string" && schema.description.trim()
        ? schema.description
        : undefined;
}

/**
 * 尽量读取 Zod object shape。复杂 union 无法稳定展开时返回 null。
 */
function readZodShape(schema: ZodType | null): Record<string, ZodType> | null {
    let current: unknown = schema;
    while (current && typeof current === "object" && "_def" in current) {
        const def = (current as {_def?: Record<string, unknown>})._def;
        if (!def) {
            break;
        }
        if (def.type === "optional" || def.type === "nullable" || def.type === "default") {
            current = def.innerType;
            continue;
        }
        if (def.type === "pipe" && def.out) {
            current = def.out;
            continue;
        }
        break;
    }
    if (!current || typeof current !== "object" || !("shape" in current)) {
        return null;
    }
    const shape = (current as {shape: Record<string, ZodType> | (() => Record<string, ZodType>)}).shape;
    return typeof shape === "function" ? shape() : shape;
}

/**
 * 读取对象条目，非对象不展开。
 */
function readObjectEntries(value: unknown): Array<[string, unknown]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
    }
    return Object.entries(value);
}

/**
 * 读取变量值类型标签。
 */
function readValueType(value: unknown): string {
    if (value === null || value === undefined) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}

/**
 * 转换为 JSON DTO 可承载值。
 */
function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (isJsonValue(value)) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

