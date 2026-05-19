import {describe, expect, it, vi} from "vitest";
import {z} from "zod";

// Mock prisma before any tool import triggers PrismaClient initialization
vi.mock("nbook/server/utils/prisma", () => ({
    prisma: {} as unknown,
}));

import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createSubagentTool} from "nbook/server/agent/tools/builtin/create-subagent.tool";
import {invokeSubagentTool} from "nbook/server/agent/tools/builtin/invoke-subagent.tool";
import {listSubagentsTool} from "nbook/server/agent/tools/builtin/list-subagents.tool";
import {enterPlanModeTool, exitPlanModeTool} from "nbook/server/agent/tools/builtin/plan-mode.tool";
import {reportResultTool} from "nbook/server/agent/tools/builtin/report-result.tool";
import {requestUserInputTool} from "nbook/server/agent/tools/builtin/request-user-input.tool";
import {skillTool} from "nbook/server/agent/tools/builtin/skill.tool";
import {taskCreateTool, taskSetStatusTool} from "nbook/server/agent/tools/builtin/task.tool";
import {readFileTool} from "nbook/server/agent/tools/file/read-file.tool";
import {writeFileTool} from "nbook/server/agent/tools/file/write-file.tool";
import {editFileTool} from "nbook/server/agent/tools/file/edit-file.tool";
import {applyPatchTool} from "nbook/server/agent/tools/file/apply-patch.tool";
import {executeShellTool} from "nbook/server/agent/tools/shell/execute-shell.tool";
import {executeSqlTool} from "nbook/server/agent/tools/sql/execute-sql.tool";
import {updateNovelTool} from "nbook/server/agent/tools/novel/update-novel.tool";
import {getPlotTreeTool} from "nbook/server/agent/tools/plot/get-plot-tree.tool";
import {getStorySceneContextTool} from "nbook/server/agent/tools/plot/get-story-scene-context.tool";
import {getChapterPlotTool} from "nbook/server/agent/tools/plot/get-chapter-plot.tool";
import {getStoryThreadTool} from "nbook/server/agent/tools/plot/get-story-thread.tool";
import {createStoryThreadTool} from "nbook/server/agent/tools/plot/create-story-thread.tool";
import {createStorySceneTool} from "nbook/server/agent/tools/plot/create-story-scene.tool";
import {createStoryPlotTool} from "nbook/server/agent/tools/plot/create-story-plot.tool";
import {updateStoryThreadTool} from "nbook/server/agent/tools/plot/update-story-thread.tool";
import {updateStorySceneTool} from "nbook/server/agent/tools/plot/update-story-scene.tool";
import {updateStoryPlotTool} from "nbook/server/agent/tools/plot/update-story-plot.tool";

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/**
 * All tools registered by AgentSystem.createDefault().
 */
const defaultTools: AgentTool<z.ZodType>[] = [
    createSubagentTool,
    listSubagentsTool,
    invokeSubagentTool,
    enterPlanModeTool,
    exitPlanModeTool,
    requestUserInputTool,
    reportResultTool,
    skillTool,
    taskCreateTool,
    taskSetStatusTool,
    executeSqlTool,
    executeShellTool,
    readFileTool,
    editFileTool,
    applyPatchTool,
    writeFileTool,
    updateNovelTool,
    getPlotTreeTool,
    getStoryThreadTool,
    getStorySceneContextTool,
    getChapterPlotTool,
    createStoryThreadTool,
    updateStoryThreadTool,
    createStorySceneTool,
    updateStorySceneTool,
    createStoryPlotTool,
    updateStoryPlotTool,
];

/**
 * Walk a Zod schema to collect all shape fields (handles z.object, z.extend, z.omit).
 */
function getZodShapeFields(schema: z.ZodType): Array<{key: string; def: z.ZodType}> {
    // Unwrap optional/nullable/default/lazy
    let current = schema;

    // Walk through wrappers
    while (true) {
        if ("_def" in current && typeof (current as unknown as Record<string, unknown>)._def === "object") {
            const def = (current as unknown as Record<string, unknown>)._def as unknown as Record<string, unknown>;
            if (def.type === "optional" || def.type === "nullable" || def.type === "default") {
                current = def.innerType as z.ZodType;
                continue;
            }
        }
        if ("_def" in current && typeof (current as unknown as Record<string, unknown>)._def === "object") {
            const def = (current as unknown as Record<string, unknown>)._def as unknown as Record<string, unknown>;
            // Handle ZodEffects (refine, superRefine, transform, etc.)
            if (def.type === "refinement" || def.type === "superRefinement" || def.type === "transform" || def.type === "preprocess") {
                current = def.schema as z.ZodType;
                continue;
            }
        }
        break;
    }

    if (current instanceof z.ZodObject) {
        // Zod v4: .shape is a property, Zod v3: .shape() is a method
        const zodObj = current as z.ZodObject<Record<string, z.ZodType>>;
        const shape: Record<string, z.ZodType> = typeof zodObj.shape === "function"
            ? (zodObj.shape as () => Record<string, z.ZodType>)()
            : (zodObj as z.ZodObject<Record<string, z.ZodType>> & {shape: Record<string, z.ZodType>}).shape;
        return Object.entries(shape).map(([key, def]) => ({key, def}));
    }

    return [];
}

describe("tool schema compliance", () => {
    it("every default tool is registered", () => {
        expect(defaultTools.length).toBe(27);
    });

    it("skill tool only exposes the skill field", () => {
        expect(skillTool.key).toBe("skill");
        expect(getZodShapeFields(skillTool.schema).map((field) => field.key)).toEqual(["skill"]);
        expect(skillTool.description).toContain("call this tool directly instead of pausing the conversation");
        expect(skillTool.description).toContain("continue the run after the user approves");
    });

    it("plan mode tools expose the expected fields", () => {
        expect(enterPlanModeTool.key).toBe("enter_plan_mode");
        expect(getZodShapeFields(enterPlanModeTool.schema)).toEqual([]);
        expect(exitPlanModeTool.key).toBe("exit_plan_mode");
        expect(getZodShapeFields(exitPlanModeTool.schema).map((field) => field.key)).toEqual(["planFilePath"]);
    });

    it("plan mode and shell tools describe scoped discovery", () => {
        expect(enterPlanModeTool.description).toContain("current-thread directory");
        expect(enterPlanModeTool.description).toContain("new feature implementation");
        expect(enterPlanModeTool.description).toContain("multiple valid approaches");
        expect(enterPlanModeTool.description).toContain("single-line or few-line fixes");
        expect(enterPlanModeTool.description).toContain("ordinary research");
        expect(exitPlanModeTool.description).toContain("current-thread directory");
        expect(exitPlanModeTool.description).toContain("planFilePath");
        expect(exitPlanModeTool.description).toContain("briefly report what you planned in chat");
        expect(exitPlanModeTool.description).toContain("Use this mainly when no plan file was prepared");
        expect(exitPlanModeTool.description).toContain("walkthrough.md");
        expect(exitPlanModeTool.description).toContain("Do not inspect, enumerate, read, or cite files from other sessions or threads.");
        expect(executeShellTool.description).toContain("Avoid broad recursive workspace listing");
        expect(executeShellTool.description).toContain("Prefer targeted file discovery");
    });

    it("request_user_input describes built-in free-form answers", () => {
        expect(requestUserInputTool.description).toContain("already allows a free-form or other answer");
        expect(requestUserInputTool.description).toContain("do not add generic fallback choices");
        expect(requestUserInputTool.description).toContain("provide only meaningful choices");
    });

    it("invoke_subagent accepts numeric subagentThreadId", () => {
        expect(() => invokeSubagentTool.schema.parse({
            subagentThreadId: 203,
            input: {
                prompt: "写一章正文",
                plotPoints: ["30"],
                lorebookEntries: [{
                    path: "lorebook/character/test/",
                }],
            },
        })).not.toThrow();
    });

    it("invoke_subagent accepts JSON string input payload", () => {
        expect(() => invokeSubagentTool.schema.parse({
            subagentThreadId: "203",
            input: JSON.stringify({
                prompt: "写一章正文",
                plotPoints: ["30"],
                lorebookEntries: [{
                    path: "lorebook/character/test/",
                }],
            }),
        })).not.toThrow();
    });

    it("every tool has a non-empty description", () => {
        for (const tool of defaultTools) {
            expect(tool.description, `Tool "${tool.key}" has empty description`).toBeTruthy();
            expect(tool.description.length, `Tool "${tool.key}" description is too short`).toBeGreaterThan(0);
        }
    });

    it("every tool description is in English (no CJK characters)", () => {
        for (const tool of defaultTools) {
            const hasCjk = CJK_RE.test(tool.description);
            expect(hasCjk, `Tool "${tool.key}" has CJK characters in description`).toBe(false);
        }
    });

    it("every tool has a key", () => {
        for (const tool of defaultTools) {
            expect(tool.key, "Tool has empty key").toBeTruthy();
            expect(tool.key.length).toBeGreaterThan(0);
        }
    });

    it("every non-empty input schema field has a description", () => {
        const failures: string[] = [];

        for (const tool of defaultTools) {
            const fields = getZodShapeFields(tool.schema);

            if (fields.length === 0) {
                // Empty-object tools must state they take no arguments in their description
                const mentionsNoArgs = /no\s+arg/i.test(tool.description)
                    || /takes?\s+no\s+arg/i.test(tool.description)
                    || /without\s+arg/i.test(tool.description)
                    || /does\s+not\s+(require|take|need|accept)\s+(any\s+)?arg/i.test(tool.description);
                if (!mentionsNoArgs) {
                    failures.push(
                        `Tool "${tool.key}" has an empty input schema but does not mention "no arguments" in its description`,
                    );
                }
                continue;
            }

            for (const {key, def} of fields) {
                if (!hasDescription(def)) {
                    failures.push(
                        `Tool "${tool.key}" field "${key}" has no .describe()`,
                    );
                    continue;
                }
                const desc = getDescription(def);
                if (desc && CJK_RE.test(desc)) {
                    failures.push(
                        `Tool "${tool.key}" field "${key}" has CJK characters in .describe(): "${desc.slice(0, 40)}..."`,
                    );
                }
            }
        }

        expect(failures, failures.join("\n")).toEqual([]);
    });
});

/**
 * Check if a Zod schema has a description string set.
 * Checks the outermost schema first (description may be on a wrapper like .optional()),
 * then unwraps to check the inner type.
 */
function hasDescription(schema: z.ZodType): boolean {
    let current = schema;

    // Check outermost first (description might be on .optional().describe(...))
    if (checkDescriptionOnType(current)) {
        return true;
    }

    while (true) {
        if ("_def" in current && typeof (current as unknown as Record<string, unknown>)._def === "object") {
            const def = (current as unknown as Record<string, unknown>)._def as unknown as Record<string, unknown>;
            if (def.type === "optional" || def.type === "nullable" || def.type === "default") {
                current = def.innerType as z.ZodType;
                if (checkDescriptionOnType(current)) {
                    return true;
                }
                continue;
            }
        }
        break;
    }

    // Handle ZodEffects (refine, superRefine, transform) — check inner schema
    if ("_def" in current && typeof (current as unknown as Record<string, unknown>)._def === "object") {
        const def = (current as unknown as Record<string, unknown>)._def as unknown as Record<string, unknown>;
        if (def.type === "refinement" || def.type === "superRefinement" || def.type === "transform" || def.type === "preprocess") {
            return hasDescription(def.schema as z.ZodType);
        }
    }

    if (current instanceof z.ZodObject) {
        const fields = getZodShapeFields(current);
        return fields.every(({def}) => hasDescription(def));
    }

    // Check again after unwrapping
    return checkDescriptionOnType(current);
}

function checkDescriptionOnType(schema: z.ZodType): boolean {
    if ("description" in schema) {
        const desc = (schema as z.ZodType & {description: unknown}).description;
        return typeof desc === "string" && desc.length > 0;
    }
    return false;
}

/**
 * Get the description string from a Zod schema, if any.
 */
function getDescription(schema: z.ZodType): string | undefined {
    let current = schema;

    while (true) {
        if ("_def" in current && typeof (current as unknown as Record<string, unknown>)._def === "object") {
            const def = (current as unknown as Record<string, unknown>)._def as unknown as Record<string, unknown>;
            if (def.type === "optional" || def.type === "nullable" || def.type === "default") {
                current = def.innerType as z.ZodType;
                continue;
            }
        }
        break;
    }

    if ("description" in current) {
        const desc = (current as z.ZodType & {description: unknown}).description;
        return typeof desc === "string" ? desc : undefined;
    }
    return undefined;
}
