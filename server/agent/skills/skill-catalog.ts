import fs from "node:fs/promises";
import type {Dirent} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import type {SkillCatalogItem} from "nbook/server/agent/types";
import {
    USER_ASSETS_WORKSPACE_ROOT,
    ensureUserAssetsWorkspaceRoot,
} from "nbook/server/workspace-files/novel-workspace";

const SKILL_ROOT_RELATIVE_PATH = path.join("agent", "skills");
const SKILL_FILE_CANDIDATES = ["SKILL.md", "skill.md"] as const;
const SKILL_TOKEN_NAME_PATTERN = /^[\p{L}_-][\p{L}\p{N}_-]*$/u;
const SkillFrontmatterSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    when_to_use: z.union([
        z.string().trim().min(1),
        z.array(z.string().trim().min(1)),
    ]).optional(),
});

/**
 * skills catalog 的读取接口。
 */
export interface SkillCatalogProvider {
    /**
     * 列出当前仓库中可发现的 skills 元数据。
     */
    list(): Promise<readonly SkillCatalogItem[]>;
}

/**
 * 本地文件系统版 skills catalog。
 * 扫描用户 assets 与仓库内置 assets；同名 skill 用户版本优先。
 */
export class LocalSkillCatalogProvider implements SkillCatalogProvider {
    constructor(
        private readonly workspaceRoot = process.cwd(),
    ) {}

    /**
     * 读取当前 skills catalog。
     */
    async list(): Promise<readonly SkillCatalogItem[]> {
        const catalogItems: SkillCatalogItem[] = [];
        const resolver = new AssetResolverForWorkspace(this.workspaceRoot);
        const skillDirectories = await resolver.listSkillDirectories();

        for (const skillDirectory of skillDirectories) {
            const skillItem = await this.readSkillItem(skillDirectory.absolutePath, {
                root: skillDirectory.absoluteRoot,
                displayRoot: skillDirectory.displayRoot,
                source: skillDirectory.source,
            });
            if (!skillItem) {
                continue;
            }
            catalogItems.push(skillItem);
        }

        return catalogItems.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }

    /**
     * 从单个 skill 目录中读取 catalog 条目。
     * 没有合法 frontmatter 的旧 skill 会被直接跳过。
     */
    private async readSkillItem(
        skillDirectoryPath: string,
        rootInput: {root: string; displayRoot: string; source: NonNullable<SkillCatalogItem["source"]>},
    ): Promise<SkillCatalogItem | null> {
        const skillFilePath = await this.resolveSkillFilePath(skillDirectoryPath);
        if (!skillFilePath) {
            return null;
        }

        const skillContent = await fs.readFile(skillFilePath, "utf-8");
        const parsedSkillDocument = parseFrontmatterDocument(skillContent, SkillFrontmatterSchema);
        if (!parsedSkillDocument.hasFrontmatter) {
            return null;
        }

        const name = parsedSkillDocument.metadata.name?.trim();
        const description = parsedSkillDocument.metadata.description?.trim();
        if (!name || !description || !isValidSkillTokenName(name)) {
            return null;
        }

        return {
            name,
            description,
            whenToUse: this.stringifyWhenToUse(parsedSkillDocument.metadata.when_to_use),
            headerText: parsedSkillDocument.rawFrontmatterText.trim(),
            location: skillFilePath,
            displayLocation: path.posix.join(
                rootInput.displayRoot,
                path.relative(rootInput.root, skillFilePath).split(path.sep).join("/"),
            ),
            source: rootInput.source,
        };
    }

    /**
     * 将 skill 适用场景归一化为一行提示。
     */
    private stringifyWhenToUse(value: z.infer<typeof SkillFrontmatterSchema>["when_to_use"]): string | undefined {
        if (Array.isArray(value)) {
            return value.map((item) => item.trim()).filter(Boolean).join("；") || undefined;
        }
        return value?.trim() || undefined;
    }

    /**
     * 解析 skill 文件路径。
     * 优先读取标准命名 `SKILL.md`，其次兼容旧版 `skill.md`。
     */
    private async resolveSkillFilePath(skillDirectoryPath: string): Promise<string | null> {
        let directoryEntries: string[];
        try {
            directoryEntries = await fs.readdir(skillDirectoryPath);
        } catch (error) {
            if (this.isMissingDirectoryError(error)) {
                return null;
            }
            throw error;
        }

        for (const skillFileName of SKILL_FILE_CANDIDATES) {
            const matchedFileName = directoryEntries.find((directoryEntry) => directoryEntry === skillFileName);
            if (matchedFileName) {
                return path.join(skillDirectoryPath, matchedFileName);
            }
        }
        return null;
    }

    /**
     * 判断是否为文件不存在错误。
     */
    private isMissingDirectoryError(error: unknown): boolean {
        return typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "ENOENT";
    }
}

/**
 * 判断 skill 名称是否可直接序列化为 `$技能名` token。
 */
function isValidSkillTokenName(name: string): boolean {
    return SKILL_TOKEN_NAME_PATTERN.test(name);
}

type SkillDirectory = {
    absolutePath: string;
    absoluteRoot: string;
    displayRoot: string;
    source: NonNullable<SkillCatalogItem["source"]>;
};

/**
 * workspace 绑定的 skill 目录解析器。
 */
class AssetResolverForWorkspace {
    constructor(
        private readonly workspaceRoot: string,
    ) {}

    /**
     * 按 skill 目录 slug 列出覆盖后的目录。
     */
    async listSkillDirectories(): Promise<SkillDirectory[]> {
        const directoriesByName = new Map<string, SkillDirectory>();
        const systemRoot = path.resolve(this.workspaceRoot, "assets", SKILL_ROOT_RELATIVE_PATH);
        const userRoot = path.resolve(this.workspaceRoot, USER_ASSETS_WORKSPACE_ROOT, SKILL_ROOT_RELATIVE_PATH);

        await this.appendSkillDirectories(directoriesByName, systemRoot, path.posix.join("assets", "agent", "skills"), "builtin");
        await ensureUserAssetsWorkspaceRoot();
        await this.appendSkillDirectories(directoriesByName, userRoot, path.posix.join(USER_ASSETS_WORKSPACE_ROOT, "agent", "skills"), "user");

        return [...directoriesByName.values()].sort((left, right) => path.basename(left.absolutePath).localeCompare(path.basename(right.absolutePath), "zh-CN"));
    }

    /**
     * 追加一级 skill 目录；后追加的用户目录按 slug 整体覆盖系统目录。
     */
    private async appendSkillDirectories(
        directoriesByName: Map<string, SkillDirectory>,
        root: string,
        displayRoot: string,
        source: NonNullable<SkillCatalogItem["source"]>,
    ): Promise<void> {
        let entries: Dirent[];
        try {
            entries = await fs.readdir(root, {withFileTypes: true});
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            directoriesByName.set(entry.name, {
                absolutePath: path.join(root, entry.name),
                absoluteRoot: root,
                displayRoot,
                source,
            });
        }
    }
}
