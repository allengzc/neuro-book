import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const GITHUB_URL = "https://github.com/notnotype/neuro-book";

type AppVersionKind = "tag" | "commit" | "package";

interface AppVersionDto {
    versionLabel: string;
    versionKind: AppVersionKind;
    githubUrl: string;
}

interface PackageManifest {
    version?: string;
}

/**
 * 读取 git 命令输出的首行文本。
 */
async function readGitOutput(args: string[]): Promise<string | null> {
    try {
        const {stdout} = await execFileAsync("git", args, {
            cwd: process.cwd(),
            windowsHide: true,
        });
        const value = stdout.trim().split(/\r?\n/u)[0]?.trim();
        return value || null;
    } catch {
        return null;
    }
}

/**
 * 读取 package.json 中的兜底版本。
 */
async function readPackageVersion(): Promise<string> {
    try {
        const content = await readFile(join(process.cwd(), "package.json"), "utf8");
        const manifest = JSON.parse(content) as PackageManifest;
        return manifest.version || "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * 返回设置页底部展示用的版本和仓库地址。
 */
export default defineEventHandler(async (): Promise<AppVersionDto> => {
    const tag = await readGitOutput(["describe", "--tags", "--exact-match", "HEAD"]);
    if (tag) {
        return {
            versionLabel: tag,
            versionKind: "tag",
            githubUrl: GITHUB_URL,
        };
    }

    const commit = await readGitOutput(["rev-parse", "--short", "HEAD"]);
    if (commit) {
        return {
            versionLabel: commit,
            versionKind: "commit",
            githubUrl: GITHUB_URL,
        };
    }

    return {
        versionLabel: await readPackageVersion(),
        versionKind: "package",
        githubUrl: GITHUB_URL,
    };
});
