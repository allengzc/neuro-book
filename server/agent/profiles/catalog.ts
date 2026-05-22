import {pathToFileURL} from "node:url";
import {readdir, stat} from "node:fs/promises";
import {existsSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {Value} from "typebox/value";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {
    AgentCatalogSnapshot,
    AgentCatalogItem,
    AgentProfile,
    AgentProfileIssue,
    AgentProfileIssueCode,
    AgentProfileSourceKind,
} from "nbook/server/agent/profiles/types";

type ProfileSource = {
    profile: AgentProfile;
    sourcePath?: string;
    builtin: boolean;
    source: AgentProfileSourceKind;
    issue?: AgentProfileIssue;
};

type LoadedProfileCatalog = {
    profiles: Map<string, ProfileSource>;
    issues: AgentProfileIssue[];
};

/**
 * 动态 profile catalog。用户 profile 按 key 覆盖系统 profile。
 */
export class AgentProfileCatalog {
    private readonly memoryProfiles = new Map<string, ProfileSource>();

    constructor(
        private readonly systemRoot = resolve(process.cwd(), "assets", ".nbook", "agent", "profiles"),
        private readonly userRoot = resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles"),
    ) {}

    /**
     * 注册内存 profile，主要给测试和最小内置 profile 使用。
     */
    register(profile: AgentProfile, builtin = true): void {
        this.memoryProfiles.set(profile.manifest.key, {
            profile,
            builtin,
            source: "memory",
        });
    }

    /**
     * 返回指定 profile。用户文件覆盖系统文件和内存 builtin。
     */
    async get(profileKey: string): Promise<AgentProfile> {
        const catalog = await this.loadAll();
        const profile = catalog.profiles.get(profileKey)?.profile;
        if (!profile) {
            throw new Error(`未找到 agent profile: ${profileKey}`);
        }
        return profile;
    }

    /**
     * 解析并校验 profile input。
     */
    parseInput(profile: AgentProfile, input: JsonValue): JsonValue {
        try {
            return Value.Parse(profile.inputSchema, input) as JsonValue;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`profile ${profile.manifest.key} input 校验失败：${message}`);
        }
    }

    /**
     * 提供给 profile prepare 的只读 snapshot。
     */
    async snapshot(): Promise<AgentCatalogSnapshot> {
        const catalog = await this.loadAll();
        return {
            profiles: [...catalog.profiles.values()].map(({profile, source, sourcePath, builtin, issue}): AgentCatalogItem => ({
                key: profile.manifest.key,
                name: profile.manifest.name,
                description: profile.manifest.description,
                inputSchema: profile.inputSchema,
                outputSchema: profile.outputSchema,
                source,
                sourcePath,
                builtin,
                loadStatus: this.issueIsFatal(issue) ? "error" : "loaded",
                issue,
            })).sort((left, right) => left.key.localeCompare(right.key)),
            issues: catalog.issues,
        };
    }

    private async loadAll(): Promise<LoadedProfileCatalog> {
        const profiles = new Map<string, ProfileSource>(this.memoryProfiles);
        const issues: AgentProfileIssue[] = [];
        const system = await this.loadDirectory(this.systemRoot, "system", true);
        issues.push(...system.issues);
        for (const source of system.sources) {
            profiles.set(source.profile.manifest.key, source);
        }
        const user = await this.loadDirectory(this.userRoot, "user", false);
        issues.push(...user.issues);
        for (const source of user.sources) {
            profiles.set(source.profile.manifest.key, source);
        }
        return {
            profiles,
            issues,
        };
    }

    private async loadDirectory(root: string, source: AgentProfileSourceKind, builtin: boolean): Promise<{
        sources: ProfileSource[];
        issues: AgentProfileIssue[];
    }> {
        if (!existsSync(root)) {
            return {
                sources: [],
                issues: [],
            };
        }
        const files = await this.findProfileFiles(root);
        const sources: ProfileSource[] = [];
        const issues: AgentProfileIssue[] = [];
        for (const file of files) {
            try {
                const profile = await this.importProfile(file);
                const locked = this.applyBuiltinSchemaLock(profile, source, file);
                const filenameIssue = this.filenameIssue(locked.profile, source, file);
                sources.push({
                    profile: locked.profile,
                    sourcePath: file,
                    builtin,
                    source,
                    issue: locked.issue ?? filenameIssue,
                });
                if (locked.issue) {
                    issues.push(locked.issue);
                }
                if (filenameIssue) {
                    issues.push(filenameIssue);
                }
            } catch (error) {
                issues.push(this.issueFromError(error, source, file));
            }
        }
        return {
            sources,
            issues,
        };
    }

    private async findProfileFiles(root: string): Promise<string[]> {
        const files: string[] = [];
        const entries = await readdir(root, {withFileTypes: true});
        for (const entry of entries) {
            const fullPath = join(root, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(fullPath));
                continue;
            }
            if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
                files.push(fullPath);
            }
        }
        return files.sort((left, right) => left.localeCompare(right));
    }

    private async importProfile(file: string): Promise<AgentProfile> {
        const fileStat = await stat(file);
        const moduleUrl = `${pathToFileURL(file).href}?mtime=${Math.trunc(fileStat.mtimeMs)}`;
        const mod = await this.importTsModule(moduleUrl) as {
            default?: unknown;
        };
        const profile = mod.default;
        if (!this.isProfile(profile)) {
            throw new ProfileCatalogError(this.profileIssueCode(profile), `profile 文件没有默认导出有效的 defineAgentProfile 结果：${file}`);
        }
        return profile;
    }

    private async importTsModule(moduleUrl: string): Promise<unknown> {
        try {
            return await import(moduleUrl);
        } catch (error) {
            if (!this.shouldFallbackToTsx(error)) {
                throw error;
            }
            const {tsImport} = await import("tsx/esm/api");
            return tsImport(moduleUrl, {
                parentURL: import.meta.url,
                tsconfig: resolve(process.cwd(), "tsconfig.json"),
            });
        }
    }

    private shouldFallbackToTsx(error: unknown): boolean {
        return error instanceof Error
            && (
                "code" in error && error.code === "ERR_UNKNOWN_FILE_EXTENSION"
                || error.message.includes("Unknown file extension")
            );
    }

    private isProfile(value: unknown): value is AgentProfile {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "inputSchema" in value
            && "allowedToolKeys" in value
            && "prepare" in value
            && typeof (value as {prepare?: unknown}).prepare === "function",
        );
    }

    private profileIssueCode(value: unknown): AgentProfileIssueCode {
        if (value && typeof value === "object" && !("inputSchema" in value)) {
            return "schema_missing";
        }
        return "invalid_export";
    }

    private applyBuiltinSchemaLock(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): {
        profile: AgentProfile;
        issue?: AgentProfileIssue;
    } {
        const builtin = this.memoryProfiles.get(profile.manifest.key);
        if (!builtin?.builtin) {
            return {profile};
        }
        const inputChanged = !this.sameSchema(profile.inputSchema, builtin.profile.inputSchema);
        const outputChanged = !this.sameSchema(profile.outputSchema, builtin.profile.outputSchema);
        if (!inputChanged && !outputChanged) {
            return {profile};
        }
        const issue: AgentProfileIssue = {
            code: "builtin_schema_locked",
            message: `builtin profile ${profile.manifest.key} 的 Input/Output schema 被锁定，运行时将继续使用内置 schema。`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
        return {
            profile: {
                ...profile,
                inputSchema: builtin.profile.inputSchema,
                outputSchema: builtin.profile.outputSchema,
            },
            issue,
        };
    }

    private issueFromError(error: unknown, source: AgentProfileSourceKind, sourcePath: string): AgentProfileIssue {
        const code = error instanceof ProfileCatalogError ? error.code : "load_failed";
        const message = error instanceof Error ? error.message : String(error);
        return {
            code,
            message,
            source,
            sourcePath,
        };
    }

    private filenameIssue(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): AgentProfileIssue | undefined {
        const fileName = basename(sourcePath).replace(/\.profile\.(tsx|ts|mjs|js)$/, "");
        if (fileName === profile.manifest.key) {
            return undefined;
        }
        return {
            code: "filename_mismatch",
            message: `profile 文件名建议与 manifest.key 保持一致：${fileName} -> ${profile.manifest.key}`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
    }

    private sameSchema(left: unknown, right: unknown): boolean {
        return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }

    private issueIsFatal(issue: AgentProfileIssue | undefined): boolean {
        return Boolean(issue && issue.code !== "filename_mismatch" && issue.code !== "builtin_schema_locked");
    }
}

class ProfileCatalogError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
