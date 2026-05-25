import {VariableRegistry} from "nbook/server/agent/variables/registry";
import type {ProfileVariableAccessor} from "nbook/server/agent/variables/types";

/**
 * 测试用 dry-run 变量访问器。生产代码不要使用。
 */
export function createTestVariableAccessor(values: Record<string, unknown> = {"client.currentProjectWorkspace": "workspace/novel-7"}): ProfileVariableAccessor {
    const registry = new VariableRegistry();
    return {
        dryRun: true,
        catalog: (query = {}) => ({
            ...registry.query(query),
            issues: [],
        }),
        async get(path) {
            return values[path] as never;
        },
        async read(path) {
            return {
                path,
                value: values[path] as never,
            };
        },
        async patch(namespace, path) {
            return {
                path: `${namespace}.${path}`,
                value: null,
            };
        },
    };
}
