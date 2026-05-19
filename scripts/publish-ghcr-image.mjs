#!/usr/bin/env node
import {spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import {Command} from "commander";
import * as p from "@clack/prompts";

const DEFAULT_APP_IMAGE = "ghcr.io/notnotype/neuro-book";
const DEFAULT_RUNTIME_IMAGE = "ghcr.io/notnotype/neuro-book-runtime";

const program = new Command()
    .name("publish-ghcr-image")
    .description("Build and push the neuro-book runtime and app Docker images to GHCR.")
    .option("--image <name>", "Alias for --app-image.", process.env.NEURO_BOOK_IMAGE)
    .option("--app-image <name>", "Target app image name.", process.env.NEURO_BOOK_APP_IMAGE)
    .option("--runtime-image <name>", "Target runtime image name.", process.env.NEURO_BOOK_RUNTIME_IMAGE ?? DEFAULT_RUNTIME_IMAGE)
    .option("--tag <tag...>", "Image tag. Can be passed multiple times.")
    .option("--platform <platform>", "Docker build platform.", process.env.NEURO_BOOK_IMAGE_PLATFORM ?? "linux/amd64")
    .option("--dry-run", "Print the docker buildx commands without running them.", false);

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

/** 解析 app/runtime 镜像名，保持旧 --image 参数可用。 */
function resolveImages(options) {
    return {
        appImage: options.appImage ?? options.image ?? DEFAULT_APP_IMAGE,
        runtimeImage: options.runtimeImage,
    };
}

/** 返回本次发布使用的 tag 列表。 */
async function resolveTags(options) {
    return options.tag && options.tag.length > 0
        ? options.tag
        : ["latest", await readPackageVersion()];
}

/** 组装 docker buildx build --push 命令参数。 */
function buildArgs({image, platform, tags, target}) {
    const args = ["buildx", "build", "--platform", platform, "--push"];

    if (target) {
        args.push("--target", target);
    }

    for (const tag of tags) {
        args.push("-t", `${image}:${tag}`);
    }

    args.push(".");
    return args;
}

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    const tags = await resolveTags(options);
    const {appImage, runtimeImage} = resolveImages(options);
    const commands = [
        {
            label: `runtime image ${runtimeImage}`,
            args: buildArgs({
                image: runtimeImage,
                platform: options.platform,
                tags,
                target: "runtime-base",
            }),
        },
        {
            label: `app image ${appImage}`,
            args: buildArgs({
                image: appImage,
                platform: options.platform,
                tags,
            }),
        },
    ];

    p.intro("Publish neuro-book images to GHCR");
    await checkDockerBuildx(options.dryRun);

    if (options.dryRun) {
        for (const command of commands) {
            p.log.info(`${command.label}: docker ${command.args.join(" ")}`);
        }
        p.outro("Dry run complete.");
        return;
    }

    for (const command of commands) {
        p.log.info(`Pushing ${command.label}`);
        await run("docker", command.args);
    }
    p.outro(`Pushed ${runtimeImage} and ${appImage}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
