import {afterEach, describe, expect, it} from "vitest";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {tmpdir} from "node:os";

import {ensurePrismaRuntime, resolvePrismaRuntimePlan} from "nbook/scripts/cli/prisma-runtime-preflight";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-prisma-preflight-"));
    tempRoots.push(root);
    return root;
}

afterEach(async () => {
    for (const root of tempRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

describe("Prisma runtime preflight", () => {
    it("源码模式缺少 App Prisma Client 时会自动生成", async () => {
        const root = await tempRoot();
        const generateScriptPath = join(root, "scripts", "db", "prisma-generate.mjs");
        const clientPath = join(root, "server", "generated", "prisma", "client.ts");
        const calls: Array<{command: string; args: string[]}> = [];
        await mkdir(dirname(generateScriptPath), {recursive: true});
        await writeFile(generateScriptPath, "", "utf8");

        await ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async (command, args) => {
                calls.push({command, args});
                if (args[0] === "run") {
                    const nuxtTsConfigPath = join(root, ".nuxt", "tsconfig.json");
                    await mkdir(dirname(nuxtTsConfigPath), {recursive: true});
                    await writeFile(nuxtTsConfigPath, "{}", "utf8");
                    return;
                }
                await mkdir(dirname(clientPath), {recursive: true});
                await writeFile(clientPath, "", "utf8");
            },
        });

        expect(calls).toEqual([
            {
                command: process.execPath,
                args: ["run", "nuxt:prepare"],
            },
            {
                command: process.execPath,
                args: [generateScriptPath],
            },
        ]);
    });

    it("Product 模式缺少打包 Prisma Client 时只报错不生成", async () => {
        const root = await tempRoot();
        const calls: string[] = [];
        const plan = resolvePrismaRuntimePlan({
            cwd: root,
            scriptPath: join(root, ".output", "server", "scripts", "cli", "has-users.ts"),
        });

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, ".output", "server", "scripts", "cli", "has-users.ts"),
            runCommand: async (command) => {
                calls.push(command);
            },
        })).rejects.toThrow("Product Runtime 缺少打包后的 Prisma Client");
        expect(plan.mode).toBe("product");
        expect(plan.clientPath).toBe(join(root, ".output", "server", "node_modules", "nbook", "server", "generated", "prisma", "client.ts"));
        expect(calls).toEqual([]);
    });

    it("has-users 不再顶层导入 Prisma", async () => {
        const text = await readFile(resolve("scripts", "cli", "has-users.ts"), "utf8");

        expect(text).not.toContain('import {prisma} from "nbook/server/utils/prisma"');
        expect(text).toContain('await import("nbook/server/utils/prisma")');
    });
});
