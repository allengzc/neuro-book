import type {
    ProfileTemplateExpressionValue,
    ProfileTemplateNodeDto,
    ProfileTemplateNodeType,
    ProfileTemplatePropValue,
} from "nbook/shared/dto/profile-template.dto";

/**
 * 新建默认节点。
 */
export function createNode(type: ProfileTemplateNodeType): ProfileTemplateNodeDto {
    const base: ProfileTemplateNodeDto = {
        id: createNodeId(type),
        type,
        props: {},
        children: [],
        editable: true,
    };
    if (type === "Message") {
        base.props = {role: "system"};
        base.children = [createNode("Text")];
    }
    if (type === "Text") {
        base.text = "文本片段";
        base.textKind = "text";
    }
    if (type === "AIMessage") {
        base.text = "Assistant 回复内容";
        base.textKind = "text";
    }
    if (type === "ToolCall") {
        base.props = {id: `call_${Date.now()}`, name: "read_file", status: "drafting"};
        base.text = "{\n    \"path\": \"workspace/\"\n}";
        base.textKind = "text";
    }
    if (type === "Reminder") {
        base.props = {id: `reminder_${Date.now()}`, repeatEveryTurns: 5};
    }
    if (type === "Watch") {
        base.props = {path: "scope.studio.workspace", previewText: "workspace 发生变化"};
    }
    if (type === "If") {
        base.props = {condition: "true"};
    }
    if (type === "ActivatedSkills") {
        base.props = {text: "${activatedSkillsText}"};
    }
    if (type === "SkillCatalog") {
        base.props = {text: "${skillCatalogText}"};
    }
    return base;
}

/**
 * 创建节点 id。
 */
export function createNodeId(type: ProfileTemplateNodeType): string {
    return `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 使用指定 id 创建节点，保证组件库拖入时预览节点 key 稳定。
 */
export function createNodeWithId(type: ProfileTemplateNodeType, id: string): ProfileTemplateNodeDto {
    const node = createNode(type);
    node.id = id;
    return node;
}

/**
 * 节点是否可包含子节点。
 */
export function canHaveChildren(type: ProfileTemplateNodeType): boolean {
    return !["Text", "ToolCall", "SkillCatalog", "ActivatedSkills"].includes(type);
}

/**
 * 判断节点是否能放进目标父节点。
 */
export function canInsertNodeIntoParent(parent: ProfileTemplateNodeDto, node: ProfileTemplateNodeDto, ancestors: ProfileTemplateNodeDto[] = []): boolean {
    if (!canHaveChildren(parent.type)) {
        return false;
    }
    if (node.type === "ProfilePrompt") {
        return false;
    }
    if (parent.type === "Message") {
        return isInlineStringNodeType(node.type) || node.type === "If";
    }
    if (node.type === "ToolCall") {
        return parent.type === "AIMessage";
    }
    if (parent.type === "AIMessage") {
        return node.type === "Text" || node.type === "If" || node.type === ("ToolCall" as ProfileTemplateNodeType);
    }
    if (parent.type === "ToolCall") {
        return node.type === "Text";
    }
    if (isInlineStringNodeType(node.type)) {
        return false;
    }
    if (parent.type === "ProfilePrompt") {
        return ["HistorySet", "DynamicSet", "AppendingSet", "Message", "AIMessage", "If"].includes(node.type);
    }
    if (parent.type === "HistorySet" || parent.type === "DynamicSet") {
        return ["Message", "AIMessage", "If"].includes(node.type);
    }
    if (parent.type === "AppendingSet") {
        return ["Message", "AIMessage", "Reminder", "Watch", "If"].includes(node.type);
    }
    if (parent.type === "Reminder" || parent.type === "Watch") {
        return ["Message", "AIMessage", "If"].includes(node.type);
    }
    if (parent.type === "If") {
        const inheritedParent = [...ancestors, parent].reverse().find((item) => item.type !== "If");
        return inheritedParent ? canInsertNodeIntoParent(inheritedParent, node, []) : false;
    }
    return false;
}

/**
 * 判断节点是否能放进目标父节点，并按当前树推断 If 继承的容器语义。
 */
export function canInsertNodeIntoParentInTree(root: ProfileTemplateNodeDto, parent: ProfileTemplateNodeDto, node: ProfileTemplateNodeDto): boolean {
    return canInsertNodeIntoParent(parent, node, findAncestorsOfNode(root, parent.id));
}

/**
 * 返回该节点是否在运行时直接产出字符串，只能作为 Message 的内联子节点。
 */
export function isInlineStringNodeType(type: ProfileTemplateNodeType): boolean {
    return type === "Text" || type === "SkillCatalog" || type === "ActivatedSkills";
}

/**
 * 深拷贝节点。
 */
export function cloneNode(node: ProfileTemplateNodeDto): ProfileTemplateNodeDto {
    return {
        ...node,
        props: Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, clonePropValue(value)])),
        children: node.children.map(cloneNode),
    };
}

/**
 * 用当前画布树的 id 对齐重新解析出的节点树，避免解析/保存后 dnd identity 抖动。
 */
export function reconcileNodeIds(previous: ProfileTemplateNodeDto | null, next: ProfileTemplateNodeDto): ProfileTemplateNodeDto {
    const cloned = cloneNode(next);
    if (!previous || previous.type !== cloned.type) {
        return cloned;
    }
    cloned.id = previous.id;
    const usedPreviousIndexes = new Set<number>();
    cloned.children = cloned.children.map((child) => {
        const previousIndex = previous.children.findIndex((previousChild, index) => {
            return !usedPreviousIndexes.has(index) && previousChild.type === child.type;
        });
        if (previousIndex < 0) {
            return child;
        }
        usedPreviousIndexes.add(previousIndex);
        const previousChild = previous.children[previousIndex];
        return previousChild ? reconcileNodeIds(previousChild, child) : child;
    });
    return cloned;
}

/**
 * 查找默认选中节点，优先让属性面板落在可编辑消息上。
 */
export function findFirstEditableNodeId(node: ProfileTemplateNodeDto): string {
    if (node.type === "Message") {
        return node.id;
    }
    for (const child of node.children) {
        const found = findFirstEditableNodeId(child);
        if (found) {
            return found;
        }
    }
    return node.id;
}

/**
 * 复制节点并刷新子树 id。
 */
export function cloneNodeWithNewIds(node: ProfileTemplateNodeDto): ProfileTemplateNodeDto {
    return {
        ...node,
        id: `${node.type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
        props: Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, clonePropValue(value)])),
        children: node.children.map(cloneNodeWithNewIds),
    };
}

/**
 * 深拷贝属性值，避免表达式对象在撤销栈和重复节点之间共享引用。
 */
export function clonePropValue(value: ProfileTemplatePropValue): ProfileTemplatePropValue {
    if (isExpressionValue(value)) {
        return {...value};
    }
    return value;
}

/**
 * 查找节点。
 */
export function findNode(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
    if (node.id === id) {
        return node;
    }
    for (const child of node.children) {
        const found = findNode(child, id);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * 统计节点数量。
 */
export function countNodes(node: ProfileTemplateNodeDto): number {
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * 删除节点。
 */
export function removeNode(node: ProfileTemplateNodeDto, id: string): boolean {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
        node.children.splice(index, 1);
        return true;
    }
    return node.children.some((child) => removeNode(child, id));
}

/**
 * 移除并返回指定节点。
 */
export function removeNodeById(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
        const [removed] = node.children.splice(index, 1);
        return removed ?? null;
    }
    for (const child of node.children) {
        const removed = removeNodeById(child, id);
        if (removed) {
            return removed;
        }
    }
    return null;
}

/**
 * 在指定节点后插入新节点。
 */
export function insertAfterNode(node: ProfileTemplateNodeDto, id: string, item: ProfileTemplateNodeDto): boolean {
    return insertAfterNodeWithAncestors(node, id, item, []);
}

/**
 * 在指定节点后插入新节点，保留祖先链用于 If 容器规则。
 */
function insertAfterNodeWithAncestors(node: ProfileTemplateNodeDto, id: string, item: ProfileTemplateNodeDto, ancestors: ProfileTemplateNodeDto[]): boolean {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
        if (!canInsertNodeIntoParent(node, item, ancestors)) {
            return false;
        }
        node.children.splice(index + 1, 0, item);
        return true;
    }
    return node.children.some((child) => insertAfterNodeWithAncestors(child, id, item, [...ancestors, node]));
}

/**
 * 判断 parent 是否包含 childId。
 */
export function containsNode(parent: ProfileTemplateNodeDto, childId: string): boolean {
    return parent.children.some((child) => child.id === childId || containsNode(child, childId));
}

/**
 * 查找指定节点的父节点。
 */
export function findParentOfNode(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
    if (node.children.some((child) => child.id === id)) {
        return node;
    }
    for (const child of node.children) {
        const found = findParentOfNode(child, id);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * 查找指定节点的祖先链，不包含节点自身。
 */
export function findAncestorsOfNode(node: ProfileTemplateNodeDto, id: string, ancestors: ProfileTemplateNodeDto[] = []): ProfileTemplateNodeDto[] {
    if (node.id === id) {
        return ancestors;
    }
    for (const child of node.children) {
        const found = findAncestorsOfNode(child, id, [...ancestors, node]);
        if (found.length > 0 || child.id === id) {
            return found;
        }
    }
    return [];
}

/**
 * 判断一棵子树是否包含指定类型。
 */
export function containsType(node: ProfileTemplateNodeDto, type: ProfileTemplateNodeType): boolean {
    return node.type === type || node.children.some((child) => containsType(child, type));
}

/**
 * 收集一棵子树的所有节点 id。
 */
export function collectNodeIds(node: ProfileTemplateNodeDto): string[] {
    return [node.id, ...node.children.flatMap(collectNodeIds)];
}

/**
 * 返回节点展示标题。
 */
export function nodeTitle(node: ProfileTemplateNodeDto): string {
    if (node.type === "Text") {
        return "Text";
    }
    if (node.type === "Message") {
        return `${node.type} · ${String(node.props.role ?? "system")}`;
    }
    if (node.type === "Reminder") {
        return `${node.type} · ${String(node.props.id ?? "")}`;
    }
    if (node.type === "Watch") {
        return `${node.type} · ${String(node.props.path ?? "")}`;
    }
    return node.type;
}

/**
 * 判断属性值是否是 TSX 表达式源码。
 */
export function isExpressionValue(value: ProfileTemplatePropValue | undefined): value is ProfileTemplateExpressionValue {
    return typeof value === "object" && value !== null && "kind" in value && value.kind === "expression";
}
