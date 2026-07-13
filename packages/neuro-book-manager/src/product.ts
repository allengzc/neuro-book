import {join} from "node:path";

import type {StagedProduct} from "#manager/component";
import {pathExists, removePath} from "#manager/files";
import {run, runBun} from "#manager/process";
import {currentProductPlatform} from "#manager/platform";

/** 使用 Application Runtime 安装源码依赖。 */
export async function installSourceDependencies(root: string, bun = "bun"): Promise<void> {
    await runBun(bun, ["install", "--frozen-lockfile", "--no-save", "--linker", "hoisted"], {
        cwd: root,
        env: {...process.env, NODE_ENV: "development"},
    });
}

/** 从源码构建 staging Product，并切换根 `.output`。 */
export async function buildSourceProduct(input: {
    root: string;
    /** Git staged worktree；未设置时等于 Installation Root。 */
    sourceRoot?: string;
    staging: string;
    version: string;
    revision: string;
    stateRoot: string;
    bun?: string;
}): Promise<StagedProduct> {
    const stagedOutput = join(input.staging, ".output");
    await removePath(stagedOutput);
    await run(input.bun ?? "bun", ["run", "nuxt:build"], {
        cwd: input.sourceRoot ?? input.root,
        env: {
            ...process.env,
            NEURO_BOOK_OUTPUT_DIR: stagedOutput,
            NEURO_BOOK_STATE_ROOT: input.stateRoot,
        },
    });
    if (!await pathExists(join(stagedOutput, "server", "index.mjs"))) {
        throw new Error("源码构建没有生成 staging .output/server/index.mjs。");
    }
    return {
        outputRoot: stagedOutput,
        component: {
            provider: "git",
            version: input.version,
            revision: input.revision,
            path: ".output",
            platform: currentProductPlatform(),
        },
    };
}
