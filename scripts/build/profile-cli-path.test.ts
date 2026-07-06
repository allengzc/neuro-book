import {execFile} from "node:child_process";
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {resolveApplicationRoot, resolveSystemNbookRoot, resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {describe, expect, it} from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const execFileAsync = promisify(execFile);

describe("profile CLI path resolution", () => {
    it("从 Workspace Root .nbook 推导应用根和用户 profile root", () => {
        const userNbookRoot = join(repoRoot, "workspace", ".nbook");

        expect(resolveApplicationRoot(userNbookRoot)).toBe(repoRoot);
        expect(resolveUserNbookRoot(userNbookRoot)).toBe(userNbookRoot);
        expect(resolveSystemNbookRoot(userNbookRoot)).toBe(join(repoRoot, "assets", "workspace", ".nbook"));
    });

    it("profile script 在 Product Root 有根源码脚本时仍选择 .output 入口", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-profile-product-"));
        try {
            const launcher = await writeProfileLauncherFixture(root);
            await writeFile(join(root, "package.json"), JSON.stringify({name: "neuro-book-product", type: "module"}), "utf8");
            await mkdir(join(root, ".output", "server"), {recursive: true});
            await writeFile(join(root, ".output", "server", "index.mjs"), "", "utf8");
            await writeEntry(join(root, ".output", "server", "scripts", "build", "profile.ts"), "product");
            await writeEntry(join(root, "scripts", "build", "profile.ts"), "source");

            const {stdout} = await execFileAsync(bunExecutable(), [launcher], {cwd: tmpdir()});
            const lines = stdout.trim().split(/\r?\n/);
            expect(lines[0]).toBe("product");
            expect(normalizePath(lines[1] ?? "")).toBe(normalizePath(await realpath(root)));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("profile script 在源码仓存在 .output 时仍选择源码入口并切换 cwd", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-profile-source-"));
        try {
            const launcher = await writeProfileLauncherFixture(root);
            await writeFile(join(root, "package.json"), JSON.stringify({name: "neuro-book", type: "module"}), "utf8");
            await mkdir(join(root, "node_modules"), {recursive: true});
            await mkdir(join(root, ".output", "server"), {recursive: true});
            await writeFile(join(root, ".output", "server", "index.mjs"), "", "utf8");
            await writeFile(join(root, ".output", "server", "package.json"), JSON.stringify({name: "neuro-book-output", type: "module"}), "utf8");
            await writeEntry(join(root, ".output", "server", "scripts", "build", "profile.ts"), "product");
            await writeEntry(join(root, "scripts", "build", "profile.ts"), "source");

            const {stdout} = await execFileAsync(bunExecutable(), [launcher], {cwd: tmpdir()});
            const lines = stdout.trim().split(/\r?\n/);
            expect(lines[0]).toBe("source");
            expect(normalizePath(lines[1] ?? "")).toBe(normalizePath(await realpath(root)));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("profile script 包含 Product Runtime manifest 判定", async () => {
        const script = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "scripts", "profile.ts"), "utf8");

        expect(script).toContain("process.chdir(profileEntry.applicationRoot)");
        expect(script).toContain("neuro-book-product");
        expect(script).toContain("neuro-book-output");
    });

    it("系统 profile wrapper 的 Product 分支会先切到 Product Root", async () => {
        const shellWrapper = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "bin", "profile"), "utf8");
        const cmdWrapper = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "bin", "profile.cmd"), "utf8");

        expect(shellWrapper).toContain("cd \"$PRODUCT_ROOT\" || exit 1");
        expect(shellWrapper).toContain("is_product_runtime_root");
        expect(shellWrapper).not.toContain("SOURCE_PROFILE_SCRIPT");
        expect(cmdWrapper).toContain("pushd \"%PRODUCT_ROOT%\" || exit /b 1");
        expect(cmdWrapper).toContain("IS_PRODUCT_RUNTIME");
        expect(cmdWrapper).not.toContain("SOURCE_PROFILE_SCRIPT");
        expect(cmdWrapper).not.toContain("EnableDelayedExpansion");
    });
});

async function writeProfileLauncherFixture(root: string): Promise<string> {
    const launcher = join(root, "assets", "workspace", ".nbook", "agent", "scripts", "profile.ts");
    await mkdir(dirname(launcher), {recursive: true});
    const source = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "scripts", "profile.ts"), "utf8");
    await writeFile(launcher, source, "utf8");
    return launcher;
}

async function writeEntry(filePath: string, label: string): Promise<void> {
    await mkdir(dirname(filePath), {recursive: true});
    await writeFile(filePath, `console.log(${JSON.stringify(label)});\nconsole.log(process.cwd());\n`, "utf8");
}

function bunExecutable(): string {
    return process.versions.bun ? process.execPath : "bun";
}

function normalizePath(filePath: string): string {
    return resolve(filePath).replaceAll("\\", "/");
}
