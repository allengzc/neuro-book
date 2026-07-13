import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {applyVariableJsonPatch} from "nbook/server/agent/variables/json-patch";
import type {VariableJsonPatchOperation, VariableNamespace} from "nbook/server/agent/variables/types";
import {resolveAgentNbookRoot} from "nbook/server/agent/variables/workspace-paths";
import {resolveStateRoot} from "nbook/server/runtime/installation-paths";

type VariableFile = {
    schemaVersion: 1;
    variables: Record<string, JsonValue>;
};

const locks = new Map<string, Promise<void>>();

/**
 * Workspace Root / Project Workspace 变量文件存储。
 */
export class VariableFileStorage {
    constructor(private readonly workspaceRoot: string) {}

    /**
     * 读取 namespace 变量文件。缺失文件等价于空 variables。
     */
    async read(namespace: Extract<VariableNamespace, "global" | "project">, projectWorkspace?: string | null): Promise<Record<string, JsonValue>> {
        const path = this.filePath(namespace, projectWorkspace);
        const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (!text) {
            return {};
        }
        const parsed = JSON.parse(text) as Partial<VariableFile>;
        if (parsed.schemaVersion !== 1 || !parsed.variables || typeof parsed.variables !== "object" || Array.isArray(parsed.variables)) {
            throw new Error(`变量文件格式非法：${path}`);
        }
        return parsed.variables;
    }

    /**
     * 对变量文件执行原子 patch。
     */
    async patch(namespace: Extract<VariableNamespace, "global" | "project">, variablePath: string, operations: VariableJsonPatchOperation[], projectWorkspace?: string | null, guard?: {
        expectedFingerprint?: string;
        fingerprintValue?: (value: JsonValue | undefined) => string;
        expectedValue?: JsonValue;
    }): Promise<JsonValue | undefined> {
        const path = this.filePath(namespace, projectWorkspace);
        await withFileLock(path, async () => {
            const variables = await this.read(namespace, projectWorkspace);
            const current = readDotPath(variables, variablePath);
            const comparableCurrent = current === undefined ? guard?.expectedValue : current;
            if (guard?.expectedFingerprint && guard.fingerprintValue && guard.fingerprintValue(comparableCurrent) !== guard.expectedFingerprint) {
                throw new Error(`变量 ${namespace}.${variablePath} 在上次读取后已经变化，请重新调用 variable_read 后再 patch。`);
            }
            const next = applyVariableJsonPatch(current, operations);
            writeDotPath(variables, variablePath, next);
            await writeVariableFile(path, {
                schemaVersion: 1,
                variables,
            });
        });
        const variables = await this.read(namespace, projectWorkspace);
        return readDotPath(variables, variablePath);
    }

    private filePath(namespace: Extract<VariableNamespace, "global" | "project">, projectWorkspace?: string | null): string {
        if (namespace === "global") {
            return join(resolveAgentNbookRoot(this.workspaceRoot), "agent", "variables.json");
        }
        if (!projectWorkspace) {
            throw new Error("project.* 变量需要本轮 client.currentProjectWorkspace。");
        }
        return join(resolve(resolveStateRoot(), projectWorkspace), ".nbook", "agent", "variables.json");
    }
}

export function readDotPath(value: Record<string, JsonValue>, path: string): JsonValue | undefined {
    const segments = path.split(".").filter(Boolean);
    let current: JsonValue | Record<string, JsonValue> | undefined = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current as JsonValue;
}

export function writeDotPath(value: Record<string, JsonValue>, path: string, next: JsonValue): void {
    const segments = path.split(".").filter(Boolean);
    let current: Record<string, JsonValue> = value;
    for (const segment of segments.slice(0, -1)) {
        const child = current[segment];
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, JsonValue>;
    }
    const leaf = segments.at(-1);
    if (!leaf) {
        throw new Error("变量 path 不能为空。");
    }
    current[leaf] = next;
}

async function writeVariableFile(path: string, file: VariableFile): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const tempPath = `${path}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
}

async function withFileLock(path: string, action: () => Promise<void>): Promise<void> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolveLock) => {
        release = resolveLock;
    });
    locks.set(path, previous.then(() => current));
    try {
        await previous;
        await action();
    } finally {
        release();
        if (locks.get(path) === current) {
            locks.delete(path);
        }
    }
}
