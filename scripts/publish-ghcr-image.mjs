#!/usr/bin/env node
import {spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import {Command} from "commander";
import * as p from "@clack/prompts";

const DEFAULT_IMAGE = "ghcr.io/notnotype/neuro-book";

const program = new Command()
    .name("publish-ghcr-image")
    .description("Build and push the neuro-book Docker image to GHCR.")
    .option("--image <name>", "Target image name.", process.env.NEURO_BOOK_IMAGE ?? DEFAULT_IMAGE)
    .option("--tag <tag...>", "Image tag. Can be passed multiple times.")
    .option("--platform <platform>", "Docker build platform.", process.env.NEURO_BOOK_IMAGE_PLATFORM ?? "linux/amd64")
    .option("--dry-run", "Print the docker buildx command without running it.", false);

program.parse();

/** 读取 package.json 版本，用于默认镜像 tag。 */
async function readPackageVersion() {
    const packageJson = JSON.parse(await readFile("package.json", "utf-8"));
    return String(packageJson.version);
}

/** 运行外部命令，并把输出直接继承给当前终端。 */
function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: options.stdio ?? "inherit",
        });

        child.on("error", (error) => {
            rejectPromise(new Error(`命令不可用或启动失败：${command}\n${error.message}`));
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`命令被信号中断：${command} ${signal}`));
                return;
            }

            if (code !== 0) {
                rejectPromise(new Error(`命令执行失败：${command} ${args.join(" ")}，退出码 ${code}`));
                return;
            }

            resolvePromise();
        });
    });
}

/** 检查本机 Docker buildx 是否可用。 */
async function checkDockerBuildx(dryRun) {
    if (dryRun) {
        return;
    }

    await run("docker", ["buildx", "version"], {stdio: "ignore"});
}

/** 组装 docker buildx build --push 命令参数。 */
async function buildArgs(options) {
    const tags = options.tag && options.tag.length > 0
        ? options.tag
        : ["latest", await readPackageVersion()];
    const args = ["buildx", "build", "--platform", options.platform, "--push"];

    for (const tag of tags) {
        args.push("-t", `${options.image}:${tag}`);
    }

    args.push(".");
    return args;
}

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    const args = await buildArgs(options);

    p.intro("Publish neuro-book image to GHCR");
    await checkDockerBuildx(options.dryRun);

    if (options.dryRun) {
        p.log.info(`docker ${args.join(" ")}`);
        p.outro("Dry run complete.");
        return;
    }

    await run("docker", args);
    p.outro(`Pushed ${options.image}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
