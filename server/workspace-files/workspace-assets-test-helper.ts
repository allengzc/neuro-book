import {cp, mkdir, mkdtemp, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
    getWorkspaceAssetRootContextForTest,
    resolveApplicationRoot,
    resolveSystemNbookRoot,
    setWorkspaceAssetRootContextForTest,
    type WorkspaceAssetRootContext,
} from "nbook/server/workspace-files/workspace-assets-root";

export type IsolatedWorkspaceAssets = {
    root: string;
    applicationRoot: string;
    systemNbookRoot: string;
    workspaceContainerRoot: string;
    userNbookRoot: string;
    userProfileRoot: string;
    systemProfileRoot: string;
    dispose: () => Promise<void>;
};

export type IsolatedWorkspaceAssetsOptions = {
    /**
     * 为 true 时把系统 `.nbook` 作为用户 `.nbook` 初始内容，适合 profile worker 这类直接编译用户 root 的测试。
     */
    seedUserAssets?: boolean;
    /**
     * 为 true 时临时切换 cwd 到隔离 root；helper 会用 symlink 暴露项目源码和依赖。
     */
    useAsCwd?: boolean;
    /**
     * 指定作为 system `.nbook` 模板的来源。默认使用真实 bundled system assets。
     */
    sourceSystemNbookRoot?: string;
};

/**
 * 在隔离的 Workspace assets root 中执行测试，避免并行测试写入真实 user-assets。
 */
export async function withIsolatedWorkspaceAssets<T>(
    options: IsolatedWorkspaceAssetsOptions,
    task: (assets: IsolatedWorkspaceAssets) => Promise<T>,
): Promise<T> {
    const assets = await createIsolatedWorkspaceAssets(options);
    try {
        return await task(assets);
    } finally {
        await assets.dispose();
    }
}

/**
 * 创建独立 Workspace assets root，并把全局 context 指向该 root。
 */
export async function createIsolatedWorkspaceAssets(options: IsolatedWorkspaceAssetsOptions = {}): Promise<IsolatedWorkspaceAssets> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-workspace-assets-"));
    const previousContext = getWorkspaceAssetRootContextForTest();
    const applicationRoot = resolveApplicationRoot();
    const sourceSystemNbookRoot = options.sourceSystemNbookRoot ?? resolveSystemNbookRoot();
    const systemNbookRoot = path.join(root, "assets", "workspace", ".nbook");
    const workspaceContainerRoot = path.join(root, "workspace");
    const userNbookRoot = path.join(workspaceContainerRoot, ".nbook");
    const context: WorkspaceAssetRootContext = {
        applicationRoot,
        systemNbookRoot,
        workspaceContainerRoot,
        userNbookRoot,
    };
    await mkdir(path.dirname(systemNbookRoot), {recursive: true});
    await cp(sourceSystemNbookRoot, systemNbookRoot, {recursive: true, force: true});
    await mkdir(workspaceContainerRoot, {recursive: true});
    if (options.seedUserAssets) {
        await cp(systemNbookRoot, userNbookRoot, {recursive: true, force: true});
    } else {
        await mkdir(userNbookRoot, {recursive: true});
    }
    const previousCwd = process.cwd();
    if (options.useAsCwd) {
        await linkApplicationFiles(applicationRoot, root);
        process.chdir(root);
    }
    setWorkspaceAssetRootContextForTest(context);
    return {
        root,
        applicationRoot,
        systemNbookRoot,
        workspaceContainerRoot,
        userNbookRoot,
        userProfileRoot: path.join(userNbookRoot, "agent", "profiles"),
        systemProfileRoot: path.join(systemNbookRoot, "agent", "profiles"),
        dispose: async () => {
            setWorkspaceAssetRootContextForTest(previousContext);
            if (options.useAsCwd) {
                process.chdir(previousCwd);
                await unlinkApplicationFiles(root);
            }
            await rm(root, {recursive: true, force: true});
        },
    };
}

const linkedApplicationEntries = [
    {name: "app", type: "junction" as const},
    {name: "server", type: "junction" as const},
    {name: "shared", type: "junction" as const},
    {name: "reference", type: "junction" as const},
    {name: "docs", type: "junction" as const},
    {name: "node_modules", type: "junction" as const},
    {name: ".nuxt", type: "junction" as const},
    {name: "package.json", type: "file" as const},
    {name: "tsconfig.json", type: "file" as const},
    {name: "nuxt.config.ts", type: "file" as const},
];

async function linkApplicationFiles(applicationRoot: string, isolatedRoot: string): Promise<void> {
    for (const entry of linkedApplicationEntries) {
        const source = path.join(applicationRoot, entry.name);
        const target = path.join(isolatedRoot, entry.name);
        await symlink(source, target, entry.type).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return;
            }
            throw error;
        });
    }
}

async function unlinkApplicationFiles(isolatedRoot: string): Promise<void> {
    await Promise.all(linkedApplicationEntries.map((entry) => rm(path.join(isolatedRoot, entry.name), {recursive: true, force: true})));
}
