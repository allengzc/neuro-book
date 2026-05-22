import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {assertFileEditKnowledge, createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {readWorkspaceTextFile, writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {resolveAgentFileTarget} from "nbook/server/agent/tools/file/workspace-file-target";

const EditFileInputSchema = z.object({
    filePath: z.string().trim().min(1, "filePath is required").describe("Project-relative path, absolute path within the project root, or workspace/... path to the target file. workspace/... maps to the active novel workspace."),
    oldString: z.string().min(1, "oldString is required").describe("Exact substring to find. Must uniquely match in the file unless replaceAll is true."),
    newString: z.string().describe("Replacement text. An empty string deletes the matched content."),
    replaceAll: z.boolean().optional().default(false).describe("If true, replaces every occurrence of oldString instead of just the first match."),
});

/**
 * 判断字符串是否明显来自 read_file 的带行号输出。
 * 这里只在“每一行都像 read_file 输出”时才去行号，避免误伤正文里合法的 `数字 + Tab` 内容。
 */
function isNumberedReadFileSnippet(value: string): boolean {
    const nonEmptyLines = value.split("\n").filter((line) => line.length > 0);
    if (nonEmptyLines.length === 0) {
        return false;
    }
    return nonEmptyLines.every((line) => /^\d+\t/.test(line));
}

/**
 * 将 read_file 输出的行号前缀剥离，恢复为原始文本片段。
 */
function stripReadFileLineNumbers(value: string): string {
    return value
        .split("\n")
        .map((line) => line.replace(/^\d+\t/, ""))
        .join("\n");
}

/**
 * 通过字符串替换编辑资源。
 */
export const editFileTool: AgentTool<typeof EditFileInputSchema> = {
    key: "edit_file",
    description: [
        "Edit a local text file within the project root via exact string replacement.",
        "Use this only after you understand the current file content well enough to provide an exact replacement.",
        "For multiple separate changes in the same file, prefer successive edit_file calls over merging them into one patch.",
        "If oldString/newString contain line-number prefixes from read_file output, they are automatically stripped.",
        "oldString must uniquely match in the file content (unless replaceAll is true).",
        "An empty newString deletes the matched content.",
    ].join("\n"),
    schema: EditFileInputSchema,
    async execute(input, context) {
        const {filePath, replaceAll} = input;
        await assertFileEditKnowledge(context, filePath);
        const target = await resolveAgentFileTarget(context, filePath);
        context.writeToolOutput(`Editing ${target.filePath}\n`);
        const content = await readWorkspaceTextFile(target.root, target.filePath);
        const shouldStripLineNumbers = isNumberedReadFileSnippet(input.oldString);
        const oldString = shouldStripLineNumbers ? stripReadFileLineNumbers(input.oldString) : input.oldString;
        const newString = shouldStripLineNumbers ? stripReadFileLineNumbers(input.newString) : input.newString;
        const matchCount = content.split(oldString).length - 1;

        if (matchCount === 0) {
            throw new Error("No matching string found");
        }
        if (matchCount > 1 && !replaceAll) {
            throw new Error(`Found ${String(matchCount)} matches; set replaceAll=true or provide a more specific oldString`);
        }

        const newContent = replaceAll
            ? content.split(oldString).join(newString)
            : content.replace(oldString, newString);

        await writeWorkspaceTextFile(target.root, target.filePath, newContent);
        const replacedCount = replaceAll ? matchCount : 1;
        context.writeToolOutput(`Replaced ${String(replacedCount)} match(es) in ${target.filePath}`);
        return createToolResultMessage(
            `Replaced ${String(replacedCount)} match(es)`,
        );
    },
};
