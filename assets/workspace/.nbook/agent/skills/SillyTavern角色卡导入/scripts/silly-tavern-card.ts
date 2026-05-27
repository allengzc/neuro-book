import fs from "node:fs/promises";
import path from "node:path";
import {Buffer} from "node:buffer";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {Command} from "commander";

type CliOptions = {
    workspace: string;
    out: string;
    force: boolean;
    json: boolean;
    rp?: boolean;
};

type CardKind = "character-card" | "preset" | "unknown";

type RawCardInput = {
    kind: CardKind;
    sourcePath: string;
    sourceType: "json" | "png";
    raw: unknown;
    card: Record<string, unknown>;
};

type MarkerCounts = Record<string, number>;

export type EntryClassification = {
    uid: string;
    comment: string;
    enabled: boolean;
    constant: boolean;
    categories: string[];
};

export type CardInspection = {
    kind: CardKind;
    sourcePath: string;
    sourceType: "json" | "png";
    slug: string;
    name: string;
    spec: string | null;
    specVersion: string | null;
    counts: {
        worldbookEntries: number;
        enabledEntries: number;
        constantEntries: number;
        regexScripts: number;
        tavernHelperScripts: number;
        tavernHelperVariables: number;
    };
    markers: MarkerCounts;
    entries: EntryClassification[];
    warnings: string[];
};

const DEFAULT_OUT = "reference/silly-tavern";
const GENERATED_MARKER = "neuro-book:silly-tavern-card generated-sha256";
const DYNAMIC_MARKERS: Array<{key: string; pattern: RegExp; category: string}> = [
    {key: "initVar", pattern: /\[initvar\]|<initvar\b/i, category: "initvar"},
    {key: "initialVariables", pattern: /\[InitialVariables\]|@@initial_variables/i, category: "initial-variables"},
    {key: "updateVariable", pattern: /<UpdateVariable\b|\[mvu_update\]|_\.(?:set|insert|assign|remove|unset|delete|add)\s*\(/i, category: "mvu-update"},
    {key: "jsonPatch", pattern: /<json_?patch\b/i, category: "json-patch"},
    {key: "ejs", pattern: /<%[\s=-]?/i, category: "ejs"},
    {key: "inject", pattern: /@INJECT/i, category: "prompt-inject"},
    {key: "condition", pattern: /@@if\b/i, category: "conditional"},
    {key: "generate", pattern: /\[GENERATE:[^\]]+\]|@@generate_(?:before|after)/i, category: "generate-prompt"},
    {key: "render", pattern: /\[RENDER:[^\]]+\]|@@render_(?:before|after)|@@iframe|@@message_formatting/i, category: "render-ui"},
];

const program = new Command();

program
    .name("silly-tavern-card")
    .description("SillyTavern 角色卡 inspect 与 Neuro Book project 导入工具");

program
    .command("inspect")
    .description("读取本地角色卡或预设，生成 inspect.md / inspect.json")
    .argument("<input>", "本地 .json/.raw.json/.png 文件")
    .requiredOption("--workspace <path>", "当前小说 workspace 根目录")
    .option("--out <path>", "workspace 内输出目录", DEFAULT_OUT)
    .option("--force", "允许覆盖已有输出目录", false)
    .option("--json", "stdout 输出 inspect JSON 摘要", false)
    .action(async (input: string, options: CliOptions) => {
        await runInspect(input, options);
    });

program
    .command("import")
    .description("执行 inspect，并把稳定设定导入 lorebook 聚合节点")
    .argument("<input>", "本地 .json/.raw.json/.png 文件")
    .requiredOption("--workspace <path>", "当前小说 workspace 根目录")
    .option("--out <path>", "workspace 内输出目录", DEFAULT_OUT)
    .option("--rp", "额外生成 RP 扩展归档", false)
    .option("--force", "允许覆盖脚本生成文件", false)
    .option("--json", "stdout 输出 import JSON 摘要", false)
    .action(async (input: string, options: CliOptions) => {
        await runImport(input, options);
    });

if (isCliEntry()) {
    runCli(process.argv).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

export async function runCli(argv: string[]): Promise<void> {
    await program.parseAsync(argv);
}

async function runInspect(input: string, options: CliOptions): Promise<void> {
    await assertProjectWorkspace(options.workspace);
    const loaded = await loadCardInput(input);
    const inspection = inspectCard(loaded);
    const target = resolveOutputTarget(options.workspace, options.out, inspection.slug);
    await assertCanWriteTarget(target.cardRoot, options.force);
    await writeInspectFiles(target, loaded, inspection, {force: options.force});
    printInspectSummary(inspection, target.cardRoot, options.json);
}

async function runImport(input: string, options: CliOptions): Promise<void> {
    await assertProjectWorkspace(options.workspace);
    const loaded = await loadCardInput(input);
    const inspection = inspectCard(loaded);
    if (inspection.kind === "unknown") {
        throw new Error("输入不是可识别的 SillyTavern 角色卡或 preset，已停止 import。请先运行 inspect 查看原始结构。");
    }
    const target = resolveOutputTarget(options.workspace, options.out, inspection.slug);
    await assertCanWriteTarget(target.cardRoot, options.force);
    await writeInspectFiles(target, loaded, inspection, {force: options.force});

    const written: string[] = [];
    if (inspection.kind === "character-card") {
        written.push(await writeLorebookAggregate(target, inspection, loaded, options.force));
        if (options.rp) {
            written.push(...await writeRpExtension(target.workspaceRoot, inspection, loaded, options.force));
        }
    }
    const reportPath = await writeImportReport(target, inspection, written, options.force);
    written.push(reportPath);
    printImportSummary(inspection, written, options.json);
}

export async function loadCardInput(inputPath: string): Promise<RawCardInput> {
    const sourcePath = path.resolve(inputPath);
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === ".json") {
        const raw = JSON.parse(await fs.readFile(sourcePath, "utf-8")) as unknown;
        return normalizeRawInput(sourcePath, "json", raw);
    }
    if (extension === ".png") {
        const raw = await readSillyTavernPngJson(sourcePath);
        return normalizeRawInput(sourcePath, "png", raw);
    }
    throw new Error(`不支持的输入类型：${extension || sourcePath}`);
}

export function inspectCard(input: RawCardInput): CardInspection {
    const data = readObject(input.card.data);
    const characterBook = readObject(data.character_book ?? input.card.character_book);
    const entries = readArray(characterBook.entries).map((entry, index) => classifyEntry(entry, index));
    const extensions = readObject(data.extensions ?? input.card.extensions);
    const tavernHelper = readObject(extensions.tavern_helper);
    const regexScripts = readArray(extensions.regex_scripts);
    const helperScripts = readArray(tavernHelper.scripts);
    const helperVariables = readObject(tavernHelper.variables);
    const allText = [
        readString(data.description),
        readString(data.scenario),
        readString(data.first_mes),
        readString(data.mes_example),
        ...readArray(characterBook.entries).map((entry, index) => {
            const rawEntry = readObject(entry);
            const classified = entries[index];
            return `${classified?.comment ?? ""}\n${classified?.uid ?? ""}\n${readString(rawEntry.content)}`;
        }),
        JSON.stringify(extensions),
    ].join("\n");
    const markers = countMarkers(allText);
    const name = readString(data.name) || readString(input.card.name) || inferNameFromPath(input.sourcePath);
    const warnings: string[] = [];
    if (input.kind === "preset") {
        warnings.push("输入看起来是 SillyTavern preset，不会作为角色主体导入 lorebook。");
    }
    if (input.sourceType === "png") {
        warnings.push("PNG 内嵌 JSON 解析为 best-effort；如结果异常，优先使用已提取的 .raw.json。");
    }

    return {
        kind: input.kind,
        sourcePath: input.sourcePath,
        sourceType: input.sourceType,
        slug: slugify(name),
        name,
        spec: readString(input.card.spec) || null,
        specVersion: readString(input.card.spec_version) || null,
        counts: {
            worldbookEntries: entries.length,
            enabledEntries: entries.filter((entry) => entry.enabled).length,
            constantEntries: entries.filter((entry) => entry.constant).length,
            regexScripts: regexScripts.length,
            tavernHelperScripts: helperScripts.length,
            tavernHelperVariables: Object.keys(helperVariables).length,
        },
        markers,
        entries,
        warnings,
    };
}

function normalizeRawInput(sourcePath: string, sourceType: "json" | "png", raw: unknown): RawCardInput {
    const card = readObject(raw);
    const kind = detectCardKind(card);
    return {
        kind,
        sourcePath,
        sourceType,
        raw,
        card,
    };
}

function detectCardKind(card: Record<string, unknown>): CardKind {
    const data = readObject(card.data);
    if (readString(card.spec).startsWith("chara_card") || readString(data.name) || data.character_book) {
        return "character-card";
    }
    if (card.SPreset || card.prompts || card.prompt_order || readObject(card.extensions).tavern_helper || readObject(card.extensions).regex_scripts) {
        return "preset";
    }
    return "unknown";
}

function classifyEntry(rawEntry: unknown, index: number): EntryClassification {
    const entry = readObject(rawEntry);
    const comment = readString(entry.comment) || readString(entry.name) || `entry-${index + 1}`;
    const content = readString(entry.content);
    const text = `${comment}\n${content}`;
    const categories = DYNAMIC_MARKERS
        .filter((marker) => marker.pattern.test(text))
        .map((marker) => marker.category);
    if (categories.length === 0) {
        categories.push("static-candidate");
    }
    return {
        uid: String(entry.uid ?? entry.id ?? index),
        comment,
        enabled: entry.disable !== true,
        constant: entry.constant === true,
        categories: [...new Set(categories)],
    };
}

function countMarkers(text: string): MarkerCounts {
    const counts: MarkerCounts = {};
    for (const marker of DYNAMIC_MARKERS) {
        const matches = text.match(new RegExp(marker.pattern.source, marker.pattern.flags.includes("g") ? marker.pattern.flags : `${marker.pattern.flags}g`));
        counts[marker.key] = matches?.length ?? 0;
    }
    return counts;
}

async function readSillyTavernPngJson(sourcePath: string): Promise<unknown> {
    const buffer = await fs.readFile(sourcePath);
    const chunks = readPngTextChunks(buffer);
    for (const chunk of chunks) {
        if (!/chara|ccv3|json|comment|description/i.test(chunk.keyword)) {
            continue;
        }
        const parsed = tryParseCardText(chunk.text);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    for (const chunk of chunks) {
        const parsed = tryParseCardText(chunk.text);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    throw new Error("未能从 PNG 中解析 SillyTavern JSON；请先使用已提取的 .raw.json。");
}

function readPngTextChunks(buffer: Buffer): Array<{keyword: string; text: string}> {
    const signature = "89504e470d0a1a0a";
    if (buffer.subarray(0, 8).toString("hex") !== signature) {
        throw new Error("输入不是有效 PNG 文件。");
    }
    const chunks: Array<{keyword: string; text: string}> = [];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            break;
        }
        if (type === "tEXt") {
            const separator = buffer.indexOf(0, dataStart);
            if (separator > dataStart && separator < dataEnd) {
                chunks.push({
                    keyword: buffer.subarray(dataStart, separator).toString("latin1"),
                    text: buffer.subarray(separator + 1, dataEnd).toString("utf-8"),
                });
            }
        }
        offset = dataEnd + 4;
    }
    return chunks;
}

function tryParseCardText(text: string): unknown {
    const candidates = [text.trim()];
    try {
        candidates.push(Buffer.from(text.trim(), "base64").toString("utf-8").trim());
    } catch {
        // ignore
    }
    for (const candidate of candidates) {
        if (!candidate || (!candidate.startsWith("{") && !candidate.startsWith("["))) {
            continue;
        }
        try {
            return JSON.parse(candidate);
        } catch {
            // ignore
        }
    }
    return undefined;
}

type OutputTarget = {
    workspaceRoot: string;
    outRelative: string;
    cardRoot: string;
};

function resolveOutputTarget(workspaceInput: string, out: string, slug: string): OutputTarget {
    const workspaceRoot = path.resolve(workspaceInput);
    const outRelative = toSafeRelativePath(out);
    return {
        workspaceRoot,
        outRelative,
        cardRoot: path.join(workspaceRoot, outRelative, slug),
    };
}

async function assertProjectWorkspace(workspaceInput: string): Promise<void> {
    const workspaceRoot = path.resolve(workspaceInput);
    try {
        const stats = await fs.stat(workspaceRoot);
        if (!stats.isDirectory()) {
            throw new Error("not-directory");
        }
        await fs.access(path.join(workspaceRoot, "project.yaml"));
    } catch {
        throw new Error(`--workspace 必须指向当前小说 Project Workspace，且目录下需要存在 project.yaml：${workspaceRoot}`);
    }
}

async function assertCanWriteTarget(targetRoot: string, force: boolean): Promise<void> {
    if (force) {
        return;
    }
    try {
        await fs.access(targetRoot);
        throw new Error(`目标已存在，使用 --force 覆盖脚本生成文件：${targetRoot}`);
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return;
        }
        throw error;
    }
}

async function writeInspectFiles(
    target: OutputTarget,
    loaded: RawCardInput,
    inspection: CardInspection,
    options: {force: boolean},
): Promise<void> {
    await fs.mkdir(path.join(target.cardRoot, "raw"), {recursive: true});
    await writeGeneratedFile(path.join(target.cardRoot, "raw", "card.json"), JSON.stringify(loaded.raw, null, 2) + "\n", options.force);
    if (loaded.sourceType === "png") {
        await writeGeneratedBinaryFile(path.join(target.cardRoot, "raw", "source.png"), await fs.readFile(loaded.sourcePath), options.force);
    }
    await writeGeneratedFile(path.join(target.cardRoot, "inspect.json"), JSON.stringify(inspection, null, 2) + "\n", options.force);
    await writeGeneratedFile(path.join(target.cardRoot, "inspect.md"), renderInspectMarkdown(inspection), options.force);
}

async function writeLorebookAggregate(target: OutputTarget, inspection: CardInspection, loaded: RawCardInput, force: boolean): Promise<string> {
    const nodeDir = path.join(target.workspaceRoot, "lorebook", "note", `silly-tavern-${inspection.slug}`);
    const indexPath = path.join(nodeDir, "index.md");
    await fs.mkdir(nodeDir, {recursive: true});
    const body = renderLorebookAggregate(inspection, loaded);
    await writeGeneratedFile(indexPath, renderMarkdown({
        title: `${inspection.name} 导入设定`,
        type: "note",
        subtype: null,
        status: "draft",
        icon: null,
        aliases: [inspection.name],
        tags: ["SillyTavern", "角色卡导入"],
        summary: `从 SillyTavern 角色卡 ${inspection.name} 导入的聚合设定草案。`,
        refs: [],
        retrieval: {
            enabled: true,
            trigger: "需要参考导入的 SillyTavern 角色卡设定、世界书或背景资料时。",
        },
        inject: {
            profiles: [],
            always: false,
        },
        governance: {
            source: "silly-tavern-import",
            review: "proposed",
        },
        ext: {
            sourceCard: inspection.sourcePath,
            inspect: path.posix.join(...target.outRelative.split("/"), inspection.slug, "inspect.md"),
        },
    }, body), force);
    return indexPath;
}

async function writeRpExtension(workspaceRoot: string, inspection: CardInspection, loaded: RawCardInput, force: boolean): Promise<string[]> {
    const rpRoot = path.join(workspaceRoot, "roleplay", "imports", "silly-tavern", inspection.slug);
    await fs.mkdir(rpRoot, {recursive: true});
    const written: string[] = [];
    const files: Array<[string, string]> = [
        ["dynamic-prompt.md", renderDynamicPromptArchive(inspection, loaded)],
        ["initvar.md", renderEntryArchive(inspection, loaded, ["initvar", "initial-variables"])],
        ["update-rules.md", renderEntryArchive(inspection, loaded, ["mvu-update", "json-patch"])],
        ["status-ui.md", renderEntryArchive(inspection, loaded, ["render-ui"])],
        ["scripts.md", renderScriptsArchive(inspection, loaded)],
    ];
    for (const [fileName, content] of files) {
        const filePath = path.join(rpRoot, fileName);
        await writeGeneratedFile(filePath, content, force);
        written.push(filePath);
    }
    return written;
}

async function writeImportReport(target: {cardRoot: string}, inspection: CardInspection, written: string[], force: boolean): Promise<string> {
    const reportPath = path.join(target.cardRoot, "import-report.md");
    await writeGeneratedFile(reportPath, renderImportReport(inspection, written), force);
    return reportPath;
}

async function writeGeneratedFile(filePath: string, content: string, force: boolean): Promise<void> {
    if (!force) {
        try {
            await fs.access(filePath);
            throw new Error(`文件已存在，使用 --force 覆盖：${filePath}`);
        } catch (error) {
            if (!isNodeError(error, "ENOENT")) {
                throw error;
            }
        }
    } else {
        await assertGeneratedFileCanBeOverwritten(filePath);
    }
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, "utf-8");
    await writeGeneratedMarker(filePath, content);
}

async function assertGeneratedFileCanBeOverwritten(filePath: string): Promise<void> {
    try {
        const current = await fs.readFile(filePath, "utf-8");
        const marker = await readGeneratedMarker(filePath);
        if (!marker || marker.hash !== sha256(current)) {
            throw new Error(`拒绝覆盖可能被用户修改的文件：${filePath}`);
        }
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return;
        }
        throw error;
    }
}

async function writeGeneratedBinaryFile(filePath: string, content: Buffer, force: boolean): Promise<void> {
    if (!force) {
        try {
            await fs.access(filePath);
            throw new Error(`文件已存在，使用 --force 覆盖：${filePath}`);
        } catch (error) {
            if (!isNodeError(error, "ENOENT")) {
                throw error;
            }
        }
    } else {
        await assertGeneratedBinaryFileCanBeOverwritten(filePath);
    }
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content);
    await writeGeneratedMarker(filePath, content);
}

async function assertGeneratedBinaryFileCanBeOverwritten(filePath: string): Promise<void> {
    try {
        const current = await fs.readFile(filePath);
        const marker = await readGeneratedMarker(filePath);
        if (!marker || marker.hash !== sha256(current)) {
            throw new Error(`拒绝覆盖可能被用户修改的文件：${filePath}`);
        }
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return;
        }
        throw error;
    }
}

async function readGeneratedMarker(filePath: string): Promise<{hash: string} | null> {
    try {
        const parsed = JSON.parse(await fs.readFile(markerPath(filePath), "utf-8")) as unknown;
        if (!isRecord(parsed) || parsed.marker !== GENERATED_MARKER || typeof parsed.hash !== "string") {
            return null;
        }
        return {hash: parsed.hash};
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return null;
        }
        throw error;
    }
}

async function writeGeneratedMarker(filePath: string, content: string | Buffer): Promise<void> {
    await fs.writeFile(markerPath(filePath), JSON.stringify({
        marker: GENERATED_MARKER,
        target: path.basename(filePath),
        hash: sha256(content),
    }, null, 2) + "\n", "utf-8");
}

function markerPath(filePath: string): string {
    return `${filePath}.generated.json`;
}

function sha256(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

function renderInspectMarkdown(inspection: CardInspection): string {
    const markerLines = Object.entries(inspection.markers)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
    const entryLines = inspection.entries.slice(0, 200)
        .map((entry) => `| ${escapeTable(entry.uid)} | ${escapeTable(entry.comment)} | ${entry.enabled ? "yes" : "no"} | ${entry.constant ? "yes" : "no"} | ${escapeTable(entry.categories.join(", "))} |`)
        .join("\n");
    return `# ${markdownHeadingText(inspection.name)} Inspect

## Summary

- kind: ${inspection.kind}
- source: ${inspection.sourcePath}
- spec: ${inspection.spec ?? "unknown"}
- spec_version: ${inspection.specVersion ?? "unknown"}
- slug: ${inspection.slug}

## Counts

- worldbook entries: ${inspection.counts.worldbookEntries}
- enabled entries: ${inspection.counts.enabledEntries}
- constant entries: ${inspection.counts.constantEntries}
- regex scripts: ${inspection.counts.regexScripts}
- tavern helper scripts: ${inspection.counts.tavernHelperScripts}
- tavern helper variables: ${inspection.counts.tavernHelperVariables}

## Dynamic Markers

${markerLines}

## Entries

| uid | comment | enabled | constant | categories |
| --- | --- | --- | --- | --- |
${entryLines || "| - | - | - | - | - |"}

## Warnings

${inspection.warnings.map((warning) => `- ${warning}`).join("\n") || "- none"}
`;
}

function renderLorebookAggregate(inspection: CardInspection, loaded: RawCardInput): string {
    const data = readObject(loaded.card.data);
    const characterBook = readObject(data.character_book ?? loaded.card.character_book);
    const entries = readArray(characterBook.entries);
    const staticEntries = entries
        .map((entry, index) => ({raw: readObject(entry), classified: classifyEntry(entry, index)}))
        .filter((item) => item.classified.categories.includes("static-candidate"))
        .slice(0, 80);
    return `# ${markdownHeadingText(inspection.name)}

> 这是从 SillyTavern 角色卡导入的写作设定聚合草案。动态脚本、变量更新、状态栏和提示词模板未执行；请根据 inspect 报告继续拆分到正式 lorebook 节点。

## 角色卡正文

${sectionText("Description", readString(data.description))}

${sectionText("Scenario", readString(data.scenario))}

${sectionText("First Message", readString(data.first_mes))}

${sectionText("Message Example", readString(data.mes_example))}

## 静态世界书候选

${staticEntries.map((item) => {
        const comment = item.classified.comment;
        const content = readString(item.raw.content);
        return `### ${markdownHeadingText(comment)}\n\n${content || "（空）"}`;
    }).join("\n\n") || "暂无明显静态候选。"}
`;
}

function renderDynamicPromptArchive(inspection: CardInspection, loaded: RawCardInput): string {
    return `# ${markdownHeadingText(inspection.name)} Dynamic Prompt Archive

本文件归档 ST-Prompt-Template、prompt injection 和条件世界书相关条目。第一版不执行这些逻辑。

${renderEntryArchive(inspection, loaded, ["ejs", "prompt-inject", "conditional", "generate-prompt"])}
`;
}

function renderEntryArchive(inspection: CardInspection, loaded: RawCardInput, categories: string[]): string {
    const data = readObject(loaded.card.data);
    const characterBook = readObject(data.character_book ?? loaded.card.character_book);
    const entries = readArray(characterBook.entries);
    const matched = entries
        .map((entry, index) => ({raw: readObject(entry), classified: classifyEntry(entry, index)}))
        .filter((item) => item.classified.categories.some((category) => categories.includes(category)));
    return matched.map((item) => {
        const content = readString(item.raw.content);
        const fence = markdownFence(content);
        return `## ${markdownHeadingText(item.classified.comment)}

- uid: ${item.classified.uid}
- categories: ${item.classified.categories.join(", ")}

${fence}text
${content}
${fence}
`;
    }).join("\n") || "暂无匹配条目。\n";
}

function renderScriptsArchive(inspection: CardInspection, loaded: RawCardInput): string {
    const data = readObject(loaded.card.data);
    const extensions = readObject(data.extensions ?? loaded.card.extensions);
    return `# ${markdownHeadingText(inspection.name)} Scripts Archive

regex_scripts: ${inspection.counts.regexScripts}

tavern_helper.scripts: ${inspection.counts.tavernHelperScripts}

\`\`\`json
${JSON.stringify({
        regex_scripts: extensions.regex_scripts ?? [],
        tavern_helper: readObject(extensions.tavern_helper).scripts ?? [],
    }, null, 2)}
\`\`\`
`;
}

function renderImportReport(inspection: CardInspection, written: string[]): string {
    return `# ${markdownHeadingText(inspection.name)} Import Report

## Result

- kind: ${inspection.kind}
- lorebook imported: ${inspection.kind === "character-card" ? "yes" : "no"}
- dynamic runtime executed: no

## Written Files

${written.map((filePath) => `- ${filePath}`).join("\n") || "- none"}

## Skipped Dynamic Content

- MVU update markers: ${inspection.markers.updateVariable ?? 0}
- JSON Patch markers: ${inspection.markers.jsonPatch ?? 0}
- EJS markers: ${inspection.markers.ejs ?? 0}
- prompt injection markers: ${inspection.markers.inject ?? 0}
- render/UI markers: ${inspection.markers.render ?? 0}

## Next Steps

- Review \`inspect.md\`.
- Split the aggregate lorebook note into character/location/faction/rule nodes as needed.
- For RP mode, adapt archived dynamic rules manually before enabling any runtime behavior.
`;
}

function renderMarkdown(frontmatter: Record<string, unknown>, body: string): string {
    return `---\n${toYaml(frontmatter)}---\n\n${body.trim()}\n`;
}

function toYaml(value: Record<string, unknown>): string {
    return Object.entries(value).map(([key, item]) => `${key}: ${yamlValue(item, 0)}`).join("\n") + "\n";
}

function yamlValue(value: unknown, indent: number): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        const prefix = " ".repeat(indent + 2);
        return `\n${value.map((item) => `${prefix}- ${yamlValue(item, indent + 2).trimStart()}`).join("\n")}`;
    }
    if (isRecord(value)) {
        if (Object.keys(value).length === 0) {
            return "{}";
        }
        const prefix = " ".repeat(indent + 2);
        return `\n${Object.entries(value).map(([key, item]) => `${prefix}${key}: ${yamlValue(item, indent + 2)}`).join("\n")}`;
    }
    return JSON.stringify(value);
}

function sectionText(title: string, content: string): string {
    return `## ${title}\n\n${content || "（空）"}`;
}

function markdownHeadingText(value: string): string {
    return value.replace(/\r?\n/g, " ").replace(/^#+\s*/u, "").trim() || "未命名条目";
}

function markdownFence(content: string): string {
    const longest = [...content.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length), 2);
    return "`".repeat(longest + 1);
}

function printInspectSummary(inspection: CardInspection, cardRoot: string, json: boolean): void {
    if (json) {
        console.log(JSON.stringify({ok: true, inspection, cardRoot}, null, 2));
        return;
    }
    console.log(`inspect wrote: ${cardRoot}`);
    console.log(`${inspection.kind}: ${inspection.name}`);
}

function printImportSummary(inspection: CardInspection, written: string[], json: boolean): void {
    if (json) {
        console.log(JSON.stringify({ok: true, inspection, written}, null, 2));
        return;
    }
    console.log(`import finished: ${inspection.name}`);
    for (const item of written) {
        console.log(`- ${item}`);
    }
}

export function slugify(input: string): string {
    const normalized = input.trim()
        .replace(/[\\/:*?"<>|#%{}^~[\]`;]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return normalized.slice(0, 80) || "silly-tavern-card";
}

function toSafeRelativePath(input: string): string {
    const normalized = input.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment === "")) {
        throw new Error(`输出目录必须是 workspace 内的相对路径，且不能包含 ..：${input}`);
    }
    return normalized;
}

function inferNameFromPath(sourcePath: string): string {
    return path.basename(sourcePath, path.extname(sourcePath));
}

function readObject(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
    return isRecord(error) && error.code === code;
}

function escapeTable(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function isCliEntry(): boolean {
    const entry = process.argv[1];
    return Boolean(entry && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)));
}
