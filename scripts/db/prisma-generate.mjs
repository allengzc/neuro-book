#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {preparePrismaEnv} from "./prisma-env.mjs";

const env = preparePrismaEnv();
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const child = spawn(bunCommand, ["x", "prisma", "generate", "--config", "./prisma.config.ts"], {
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
