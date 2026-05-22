import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";

export type AgentTreeDerivedState = {
    nodeById: Map<string, SessionTreeNode>;
    childrenByParentId: Map<string | null, SessionTreeNode[]>;
    activePathIds: Set<string>;
    flattenedNodes: SessionTreeNode[];
    terminalByBranchRootId: Map<string, SessionTreeNode>;
    switcherByMessageId: Record<string, AgentMessageSwitcherState>;
};

/**
 * 从 session tree DTO 派生前端切分支所需索引。
 */
export function deriveAgentTreeState(tree: SessionTreeNode[]): AgentTreeDerivedState {
    const nodeById = new Map<string, SessionTreeNode>();
    const childrenByParentId = new Map<string | null, SessionTreeNode[]>();
    const activePathIds = new Set<string>();

    for (const node of tree) {
        nodeById.set(node.id, node);
        if (node.active) {
            activePathIds.add(node.id);
        }
        const siblings = childrenByParentId.get(node.parentId) ?? [];
        siblings.push(node);
        childrenByParentId.set(node.parentId, siblings);
    }

    for (const siblings of childrenByParentId.values()) {
        siblings.sort((left, right) => left.timestamp - right.timestamp);
    }

    const terminalByBranchRootId = new Map<string, SessionTreeNode>();
    for (const node of tree) {
        terminalByBranchRootId.set(node.id, resolveLatestTerminal(node, childrenByParentId));
    }

    return {
        nodeById,
        childrenByParentId,
        activePathIds,
        flattenedNodes: flattenTreeNodes(childrenByParentId),
        terminalByBranchRootId,
        switcherByMessageId: deriveSwitcherByMessageId(tree, childrenByParentId),
    };
}

/**
 * 根据当前消息节点和方向，找到应该切换到的 terminal entry。
 */
export function resolveBranchSwitchTarget(
    state: AgentTreeDerivedState,
    messageId: string,
    direction: -1 | 1,
): SessionTreeNode | null {
    const switcher = state.switcherByMessageId[messageId];
    if (!switcher || switcher.total <= 1) {
        return null;
    }
    const nextMessageNodeId = switcher.nodeIds[(switcher.currentIndex + direction + switcher.total) % switcher.total];
    if (!nextMessageNodeId) {
        return null;
    }
    return state.terminalByBranchRootId.get(nextMessageNodeId) ?? state.nodeById.get(nextMessageNodeId) ?? null;
}

/**
 * 判断 tree 面板默认过滤下是否显示节点。
 */
export function isDefaultVisibleTreeNode(node: SessionTreeNode): boolean {
    if (node.type === "message" || node.type === "custom_message") {
        return Boolean(node.preview || node.toolName || node.role);
    }
    return node.type === "compaction" || node.type === "branch_summary";
}

function deriveSwitcherByMessageId(
    tree: SessionTreeNode[],
    childrenByParentId: Map<string | null, SessionTreeNode[]>,
): Record<string, AgentMessageSwitcherState> {
    const result: Record<string, AgentMessageSwitcherState> = {};
    for (const node of tree) {
        if (!node.active || node.type !== "message" || !node.role || !node.messageId) {
            continue;
        }
        const siblings = (childrenByParentId.get(node.parentId) ?? []).filter((item) => {
            return item.type === "message" && item.role === node.role && item.messageId;
        });
        if (siblings.length <= 1) {
            continue;
        }
        const currentIndex = siblings.findIndex((item) => item.id === node.id);
        if (currentIndex < 0) {
            continue;
        }
        result[node.messageId] = {
            nodeIds: siblings.map((item) => item.id),
            currentIndex,
            total: siblings.length,
        };
    }
    return result;
}

function flattenTreeNodes(childrenByParentId: Map<string | null, SessionTreeNode[]>): SessionTreeNode[] {
    const result: SessionTreeNode[] = [];
    const visit = (parentId: string | null): void => {
        const children = childrenByParentId.get(parentId) ?? [];
        const activeChildren = children.filter((node) => node.active);
        const inactiveChildren = children.filter((node) => !node.active);
        for (const child of [...activeChildren, ...inactiveChildren]) {
            result.push(child);
            visit(child.id);
        }
    };

    visit(null);
    return result;
}

function resolveLatestTerminal(
    root: SessionTreeNode,
    childrenByParentId: Map<string | null, SessionTreeNode[]>,
): SessionTreeNode {
    let latest = root;
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        const children = childrenByParentId.get(current.id) ?? [];
        if (children.length === 0 && current.timestamp >= latest.timestamp) {
            latest = current;
        }
        for (const child of children) {
            stack.push(child);
        }
    }
    return latest;
}
