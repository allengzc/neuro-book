import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Command} from "commander";
import * as yaml from "yaml";
import {
    workspaceContentJsonSchema,
    WORKSPACE_CONTENT_STATUSES,
    WORKSPACE_CONTENT_TYPES,
    WORKSPACE_STATUS_DESCRIPTIONS,
    type WorkspaceContentStatus,
    type WorkspaceContentType,
} from "nbook/server/workspace-files/content-node-schema";
import {renderWorkspaceContentTemplateBundle, renderWorkspaceStateTemplate} from "nbook/server/workspace-files/content-node-templates";
import {
    createWorkspaceContentState,
    createWorkspaceDirectory,
    parseMarkdownDocument,
    resolveWorkspacePath,
    statWorkspacePath,
    toWorkspaceDisplayPath,
    type WorkspaceFileIssue,
    validateWorkspaceContentNodes,
} from "nbook/server/workspace-files/workspace-files";
import {initProjectDatabaseAtRoot, PROJECT_DATABASE_RELATIVE_PATH} from "nbook/server/workspace-files/project-workspace";

type WorkspaceNodeNewOptions = {
    title?: string;
    status: string;
    type: string;
    state: boolean;
};

type WorkspaceNodeParseOptions = {
    stdin: boolean;
    null: boolean;
    json: boolean;
    ndjson: boolean;
    body: boolean;
    absolute: boolean;
};

type WorkspaceNodeValidateOptions = {
    stdin: boolean;
    null: boolean;
    json: boolean;
    recursive: boolean;
    fixMissing: boolean;
};

type WorkspaceSchemaOptions = {
    json: boolean;
};

type WorkspaceProjectCreateOptions = {
    title?: string;
    summary?: string;
    template?: string;
    json: boolean;
    db: boolean;
};

type ResolvedWorkspaceTarget = {
    root: string;
    relativePath: string;
};

type CreatedProjectWorkspace = {
    projectPath: string;
    absolutePath: string;
    title: string;
    summary: string;
    templateRoot: string;
    databasePath: string | null;
};

type ProjectTemplateSource = {
    root: string;
    overlay: boolean;
};

type ParsedContentNode = {
    path: string;
    indexPath: string;
    statePath: string | null;
    type: string | null;
    status: string | null;
    title: string;
    summary: string;
    words: number;
    refs: string[];
    frontmatter: Record<string, unknown>;
    frontmatterError: string | null;
    state: {
        path: string;
        frontmatter: Record<string, unknown>;
        frontmatterError: string | null;
        words: number;
    } | null;
    body?: string;
    absolutePath?: string;
    absoluteIndexPath?: string;
    absoluteStatePath?: string | null;
};

const program = new Command();
const INVOCATION_CWD = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_METADATA_FILE = "workspace.yaml";
const PROJECT_METADATA_FILE = "project.yaml";
const DEFAULT_TEMPLATE_NAME = "novel-directory-templates";
const WORKSPACE_ROOT_NAME = "workspace";
const SYSTEM_TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "templates");

program
    .name("workspace")
    .description("工作区内容节点脚手架、解析、校验与 schema 查看工具");

const nodeCommand = program
    .command("node")
    .description("处理 lorebook/manuscript 标准内容节点");

const projectCommand = program
    .command("project")
    .description("创建和维护 Project Workspace");

projectCommand
    .command("create")
    .description("从模板创建新的小说 Project Workspace")
    .argument("<project>", "Project Path，例如 workspace/my-novel；在 Workspace Root 内执行时也可写 my-novel")
    .option("--title <title>", "project.yaml title，默认从目录名推断")
    .option("--summary <summary>", "project.yaml summary", "")
    .option("--template <template>", "模板目录名或绝对路径", DEFAULT_TEMPLATE_NAME)
    .option("--json", "输出 JSON", false)
    .option("--no-db", "只创建文件模板，不初始化 .nbook/project.sqlite")
    .action(async (project: string, options: WorkspaceProjectCreateOptions) => {
        try {
            const created = await createProjectWorkspace(project, options);
            if (options.json) {
                console.log(JSON.stringify(created, null, 2));
                return;
            }

            console.log(`Created ${created.projectPath}`);
            console.log(`Title: ${created.title}`);
            console.log(`Template: ${created.templateRoot}`);
            if (created.databasePath) {
                console.log(`Database: ${created.databasePath}`);
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("new")
    .description("创建标准内容节点目录并写入 index.md")
    .argument("<target>", "要创建的内容节点目录")
    .requiredOption("--type <type>", "frontmatter type")
    .option("--title <title>", "frontmatter title")
    .option("--status <status>", "frontmatter status", "draft")
    .option("--state", "同时创建 state.md", false)
    .action(async (target: string, options: WorkspaceNodeNewOptions) => {
        try {
            assertValidContentType(options.type);
            assertValidStatus(options.status);
            const resolvedTarget = await resolveSingleWorkspaceTarget(target);
            const content = renderWorkspaceContentTemplateBundle({
                title: options.title?.trim() || inferTitle(resolvedTarget.relativePath),
                type: options.type,
                status: options.status,
            }, options.state);
            const node = await createWorkspaceDirectory({
                root: resolvedTarget.root,
                dirPath: resolvedTarget.relativePath,
                indexContent: content.indexContent,
                stateContent: content.stateContent,
            });

            console.log(node.path);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("state")
    .description("给已有内容节点创建 state.md")
    .argument("<target>", "内容节点目录或 index.md")
    .action(async (target: string) => {
        try {
            const resolvedTarget = await resolveSingleWorkspaceTarget(target);
            const node = await statWorkspacePath(resolvedTarget.root, resolvedTarget.relativePath);
            if (!node.isDirectory || !node.contentNode) {
                throw new Error(`目标不是标准内容节点目录: ${node.path}`);
            }
            const nodeType = node.entryType ?? "";
            assertValidContentType(nodeType);
            const stateContent = renderWorkspaceStateTemplate({
                title: node.title || inferTitle(node.path),
                type: nodeType,
                status: readTemplateStatus(node.status),
            });
            const nextNode = await createWorkspaceContentState({
                root: resolvedTarget.root,
                dirPath: resolvedTarget.relativePath,
                stateContent,
            });

            console.log(nextNode.state?.path ?? path.posix.join(nextNode.path.replace(/\/$/, ""), "state.md"));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("parse")
    .description("解析指定内容节点")
    .argument("[targets...]", "内容节点目录或 index.md")
    .option("--stdin", "从 stdin 读取路径列表", false)
    .option("-0, --null", "stdin 使用 NUL 分隔", false)
    .option("--json", "输出 JSON 数组", false)
    .option("--ndjson", "每个节点输出一行 JSON", false)
    .option("--body", "JSON/NDJSON 中包含正文 body", false)
    .option("--absolute", "JSON/NDJSON 中额外输出绝对路径字段", false)
    .action(async (targets: string[], options: WorkspaceNodeParseOptions) => {
        try {
            assertCompatibleOutputOptions(options);
            const inputTargets = await collectInputTargets(targets, options);
            const resolvedTargets = await resolveWorkspaceTargets(inputTargets);
            const nodes = await Promise.all(resolvedTargets.map((target) => parseContentNode(target, options)));

            if (options.json) {
                console.log(JSON.stringify(nodes, null, 2));
                return;
            }
            if (options.ndjson) {
                for (const node of nodes) {
                    console.log(JSON.stringify(node));
                }
                return;
            }
            printParsedContentNodes(nodes);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

nodeCommand
    .command("validate")
    .description("校验指定内容节点")
    .argument("[targets...]", "内容节点目录或 index.md")
    .option("--stdin", "从 stdin 读取路径列表", false)
    .option("-0, --null", "stdin 使用 NUL 分隔", false)
    .option("--json", "输出 JSON", false)
    .option("--recursive", "递归校验目标目录下的内容节点", false)
    .option("--fix-missing", "校验时写回缺失的标准 frontmatter 字段", false)
    .action(async (targets: string[], options: WorkspaceNodeValidateOptions) => {
        try {
            const inputTargets = await collectInputTargets(targets, options);
            const resolvedTargets = await resolveWorkspaceTargets(inputTargets);
            const root = assertSingleWorkspaceRoot(resolvedTargets);
            const result = await validateWorkspaceContentNodes({
                root,
                targets: resolvedTargets.map((target) => target.relativePath),
                recursive: options.recursive,
                fixMissing: options.fixMissing,
            });

            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                printIssues(result.issues);
                printFixedPaths(result.fixedPaths);
            }

            if (result.issues.some((issue) => issue.level === "P1" || issue.level === "P2")) {
                process.exitCode = 1;
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program
    .command("schema")
    .description("查看内容节点 frontmatter schema")
    .argument("[type]", "内容节点类型，例如 character")
    .option("--json", "输出 JSON", false)
    .action((type: string | undefined, options: WorkspaceSchemaOptions) => {
        const schema = workspaceContentJsonSchema(type);
        if (options.json) {
            console.log(JSON.stringify(schema, null, 2));
            return;
        }

        console.log(renderSchemaMarkdown(type, schema));
    });

await program.parseAsync(process.argv);

/**
 * 校验 status 参数，避免脚手架生成旧状态。
 */
function assertValidStatus(status: string): asserts status is WorkspaceContentStatus {
    if (!WORKSPACE_CONTENT_STATUSES.includes(status as WorkspaceContentStatus)) {
        throw new Error(`status 必须是 ${WORKSPACE_CONTENT_STATUSES.join("、")}`);
    }
}

/**
 * 读取用于渲染模板的 status；旧节点缺失或非法时回退为 draft。
 */
function readTemplateStatus(status: string | null): WorkspaceContentStatus {
    if (WORKSPACE_CONTENT_STATUSES.includes(status as WorkspaceContentStatus)) {
        return status as WorkspaceContentStatus;
    }
    return "draft";
}

/**
 * 校验内容节点类型参数。
 */
function assertValidContentType(type: string): asserts type is WorkspaceContentType {
    if (!WORKSPACE_CONTENT_TYPES.includes(type as WorkspaceContentType)) {
        throw new Error(`type 必须是 ${WORKSPACE_CONTENT_TYPES.join("、")}`);
    }
}

/**
 * 校验输出参数组合，避免管道输出不可解析。
 */
function assertCompatibleOutputOptions(options: WorkspaceNodeParseOptions): void {
    if (options.json && options.ndjson) {
        throw new Error("--json 与 --ndjson 不能同时使用");
    }
    if (options.body && !options.json && !options.ndjson) {
        throw new Error("--body 只能与 --json 或 --ndjson 一起使用");
    }
    if (options.absolute && !options.json && !options.ndjson) {
        throw new Error("--absolute 只能与 --json 或 --ndjson 一起使用");
    }
}

/**
 * 合并命令行路径与 stdin 路径。
 */
async function collectInputTargets(
    targets: string[],
    options: {stdin: boolean; null: boolean},
): Promise<string[]> {
    const stdinTargets = options.stdin
        ? splitStdinTargets(await readStdinText(), options.null)
        : [];
    const inputTargets = [...targets, ...stdinTargets]
        .map((target) => target.trim())
        .filter(Boolean);

    if (inputTargets.length === 0) {
        throw new Error("至少需要提供一个内容节点路径");
    }
    return inputTargets;
}

/**
 * 读取标准输入文本。
 */
async function readStdinText(): Promise<string> {
    process.stdin.setEncoding("utf-8");
    let text = "";
    for await (const chunk of process.stdin) {
        text += String(chunk);
    }
    return text;
}

/**
 * 按普通换行或 NUL 分隔 stdin 路径。
 */
function splitStdinTargets(text: string, nullSeparated: boolean): string[] {
    return text
        .split(nullSeparated ? "\0" : /\r?\n/)
        .map((target) => target.trim())
        .filter(Boolean);
}

/**
 * 解析多个输入目标，并确认它们属于同一个 workspace。
 */
async function resolveWorkspaceTargets(targets: string[]): Promise<ResolvedWorkspaceTarget[]> {
    const resolvedTargets = await Promise.all(targets.map((target) => resolveSingleWorkspaceTarget(target)));
    assertSingleWorkspaceRoot(resolvedTargets);
    return uniqueResolvedTargets(resolvedTargets);
}

/**
 * 解析单个输入路径到 workspace root 与内容节点目录相对路径。
 */
async function resolveSingleWorkspaceTarget(target: string): Promise<ResolvedWorkspaceTarget> {
    const absoluteTarget = path.isAbsolute(target)
        ? path.resolve(target)
        : path.resolve(INVOCATION_CWD, target);
    const root = await findWorkspaceRoot(absoluteTarget);
    const contentDirectoryPath = normalizeContentNodeDirectoryPath(root, absoluteTarget);
    return {
        root,
        relativePath: toWorkspaceDisplayPath(root, contentDirectoryPath, true).replace(/\/$/, "") || ".",
    };
}

/**
 * 从模板创建 Project Workspace，并写入当前 Project manifest。
 */
async function createProjectWorkspace(
    project: string,
    options: WorkspaceProjectCreateOptions,
): Promise<CreatedProjectWorkspace> {
    const target = resolveProjectTarget(project);
    if (await pathExists(target.absolutePath)) {
        throw new Error(`Project Workspace 已存在: ${target.projectPath}`);
    }

    const templateSources = await resolveProjectTemplateSources(options.template ?? DEFAULT_TEMPLATE_NAME);
    const templateRoot = templateSources.map((source) => source.root).join(" + ");
    await fs.mkdir(path.dirname(target.absolutePath), {recursive: true});
    const stagingRoot = await fs.mkdtemp(path.join(path.dirname(target.absolutePath), `.${target.projectSlug}.creating-`));
    try {
        for (const source of templateSources) {
            await fs.cp(source.root, stagingRoot, {
                recursive: true,
                force: source.overlay,
                errorOnExist: !source.overlay,
            });
        }
        await normalizeProjectTemplateArtifacts(stagingRoot);

        const title = options.title?.trim() || inferProjectTitle(target.projectSlug);
        const summary = options.summary?.trim() ?? "";
        await fs.writeFile(path.join(stagingRoot, PROJECT_METADATA_FILE), yaml.stringify({
            kind: "novel",
            title,
            summary,
        }), "utf-8");

        const databasePath = options.db === false ? null : path.join(target.absolutePath, PROJECT_DATABASE_RELATIVE_PATH);
        if (options.db !== false) {
            await initProjectDatabaseAtRoot(stagingRoot);
        }
        await fs.cp(stagingRoot, target.absolutePath, {
            recursive: true,
            force: false,
            errorOnExist: true,
        });
        await removeDirectoryWithRetry(stagingRoot);
        return {
            projectPath: target.projectPath,
            absolutePath: target.absolutePath,
            title,
            summary,
            templateRoot,
            databasePath,
        };
    } catch (error) {
        await removeDirectoryWithRetry(stagingRoot).catch(() => undefined);
        throw error;
    }
}

/**
 * 清理旧 novel workspace 模板产物，避免新 Project Workspace 继续暴露 workspace.yaml 心智。
 */
async function normalizeProjectTemplateArtifacts(projectRoot: string): Promise<void> {
    await fs.rm(path.join(projectRoot, WORKSPACE_METADATA_FILE), {force: true});
    const statusPath = path.join(projectRoot, "PROJECT-STATUS.md");
    try {
        const content = await fs.readFile(statusPath, "utf-8");
        const normalizedContent = content.replace("已创建 `workspace.yaml`、", "已创建 `project.yaml`、");
        if (normalizedContent !== content) {
            await fs.writeFile(statusPath, normalizedContent, "utf-8");
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}

/**
 * 解析 Project 创建目标；从仓库根执行时允许 workspace/<slug>，从 Workspace Root 执行时允许 <slug>。
 */
function resolveProjectTarget(project: string): {projectSlug: string; projectPath: string; absolutePath: string} {
    const normalizedProject = project.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!normalizedProject || normalizedProject.includes("..") || path.posix.isAbsolute(normalizedProject)) {
        throw new Error("project 必须是 workspace/<project> 或单段 project 目录名");
    }

    const parts = normalizedProject.split("/").filter(Boolean);
    const projectSlug = parts.length === 2 && parts[0] === WORKSPACE_ROOT_NAME
        ? parts[1]
        : parts.length === 1
            ? parts[0]
            : "";
    if (!projectSlug || !/^[a-z0-9][a-z0-9._-]*$/i.test(projectSlug)) {
        throw new Error("project 只能是 workspace 下的单段目录名，支持字母、数字、点、下划线和连字符");
    }

    const workspaceRoot = resolveWorkspaceContainerRoot();
    const absolutePath = path.join(workspaceRoot, projectSlug);
    return {
        projectSlug,
        projectPath: path.posix.join(WORKSPACE_ROOT_NAME, projectSlug),
        absolutePath,
    };
}

/**
 * 推断 Workspace Root 的绝对路径，兼容从仓库根、Workspace Root 或某个 Project Workspace 内执行。
 */
function resolveWorkspaceContainerRoot(): string {
    const cwd = path.resolve(INVOCATION_CWD);
    if (path.basename(cwd) === WORKSPACE_ROOT_NAME) {
        return cwd;
    }
    if (path.basename(path.dirname(cwd)) === WORKSPACE_ROOT_NAME) {
        return path.dirname(cwd);
    }
    return path.join(cwd, WORKSPACE_ROOT_NAME);
}

/**
 * 查找 Project 模板目录；优先使用当前 Workspace Root 的用户覆盖层，再回退到 bundled 模板。
 */
async function resolveProjectTemplateSources(template: string): Promise<ProjectTemplateSource[]> {
    const trimmedTemplate = template.trim();
    if (!trimmedTemplate) {
        throw new Error("template 不能为空");
    }
    if (path.isAbsolute(trimmedTemplate)) {
        const templateRoot = path.resolve(trimmedTemplate);
        if (await isDirectory(templateRoot)) {
            return [{root: templateRoot, overlay: false}];
        }
        throw new Error(`找不到 Project 模板: ${trimmedTemplate}`);
    }

    const systemRoot = path.join(SYSTEM_TEMPLATE_ROOT, trimmedTemplate);
    const userRoot = path.join(resolveWorkspaceContainerRoot(), ".nbook", "templates", trimmedTemplate);
    const sources: ProjectTemplateSource[] = [];
    if (await isDirectory(systemRoot)) {
        sources.push({root: systemRoot, overlay: false});
    }
    if (userRoot !== systemRoot && await isDirectory(userRoot)) {
        sources.push({root: userRoot, overlay: sources.length > 0});
    }
    if (sources.length > 0) {
        return sources;
    }
    throw new Error(`找不到 Project 模板: ${trimmedTemplate}`);
}

/**
 * 从路径向上寻找最近的 workspace.yaml。
 */
async function findWorkspaceRoot(startPath: string): Promise<string> {
    let currentPath = await readExistingDirectoryOrSelf(startPath);
    while (true) {
        if (await pathExists(path.join(currentPath, WORKSPACE_METADATA_FILE))) {
            return currentPath;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            throw new Error(`找不到 ${WORKSPACE_METADATA_FILE}，请在具体 novel workspace 内执行，或传入该 workspace 内的绝对路径`);
        }
        currentPath = parentPath;
    }
}

/**
 * 读取已存在目录；路径不存在时从原路径开始向上回溯。
 */
async function readExistingDirectoryOrSelf(startPath: string): Promise<string> {
    let currentPath = path.resolve(startPath);
    while (true) {
        try {
            const stat = await fs.stat(currentPath);
            return stat.isDirectory() ? currentPath : path.dirname(currentPath);
        } catch {
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) {
                return path.resolve(startPath);
            }
            currentPath = parentPath;
        }
    }
}

/**
 * 将目录或 index.md 输入统一成内容节点目录绝对路径。
 */
function normalizeContentNodeDirectoryPath(root: string, absoluteTarget: string): string {
    const safeTarget = resolveWorkspacePath(root, absoluteTarget);
    if (path.basename(safeTarget).toLowerCase() === "index.md") {
        return path.dirname(safeTarget);
    }
    return safeTarget;
}

/**
 * 确认所有目标都属于同一个 workspace，并返回该 root。
 */
function assertSingleWorkspaceRoot(targets: ResolvedWorkspaceTarget[]): string {
    const root = targets[0]?.root;
    if (!root) {
        throw new Error("至少需要提供一个内容节点路径");
    }
    const mixedTarget = targets.find((target) => target.root !== root);
    if (mixedTarget) {
        throw new Error(`一次命令只能处理一个 workspace：${root} 与 ${mixedTarget.root}`);
    }
    return root;
}

/**
 * 去重输入路径，避免管道重复输出同一节点。
 */
function uniqueResolvedTargets(targets: ResolvedWorkspaceTarget[]): ResolvedWorkspaceTarget[] {
    const seen = new Set<string>();
    const result: ResolvedWorkspaceTarget[] = [];
    for (const target of targets) {
        const key = `${target.root}:${target.relativePath}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(target);
    }
    return result;
}

/**
 * 解析标准内容节点，默认不输出正文和绝对路径。
 */
async function parseContentNode(
    target: ResolvedWorkspaceTarget,
    options: Pick<WorkspaceNodeParseOptions, "body" | "absolute">,
): Promise<ParsedContentNode> {
    const node = await statWorkspacePath(target.root, target.relativePath);
    if (!node.isDirectory || !node.contentNode) {
        throw new Error(`目标不是标准内容节点目录: ${node.path}`);
    }

    const absoluteIndexPath = path.join(node.absolutePath, "index.md");
    const content = await fs.readFile(absoluteIndexPath, "utf-8");
    const parsed = parseMarkdownDocument(content);
    return {
        path: node.path,
        indexPath: toWorkspaceDisplayPath(target.root, absoluteIndexPath),
        statePath: node.state?.path ?? null,
        type: node.entryType,
        status: node.status,
        title: node.title,
        summary: node.summary,
        words: node.words,
        refs: node.refs,
        frontmatter: node.frontmatter,
        frontmatterError: node.frontmatterError,
        state: node.state ? {
            path: node.state.path,
            frontmatter: node.state.frontmatter,
            frontmatterError: node.state.frontmatterError,
            words: node.state.words,
        } : null,
        ...(options.body ? {body: parsed.body} : {}),
        ...(options.absolute ? {absolutePath: node.absolutePath, absoluteIndexPath, absoluteStatePath: node.state?.absolutePath ?? null} : {}),
    };
}

/**
 * 打印适合管道查看的内容节点摘要。
 */
function printParsedContentNodes(nodes: ParsedContentNode[]): void {
    for (const node of nodes) {
        console.log([
            node.path,
            node.type ?? "-",
            node.status ?? "-",
            String(node.words),
            String(node.refs.length),
            node.state ? "state" : "-",
            formatTextField(node.title),
        ].join("\t"));
    }
}

/**
 * 让文本表格字段保持单行。
 */
function formatTextField(value: string): string {
    return value.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * 从路径推断标题。
 */
function inferTitle(target: string): string {
    const normalizedTarget = target.endsWith("/index.md")
        ? target.slice(0, -"/index.md".length)
        : target.replace(/\.(?:md|txt)$/i, "");
    const parts = normalizedTarget.split(/[\\/]/).filter(Boolean);
    const baseName = parts.at(-1) ?? "未命名";
    return baseName.replace(/^\d+[-_.\s]+/, "");
}

/**
 * 从 Project 目录名推断展示标题。
 */
function inferProjectTitle(projectSlug: string): string {
    return projectSlug
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "未命名小说";
}

/**
 * 判断路径是否存在。
 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 判断路径是否为目录。
 */
async function isDirectory(filePath: string): Promise<boolean> {
    try {
        return (await fs.stat(filePath)).isDirectory();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/**
 * Windows 下 SQLite 句柄释放偶尔滞后，目录清理需要短重试。
 */
async function removeDirectoryWithRetry(directoryPath: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await fs.rm(directoryPath, {recursive: true, force: true});
            return;
        } catch (error) {
            if (attempt === 4 || !isBusyFileError(error)) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
    }
}

/**
 * 判断是否是 Windows 文件句柄暂未释放导致的临时错误。
 */
function isBusyFileError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error.code === "EBUSY" || error.code === "EPERM");
}

/**
 * 打印校验结果。
 */
function printIssues(issues: WorkspaceFileIssue[]): void {
    if (issues.length === 0) {
        console.log("OK");
        return;
    }

    console.log(formatIssueSummary(issues));
    for (const [filePath, fileIssues] of groupIssuesByPath(issues)) {
        console.log(filePath);
        for (const line of formatIssueLines(fileIssues)) {
            console.log(`  ${line}`);
        }
    }
}

/**
 * 打印自动修复的文件路径。
 */
function printFixedPaths(paths: string[]): void {
    if (paths.length === 0) {
        return;
    }

    console.log("Fixed:");
    for (const fixedPath of paths) {
        console.log(`- ${fixedPath}`);
    }
}

/**
 * 按严重级别生成简短汇总。
 */
function formatIssueSummary(issues: WorkspaceFileIssue[]): string {
    const counts = new Map<string, number>();
    for (const issue of issues) {
        counts.set(issue.level, (counts.get(issue.level) ?? 0) + 1);
    }
    return ["P1", "P2", "P3", "WARN"]
        .map((level) => `${level}:${String(counts.get(level) ?? 0)}`)
        .join(" ");
}

/**
 * 按文件路径分组并排序校验结果。
 */
function groupIssuesByPath(issues: WorkspaceFileIssue[]): Map<string, WorkspaceFileIssue[]> {
    const grouped = new Map<string, WorkspaceFileIssue[]>();
    const sortedIssues = [...issues].sort((left, right) => {
        const pathOrder = left.path.localeCompare(right.path, "zh-Hans-CN");
        if (pathOrder !== 0) {
            return pathOrder;
        }
        return issuePriority(left.level) - issuePriority(right.level);
    });

    for (const issue of sortedIssues) {
        const fileIssues = grouped.get(issue.path) ?? [];
        fileIssues.push(issue);
        grouped.set(issue.path, fileIssues);
    }
    return grouped;
}

/**
 * 将同一文件下的 issue 格式化为紧凑行。
 */
function formatIssueLines(issues: WorkspaceFileIssue[]): string[] {
    const lines: string[] = [];
    const missingFields = issues
        .filter((issue) => issue.code === "missing-frontmatter-field")
        .map((issue) => readFrontmatterFieldFromMessage(issue.message))
        .filter((field): field is string => Boolean(field));

    if (missingFields.length > 0) {
        lines.push(`P2 missing-frontmatter-field x${String(missingFields.length)} - 缺失: ${missingFields.join(", ")}`);
    }

    for (const issue of issues) {
        if (issue.code === "missing-frontmatter-field") {
            continue;
        }
        const lineLabel = issue.line === undefined ? "" : `:${String(issue.line)}`;
        lines.push(`${issue.level} ${issue.code}${lineLabel} - ${issue.message}`);
    }
    return lines;
}

/**
 * 从缺失字段消息中提取 frontmatter 字段路径。
 */
function readFrontmatterFieldFromMessage(message: string): string | null {
    const match = message.match(/^frontmatter\.([^\s]+)\s/);
    return match?.[1] ?? null;
}

/**
 * 将 P1/P2/P3 映射成排序权重。
 */
function issuePriority(level: WorkspaceFileIssue["level"]): number {
    return level === "P1" ? 1 : level === "P2" ? 2 : level === "P3" ? 3 : 4;
}

/**
 * 将 Zod 自动生成的 JSON schema 输出为适合终端阅读的 Markdown。
 */
function renderSchemaMarkdown(type: string | undefined, schema: Record<string, unknown>): string {
    const statuses = WORKSPACE_CONTENT_STATUSES
        .map((status) => `- \`${status}\`：${WORKSPACE_STATUS_DESCRIPTIONS[status]}`)
        .join("\n");
    const fields = Object.entries(readSchemaProperties(schema))
        .map(([name, field]) => `- \`${name}\` (${readSchemaType(field)})：${readSchemaDescription(field)}`)
        .join("\n");

    return [
        `# Workspace Content Schema: ${type?.trim() || "common"}`,
        "",
        "## Status",
        statuses,
        "",
        "## Fields",
        fields,
        "",
        "## Refs",
        "- `refs[].target` 与 inline Markdown link 都使用相对路径。",
        "- 内容节点 target 指向目录并带 `/`，普通文件 target 指向具体文件名。",
    ].join("\n");
}

/**
 * 读取 JSON schema 顶层属性。
 */
function readSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return {};
    }
    return properties as Record<string, Record<string, unknown>>;
}

/**
 * 从 JSON schema 字段里读取类型。
 */
function readSchemaType(field: Record<string, unknown>): string {
    if (Array.isArray(field.type)) {
        return field.type.join(" | ");
    }
    if (Array.isArray(field.anyOf)) {
        return field.anyOf
            .map((item) => typeof item === "object" && item !== null && "type" in item ? String(item.type) : "unknown")
            .join(" | ");
    }
    if (typeof field.type === "string") {
        return field.type;
    }
    if (Array.isArray(field.enum)) {
        return field.enum.map(String).join(" | ");
    }
    if (field.properties) {
        return "object";
    }
    return "unknown";
}

/**
 * 从 JSON schema 字段里读取描述。
 */
function readSchemaDescription(field: Record<string, unknown>): string {
    return typeof field.description === "string" ? field.description : "";
}
