import {
    isExpressionValue,
} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";

/**
 * 生成完整 TSX 模板文件。
 * 注意：这里必须和 server/agent/profile-templates/profile-template-service.ts 的
 * generateProfileTemplateSource 保持同一套包装规则；后续若服务端生成器变化，需要同步这里。
 */
export function generateFullTemplateSource(templateName: string, node: ProfileTemplateNodeDto): string {
    const componentNames = collectComponentNames(node);
    const promptImportNames = ["Message", ...(componentNames.has("AIMessage") ? ["AIMessage"] : []), ...(componentNames.has("If") ? ["If"] : [])];
    const profileImportNames = [...componentNames].filter((name) => !["Message", "AIMessage", "If", "ToolCall"].includes(name)).sort();
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
        indentPreviewSource(generatePreviewNodeSource(node), 2),
        "    );",
        "}",
    ].join("\n");
}

/**
 * 收集模板使用到的组件名。
 */
export function collectComponentNames(node: ProfileTemplateNodeDto): Set<string> {
    const names = new Set<string>(["ProfilePrompt"]);
    walkNode(node, (current) => {
        names.add(current.type);
    });
    return names;
}

/**
 * 遍历节点树。
 */
export function walkNode(node: ProfileTemplateNodeDto, visit: (node: ProfileTemplateNodeDto) => void): void {
    visit(node);
    for (const child of node.children) {
        walkNode(child, visit);
    }
}

/**
 * 转 PascalCase 函数名。
 */
export function toPascalCase(value: string): string {
    const normalized = value
        .replace(/\.tsx$/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join("");
    return normalized || "ProfileTemplate";
}

/**
 * 生成右侧预览用 TSX 标签片段。
 */
export function generatePreviewNodeSource(node: ProfileTemplateNodeDto): string {
    const props = generatePreviewProps(node.props);
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
    }
    if ((node.type === "Message" || node.type === "AIMessage" || node.type === "ToolCall") && node.text) {
        const textSource = renderPreviewNodeText(node);
        const childLines = [
            indentPreviewSource(textSource, 1),
            ...node.children.map((child) => indentPreviewSource(generatePreviewNodeSource(child), 1)),
        ];
        return [
            `<${node.type}${props}>`,
            ...childLines,
            `</${node.type}>`,
        ].join("\n");
    }
    const childLines = [
        node.text ? renderPreviewNodeText(node) : "",
        ...node.children.map((child) => generatePreviewNodeSource(child)),
    ].filter(Boolean);
    return [
        `<${node.type}${props}>`,
        ...childLines.map((line) => indentPreviewSource(line, 1)),
        `</${node.type}>`,
    ].join("\n");
}

/**
 * 生成 TSX 标签属性。
 */
export function generatePreviewProps(props: ProfileTemplateNodeDto["props"]): string {
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
    return chunks.length > 0 ? ` ${chunks.join(" ")}` : "";
}

/**
 * 缩进 TSX 片段。
 */
export function indentPreviewSource(source: string, level: number): string {
    const prefix = "    ".repeat(level);
    return source.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

/**
 * 渲染预览中的节点文本，source 模式保留原始 TSX children 片段。
 */
export function renderPreviewNodeText(node: ProfileTemplateNodeDto): string {
    if (node.textKind === "source") {
        return `{${node.text ?? ""}}`;
    }
    return node.text ? renderMessageTextExpressions(node.text) : "";
}

/**
 * 按行生成 Message 正文表达式，兼顾源码可读性与换行保真。
 */
export function renderMessageTextExpressions(text: string): string {
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
export function escapeTemplateLine(text: string): string {
    return text
        .replaceAll("\\", "\\\\")
        .replaceAll("`", "\\`");
}
