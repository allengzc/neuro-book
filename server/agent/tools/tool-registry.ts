import type {DynamicStructuredTool} from "@langchain/core/tools";
import {z} from "zod";
import type {AgentTool, AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {toLangChainTool} from "nbook/server/agent/tools/agent-tool";
import type {ToolKey} from "nbook/server/agent/types";

/**
 * 绑定到某次 run 的工具。
 * langChainTool 只负责给模型提供 tool schema；真正执行走 definition。
 */
export type BoundAgentTool = {
    definition: AgentTool<z.ZodType>;
    langChainTool: DynamicStructuredTool;
    context: AgentToolContext;
    invoke: DynamicStructuredTool["invoke"];
};

/**
 * Agent tool 注册表接口。
 */
export interface AgentToolRegistry {
    /**
     * 注册 tool。
     */
    register(tool: AgentTool<z.ZodType>): void;

    /**
     * 列出当前已注册的全部 tool key。
     */
    listToolKeys(): ToolKey[];

    /**
     * 根据 key 解析 LangChain tools。
     */
    resolveTools(toolKeys: readonly ToolKey[], context: AgentToolContext): Promise<DynamicStructuredTool[]>;

    /**
     * 根据 key 解析项目自研 runner 使用的绑定工具。
     */
    resolveBoundTools(toolKeys: readonly ToolKey[], context: AgentToolContext): Promise<BoundAgentTool[]>;
}

/**
 * 内存版 tool 注册表。
 */
export class InMemoryAgentToolRegistry implements AgentToolRegistry {
    private readonly tools = new Map<ToolKey, AgentTool<z.ZodType>>();

    /**
     * 注册 tool。
     */
    register(tool: AgentTool<z.ZodType>): void {
        this.tools.set(tool.key, tool);
    }

    /**
     * 列出当前已注册的全部 tool key。
     */
    listToolKeys(): ToolKey[] {
        return [...this.tools.keys()];
    }

    /**
     * 解析 tools。
     */
    async resolveTools(toolKeys: readonly ToolKey[], context: AgentToolContext): Promise<DynamicStructuredTool[]> {
        return (await this.resolveBoundTools(toolKeys, context)).map((tool) => tool.langChainTool);
    }

    /**
     * 解析绑定 tools。
     */
    async resolveBoundTools(toolKeys: readonly ToolKey[], context: AgentToolContext): Promise<BoundAgentTool[]> {
        return Promise.all(toolKeys.map(async (toolKey) => {
            const definition = this.tools.get(toolKey);
            if (!definition) {
                throw new Error(`未注册的 toolKey: ${toolKey}`);
            }
            const schema = definition.resolveSchema
                ? await definition.resolveSchema(context)
                : definition.schema;
            const boundDefinition = {
                ...definition,
                schema,
            } satisfies AgentTool<z.ZodType>;
            const langChainTool = toLangChainTool(boundDefinition, context, schema);
            return {
                definition: boundDefinition,
                langChainTool,
                context,
                invoke: langChainTool.invoke.bind(langChainTool),
            };
        }));
    }
}
