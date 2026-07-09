import {isAbsolute, join, normalize, relative} from "node:path";

/**
 * Project Workspace 内 Plan Mode 计划目录的固定相对路径。
 */
export const PLAN_MODE_DIRECTORY = ".agent/plan";

export type PlanModeLocationInput = {
    workspaceRoot: string;
    /** 为空表示当前 session 没有绑定 Project Workspace，回退到 workspaceRoot。 */
    projectPath?: string;
};

/**
 * 返回当前 Project Workspace 的 Plan Mode 计划目录。
 */
export function planModeDirectory(input: PlanModeLocationInput): string {
    return join(planModeProjectRoot(input), ".agent", "plan");
}

/**
 * 返回 Agent 文件工具可使用的 Plan Mode 目录路径。
 */
export function planModeToolDirectory(input: PlanModeLocationInput): string {
    const projectPath = normalizeProjectPath(input.projectPath);
    if (!projectPath) {
        return PLAN_MODE_DIRECTORY;
    }
    if (isAbsolute(projectPath)) {
        return planModeDirectory(input).replace(/\\/g, "/");
    }
    const projectRelativePath = projectPath === "workspace"
        ? "."
        : projectPath.startsWith("workspace/")
            ? projectPath.slice("workspace/".length)
            : projectPath;
    return projectRelativePath === "."
        ? PLAN_MODE_DIRECTORY
        : `${projectRelativePath}/${PLAN_MODE_DIRECTORY}`;
}

/**
 * 将计划文件路径解析为 Project Workspace 内的安全 Markdown 文件。
 */
export function resolvePlanModeFile(input: PlanModeLocationInput & {planFilePath: string}): {
    displayPath: string;
    absolutePath: string;
} {
    const normalizedInput = input.planFilePath.trim().replace(/\\/g, "/");
    if (!normalizedInput) {
        throw new Error("switch_mode planFilePath cannot be empty.");
    }
    if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
        throw new Error("switch_mode planFilePath must be relative to the Project Workspace.");
    }
    if (normalizedInput.split("/").includes("..")) {
        throw new Error("switch_mode planFilePath cannot contain '..'.");
    }
    if (!normalizedInput.toLowerCase().endsWith(".md")) {
        throw new Error("switch_mode planFilePath must point to a Markdown .md file.");
    }

    const projectRoot = planModeProjectRoot(input);
    const planRoot = normalize(planModeDirectory(input));
    const absolutePath = normalize(join(projectRoot, normalizedInput));
    const relativeToPlanRoot = relative(planRoot, absolutePath);
    if (relativeToPlanRoot.startsWith("..") || relativeToPlanRoot === "" || relativeToPlanRoot.startsWith("/") || /^[A-Za-z]:/.test(relativeToPlanRoot)) {
        throw new Error(`switch_mode planFilePath must stay inside ${PLAN_MODE_DIRECTORY}/.`);
    }

    return {
        displayPath: normalizedInput,
        absolutePath,
    };
}

function planModeProjectRoot(input: PlanModeLocationInput): string {
    const projectPath = normalizeProjectPath(input.projectPath);
    if (!projectPath) {
        return input.workspaceRoot;
    }
    if (isAbsolute(projectPath)) {
        return projectPath;
    }
    if (projectPath === "workspace") {
        return input.workspaceRoot;
    }
    if (projectPath.startsWith("workspace/")) {
        return join(input.workspaceRoot, projectPath.slice("workspace/".length));
    }
    return join(input.workspaceRoot, projectPath);
}

function normalizeProjectPath(projectPath: string | undefined): string {
    return projectPath?.trim().replace(/\\/g, "/").replace(/\/+$/g, "") ?? "";
}
