/**
 * 统一入口 guard：server/ 下除 allowlist 外，禁止任何文件直接从 @earendil-works/pi-ai
 * import streamSimple / completeSimple——所有 provider 调用必须走 traced-provider，
 * 否则该调用对 Pi 请求 trace 不可见。
 *
 * 仓库没有 eslint / biome 的模块级 import 限制（模块级限制会误伤合法的 pi-ai 类型 import），
 * 本扫描测试是这条约束的唯一机器强制点。新增合法直连点必须显式改 ALLOWLIST 并说明理由。
 */
import {readFile, readdir} from "node:fs/promises";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

// 本文件位于 server/agent/observability/，上跳两级即 server/。
const serverRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 允许直接 import streamSimple/completeSimple 的文件（相对 server/ 的 posix 路径）。 */
const ALLOWLIST = new Set([
    "agent/observability/traced-provider.ts",
    // health-check 已正式划出 trace 范围（task 86 round-01，2026-07-05 用户决定）。
    "utils/model-settings.ts",
]);

/** 匹配自 pi-ai 的具名 import/export 子句或命名空间 import；`[^}]` 天然跨行。 */
const PI_AI_IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+["']@earendil-works\/pi-ai["']/g;

async function collectTsFiles(dir: string, out: string[]): Promise<void> {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") {
                await collectTsFiles(join(dir, entry.name), out);
            }
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            out.push(join(dir, entry.name));
        }
    }
}

describe("pi 请求统一入口 guard", () => {
    it("server/ 只有 allowlist 能直接 import streamSimple / completeSimple", async () => {
        const files: string[] = [];
        await collectTsFiles(serverRoot, files);
        expect(files.length).toBeGreaterThan(100); // 扫描面兜底：路径算错时立刻暴露

        const violations: string[] = [];
        for (const file of files) {
            const rel = relative(serverRoot, file).replaceAll("\\", "/");
            if (ALLOWLIST.has(rel)) {
                continue;
            }
            const source = await readFile(file, "utf8");
            for (const match of source.matchAll(PI_AI_IMPORT_RE)) {
                // 命名空间 import 无法静态确认用途，一律视为违规；具名子句看是否含目标函数。
                if (match[1]!.startsWith("*") || /\b(?:streamSimple|completeSimple)\b/.test(match[1]!)) {
                    violations.push(rel);
                    break;
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
