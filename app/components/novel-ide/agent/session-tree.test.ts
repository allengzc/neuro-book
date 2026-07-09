import {describe, expect, it} from "vitest";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import {deriveAgentSessionTreeRows, deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";

const node = (patch: Partial<SessionTreeNode> & Pick<SessionTreeNode, "id" | "parentId">): SessionTreeNode => ({
    type: "message",
    timestamp: 1,
    active: false,
    terminal: true,
    childCount: 0,
    role: "assistant",
    messageId: patch.id,
    ...patch,
});

describe("agent session tree", () => {
    it("为 active path 上每个有 sibling 的消息派生切换状态", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true, childCount: 2}),
            node({id: "u2", parentId: "a2", role: "user", timestamp: 4, active: true}),
            node({id: "u3", parentId: "a2", role: "user", timestamp: 5, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.switcherByMessageId.a2).toEqual({
            nodeIds: ["a1", "a2"],
            currentIndex: 1,
            total: 2,
        });
        expect(state.switcherByMessageId.u2).toEqual({
            nodeIds: ["u2", "u3"],
            currentIndex: 0,
            total: 2,
        });
    });

    it("切换 sibling 时定位到该分支最新 terminal descendant", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false, terminal: false, childCount: 1}),
            node({id: "a1-u1", parentId: "a1", role: "user", timestamp: 10, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true}),
        ];

        const state = deriveAgentTreeState(tree);
        const target = resolveBranchSwitchTarget(state, "a2", 1);

        expect(target?.id).toBe("a1-u1");
    });

    it("消息切分支使用 continuation lane roots 而不是同 role message sibling", () => {
        const tree = [
            node({id: "A", parentId: null, role: "assistant", timestamp: 1, active: true, childCount: 1}),
            node({id: "B", parentId: "A", role: "toolResult", toolName: "report_result", timestamp: 2, active: true, childCount: 2}),
            node({id: "C1", parentId: "B", role: "user", timestamp: 3, active: true}),
            node({id: "C2", parentId: "B", role: "assistant", timestamp: 4, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.switcherByMessageId.C1).toEqual({
            nodeIds: ["C1", "C2"],
            currentIndex: 0,
            total: 2,
        });
        expect(state.switcherByMessageId.C2).toBeUndefined();
        expect(resolveBranchSwitchTarget(state, "C1", 1)?.id).toBe("C2");
    });

    it("按树结构 preorder 展开，而不是按 JSONL append 顺序展示", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: true}),
            node({id: "u2", parentId: "a1", role: "user", timestamp: 3, active: true}),
            node({id: "a2", parentId: "u1", timestamp: 4, active: false}),
            node({id: "a2-u1", parentId: "a2", role: "user", timestamp: 10, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.flattenedNodes.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2", "a2-u1"]);
    });

    it("projection 在线性链上保持同一 lane", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 1}),
            node({id: "C", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D", parentId: "C", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C", 0],
            ["D", 0],
        ]);
    });

    it("projection 只有进入真实分支时才增加 laneDepth", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C1", 1],
            ["D1", 1],
            ["C2", 1],
            ["D2", 1],
        ]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            isBranchPoint: true,
            branchSiblingCount: 0,
            branchIndex: null,
        });
        expect(rows.find((row) => row.node.id === "C1")).toMatchObject({
            isBranchPoint: false,
            branchSiblingCount: 2,
            branchIndex: 0,
        });
        expect(rows.find((row) => row.node.id === "D1")).toMatchObject({
            branchSiblingCount: 0,
            branchIndex: null,
        });
        expect(rows.map((row) => [row.node.id, row.guideParts])).toEqual([
            ["A", ["root"]],
            ["B", ["root"]],
            ["C1", ["branch"]],
            ["D1", ["line"]],
            ["C2", ["end"]],
            ["D2", ["space"]],
        ]);
    });

    it("projection 默认保持分支全展开", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => row.node.id)).toEqual(["A", "B", "C1", "D1", "C2"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsible: true,
            collapsed: false,
            hiddenDescendantCount: 0,
        });
    });

    it("projection 收起 branch point 时保留自身并隐藏整段子树", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "all",
            collapsedBranchIds: new Set(["B"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["A", "B"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsible: true,
            collapsed: true,
            hiddenDescendantCount: 4,
        });
    });

    it("projection 只在嵌套分支处继续增加 laneDepth", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 2}),
            node({id: "E1", parentId: "D1", timestamp: 5}),
            node({id: "E2", parentId: "D1", timestamp: 6}),
            node({id: "C2", parentId: "B", timestamp: 7, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 8}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C1", 1],
            ["D1", 1],
            ["E1", 2],
            ["E2", 2],
            ["C2", 1],
            ["D2", 1],
        ]);
        expect(rows.find((row) => row.node.id === "E1")?.guideParts).toEqual(["line", "branch"]);
        expect(rows.find((row) => row.node.id === "E2")?.guideParts).toEqual(["line", "end"]);
    });

    it("projection 收起嵌套分支时外层 sibling lane 仍显示", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 2}),
            node({id: "E1", parentId: "D1", timestamp: 5}),
            node({id: "E2", parentId: "D1", timestamp: 6}),
            node({id: "C2", parentId: "B", timestamp: 7, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 8}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "all",
            collapsedBranchIds: new Set(["D1"]),
        });

        expect(rows.map((row) => [row.node.id, row.guideParts])).toEqual([
            ["A", ["root"]],
            ["B", ["root"]],
            ["C1", ["branch"]],
            ["D1", ["line"]],
            ["C2", ["end"]],
            ["D2", ["space"]],
        ]);
        expect(rows.find((row) => row.node.id === "D1")).toMatchObject({
            collapsed: true,
            hiddenDescendantCount: 2,
        });
    });

    it("projection 在过滤工具时保留 branch point 和直接 continuation", () => {
        const tree = [
            node({id: "A", parentId: null, role: "user", timestamp: 1, childCount: 1}),
            node({id: "T", parentId: "A", role: "toolResult", toolName: "read", timestamp: 2, childCount: 2}),
            node({id: "U1", parentId: "T", role: "user", timestamp: 3}),
            node({id: "R1", parentId: "T", role: "toolResult", toolName: "read", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "no-tools"});

        expect(rows.map((row) => row.node.id)).toEqual(["A", "T", "U1", "R1"]);
        expect(rows.find((row) => row.node.id === "T")?.isBranchPoint).toBe(true);
        expect(rows.find((row) => row.node.id === "R1")?.laneDepth).toBe(1);
    });

    it("projection 在过滤工具时按过滤后的可见行统计隐藏数量", () => {
        const tree = [
            node({id: "A", parentId: null, role: "user", timestamp: 1, childCount: 1}),
            node({id: "T", parentId: "A", role: "toolResult", toolName: "read", timestamp: 2, childCount: 2}),
            node({id: "U1", parentId: "T", role: "user", timestamp: 3}),
            node({id: "R1", parentId: "T", role: "toolResult", toolName: "read", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "no-tools",
            collapsedBranchIds: new Set(["T"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["A", "T"]);
        expect(rows.find((row) => row.node.id === "T")).toMatchObject({
            collapsed: true,
            hiddenDescendantCount: 2,
        });
    });

    it("projection 搜索深层命中时只保留命中路径的 branch anchor", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 1}),
            node({id: "E1", parentId: "D1", timestamp: 5, preview: "needle"}),
            node({id: "C2", parentId: "B", timestamp: 6, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 7}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "default", query: "needle"});

        expect(rows.map((row) => row.node.id)).toEqual(["B", "C1", "E1"]);
        expect(rows.find((row) => row.node.id === "B")?.isBranchPoint).toBe(true);
        expect(rows.find((row) => row.node.id === "C1")?.laneDepth).toBe(1);
        expect(rows.find((row) => row.node.id === "E1")?.laneDepth).toBe(1);
    });

    it("projection 搜索时临时忽略折叠状态", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 1}),
            node({id: "E1", parentId: "D1", timestamp: 5, preview: "needle"}),
            node({id: "C2", parentId: "B", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "default",
            query: "needle",
            collapsedBranchIds: new Set(["B"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["B", "C1", "E1"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsed: false,
            hiddenDescendantCount: 0,
        });
    });

    it("projection 显示 sidecar enter 与 lifecycle end sibling 形成的 branch group", () => {
        const tree = [
            node({id: "tool-result", parentId: null, role: "toolResult", toolName: "report_result", timestamp: 1, childCount: 2}),
            node({id: "sidecar-enter", parentId: "tool-result", role: "user", timestamp: 2, preview: "sidecar: actor.memory-save"}),
            node({
                id: "run-end",
                parentId: "tool-result",
                type: "invocation_lifecycle",
                role: undefined,
                messageId: undefined,
                timestamp: 3,
                preview: "run end",
            }),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "default"});

        expect(rows.map((row) => row.node.id)).toEqual(["tool-result", "sidecar-enter", "run-end"]);
        expect(rows.find((row) => row.node.id === "sidecar-enter")).toMatchObject({
            laneDepth: 1,
            branchSiblingCount: 2,
            branchIndex: 0,
        });
        expect(rows.find((row) => row.node.id === "run-end")).toMatchObject({
            laneDepth: 1,
            branchSiblingCount: 2,
            branchIndex: 1,
        });
    });
});
