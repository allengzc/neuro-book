import {z} from "zod";
import * as yaml from "yaml";

type ParsedFrontmatterDocument<T> = {
    metadata: T;
    body: string;
    hasFrontmatter: boolean;
    rawFrontmatter: Record<string, unknown>;
    rawFrontmatterText: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 解析 Markdown 文档中的 YAML frontmatter。
 */
export function parseFrontmatterDocument<T>(
    content: string,
    schema: z.ZodSchema<T>,
): ParsedFrontmatterDocument<T> {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {
            metadata: schema.parse({}),
            body: content,
            hasFrontmatter: false,
            rawFrontmatter: {},
            rawFrontmatterText: "",
        };
    }

    const frontmatterText = match[1] ?? "";
    const body = match[2] ?? "";
    const parsedFrontmatter = yaml.parse(frontmatterText, {logLevel: "silent"});
    const rawFrontmatter = isRecord(parsedFrontmatter) ? parsedFrontmatter : {};

    return {
        metadata: schema.parse(rawFrontmatter),
        body,
        hasFrontmatter: true,
        rawFrontmatter,
        rawFrontmatterText: frontmatterText,
    };
}

/**
 * 将 frontmatter 与正文渲染回 Markdown。
 */
export function renderFrontmatterDocument(frontmatter: Record<string, unknown>, body: string): string {
    const yamlString = yaml.stringify(frontmatter).trim();
    return `---\n${yamlString}\n---\n${body}`;
}

/**
 * 校验 frontmatter 中没有只读字段。
 */
export function assertNoReadonlyFrontmatterKeys(
    rawFrontmatter: Record<string, unknown>,
    readonlyKeys: string[],
): void {
    for (const key of readonlyKeys) {
        if (key in rawFrontmatter) {
            throw new Error(`frontmatter 不允许写入只读字段 "${key}"`);
        }
    }
}

/**
 * 判断值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
