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

const SKILL_ROOT_RELATIVE_PATH = path.join("assets", "agent", "skills");
const USER_SKILL_ROOT_RELATIVE_PATH = path.join(USER_ASSETS_WORKSPACE_ROOT, "agent", "skills");
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
        const catalogByName = new Map<string, SkillCatalogItem>();
        await this.appendSkillRoot(catalogByName, {
            root: path.resolve(this.workspaceRoot, SKILL_ROOT_RELATIVE_PATH),
            displayRoot: path.posix.join("assets", "agent", "skills"),
            source: "builtin",
        });
        await this.appendSkillRoot(catalogByName, {
            root: path.resolve(this.workspaceRoot, USER_SKILL_ROOT_RELATIVE_PATH),
            displayRoot: path.posix.join(USER_ASSETS_WORKSPACE_ROOT, "agent", "skills"),
            source: "user",
        });

        return [...catalogByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }

    /**
     * 追加一个 skill 根目录；后追加的同名 skill 覆盖先前条目。
     */
    private async appendSkillRoot(
        catalogByName: Map<string, SkillCatalogItem>,
        input: {root: string; displayRoot: string; source: NonNullable<SkillCatalogItem["source"]>},
    ): Promise<void> {
        if (input.source === "user") {
            await ensureUserAssetsWorkspaceRoot();
        }
        const skillDirectoryEntries = await this.readSkillDirectories(input.root);

        for (const skillDirectoryEntry of skillDirectoryEntries) {
            const skillItem = await this.readSkillItem(path.join(input.root, skillDirectoryEntry.name), input);
            if (!skillItem) {
                continue;
            }
            catalogByName.set(skillItem.name, skillItem);
        }
    }

    /**
     * 读取根目录下的一级 skill 目录。
     */
    private async readSkillDirectories(skillRoot: string): Promise<Dirent[]> {
        try {
            const directoryEntries = await fs.readdir(skillRoot, {withFileTypes: true});
            return directoryEntries.filter((directoryEntry) => directoryEntry.isDirectory());
        } catch (error) {
            if (this.isMissingDirectoryError(error)) {
                return [];
            }
            throw error;
        }
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
