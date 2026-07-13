import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";
import {parse} from "yaml";

import {writeDockerCompose} from "#manager/docker";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Docker Compose部署合同", () => {
    it("POSIX容器使用当前用户写入State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({root, stateRoot: root, profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        if (process.platform === "win32") expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
    });
});
