import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {assetResolver} from "nbook/server/assets/asset-resolver";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";

export const DEFAULT_WRITING_REFERENCE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters";

const WRITING_REFERENCE_DIR_CANDIDATES = [
    path.join(process.cwd(), "server", "agent-v2", "profiles", "builtin", "writing-references"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin", "writing-references"),
    path.join(assetResolver.systemRoot, "agent", "profiles", "builtin", "writing-references"),
    path.join(assetResolver.userRoot, "agent", "profiles", "builtin", "writing-references"),
] as const;

const WritingReferenceFrontmatterSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    sourceTitle: z.string().min(1),
    sourceChapters: z.string().min(1),
    generatedFrom: z.string().min(1),
});

export type WritingReferenceDefinition = z.infer<typeof WritingReferenceFrontmatterSchema> & {
    readonly sourceFile: string;
    readonly content: string;
};

export type WritingReferencePreset = string;

type WritingReferenceFile = {
    readonly name: string;
    readonly absolutePath: string;
};

/**
 * 从 writing-references 目录自动发现 Markdown 文风参考正文。
 */
export async function loadWritingReferencePresets(candidates: readonly string[] = WRITING_REFERENCE_DIR_CANDIDATES): Promise<WritingReferenceDefinition[]> {
    const referenceFiles = await listMergedWritingReferenceFiles(candidates);
    const references: WritingReferenceDefinition[] = [];

    for (const referenceFile of referenceFiles) {
        const content = await fs.readFile(referenceFile.absolutePath, "utf-8");
        const parsed = parseFrontmatterDocument(content, WritingReferenceFrontmatterSchema);
        if (!parsed.hasFrontmatter) {
            throw new Error(`Writing reference missing frontmatter: ${referenceFile.absolutePath}`);
        }
        references.push({
            ...parsed.metadata,
            sourceFile: path.relative(process.cwd(), referenceFile.absolutePath).split(path.sep).join("/"),
            content: parsed.body,
        });
    }
    return references.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}

/**
 * 构造 writer 文风参考正文提示词。
 */
export async function buildWritingReference(input: {preset?: WritingReferencePreset} = {}): Promise<string> {
    const preset = input.preset ?? DEFAULT_WRITING_REFERENCE_PRESET;
    const references = await loadWritingReferencePresets();
    const reference = references.find((item) => item.key === preset);
    if (!reference) {
        throw new Error(`Unknown writing reference preset: ${preset}`);
    }
    return [
        "<writing_reference>",
        reference.content.trim() ? reference.content.trim() : "空",
        "</writing_reference>",
    ].join("\n");
}

async function listMergedWritingReferenceFiles(candidates: readonly string[]): Promise<WritingReferenceFile[]> {
    const filesByName = new Map<string, WritingReferenceFile>();
    let foundDirectory = false;
    for (const candidate of candidates) {
        const entries = await readOptionalDirectory(candidate);
        if (!entries) {
            continue;
        }
        foundDirectory = true;
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".md")) {
                filesByName.set(entry.name, {
                    name: entry.name,
                    absolutePath: path.join(candidate, entry.name),
                });
            }
        }
    }
    if (!foundDirectory) {
        throw new Error(`Writing references directory not found. Tried: ${candidates.join(", ")}`);
    }
    return [...filesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

async function readOptionalDirectory(directoryPath: string): Promise<Array<import("node:fs").Dirent> | null> {
    try {
        return await fs.readdir(directoryPath, {withFileTypes: true});
    } catch (error) {
        if (isMissingPathError(error)) {
            return null;
        }
        throw error;
    }
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
