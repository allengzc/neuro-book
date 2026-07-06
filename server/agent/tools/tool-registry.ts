import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";

/**
 * v3 工具注册表。toolKeys 是模型可见工具集合；执行硬权限由调用方传入的 executionToolKeys 决定。
 */
export class AgentToolRegistry {
    private readonly tools = new Map<string, NeuroAgentTool>();

    /**
     * 注册一个工具。后注册同 key 工具会覆盖旧工具。
     */
    register(tool: NeuroAgentTool): void {
        this.tools.set(tool.key, tool);
    }

    /**
     * 读取单个工具。
     */
    get(toolKey: string): NeuroAgentTool | undefined {
        return this.tools.get(toolKey);
    }

    /**
     * 返回 profile 允许的工具，过滤掉不存在的 key。
     */
    allowed(toolKeys: readonly string[]): AgentTool<any, any>[] {
        return toolKeys.flatMap((toolKey) => {
            const tool = this.tools.get(toolKey);
            return tool ? [tool] : [];
        });
    }

    /**
     * 返回 profile 允许的工具定义，允许调用方按当前 profile 覆盖某些工具 schema。
     */
    allowedWithOverrides(toolKeys: readonly string[], overrides: Record<string, AgentTool<any, any>>): AgentTool<any, any>[] {
        return toolKeys.flatMap((toolKey) => {
            const tool = overrides[toolKey] ?? this.tools.get(toolKey);
            return tool ? [tool] : [];
        });
    }

    /**
     * 判断工具是否是需要前端/用户恢复的审批工具。
     */
    approvalToolKeys(): string[] {
        return [...this.tools.values()]
            .filter((tool) => tool.approvalRequired)
            .map((tool) => tool.key)
            .sort((left, right) => left.localeCompare(right));
    }

    /**
     * 判断工具是否会暂停 run，并等待用户 resolution 恢复。
     */
    userResolutionToolKeys(): string[] {
        return [...this.tools.values()]
            .filter((tool) => tool.approvalRequired || Boolean(tool.userInputRequest))
            .map((tool) => tool.key)
            .sort((left, right) => left.localeCompare(right));
    }

    /**
     * 列出会修改 workspace 文件的工具 key。只读模式（Task 90）下这些工具会被注入写审批挂起。
     */
    workspaceMutatingToolKeys(): string[] {
        return [...this.tools.values()]
            .filter((tool) => Boolean(tool.mutatesWorkspace))
            .map((tool) => tool.key)
            .sort((left, right) => left.localeCompare(right));
    }

    /**
     * 列出已注册工具 key。
     */
    keys(): string[] {
        return [...this.tools.keys()].sort((left, right) => left.localeCompare(right));
    }
}
