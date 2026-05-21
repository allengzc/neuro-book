import type {RuntimeAgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {RetrievalInputSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin/retrieval.contract";
import {LeaderInputSchema, WriterInputSchema} from "nbook/server/agent/types";

/**
 * builtin profile 的静态契约。
 * 这里只保存 key/kind/schema 这类稳定合同，不保存 prompt 实现。
 */
export function createBuiltinProfileContracts(): RuntimeAgentProfile[] {
    return [
        {
            key: "leader.default",
            kind: "leader",
            name: "Leader",
            inputSchema: LeaderInputSchema,
            allowedToolKeys: [],
        },
        {
            key: "leader.assets",
            kind: "leader",
            name: "用户资产助手",
            inputSchema: LeaderInputSchema,
            allowedToolKeys: [],
        },
        {
            key: "subagent.writer",
            kind: "subagent",
            name: "Writer",
            inputSchema: WriterInputSchema,
            allowedToolKeys: [],
        },
        {
            key: "subagent.retrieval",
            kind: "subagent",
            name: "Retrieval",
            inputSchema: RetrievalInputSchema,
            outputSchema: RetrievalOutputSchema,
            allowedToolKeys: [],
        },
    ];
}
