import {readdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {basename, resolve} from "node:path";
import {createError} from "h3";
import type * as TypeScript from "typescript";
import type {
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
import type {AgentVariableScope, JsonValue} from "nbook/server/agent/types";

const TEMPLATE_DIR = resolve(process.cwd(), "server/agent/profiles/templates");
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;
const COMPONENT_NAMES = new Set([
    "ProfilePrompt",
    "HistorySet",
    "DynamicSet",
    "AppendingSet",
    "Message",
    "Reminder",
    "Watch",
    "If",
    "SkillCatalog",
    "ActivatedSkills",
]);

type ParsedTemplate = {
    root: ProfileTemplateNodeDto | null;
    issues: ProfileTemplateIssueDto[];
};

type PreviewContext = {
    scope?: AgentVariableScope;
    inputOverrides?: Record<string, JsonValue>;
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
    await writeFile(resolveTemplatePath(fileName), source.endsWith("\n") ? source : `${source}\n`, "utf-8");
    return readProfileTemplate(fileName);
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
}): ProfileTemplatePreviewDto {
    const source = input.source ?? generateProfileTemplateSource("preview-template", input.root);
    const parsed = parseProfileTemplateSource(source);
    const messages: ProfileTemplatePreviewMessageDto[] = [];
    const previewContext = {
        scope: input.scope,
        inputOverrides: input.inputOverrides,
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
    const rootExpression = findReturnedJsx(sourceFile);
    if (!rootExpression) {
        return {
            root: null,
            issues: [{
                severity: "error",
                message: "模板必须导出函数并 return <ProfilePrompt> 根节点",
            }],
        };
    }
    const root = parseJsxExpression(sourceFile, rootExpression, issues);
    validateTemplateTree(root, issues);
    return {root, issues};
}

/**
 * 从结构化树生成规范 TSX 模板。
 */
export function generateProfileTemplateSource(templateName: string, root: ProfileTemplateNodeDto | undefined): string {
    const componentNames = collectComponentNames(root);
    const promptImportNames = ["Message", ...(componentNames.has("If") ? ["If"] : [])];
    const profileImportNames = [...componentNames].filter((name) => name !== "Message" && name !== "If").sort();
    const functionName = toPascalCase(templateName || "ProfileTemplate");
    return [
        "/** @jsxRuntime automatic */",
        "/** @jsxImportSource nbook/server/agent/prompts */",
        "",
        `import {${promptImportNames.join(", ")}} from "nbook/server/agent/prompts";`,
        `import {${profileImportNames.join(", ")}} from "nbook/server/agent/profiles/simple-profile";`,
        "import type {ProfilePromptContext} from \"nbook/server/agent/profiles/simple-profile\";",
        "",
        `export default function ${functionName}(ctx: ProfilePromptContext<"leader.default">) {`,
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
 * 找到导出函数里的 return JSX。
 */
function findReturnedJsx(sourceFile: TypeScript.SourceFile): TypeScript.Expression | null {
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
    visit(sourceFile);
    return found;
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
 * 解析 JSX 表达式为低代码节点。
 */
function parseJsxExpression(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    issues: ProfileTemplateIssueDto[],
): ProfileTemplateNodeDto | null {
    if (ts.isJsxElement(expression)) {
        return parseJsxElement(sourceFile, expression, issues);
    }
    if (ts.isJsxSelfClosingElement(expression)) {
        return parseSelfClosingElement(sourceFile, expression, issues);
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
): ProfileTemplateNodeDto | null {
    const type = element.openingElement.tagName.getText(sourceFile);
    if (!isComponentType(type)) {
        issues.push(buildUnsupportedComponentIssue(sourceFile, type, element));
        return null;
    }
    const parsedChildren = type === "Message"
        ? parseMessageChildren(sourceFile, element.children, issues)
        : {text: undefined, children: parseChildren(sourceFile, element.children, issues)};
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
): {
    text?: string;
    textKind?: "text" | "source";
    children: ProfileTemplateNodeDto[];
} {
    const plainTextParts: string[] = [];
    const sourceTextParts: string[] = [];
    const nestedChildren: ProfileTemplateNodeDto[] = [];
    let hasSourceText = false;
    for (const child of children) {
        if (ts.isJsxText(child)) {
            const rawText = child.getText(sourceFile).replace(/\r\n/g, "\n");
            const text = normalizeText(decodeJsxTextEntities(rawText));
            if (text) {
                plainTextParts.push(text);
            }
            if (rawText.trim()) {
                sourceTextParts.push(decodeJsxTextEntities(rawText));
            }
            continue;
        }
        if (ts.isJsxExpression(child) && child.expression) {
            const expression = child.expression;
            if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
                plainTextParts.push(expression.text);
                sourceTextParts.push(expression.text);
                continue;
            }
            sourceTextParts.push(child.getText(sourceFile));
            hasSourceText = true;
            continue;
        }
        if (ts.isJsxElement(child)) {
            if (isInlineTextElement(sourceFile, child)) {
                const text = renderInlineTextElement(sourceFile, child);
                plainTextParts.push(text);
                sourceTextParts.push(text);
                continue;
            }
            const node = parseJsxElement(sourceFile, child, issues);
            if (node) {
                nestedChildren.push(node);
                hasSourceText = true;
            }
            continue;
        }
        if (ts.isJsxSelfClosingElement(child)) {
            if (isInlineTextElement(sourceFile, child)) {
                const text = renderInlineTextElement(sourceFile, child);
                plainTextParts.push(text);
                sourceTextParts.push(text);
                continue;
            }
            const node = parseSelfClosingElement(sourceFile, child, issues);
            if (node) {
                nestedChildren.push(node);
                hasSourceText = true;
            }
        }
    }
    const hasInlineSource = hasSourceText;
    return {
        ...(hasInlineSource ? {text: sourceTextParts.join("")} : plainTextParts.length > 0 ? {text: plainTextParts.join("\n")} : {}),
        ...(hasInlineSource ? {textKind: "source" as const} : {}),
        children: nestedChildren,
    };
}

/**
 * 解析自闭合 JSX 节点。
 */
function parseSelfClosingElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxSelfClosingElement,
    issues: ProfileTemplateIssueDto[],
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
): ProfileTemplateNodeDto[] {
    const result: ProfileTemplateNodeDto[] = [];
    for (const child of children) {
        if (ts.isJsxText(child)) {
            const text = child.getText(sourceFile).replace(/\r\n/g, "\n");
            if (text.trim()) {
                result.push({
                    id: createNodeId("Text"),
                    type: "Message",
                    props: {role: "system"},
                    children: [],
                    text: normalizeText(text),
                    editable: false,
                    sourceRange: {start: child.getStart(sourceFile), end: child.getEnd()},
                });
                issues.push({
                    severity: "warning",
                    message: "检测到裸文本；低代码编辑器会以不可编辑文本节点显示",
                    nodeId: result.at(-1)?.id,
                    path: buildSourceLocation(sourceFile, child.getStart(sourceFile)),
                    sourceRange: {start: child.getStart(sourceFile), end: child.getEnd()},
                });
            }
            continue;
        }
        if (ts.isJsxElement(child)) {
            const node = parseJsxElement(sourceFile, child, issues);
            if (node) {
                result.push(node);
            }
            continue;
        }
        if (ts.isJsxSelfClosingElement(child)) {
            const node = parseSelfClosingElement(sourceFile, child, issues);
            if (node) {
                result.push(node);
            }
            continue;
        }
        if (ts.isJsxExpression(child) && child.expression) {
            const node = parseExpressionChild(sourceFile, child.expression, issues);
            if (node) {
                result.push(node);
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
): ProfileTemplateNodeDto | null {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return {
            id: createNodeId("Text"),
            type: "Message",
            props: {role: "system"},
            children: [],
            text: `{${expression.getText(sourceFile)}}`,
            textKind: "source",
            editable: false,
            sourceRange: {start: expression.getStart(sourceFile), end: expression.getEnd()},
        };
    }
    if (ts.isConditionalExpression(expression)) {
        const whenTrue = parseExpressionAsChildren(sourceFile, expression.whenTrue, issues);
        return {
            id: createNodeId("If"),
            type: "If",
            props: {condition: expression.condition.getText(sourceFile)},
            children: whenTrue,
            editable: true,
            sourceRange: {start: expression.getStart(sourceFile), end: expression.getEnd()},
        };
    }
    const text = `{${expression.getText(sourceFile)}}`;
    return {
        id: createNodeId("Expression"),
        type: "Message",
        props: {role: "system"},
        children: [],
        text,
        textKind: "source",
        editable: false,
        sourceRange: {start: expression.getStart(sourceFile), end: expression.getEnd()},
    };
}

/**
 * 把表达式解析为节点数组。
 */
function parseExpressionAsChildren(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    issues: ProfileTemplateIssueDto[],
): ProfileTemplateNodeDto[] {
    const unwrapped = unwrapParenthesized(expression);
    if (ts.isJsxElement(unwrapped)) {
        const node = parseJsxElement(sourceFile, unwrapped, issues);
        return node ? [node] : [];
    }
    if (ts.isJsxSelfClosingElement(unwrapped)) {
        const node = parseSelfClosingElement(sourceFile, unwrapped, issues);
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
            if (node.children.some((child) => child.type === "Message")) {
                issues.push({
                    severity: "error",
                    message: "Message 节点内不能放 Message 节点",
                    nodeId: node.id,
                });
            }
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
        if (node.text?.trim() && node.type !== "Message" && ancestors.at(-1)?.type !== "Message" && node.editable) {
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
        const ownText = source === "input" && !node.text
            ? readVariableAsText("input.prompt", context)
            : replaceVariableTokens(renderPreviewMessageText(node), context);
        return [{
            role: String(node.props.role ?? "system"),
            text: [
                ownText,
                ...node.children.flatMap((child) => collectPreviewMessages(child, context).map((message) => message.text)),
            ].filter(Boolean).join(""),
            source,
        }];
    }
    if (node.type === "SkillCatalog") {
        return [{role: "system", text: replaceVariableTokens(String(node.props.text ?? "{{skillCatalogText}}"), context), source: null}];
    }
    if (node.type === "ActivatedSkills") {
        return [{role: "human", text: replaceVariableTokens(String(node.props.text ?? "{{activatedSkillsText}}"), context), source: null}];
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
 * 生成节点 TSX。
 */
function generateNodeSource(node: ProfileTemplateNodeDto): string {
    const props = generateProps(node.props);
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
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
        return node.text ?? "";
    }
    return node.text ? renderPlainTextForJsx(node.text) : "";
}

/**
 * 预览阶段替换常见变量 token。
 */
function replaceVariableTokens(text: string, context: PreviewContext): string {
    return text.replace(/\{\{([^{}]+)}}/g, (_match, rawPath: string) => {
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
    return text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
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
    const item = (
        label: string,
        value: string,
        path: string,
        editable = false,
    ): ProfileTemplateVariableItemDto => ({
        label,
        value,
        path,
        editable,
        currentValue: readPreviewVariable(path, context) ?? null,
    });
    const groups: ProfileTemplateVariableGroupDto[] = [
        {
            group: "input",
            items: [
                item("用户输入", "{{input.prompt}}", "input.prompt", true),
                item("用户输入（兼容）", "{{input.text}}", "input.text", true),
                item("输入文件", "{{input.files}}", "input.files"),
                item("输入元数据", "{{input.metadata}}", "input.metadata"),
            ],
        },
        {
            group: "scope",
            items: [
                item("工作区", "{{scope.studio.workspace}}", "scope.studio.workspace"),
                item("当前章节", "{{scope.studio.currentChapterLabel}}", "scope.studio.currentChapterLabel"),
                item("剧情线程", "{{scope.studio.extra.selectedStoryThreadId}}", "scope.studio.extra.selectedStoryThreadId"),
                item("剧情场景", "{{scope.studio.extra.selectedStorySceneId}}", "scope.studio.extra.selectedStorySceneId"),
                item("任务状态", "{{scope.agent.tasks}}", "scope.agent.tasks"),
                item("关联 Subagent", "{{scope.agent.subagents}}", "scope.agent.subagents"),
            ],
        },
        {
            group: "skill",
            items: [
                item("激活技能文本", "{{activatedSkillsText}}", "activatedSkillsText"),
                item("激活技能", "{{activatedSkills}}", "activatedSkills"),
            ],
        },
        {
            group: "runtime",
            items: [
                item("线程 ID", "{{runtime.thread.id}}", "runtime.thread.id"),
                item("用户 ID", "{{runtime.user.id}}", "runtime.user.id"),
                item("会话 ID", "{{runtime.session.id}}", "runtime.session.id"),
            ],
        },
    ];
    return groups;
}

