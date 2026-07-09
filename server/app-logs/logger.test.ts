import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    AppFileLogger,
    listAppLogFiles,
    readAppLogStatus,
    redactSensitiveText,
    resolveAppLogDirectory,
    sanitizeAppLogValue,
    serializeAppLogError,
} from "nbook/server/app-logs/logger";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await fs.rm(root, {recursive: true, force: true});
    }
});

/**
 * 创建临时日志根目录。
 */
async function tempLogRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-app-logs-"));
    cleanupRoots.push(root);
    return root;
}

describe("app logs logger", () => {
    it("resolves explicit log directory before environment fallbacks", () => {
        expect(resolveAppLogDirectory({
            cwd: "C:/Product",
            env: {NEURO_BOOK_LOG_DIR: "data/logs"} as NodeJS.ProcessEnv,
        }).replaceAll("\\", "/")).toBe("C:/Product/data/logs");
        expect(resolveAppLogDirectory({
            cwd: "C:/Product",
            env: {NODE_ENV: "production"} as NodeJS.ProcessEnv,
        }).replaceAll("\\", "/")).toBe("C:/Product/logs");
        expect(resolveAppLogDirectory({
            cwd: "C:/Repo",
            env: {} as NodeJS.ProcessEnv,
        }).replaceAll("\\", "/")).toBe("C:/Repo/workspace/.nbook/logs");
    });

    it("redacts common secret fields recursively", () => {
        const sanitized = sanitizeAppLogValue({
            apiKey: "sk-123",
            authorization: "Bearer token",
            cookie: "sid=1",
            password: "pw",
            nested: {
                token: "token",
                secret: "secret",
                safe: "visible",
            },
        });

        expect(sanitized).toEqual({
            apiKey: "[REDACTED]",
            authorization: "[REDACTED]",
            cookie: "[REDACTED]",
            password: "[REDACTED]",
            nested: {
                token: "[REDACTED]",
                secret: "[REDACTED]",
                safe: "visible",
            },
        });
    });

    it("redacts sensitive tokens from free text and error stacks", () => {
        expect(redactSensitiveText("Authorization: Bearer abc123 token=secret apiKey=sk-testvalue123456"))
            .toBe("Authorization: Bearer [REDACTED] token=[REDACTED] apiKey=[REDACTED]");

        const error = new Error("request failed password=hunter2");
        error.stack = "Error: request failed\napiKey=sk-realkey123456789";
        expect(serializeAppLogError(error)).toMatchObject({
            message: "request failed password=[REDACTED]",
            stack: "Error: request failed\napiKey=[REDACTED]",
        });
    });

    it("writes jsonl entries with sanitized data and serialized errors", async () => {
        const root = await tempLogRoot();
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            now: () => new Date("2026-06-28T10:00:00.000Z"),
        });

        await logger.error("test.error", {path: "/api/test", apiKey: "hidden"}, new Error("boom"), "请求失败 token=hidden");
        await logger.flush();

        const text = await fs.readFile(path.join(root, "server-current.jsonl"), "utf8");
        const entry = JSON.parse(text.trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            timestamp: "2026-06-28T10:00:00.000Z",
            level: "error",
            event: "test.error",
            message: "请求失败 token=[REDACTED]",
        });
        expect(entry.data).toMatchObject({path: "/api/test", apiKey: "[REDACTED]"});
        expect(entry.error).toMatchObject({name: "Error", message: "boom"});
    });

    it("writes fatal logs synchronously for crash paths", async () => {
        const root = await tempLogRoot();
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            now: () => new Date("2026-06-28T10:01:00.000Z"),
        });

        logger.fatalSync("process.uncaughtException", undefined, new Error("fatal token=secret"), "Uncaught exception");

        const text = await fs.readFile(path.join(root, "server-current.jsonl"), "utf8");
        const entry = JSON.parse(text.trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            timestamp: "2026-06-28T10:01:00.000Z",
            level: "fatal",
            event: "process.uncaughtException",
        });
        expect(entry.error).toMatchObject({message: "fatal token=[REDACTED]"});
    });

    it("rotates server-current and prunes old server logs", async () => {
        const root = await tempLogRoot();
        let second = 0;
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            maxFileBytes: 180,
            retention: 3,
            now: () => new Date(`2026-06-28T10:00:${String(second++).padStart(2, "0")}.000Z`),
        });

        for (let index = 0; index < 8; index += 1) {
            await logger.info("test.large", {index, text: "x".repeat(80)});
        }
        await logger.flush();

        const files = await listAppLogFiles(root);
        const serverFiles = files.filter((file) => file.name === "server-current.jsonl" || file.name.startsWith("server-"));
        expect(serverFiles.length).toBeLessThanOrEqual(3);
        expect(serverFiles.some((file) => file.name === "server-current.jsonl")).toBe(true);
    });

    it("summarizes status for empty and populated directories", async () => {
        const root = await tempLogRoot();
        await expect(readAppLogStatus(root)).resolves.toMatchObject({
            directory: root,
            fileCount: 0,
            totalBytes: 0,
            latestMtimeMs: null,
        });

        await fs.writeFile(path.join(root, "launcher-2026-06-28.log"), "hello\n", "utf8");
        const status = await readAppLogStatus(root);
        expect(status.fileCount).toBe(1);
        expect(status.totalBytes).toBe(6);
        expect(status.latestMtimeMs).toEqual(expect.any(Number));
    });
});
