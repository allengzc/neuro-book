import {join, normalize, relative} from "node:path";

/**
 * Project Workspace 内 Plan Mode 计划目录的固定相对路径。
 */
export const PLAN_MODE_DIRECTORY = ".agent/plan";

/**
 * 返回当前 Project Workspace 的 Plan Mode 计划目录。
 */
export function planModeDirectory(workspaceRoot: string): string {
    return join(workspaceRoot, ".agent", "plan");
}

/**
 * 将计划文件路径解析为 Project Workspace 内的安全 Markdown 文件。
 */
export function resolvePlanModeFile(workspaceRoot: string, planFilePath: string): {
    displayPath: string;
    absolutePath: string;
} {
    const normalizedInput = planFilePath.trim().replace(/\\/g, "/");
    if (!normalizedInput) {
        throw new Error("exit_plan_mode planFilePath cannot be empty.");
    }
    if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
        throw new Error("exit_plan_mode planFilePath must be relative to the Project Workspace.");
    }
    if (normalizedInput.split("/").includes("..")) {
        throw new Error("exit_plan_mode planFilePath cannot contain '..'.");
    }
    if (!normalizedInput.toLowerCase().endsWith(".md")) {
        throw new Error("exit_plan_mode planFilePath must point to a Markdown .md file.");
    }

    const planRoot = normalize(planModeDirectory(workspaceRoot));
    const absolutePath = normalize(join(workspaceRoot, normalizedInput));
    const relativeToPlanRoot = relative(planRoot, absolutePath);
    if (relativeToPlanRoot.startsWith("..") || relativeToPlanRoot === "" || relativeToPlanRoot.startsWith("/") || /^[A-Za-z]:/.test(relativeToPlanRoot)) {
        throw new Error(`exit_plan_mode planFilePath must stay inside ${PLAN_MODE_DIRECTORY}/.`);
    }

    return {
        displayPath: normalizedInput,
        absolutePath,
    };
}
