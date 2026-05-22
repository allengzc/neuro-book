import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {resolveAgentFileTarget} from "nbook/server/agent/tools/file/workspace-file-target";

const ReadFileInputSchema = z.object({
    filePath: z.string().trim().min(1, "filePath is required").describe("Project-relative path, absolute path within the project root, or workspace/... path to a text file. workspace/... maps to the active novel workspace."),
    offset: z.number().int().min(1, "offset must be at least 1").optional().describe("1-based starting line number. Defaults to the first line."),
    limit: z.number().int().min(1, "limit must be at least 1").optional().default(2000).describe("Maximum number of lines to read. Defaults to 2000."),
});

/**
 * 读取指定资源内容。
 */
export const readFileTool: AgentTool<typeof ReadFileInputSchema> = {
    key: "read_file",
    description: [
        "Read the content of a local text file within the project root.",
        "Returns content with line numbers (format: lineNumber\\tcontent).",
        "Use offset (1-based) to skip lines and limit to cap the number of lines returned.",
        "Inspect existing files before editing when the change depends on their current content.",
    ].join("\n"),
    schema: ReadFileInputSchema,
    async execute(input, context) {
        const {filePath, offset, limit} = input;
        const target = await resolveAgentFileTarget(context, filePath);
        const content = await readWorkspaceTextFile(target.root, target.filePath);
        const allLines = content.split("\n");
        const lines: string[] = [];
        const startLine = offset ?? 1;
        const endLine = Math.min(allLines.length, startLine + limit - 1);

        for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
            const lineIndex = lineNumber - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                lines.push(`${String(lineNumber)}\t${allLines[lineIndex]!}`);
            }
        }

        const result = lines.length > 0
            ? lines.join("\n")
            : `File is empty or offset(${String(startLine)}) is beyond total line count(${String(allLines.length)})`;

        return createToolResultMessage(result, JSON.stringify({filePath, offset, limit}));
    },
};
