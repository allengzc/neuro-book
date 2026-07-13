import {dirname, join, relative} from "node:path";
import {stringify} from "yaml";

import {writeTextAtomic} from "#manager/files";
import {run} from "#manager/process";
import type {InstallProfile} from "#manager/types";

/** 生成完整 Docker Compose，不依赖仓库根旧模板。 */
export async function writeDockerCompose(input: {
    root: string;
    stateRoot: string;
    profile: "source-docker" | "ghcr";
    image?: string;
    port: number;
    output?: string;
    /** staging 写入时按最终 Compose 位置计算相对 volume。 */
    layoutPath?: string;
}): Promise<string> {
    const composePath = input.output ?? join(input.root, ".deploy", "docker-compose.generated.yml");
    const stateRelative = relative(dirname(input.layoutPath ?? composePath), input.stateRoot).replaceAll("\\", "/") || ".";
    const service = input.profile === "ghcr"
        ? {
            image: input.image,
            environment: commonEnvironment(input.port),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/logs:/app/logs`,
            ],
            restart: "unless-stopped",
        }
        : {
            image: input.image,
            environment: commonEnvironment(input.port),
            ports: [`${input.port}:${input.port}`],
            volumes: [
                `${stateRelative}/workspace:/app/workspace`,
                `${stateRelative}/config.yaml:/app/config.yaml`,
                `${stateRelative}/logs:/app/logs`,
            ],
            restart: "unless-stopped",
        };
    await writeTextAtomic(composePath, stringify({services: {app: service}}));
    return composePath;
}

/** 验证 Docker Profile 的基础 HTTP 与版本接口。 */
export async function verifyDockerApplication(port: number, expectedVersion: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    let lastError = "容器尚未响应";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                const value = await response.json() as {versionLabel?: string};
                const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                if (value.versionLabel !== expected) throw new Error(`容器版本为 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    throw new Error(`Docker HTTP 健康检查超时：${lastError}`);
}

/** 启动 Docker Profile。 */
export async function startDocker(root: string, stateRoot: string, profile: InstallProfile): Promise<void> {
    const compose = join(root, ".deploy", "docker-compose.generated.yml");
    const args = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
    if (profile === "ghcr") {
        await run("docker", [...args, "pull", "app"], {cwd: root});
        await run("docker", [...args, "up", "-d"], {cwd: root});
        return;
    }
    await run("docker", [...args, "up", "-d"], {cwd: root});
}

/** 从 staged Git worktree 构建带 revision tag 的 Source Docker image。 */
export async function buildSourceDockerImage(sourceRoot: string, image: string): Promise<void> {
    await run("docker", ["build", "--file", join(sourceRoot, "Dockerfile"), "--tag", image, sourceRoot], {cwd: sourceRoot});
}

function commonEnvironment(port: number): Record<string, string> {
    return {
        HOST: "0.0.0.0",
        PORT: String(port),
        NUXT_PORT: String(port),
        DATABASE_KIND: "sqlite",
        DATABASE_URL: "file:./workspace/.nbook/neuro-book.sqlite",
        NEURO_BOOK_STATE_ROOT: "/app",
    };
}
