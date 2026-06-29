import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it, vi} from "vitest";
import {runCli} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/cli";
import {loadConfig} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/config";
import {importCuratedRulesets} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/curated-import";
import {CURATED_RULE_SLUGS} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/curated-slugs";
import {loadRules} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/rules";
import {scanText} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/scanner";
import type {LintRuleRecord} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/types";

const RULESETS_ROOT = resolve("assets/workspace/.nbook/agent/skills/llmlint/rulesets");
const LLMLINT_BIN = resolve("assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts");
const execFileAsync = promisify(execFile);

describe("llmlint", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("默认启用 builtin/default ruleset 并加载 LLM rules", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const issues = scanText("首先要分析问题，其次要制定方案，最后执行。他抬起头颅。", loadedRules.regexRules);

        expect(loadedRules.summary.rulesets).toEqual(["builtin/default"]);
        expect(issues.some((issue) => issue.rule.id === "firstly-secondly")).toBe(true);
        expect(issues.some((issue) => issue.rule.ruleset === "builtin/default")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "firstly-secondly")?.rule.level).toBe("high");
        expect(loadedRules.llmRules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
        expect(issues.map((issue) => issue.rule.id)).toContain("cn.vocabulary.body.skull-head");
    });

    it("rules 和中文 namespace alias 能关闭和改写规则级别", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-config-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    namespaces: {
        "二元对比": "low",
    },
    rules: {
        "filler-word-actually": "off",
    },
};
`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const loadedRules = await loadRules(config);
        const issues = scanText("其实不是因为天气不好，而是因为路况复杂。", loadedRules.regexRules);

        expect(issues.some((issue) => issue.rule.id === "filler-word-actually")).toBe(false);
        expect(issues.find((issue) => issue.rule.id === "not-but-structure")?.rule.level).toBe("low");
    });

    it("vocabulary.r18 namespace 能关闭默认中文精选规则集中的 R18 规则", async () => {
        const loadedRules = await loadRules({
            rulesets: ["builtin/default"],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {
                "vocabulary.r18": "off",
            },
            rules: {},
            output: "stylish",
        });

        expect(loadedRules.rules.some((rule) => rule.namespace === "vocabulary.r18")).toBe(false);
    });

    it("多个 ruleset 可向同 namespace append，并按同 id override 产生 diagnostics", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
            regexRule("test.shared.B", "modifier", "规则 B", "新词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.C", "modifier", "规则 C", "追加词"),
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            output: "stylish",
        });

        const issues = scanText("旧词 新词 追加词 覆盖词", loadedRules.regexRules);

        expect(loadedRules.summary.namespaces.find((item) => item.namespace === "modifier")?.totalRules).toBe(3);
        expect(issues.some((issue) => issue.rule.id === "test.shared.B")).toBe(true);
        expect(issues.some((issue) => issue.rule.id === "test.shared.C")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "test.shared.A")?.match).toBe("覆盖词");
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "rule-override",
                ruleId: "test.shared.A",
                previousRuleset: firstRuleset,
                nextRuleset: secondRuleset,
            }),
        ]));
    });

    it("rulesetOverrides off 的规则包不参与同 ID 覆盖", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            rulesetOverrides: {
                [secondRuleset]: "off",
            },
            namespaces: {},
            rules: {},
            output: "stylish",
        });
        const issues = scanText("旧词 覆盖词", loadedRules.regexRules);

        expect(issues).toHaveLength(1);
        expect(issues[0]?.rule.ruleset).toBe(firstRuleset);
        expect(issues[0]?.match).toBe("旧词");
        expect(loadedRules.diagnostics.some((diagnostic) => diagnostic.code === "rule-override")).toBe(false);
    });

    it("rulesetOverrides off 的规则包可被 rule 或 namespace 显式启用", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.explicit.rule", "modifier", "按 rule 启用", "规则词"),
            regexRule("test.explicit.namespace", "tone", "按 namespace 启用", "语气词"),
            regexRule("test.explicit.skipped", "cliche", "保持关闭", "关闭词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {
                [rulesetId]: "off",
            },
            namespaces: {
                tone: "low",
            },
            rules: {
                "test.explicit.rule": "high",
            },
            output: "stylish",
        });
        const issues = scanText("规则词 语气词 关闭词", loadedRules.regexRules);

        expect(issues.map((issue) => issue.rule.id)).toEqual([
            "test.explicit.rule",
            "test.explicit.namespace",
        ]);
        expect(issues.find((issue) => issue.rule.id === "test.explicit.rule")?.rule.level).toBe("high");
        expect(issues.find((issue) => issue.rule.id === "test.explicit.namespace")?.rule.level).toBe("low");
        expect(loadedRules.summary.rulesets).toContain(rulesetId);
    });

    it("regex detector 支持 flags 和多个 targets", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            ...regexRule("test.flags", "test.regex", "大小写规则", "alpha"),
            detector: {type: "regex", targets: ["alpha", "beta"], flags: "i"},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("ALPHA beta", loadedRules.regexRules);

        expect(issues.map((issue) => issue.match)).toEqual(["ALPHA", "beta"]);
    });

    it("handler rule 第一版会跳过并产生 warning", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            id: "test.handler",
            namespace: "test.handler",
            title: "handler",
            level: "medium",
            handler: {type: "module", path: "handler.ts"},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));

        expect(loadedRules.rules).toHaveLength(0);
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "handler-not-implemented", ruleId: "test.handler"}),
        ]));
    });

    it("rule source 只接受当前 schema 明确允许的字段", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRawRuleset(rulesetId, [{
            id: "test.source.extra",
            namespace: "test.source",
            title: "来源字段收紧",
            level: "medium",
            source: {
                importedFrom: "fixture",
                unexpected: "not allowed",
            },
            detector: {type: "regex", targets: ["来源词"]},
            action: {type: "replace", replacements: [""]},
        }]);

        await expect(loadRules(emptyConfig([rulesetId]))).rejects.toThrow("不是允许的 source 字段");
    });

    it("配置 output json 时 CLI 输出 check JSON，包含 registry 和 diagnostics", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-json-output-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    output: "json",
};
`, "utf-8");
        await writeFile(textPath, "alpha beta", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; registry: {rulesets: string[]}; diagnostics: unknown[]; issues: unknown[]};
        expect(report).toMatchObject({
            kind: "check",
            registry: {rulesets: ["builtin/default"]},
            diagnostics: [],
            issues: [],
        });
    });

    it("命令行 --format json 覆盖 config output 并输出 LLM rules JSON", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--format", "json", "show-llm-rules"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; rules: Array<{id: string}>};
        expect(report.kind).toBe("llm-rules");
        expect(report.rules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
    });

    it("CLI help 只暴露硬切后的公开命令", async () => {
        const {stdout} = await execFileAsync("bun", [LLMLINT_BIN, "--help"], {
            encoding: "utf-8",
            timeout: 10000,
        });

        expect(stdout).toContain("check [options] <file>");
        expect(stdout).toContain("show-llm-rules [options]");
        expect(stdout).not.toContain("import-legacy");
        expect(stdout).not.toContain("import-curated");
        expect(stdout).not.toContain("兼容旧用法");
        expect(stdout).not.toContain("llmlint [options] [file]");
    });

    it("CLI 不再支持 llmlint <file> 旧 positional 用法", async () => {
        const result = await runFailedCommand([
            LLMLINT_BIN,
            "assets/workspace/.nbook/agent/skills/llmlint/SKILL.md",
        ]);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("unknown command");
    });

    it("llmlint 源码不保留旧规则导入入口", async () => {
        const root = resolve("assets/workspace/.nbook/agent/skills/llmlint");
        const files = await listFiles(root);
        const fileNames = files.map((file) => file.replace(/\\/g, "/"));
        const source = (await Promise.all(files
            .filter((file) => /\.(ts|md|json)$/.test(file))
            .map((file) => readFile(file, "utf-8"))))
            .join("\n");

        expect(fileNames.some((file) => file.endsWith("legacy-import.ts"))).toBe(false);
        expect(source).not.toContain("import-legacy");
        expect(source).not.toContain("LegacyImport");
        expect(source).not.toContain("source.legacy");
    });

    it("curated import 会生成单个内置中文精选 ruleset 并去重合并策展素材", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-curated-"));
        tempRoots.push(root);
        const report = await importCuratedRulesets({
            sourceRoot: ".agent/workspace/llmlint_rules",
            outputRoot: root,
        });
        const rules = JSON.parse(await readFile(join(root, "builtin", "default", "rules.json"), "utf-8")) as Array<{
            id: string;
            namespace: string;
            enabled?: boolean;
            detector: {type: "regex"; targets: string[]} | {type: "llm"; prompt: string};
            action: {replacements: string[]};
            source?: {canonicalKey?: string; importedFrom?: string};
        }>;

        expect(report.rulesets.map((ruleset) => ruleset.rulesetId)).toEqual([
            "builtin/default",
        ]);
        expect(report.skipped).toHaveLength(0);
        expect(report.converted.text).toBeGreaterThan(0);
        expect(report.converted.simple).toBeGreaterThan(0);
        expect(report.converted.regex).toBeGreaterThan(0);
        expect(report.uniqueRules).toBe(292);
        expect(rules).toHaveLength(292);
        expect(rules.some((rule) => rule.id === "mechanical-elevation-ending")).toBe(true);
        expect(rules.some((rule) => /^cn\..+\.[0-9a-f]{10}$/.test(rule.id))).toBe(false);
        expect(rules.some((rule) => rule.namespace === "vocabulary.r18" && rule.enabled !== false)).toBe(true);
        expect(rules.some((rule) => rule.namespace === "modifier.extreme" && rule.enabled !== false)).toBe(false);
        expect(JSON.stringify(rules)).not.toContain(`leg${"acy"}`);
        expect(rules.filter((rule) => rule.id.startsWith("cn.")).every((rule) => rule.source?.importedFrom === ".agent/workspace/llmlint_rules")).toBe(true);
        expect(rules.some((rule) => rule.id === "cn.vocabulary.body.skull-head")).toBe(true);
        const cnSlugs = rules
            .filter((rule) => rule.id.startsWith("cn."))
            .map((rule) => rule.id.split(".").at(-1) ?? "");
        expect(cnSlugs.every((slug) => slug.length <= 40)).toBe(true);
        expect(cnSlugs).not.toEqual(expect.arrayContaining([
            "tou-lu",
            "cu-zhong-cu-bao-feng-kuang-de-di",
            "zhi-shan-mo-wei-huo-dui-hua-qian-zhi-fen-ju",
            "punctuation-4",
        ]));
        const headRule = rules.find((rule) => rule.detector.type === "regex" && rule.detector.targets.includes("头颅"));
        expect(headRule?.action.replacements)
            .toEqual(expect.arrayContaining(["头", "脑袋"]));
    });

    it("curated import 遇到缺失 slug 映射会失败", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-curated-missing-slug-"));
        tempRoots.push(root);
        const key = "vocabulary.body\t\t头颅";
        const original = CURATED_RULE_SLUGS[key];
        delete CURATED_RULE_SLUGS[key];

        try {
            await expect(importCuratedRulesets({
                sourceRoot: ".agent/workspace/llmlint_rules",
                outputRoot: root,
            })).rejects.toThrow("缺少中文规则 slug 映射");
        } finally {
            if (original) {
                CURATED_RULE_SLUGS[key] = original;
            }
        }
    });

    it("显式配置路径不存在时返回明确错误", async () => {
        await expect(loadConfig({
            cwd: process.cwd(),
            configPath: join(tmpdir(), "missing-llmlint.config.ts"),
        })).rejects.toThrow("配置文件不存在");
    });
});

function emptyConfig(rulesets: string[]) {
    return {
        rulesets,
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        output: "stylish" as const,
    };
}

function regexRule(id: string, namespace: string, title: string, target: string): LintRuleRecord {
    return {
        id,
        namespace,
        title,
        level: "medium",
        detector: {type: "regex", targets: [target]},
        action: {type: "replace", replacements: [""]},
    };
}

async function writeRuleset(id: string, rules: LintRuleRecord[]): Promise<void> {
    await writeRawRuleset(id, rules);
}

async function writeRawRuleset(id: string, rules: object[]): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules.json"), JSON.stringify(rules), "utf-8");
}

async function listFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true});
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = join(root, entry.name);
        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }
        return [entryPath];
    }));
    return files.flat();
}

async function runFailedCommand(args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> {
    try {
        await execFileAsync("bun", args, {
            encoding: "utf-8",
            timeout: 10000,
        });
    } catch (error) {
        const failed = error as {code?: number | null; stdout?: string; stderr?: string};
        return {
            code: failed.code ?? null,
            stdout: failed.stdout ?? "",
            stderr: failed.stderr ?? "",
        };
    }
    throw new Error("命令预期失败，但实际成功。");
}
