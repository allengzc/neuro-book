import {applyPatch} from "diff";
import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {assertFileEditKnowledge, createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {readWorkspaceTextFile, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {resolveAgentFileTarget} from "nbook/server/agent/tools/file/workspace-file-target";

const ApplyPatchInputSchema = z.object({
    filePath: z.string().trim().min(1, "filePath is required").describe("Project-relative path, absolute path within the project root, or workspace/... path to the target file. workspace/... maps to the active novel workspace."),
    patch: z.string().trim().min(1, "patch is required").describe("Standard unified diff patch text to apply."),
    fuzzFactor: z.number().int().min(0).optional().default(0).describe("Context matching tolerance in lines. Default 0 means strict matching."),
});

/**
 * 对资源应用 unified diff。
 */
export const applyPatchTool: AgentTool<typeof ApplyPatchInputSchema> = {
    key: "apply_patch",
    description: [
        "Apply a unified diff patch to a real local text file within the project root.",
        "The patch parameter must be in standard unified diff format.",
        "Use this only when the patch is based on the current file content and the changes are naturally cohesive in one patch.",
        "fuzzFactor controls context matching tolerance (default 0 for strict matching).",
    ].join("\n"),
    schema: ApplyPatchInputSchema,
    async execute(input, context) {
        const {filePath, patch, fuzzFactor} = input;
        await assertFileEditKnowledge(context, filePath);
        const target = await resolveAgentFileTarget(context, filePath);
        const content = await readWorkspaceTextFile(target.root, target.filePath);
        const patched = applyPatch(content, patch, {fuzzFactor});

        if (patched === false) {
            throw new Error("Patch application failed; verify the patch matches the current file content");
        }

        await writeWorkspaceTextFile(target.root, target.filePath, patched);
        return createToolResultMessage(
            "Patch applied",
        );
    },
};
