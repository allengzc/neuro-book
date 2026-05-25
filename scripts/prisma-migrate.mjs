#!/usr/bin/env node
import {spawn} from "node:child_process";
import {preparePrismaEnv} from "./prisma-env.mjs";

const env = preparePrismaEnv();
const mode = process.argv.includes("--deploy") ? "deploy" : "dev";
if (env.kind === "sqlite" && mode === "deploy") {
    const child = spawn("node", ["scripts/sqlite-migrate.mjs"], {
        env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
        stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
} else {
    const args = ["prisma", "migrate", mode, "--config", "./prisma.config.ts"];
    const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
    const child = spawn(bunCommand, ["x", ...args], {
        env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
        stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
}
