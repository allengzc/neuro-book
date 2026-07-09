import {existsSync} from "node:fs";
import {readFile, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";

export type SkillCatalogSource = "system" | "user";

export type SkillCatalogItem = {
    key: string;
    name: string;
    description?: string;
    whenToUse?: string;
    source: SkillCatalogSource;
    rootPath: string;
    skillPath: string;
};

const DISABLED_LEGACY_SKILL_KEYS = new Set(["anti-ai-slop"]);

/**
 * v3 skill catalog。用户同名目录整体覆盖系统目录。
 */
export class SkillCatalog {
    constructor(
        private readonly systemRoot = resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "skills"),
        private readonly userRoot = resolve(process.cwd(), "workspace", ".nbook", "agent", "skills"),
    ) {}

    /**
     * 列出当前可见 skill。目录名是第一版稳定 key。
     */
    async list(): Promise<SkillCatalogItem[]> {
        const skills = new Map<string, SkillCatalogItem>();
        for (const skill of await this.loadRoot(this.systemRoot, "system")) {
            skills.set(skill.key, skill);
        }
        for (const skill of await this.loadRoot(this.userRoot, "user")) {
            skills.set(skill.key, skill);
        }
        return [...skills.values()].sort((left, right) => left.key.localeCompare(right.key));
    }

    /**
     * 读取单个 skill。返回 null 表示该 skill 对当前 v3 catalog 不可见。
     */
    async get(skillKey: string): Promise<SkillCatalogItem | null> {
        return (await this.list()).find((skill) => skill.key === skillKey) ?? null;
    }

    private async loadRoot(root: string, source: SkillCatalogSource): Promise<SkillCatalogItem[]> {
        if (!existsSync(root)) {
            return [];
        }
        const entries = await readdir(root, {withFileTypes: true});
        const skills: SkillCatalogItem[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (DISABLED_LEGACY_SKILL_KEYS.has(entry.name)) {
                continue;
            }
            const rootPath = join(root, entry.name);
            const skillPath = await this.findSkillFile(rootPath);
            if (!skillPath) {
                continue;
            }
            const metadata = this.readMetadata(await readFile(skillPath, "utf8"));
            skills.push({
                key: entry.name,
                name: metadata.name ?? entry.name,
                description: metadata.description,
                whenToUse: metadata.whenToUse,
                source,
                rootPath,
                skillPath,
            });
        }
        return skills;
    }

    private async findSkillFile(rootPath: string): Promise<string | null> {
        for (const name of ["SKILL.md", "skill.md"]) {
            const skillPath = join(rootPath, name);
            if (existsSync(skillPath)) {
                return skillPath;
            }
        }
        return null;
    }

    private readMetadata(source: string): {name?: string; description?: string; whenToUse?: string} {
        const frontmatter = source.match(/^---\r?\n(?<body>[\s\S]*?)\r?\n---/u)?.groups?.body;
        if (!frontmatter) {
            const heading = source.split(/\r?\n/).find((line) => line.trim().startsWith("# "))?.replace(/^#\s+/, "").trim();
            return {
                name: heading || undefined,
            };
        }
        const metadata: {name?: string; description?: string; whenToUse?: string} = {};
        let currentListKey: "when_to_use" | null = null;
        const whenToUseItems: string[] = [];
        for (const line of frontmatter.split(/\r?\n/)) {
            const listMatch = line.match(/^\s*-\s*(?<value>.+)$/u);
            if (currentListKey === "when_to_use" && listMatch?.groups?.value) {
                whenToUseItems.push(cleanYamlScalar(listMatch.groups.value));
                continue;
            }
            currentListKey = null;
            const match = line.match(/^(name|description|when_to_use):\s*(?<value>.*)$/u);
            if (!match?.groups || !match[1]) {
                continue;
            }
            const value = cleanYamlScalar(match.groups.value ?? "");
            if (match[1] === "when_to_use") {
                if (value) {
                    metadata.whenToUse = value;
                } else {
                    currentListKey = "when_to_use";
                }
                continue;
            }
            metadata[match[1] as "name" | "description"] = value;
        }
        if (!metadata.whenToUse && whenToUseItems.length > 0) {
            metadata.whenToUse = whenToUseItems.join("；");
        }
        return metadata;
    }
}

function cleanYamlScalar(value: string): string {
    return value.replace(/^["']|["']$/g, "").trim();
}
