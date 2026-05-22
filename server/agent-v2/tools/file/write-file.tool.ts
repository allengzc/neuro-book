import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {assertFileEditKnowledge, createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {readWorkspaceTextFile, workspacePathExists, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {resolveAgentFileTarget} from "nbook/server/agent/tools/file/workspace-file-target";

const WriteFileInputSchema = z.object({
    filePath: z.string().trim().min(1, "filePath is required").describe("Project-relative path, absolute path within the project root, or workspace/... path to the target file. workspace/... maps to the active novel workspace."),
    content: z.string().describe("Full text content to write to the file."),
    append: z.boolean().optional().default(false).describe("If true, appends content to the end of the file instead of overwriting."),
});

/**
 * 覆盖或追加写入资源。
 */
export const writeFileTool: AgentTool<typeof WriteFileInputSchema> = {
    key: "write_file",
    description: [
        "Write complete content to a real local text file within the project root.",
        "For existing files, write only after you understand the current file content well enough to replace or append safely.",
        "Overwrites the entire file by default; set append=true to append to the existing content instead.",
        "For minor file modifications, use edit_file or apply_patch tools first.",
    ].join("\n"),
    schema: WriteFileInputSchema,
    async execute(input, context) {
        const {filePath, content, append} = input;
        const target = await resolveAgentFileTarget(context, filePath);
        const fileExists = await workspacePathExists(target.root, target.filePath);
        if (fileExists) {
            await assertFileEditKnowledge(context, filePath);
        }
        let finalContent = content;

        if (append && fileExists) {
            finalContent = await readWorkspaceTextFile(target.root, target.filePath) + content;
        }

        await writeWorkspaceTextFile(target.root, target.filePath, finalContent);
        return createToolResultMessage(
            append ? "Content appended" : "File written",
        );
    },
};
