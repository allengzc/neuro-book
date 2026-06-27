import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";
import type {JsonValue as AgentJsonValue} from "nbook/server/agent/messages/types";
import type {JsonValue as WorldJsonValue} from "nbook/server/world-engine/types";
import {WORLD_FOCUS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {randomBytes} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});
const ProjectScopedSchema = Type.Object({
    projectPath: NonEmptyString("Required Project Path, e.g. workspace/silver-dragon-hime. The agent must pass it explicitly."),
});

const ExecuteWorldQuerySchema = Type.Object({
    ...ProjectScopedSchema.properties,
    code: Type.String({minLength: 1, description: "JavaScript code to execute in the sandbox"}),
}, {
    additionalProperties: false,
    description: `Execute JavaScript code to query World Engine state.

Available API in sandbox:

\`\`\`typescript
declare const world: {
    // 查询单个 subject 状态
    get(id: string, options?: { deref?: boolean; derefDepth?: number }): Promise<any>;

    // 批量查询多个 subject
    getMany(ids: string[]): Promise<any[]>;

    // 列出指定类型的所有 subject
    list(type: string): Promise<Array<{ id: string; name: string }>>;

    // 反向查找：哪些 subject 引用了目标
    findRefs(targetId: string, sourceType?: string): Promise<Array<{ subjectId: string; attr: string }>>;

    // 向量搜索（存活集去重 + 同 model 过滤 + 未向量化即时兜底 + time-travel at）
    searchText(query: string, options?: { k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint }): Promise<Array<{ subjectId: string; attr: string; text: string; score: number }>>;

    // 查询时间轴切面
    slices(options?: { from?: bigint; to?: bigint; limit?: number }): Promise<any[]>;

    // 获取当前时间
    now(): bigint;
};
\`\`\`

Constraints:
- Timeout: 5s
- Max result size: 10KB
- Blocked APIs: fetch, fs, process, require, eval, Function, Bun, globalThis
- READ-ONLY：查询世界用本工具；写入世界请用 write_world_slice。

Example queries:

\`\`\`javascript
// 查询单个 subject（不解引用）
const erina = await world.get("erina");
return { hp: erina.hp, level: erina.level };

// 查询并自动解引用
const erina = await world.get("erina", { deref: true, derefDepth: 1 });
// 引用字段会被展开，例如：
// { location: { __ref: "subject://town1", name: "新手村", ... } }

// 列出所有角色
const characters = await world.list("character");
return characters; // [{ id: "erina", name: "艾莉娜" }, ...]

// 反向查找：谁引用了某个 subject
const refs = await world.findRefs("phoenix-faction", "character");
// 返回：[{ subjectId: "erina", attr: "faction" }, ...]

// 批量查询
const members = await world.findRefs("phoenix-faction", "character");
const states = await world.getMany(members.map(ref => ref.subjectId));
return states.map((state, i) => ({
    id: members[i].subjectId,
    hp: state?.hp,
}));

// 时间轴查询
const recentSlices = await world.slices({ limit: 10 });
return recentSlices.map(s => ({ time: s.instant, title: s.title }));
\`\`\`

Note: Code must use \`await\` for all world.* method calls.
If code fails, it will be saved to .temp/ and the path will be returned for debugging.
`,
});

const WorldPatchSchema = Type.Object({
    subjectId: NonEmptyString("Target subject id"),
    path: NonEmptyString("JSON Pointer path, e.g. /hp or /equipment/head"),
    op: Type.Union([
        Type.Literal("replace"),
        Type.Literal("increment"),
        Type.Literal("remove"),
        Type.Literal("append"),
    ], {description: "Patch op"}),
    // value 可以是任意 JSON 值；remove 时省略。注释而非 any：工具入参是运行时 JSON。
    value: Type.Optional(Type.Unknown()),
    summary: Type.Optional(Type.String({description: "Human-readable patch summary"})),
    // 首写该 subject 时声明类型/名字：subject 不存在时据此自动注册（无需单独 create 步骤）；已存在则忽略。
    type: Type.Optional(Type.String({description: "Subject type, required only on the FIRST write of a new subject (e.g. character/location/item). Ignored if subject already exists."})),
    name: Type.Optional(Type.String({description: "Subject display name, optional, used only on first write of a new subject."})),
}, {additionalProperties: false});

const WriteWorldSliceSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    // 时间一律用项目日历字符串（如「星辉历312年 5月5日 14:00」），工具内部用 facade.parseTime 转 instant；禁止裸 raw instant 数字。
    time: NonEmptyString("Slice time as a project calendar string, e.g. 星辉历312年 5月5日 14:00. Raw instant numbers are not accepted."),
    title: Type.Optional(Type.String({description: "Slice title, e.g. 城北遭遇战"})),
    summary: Type.Optional(Type.String({description: "Slice summary"})),
    kind: Type.Optional(Type.String({description: "Slice kind (default: event)"})),
    patches: Type.Array(WorldPatchSchema, {minItems: 1, description: "Patches applied atomically in this slice"}),
}, {
    additionalProperties: false,
    description: `Write a new World Engine slice (an atomic, timestamped batch of patches).

Each patch targets one subject JSON Pointer path with an op:
- replace: 设置绝对值
- increment: 数值增减（仅数值）
- remove: 移除路径；collection 可提供 value 按 stable JSON 值删除指定元素，list 不支持按值删
- append: 向数组追加元素（集合语义数组自动去重）

首次写入某 subject 时无需单独 create 步骤：在该 subject 的某条 patch 上加 \`type\`（如 character/location），可选 \`name\`，工具会自动注册并应用 schema 默认值。subject 已存在时 type/name 被忽略。

Example:
\`\`\`json
{
  "projectPath": "workspace/silver-dragon-hime",
  "time": "星辉历312年 5月5日 14:00",
  "title": "城北遭遇战",
  "patches": [
    {"subjectId": "erina", "path": "/hp", "op": "increment", "value": -20, "summary": "受伤失去体力"},
    {"subjectId": "erina", "path": "/events", "op": "append", "value": "被伏击", "summary": "记录遭遇战"},
    {"subjectId": "erina", "path": "/inventory", "op": "remove", "value": "subject://old-sword", "summary": "交出旧剑"}
  ]
}
\`\`\`
Returns { sliceId, issues }. 同一时间点只能有一个 slice，目标时间已有切面时会冲突报错（改用相邻时间）。查询世界请用 execute_world_query（只读）。`,
});

/** 构造 World Engine Agent 工具。 */
export function createWorldEngineTools(): NeuroAgentTool[] {
    return [
        tool(
            "execute_world_query",
            "Execute JavaScript code to query World Engine state. Use this to query subjects, find references, list entities, or explore the world timeline.",
            ExecuteWorldQuerySchema,
            async (context, input) => {
                // 执行查询
                try {
                    const facade = await loadWorldEngineFacade();
                    const result = await facade.executeCodeActQuery(input.projectPath, input.code);
                    return worldResult(result);
                } catch (error) {
                    // 保存失败的代码到 temp 文件
                    const tempPath = await saveTempCode(context, input.code);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    throw new Error(`查询执行失败：${errorMessage}\n失败的代码已保存到：${tempPath}`);
                }
            },
        ),
        tool(
            "write_world_slice",
            "Write a new World Engine slice (atomic batch of patches at one instant). Use this to record state changes; querying is read-only via execute_world_query.",
            WriteWorldSliceSchema,
            async (_context, input) => {
                const facade = await loadWorldEngineFacade();
                // 日历字符串 → instant：工具层不接受 raw instant，统一通过项目 calendar 解析。
                const instant = await facade.parseTime(input.projectPath, input.time);
                const result = await facade.writeSlice(input.projectPath, {
                    instant,
                    title: input.title,
                    summary: input.summary,
                    kind: input.kind,
                    patches: input.patches.map((patch) => ({
                        subjectId: patch.subjectId,
                        path: patch.path,
                        op: patch.op,
                        ...(patch.value === undefined ? {} : {value: patch.value as WorldJsonValue}),
                        ...(patch.summary ? {summary: patch.summary} : {}),
                        ...(patch.type ? {type: patch.type} : {}),
                        ...(patch.name ? {name: patch.name} : {}),
                    })),
                });
                return worldResult(result);
            },
        ),
    ];
}

function tool<TSchemaValue extends TSchema>(
    key: string,
    description: string,
    parameters: TSchemaValue,
    execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<AgentToolResult<unknown>>,
): NeuroAgentTool {
    return {
        key,
        name: key,
        label: key,
        executionMode: "sequential",
        description,
        parameters,
        async execute() {
            throw new Error(`${key} 需要 v3 session context。`);
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            return execute(context, params as Static<TSchemaValue>);
        },
    };
}

function worldResult(details: unknown): AgentToolResult<unknown> {
    const normalized = normalizeToolDetails(details);
    return {
        content: [{type: "text" as const, text: JSON.stringify(normalized, null, 2)}],
        details: normalized,
    };
}

function normalizeToolDetails(value: unknown): AgentJsonValue {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value === undefined) {
        return null;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalizeToolDetails);
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, normalizeToolDetails(item)]));
    }
    return String(value);
}

async function loadWorldEngineFacade(): Promise<typeof import("nbook/server/world-engine").worldEngineFacade> {
    return (await import("nbook/server/world-engine")).worldEngineFacade;
}

/**
 * 保存失败的代码到 .temp 目录。
 */
async function saveTempCode(context: ToolExecutionContext, code: string): Promise<string> {
    const tempDir = join(context.workspaceRoot, ".temp");
    await mkdir(tempDir, {recursive: true});

    const hash = randomBytes(6).toString("hex");
    const filename = `world-query-${hash}.js`;
    const fullPath = join(tempDir, filename);

    await writeFile(fullPath, code, "utf-8");

    return `.temp/${filename}`;
}
