<script setup lang="ts">
import type {Data} from "@dnd-kit/abstract";
import {defaultPreset} from "@dnd-kit/dom";
import {DragDropProvider, KeyboardSensor, PointerSensor} from "@dnd-kit/vue";
import type {DragDropProviderEmits} from "@dnd-kit/vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormCheckbox from "nbook/app/components/common/form/FormCheckbox.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import MarkdownSourceEditor from "nbook/app/components/markdown-studio/MarkdownSourceEditor.vue";
import ProfileTemplateDropZone from "nbook/app/components/profile-template-editor/ProfileTemplateDropZone.vue";
import ProfileTemplateLibraryItem from "nbook/app/components/profile-template-editor/ProfileTemplateLibraryItem.vue";
import ProfileTemplateNodeView from "nbook/app/components/profile-template-editor/ProfileTemplateNodeView.vue";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {
    ProfileTemplateExpressionValue,
    ProfileTemplateDetailDto,
    ProfileTemplateIssueDto,
    ProfileTemplateNodeDto,
    ProfileTemplateNodeType,
    ProfileTemplatePropValue,
    ProfileTemplatePreviewDto,
    ProfileTemplatePreviewMessageDto,
    ProfileTemplateSummaryDto,
} from "nbook/shared/dto/profile-template.dto";

type ComponentLibraryItem = {
    type: ProfileTemplateNodeType;
    label: string;
    description: string;
    iconClass: string;
    group: ComponentLibraryGroup;
};

type ComponentLibraryGroup = "all" | "sets" | "messages" | "flow" | "variables" | "privileged";
type InspectorTab = "props" | "variables" | "runtime";
type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];
type ProfileTemplateDropPosition = "before" | "after" | "inside" | "root";

type ProfileTemplateNodeDragData = {
    kind: "profile-template-node";
    nodeId: string;
    parentId: string;
};

type ProfileTemplateLibraryDragData = {
    kind: "library-node";
    type: ProfileTemplateNodeType;
};

type ProfileTemplateDropData = {
    kind: "profile-template-drop";
    parentId: string;
    targetId: string | null;
    position: ProfileTemplateDropPosition;
};

type ProfileTemplateDropState = {
    parentId: string;
    targetId: string | null;
    position: ProfileTemplateDropPosition;
} | null;

type ActiveDragSource = ProfileTemplateNodeDragData | (ProfileTemplateLibraryDragData & {previewNodeId: string}) | null;

type HistoryEntry = {
    root: ProfileTemplateNodeDto;
    selectedNodeId: string;
};

type LibraryVariableItem = {
    label: string;
    description: string;
    value: string;
    iconClass: string;
};

const componentLibrary: ComponentLibraryItem[] = [
    {type: "HistorySet", label: "HistorySet", description: "长期记忆集合。适合放会话历史、用户偏好、项目背景等需要进入长期历史的上下文。", iconClass: "i-lucide-archive", group: "sets"},
    {type: "DynamicSet", label: "DynamicSet", description: "本轮临时上下文集合。适合放只影响当前模型调用、不写入长期历史的说明或材料。", iconClass: "i-lucide-panel-top", group: "sets"},
    {type: "AppendingSet", label: "AppendingSet", description: "输出追加集合。适合把运行后产生的消息追加到历史尾部，用于沉淀结果或后续追踪。", iconClass: "i-lucide-panel-bottom", group: "sets"},
    {type: "Message", label: "Message", description: "普通消息节点。可编辑 role 与正文，常用于 system / user / assistant 提示词片段。", iconClass: "i-lucide-message-square", group: "messages"},
    {type: "Reminder", label: "Reminder", description: "提醒节点。用于注入可恢复的提醒内容，适合周期检查、延迟任务和状态回看。", iconClass: "i-lucide-bell-ring", group: "flow"},
    {type: "Watch", label: "Watch", description: "监听节点。观察指定变量或路径的变化，并在变化时补充上下文说明。", iconClass: "i-lucide-eye", group: "flow"},
    {type: "If", label: "If", description: "条件分支容器。只有 condition 成立时才渲染子节点，适合做模式开关和运行时分支。", iconClass: "i-lucide-git-branch", group: "flow"},
    {type: "ActivatedSkills", label: "ActivatedSkills", description: "激活技能内容。把本轮启用的 skill 文本注入 prompt，通常由运行时维护。", iconClass: "i-lucide-sparkles", group: "privileged"},
    {type: "SkillCatalog", label: "SkillCatalog", description: "技能目录节点。展示可用 skill 列表，帮助模型理解当前可调用的工作流能力。", iconClass: "i-lucide-library", group: "privileged"},
];

const groupLabels: Record<ComponentLibraryGroup, string> = {
    all: "全部",
    sets: "集合",
    messages: "消息",
    flow: "流程控制",
    variables: "变量与引用",
    privileged: "特权节点",
};

const themeHostRef = ref<HTMLElement | null>(null);
const novelIdeStore = useNovelIdeStore();
const theme = computed<IdeTheme>({
    get: () => novelIdeStore.theme,
    set: (value) => {
        novelIdeStore.theme = value;
    },
});
const {mountThemeHost, setTheme} = useIdeTheme(theme);

const templates = ref<ProfileTemplateSummaryDto[]>([]);
const selectedTemplate = ref("leader-runtime");
const detail = ref<ProfileTemplateDetailDto | null>(null);
const root = ref<ProfileTemplateNodeDto | null>(null);
const selectedNodeId = ref("");
const previewMessages = ref<ProfileTemplatePreviewMessageDto[]>([]);
const issues = ref<ProfileTemplateIssueDto[]>([]);
const loading = ref(false);
const saving = ref(false);
const validating = ref(false);
const previewing = ref(false);
const previewDialogOpen = ref(false);
const previewUpdatedAt = ref("");
const statusText = ref("");
const componentSearch = ref("");
const activeComponentGroup = ref<ComponentLibraryGroup>("all");
const inspectorTab = ref<InspectorTab>("props");
const activeTextTarget = ref<"text" | string>("text");
const dragSnapshot = ref<ProfileTemplateNodeDto | null>(null);
const dragVisualRoot = ref<ProfileTemplateNodeDto | null>(null);
const activeDragSource = ref<ActiveDragSource>(null);
const lastValidDropState = ref<ProfileTemplateDropState>(null);
const dropState = ref<ProfileTemplateDropState>(null);
const undoStack = ref<HistoryEntry[]>([]);
const redoStack = ref<HistoryEntry[]>([]);

const selectedNode = computed(() => root.value ? findNode(root.value, selectedNodeId.value) : null);
const selectedPropEntries = computed(() => selectedNode.value ? Object.entries(selectedNode.value.props) : []);
const templateOptions = computed(() => templates.value.map((template) => ({
    value: template.name,
    label: template.fileName,
})));
const issueCount = computed(() => issues.value.filter((issue) => issue.severity === "error").length);
const sourceSnippet = computed(() => root.value ? generatePreviewNodeSource(root.value) : "");
const sourceLineCount = computed(() => sourceSnippet.value ? sourceSnippet.value.split("\n").length : 0);
const selectedTemplateFileName = computed(() => templates.value.find((item) => item.name === selectedTemplate.value)?.fileName ?? `${selectedTemplate.value}.tsxprofile`);
const selectedTextLength = computed(() => selectedNode.value?.text?.length ?? 0);
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const nodeCount = computed(() => root.value ? countNodes(root.value) - 1 : 0);
const displayRoot = computed(() => dragVisualRoot.value ?? root.value);
const disabledDropNodeIds = computed(() => {
    const source = activeDragSource.value;
    const snapshot = dragSnapshot.value;
    if (!source || !snapshot) {
        return [];
    }
    if (source.kind === "library-node") {
        return [source.previewNodeId];
    }
    const sourceNode = findNode(snapshot, source.nodeId);
    return sourceNode ? collectNodeIds(sourceNode) : [source.nodeId];
});

const filteredComponentGroups = computed(() => {
    const keyword = componentSearch.value.trim().toLowerCase();
    const groups = new Map<ComponentLibraryGroup, ComponentLibraryItem[]>();
    for (const item of componentLibrary) {
        if (activeComponentGroup.value !== "all" && item.group !== activeComponentGroup.value) {
            continue;
        }
        if (keyword && !`${item.label} ${item.description}`.toLowerCase().includes(keyword)) {
            continue;
        }
        const current = groups.get(item.group) ?? [];
        current.push(item);
        groups.set(item.group, current);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({
        group,
        label: groupLabels[group],
        items,
    }));
});

const variableGroups = computed(() => detail.value?.variables ?? []);
const runtimeVariableGroups = computed(() => variableGroups.value.filter((group) => ["input", "scope", "skill", "runtime"].includes(group.group)));
const inspectorTabs: Array<{value: InspectorTab; label: string}> = [
    {value: "props", label: "属性面板"},
    {value: "variables", label: "变量面板"},
    {value: "runtime", label: "运行时变量"},
];
const themeOptions: Array<{value: IdeTheme; label: string}> = [
    {value: "light", label: "浅色"},
    {value: "sepia", label: "暖色"},
    {value: "dark", label: "暗色"},
];
const componentGroupTabs: Array<{value: ComponentLibraryGroup; label: string}> = [
    {value: "all", label: "全部"},
    {value: "messages", label: "消息"},
    {value: "sets", label: "集合"},
    {value: "flow", label: "流程控制"},
    {value: "variables", label: "变量"},
    {value: "privileged", label: "工具"},
];
const roleOptions = [
    {value: "system", label: "system"},
    {value: "human", label: "human"},
    {value: "assistant", label: "assistant"},
];
const sourceOptions = [
    {value: "context", label: "context"},
    {value: "input", label: "input"},
];
const libraryVariableItems: LibraryVariableItem[] = [
    {label: "变量引用", description: "插入运行时变量，如 {{scope.now}}", value: "{{scope.time.now}}", iconClass: "i-lucide-braces"},
    {label: "变量", description: "定义或查看运行时变量", value: "{{scope.studio.workspace}}", iconClass: "i-lucide-triangle"},
];
const dndSensors = [
    PointerSensor,
    KeyboardSensor,
];
const sourceEditorPreferences = {
    ...DEFAULT_MONACO_EDITOR_PREFERENCES,
    fontSize: 12,
    lineHeight: 24,
    minimapEnabled: false,
    wordWrap: false,
};

/**
 * 加载模板列表。
 */
async function loadTemplates(): Promise<void> {
    templates.value = await $fetch<ProfileTemplateSummaryDto[]>("/api/agent/profile-templates");
    if (!templates.value.some((item) => item.name === selectedTemplate.value)) {
        selectedTemplate.value = templates.value[0]?.name ?? "";
    }
}

/**
 * 加载当前模板详情。
 */
async function loadTemplate(): Promise<void> {
    if (!selectedTemplate.value) {
        return;
    }
    loading.value = true;
    try {
        const nextDetail = await $fetch<ProfileTemplateDetailDto>(`/api/agent/profile-templates/${selectedTemplate.value}`);
        detail.value = nextDetail;
        root.value = nextDetail.root ? cloneNode(nextDetail.root) : null;
        issues.value = nextDetail.issues;
        selectedNodeId.value = nextDetail.root ? findFirstEditableNodeId(nextDetail.root) : "";
        previewMessages.value = [];
        undoStack.value = [];
        redoStack.value = [];
        resetDragState();
        statusText.value = "已加载模板";
    } finally {
        loading.value = false;
    }
}

/**
 * 请求预览并同步规范化源码。
 */
async function previewTemplate(): Promise<void> {
    if (!root.value) {
        return;
    }
    previewing.value = true;
    statusText.value = "正在生成 Prompt 预览...";
    try {
        const result = await $fetch<ProfileTemplatePreviewDto>("/api/agent/profile-templates/preview", {
            method: "POST",
            body: {root: root.value},
        });
        issues.value = result.issues;
        previewMessages.value = result.messages;
        const timeText = new Date().toLocaleTimeString("zh-CN", {hour12: false});
        previewUpdatedAt.value = timeText;
        statusText.value = result.issues.some((issue) => issue.severity === "error")
            ? `预览存在错误 · ${timeText}`
            : `预览已更新：${result.messages.length} 条消息 · ${timeText}`;
    } catch (error) {
        const message = describeFetchError(error);
        issues.value = [{
            severity: "error",
            message: `预览失败：${message}`,
        }];
        previewMessages.value = [];
        statusText.value = "预览失败，详情见右侧问题面板";
    } finally {
        previewing.value = false;
    }
}

/**
 * 打开独立预览调试弹窗。
 */
async function openPreviewDialog(): Promise<void> {
    previewDialogOpen.value = true;
    await previewTemplate();
}

/**
 * 校验当前模板树。
 */
async function validateTemplate(): Promise<void> {
    if (!root.value) {
        return;
    }
    validating.value = true;
    try {
        const result = await $fetch<ProfileTemplateDetailDto>("/api/agent/profile-templates/validate", {
            method: "POST",
            body: {root: root.value},
        });
        issues.value = result.issues;
        statusText.value = result.issues.some((issue) => issue.severity === "error") ? "校验未通过" : "校验通过";
    } finally {
        validating.value = false;
    }
}

/**
 * 保存当前模板。
 */
async function saveTemplate(): Promise<void> {
    if (!root.value || !selectedTemplate.value) {
        return;
    }
    saving.value = true;
    try {
        const result = await $fetch<ProfileTemplateDetailDto>(`/api/agent/profile-templates/${selectedTemplate.value}`, {
            method: "PUT",
            body: {root: root.value},
        });
        detail.value = result;
        root.value = result.root ? cloneNode(result.root) : null;
        issues.value = result.issues;
        selectedNodeId.value = result.root ? findFirstEditableNodeId(result.root) : "";
        statusText.value = "已保存模板";
    } finally {
        saving.value = false;
    }
}

/**
 * 添加组件到当前选中节点。
 */
function addNode(type: ProfileTemplateNodeType): void {
    if (!root.value) {
        root.value = createNode("ProfilePrompt");
        selectedNodeId.value = root.value.id;
    }
    const parent = selectedNode.value && canHaveChildren(selectedNode.value.type)
        ? selectedNode.value
        : root.value;
    const node = createNode(type);
    if (!canInsertNodeIntoParent(parent, node)) {
        statusText.value = "Message 节点内不能放 Message 节点";
        return;
    }
    pushHistory();
    parent.children.push(node);
    selectedNodeId.value = node.id;
    inspectorTab.value = "props";
    void previewTemplate();
}

/**
 * 删除指定节点。
 */
function deleteNode(id: string = selectedNodeId.value): void {
    if (!root.value || id === root.value.id) {
        return;
    }
    pushHistory();
    removeNode(root.value, id);
    selectedNodeId.value = findFirstEditableNodeId(root.value);
    void previewTemplate();
}

/**
 * 复制指定节点到同级后方。
 */
function duplicateNode(id: string): void {
    if (!root.value || id === root.value.id) {
        return;
    }
    const node = findNode(root.value, id);
    if (!node) {
        return;
    }
    const copy = cloneNodeWithNewIds(node);
    const parent = findParentOfNode(root.value, id);
    if (!parent || !canInsertNodeIntoParent(parent, copy)) {
        statusText.value = "Message 节点内不能放 Message 节点";
        return;
    }
    pushHistory();
    if (!insertAfterNode(root.value, id, copy)) {
        statusText.value = "无法复制到当前节点位置";
        return;
    }
    selectedNodeId.value = copy.id;
    void previewTemplate();
}

/**
 * 更新节点属性。
 */
function updateProp(key: string, value: ProfileTemplatePropValue): void {
    if (!selectedNode.value) {
        return;
    }
    pushHistory();
    selectedNode.value.props[key] = value;
    refreshRootView();
    void previewTemplate();
}

/**
 * 更新表达式属性，保留 TSX 源码而不是转成普通字符串。
 */
function updateExpressionProp(key: string, code: string): void {
    if (!selectedNode.value) {
        return;
    }
    pushHistory();
    selectedNode.value.props[key] = {
        kind: "expression",
        code,
    };
    refreshRootView();
    void previewTemplate();
}

/**
 * 更新节点文本。
 */
function updateText(value: string): void {
    if (!selectedNode.value) {
        return;
    }
    pushHistory();
    selectedNode.value.text = value;
    refreshRootView();
    void previewTemplate();
}

/**
 * 插入变量到当前活跃字段。
 */
function insertVariable(value: string): void {
    if (!selectedNode.value) {
        return;
    }
    pushHistory();
    if (activeTextTarget.value === "text") {
        selectedNode.value.text = `${selectedNode.value.text ?? ""}${value}`;
        refreshRootView();
        void previewTemplate();
        return;
    }
    const current = selectedNode.value.props[activeTextTarget.value];
    if (isExpressionValue(current)) {
        selectedNode.value.props[activeTextTarget.value] = {
            kind: "expression",
            code: `${current.code}${value}`,
        };
    } else {
        selectedNode.value.props[activeTextTarget.value] = `${typeof current === "string" ? current : ""}${value}`;
    }
    refreshRootView();
    void previewTemplate();
}

/**
 * 处理节点拖拽开始，保存回滚快照。
 */
function handleNodeDragStart(event: DragStartPayload): void {
    const source = event.operation.source;
    if (!root.value || !source || !isSupportedDragData(source.data)) {
        resetDragState(false);
        return;
    }

    dragSnapshot.value = cloneNode(root.value);
    dragVisualRoot.value = null;
    dropState.value = null;
    lastValidDropState.value = null;
    activeDragSource.value = isProfileTemplateLibraryDragData(source.data)
        ? {
            ...source.data,
            previewNodeId: createNodeId(source.data.type),
        }
        : source.data;

    if (isProfileTemplateNodeDragData(source.data)) {
        selectedNodeId.value = source.data.nodeId;
    }
}

/**
 * 拖拽前先选中节点，保证操作反馈和属性面板同步。
 */
function prepareNodeDrag(nodeId: string): void {
    selectedNodeId.value = nodeId;
}

/**
 * 处理节点拖拽经过，仅拦截非法排序目标。
 */
function handleNodeDragOver(event: DragOverPayload): void {
    const source = activeDragSource.value;
    const snapshot = dragSnapshot.value;
    if (!snapshot || !source) {
        event.preventDefault();
        return;
    }

    const nextDropState = readDropState(event, snapshot);
    if (!nextDropState) {
        event.preventDefault();
        return;
    }

    if (!isSameDropState(lastValidDropState.value, nextDropState)) {
        const nextRoot = buildDragVisualRoot(snapshot, source, nextDropState);
        if (!nextRoot) {
            event.preventDefault();
            return;
        }
        dragVisualRoot.value = nextRoot.root;
        selectedNodeId.value = nextRoot.selectedNodeId;
    }

    lastValidDropState.value = nextDropState;
    dropState.value = nextDropState;
}

/**
 * 处理节点拖拽结束，提交当前预览位置，取消时回滚。
 */
function handleNodeDragEnd(event: DragEndPayload): void {
    const snapshot = dragSnapshot.value;
    const source = activeDragSource.value;
    const finalDropState = lastValidDropState.value;
    dropState.value = null;

    if (event.canceled || !snapshot || !source || !finalDropState) {
        resetDragState(false);
        return;
    }

    const nextRoot = buildDragVisualRoot(snapshot, source, finalDropState);
    if (!nextRoot) {
        resetDragState(false);
        return;
    }

    pushHistory(snapshot);
    root.value = nextRoot.root;
    selectedNodeId.value = nextRoot.selectedNodeId;
    resetDragState(false);
    void previewTemplate();
}

/**
 * 新建默认节点。
 */
function createNode(type: ProfileTemplateNodeType): ProfileTemplateNodeDto {
    const base: ProfileTemplateNodeDto = {
        id: createNodeId(type),
        type,
        props: {},
        children: [],
        editable: true,
    };
    if (type === "Message") {
        base.props = {role: "system"};
        base.text = "新的消息内容";
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
        base.props = {text: "{{activatedSkillsText}}"};
    }
    return base;
}

/**
 * 创建节点 id。
 */
function createNodeId(type: ProfileTemplateNodeType): string {
    return `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 撤销最近一次编辑。
 */
function undoEdit(): void {
    const entry = undoStack.value.pop();
    if (!entry || !root.value) {
        return;
    }
    redoStack.value.push({
        root: cloneNode(root.value),
        selectedNodeId: selectedNodeId.value,
    });
    root.value = cloneNode(entry.root);
    selectedNodeId.value = entry.selectedNodeId;
    void previewTemplate();
}

/**
 * 重做最近一次撤销。
 */
function redoEdit(): void {
    const entry = redoStack.value.pop();
    if (!entry || !root.value) {
        return;
    }
    undoStack.value.push({
        root: cloneNode(root.value),
        selectedNodeId: selectedNodeId.value,
    });
    root.value = cloneNode(entry.root);
    selectedNodeId.value = entry.selectedNodeId;
    void previewTemplate();
}

/**
 * 记录编辑前快照。
 */
function pushHistory(snapshot: ProfileTemplateNodeDto | undefined = root.value ?? undefined): void {
    if (!snapshot) {
        return;
    }
    undoStack.value.push({
        root: cloneNode(snapshot),
        selectedNodeId: selectedNodeId.value,
    });
    if (undoStack.value.length > 80) {
        undoStack.value.shift();
    }
    redoStack.value = [];
}

/**
 * 节点是否可包含子节点。
 */
function canHaveChildren(type: ProfileTemplateNodeType): boolean {
    return !["SkillCatalog", "ActivatedSkills"].includes(type);
}

/**
 * 判断节点是否能放进目标父节点。
 */
function canInsertNodeIntoParent(parent: ProfileTemplateNodeDto, node: ProfileTemplateNodeDto): boolean {
    if (!canHaveChildren(parent.type)) {
        return false;
    }
    if (parent.type === "Message" && containsType(node, "Message")) {
        return false;
    }
    return true;
}

/**
 * 深拷贝节点。
 */
function cloneNode(node: ProfileTemplateNodeDto): ProfileTemplateNodeDto {
    return {
        ...node,
        props: Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, clonePropValue(value)])),
        children: node.children.map(cloneNode),
    };
}

/**
 * 查找默认选中节点，优先让属性面板落在可编辑消息上。
 */
function findFirstEditableNodeId(node: ProfileTemplateNodeDto): string {
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
function cloneNodeWithNewIds(node: ProfileTemplateNodeDto): ProfileTemplateNodeDto {
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
function clonePropValue(value: ProfileTemplatePropValue): ProfileTemplatePropValue {
    if (isExpressionValue(value)) {
        return {...value};
    }
    return value;
}

/**
 * 替换根引用，保证深层属性编辑后画布和 dnd 节点实时刷新。
 */
function refreshRootView(): void {
    if (!root.value) {
        return;
    }
    root.value = cloneNode(root.value);
}

/**
 * 查找节点。
 */
function findNode(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
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
function countNodes(node: ProfileTemplateNodeDto): number {
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * 删除节点。
 */
function removeNode(node: ProfileTemplateNodeDto, id: string): boolean {
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
function removeNodeById(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
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
function insertAfterNode(node: ProfileTemplateNodeDto, id: string, item: ProfileTemplateNodeDto): boolean {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
        if (!canInsertNodeIntoParent(node, item)) {
            return false;
        }
        node.children.splice(index + 1, 0, item);
        return true;
    }
    return node.children.some((child) => insertAfterNode(child, id, item));
}

/**
 * 根据拖拽落点插入节点。
 */
function insertNodeAtDrop(rootNode: ProfileTemplateNodeDto, node: ProfileTemplateNodeDto, state: NonNullable<ProfileTemplateDropState>): boolean {
    const parent = findNode(rootNode, state.parentId);
    if (!parent) {
        return false;
    }
    if (!canInsertNodeIntoParent(parent, node)) {
        return false;
    }
    if (state.position === "inside") {
        parent.children.push(node);
        return true;
    }
    if (state.position === "root" || !state.targetId) {
        parent.children.push(node);
        return true;
    }
    const targetIndex = parent.children.findIndex((child) => child.id === state.targetId);
    if (targetIndex < 0) {
        return false;
    }
    parent.children.splice(state.position === "before" ? targetIndex : targetIndex + 1, 0, node);
    return true;
}

/**
 * 读取当前拖拽落点。
 */
function readDropState(event: DragOverPayload | DragEndPayload, baseRoot: ProfileTemplateNodeDto | null = dragSnapshot.value ?? root.value): ProfileTemplateDropState {
    const source = activeDragSource.value ?? event.operation.source?.data;
    const target = event.operation.target;
    if (!baseRoot || !source || !target || !isSupportedDragData(source) || !isProfileTemplateDropData(target.data)) {
        return null;
    }
    if (!findNode(baseRoot, target.data.parentId)) {
        return null;
    }
    if (target.data.targetId && !findNode(baseRoot, target.data.targetId)) {
        return null;
    }
    if (source.kind === "profile-template-node" && !canMoveNodeToDrop(baseRoot, source.nodeId, target.data)) {
        return null;
    }
    if (target.data.position === "inside") {
        const targetParent = findNode(baseRoot, target.data.parentId);
        if (!targetParent || !canHaveChildren(targetParent.type)) {
            return null;
        }
    }
    const sourceNode = source.kind === "library-node"
        ? createNode(source.type)
        : findNode(baseRoot, source.nodeId);
    const targetParent = findNode(baseRoot, target.data.parentId);
    if (!sourceNode || !targetParent || !canInsertNodeIntoParent(targetParent, sourceNode)) {
        return null;
    }
    return {
        parentId: target.data.parentId,
        targetId: target.data.targetId,
        position: target.data.position,
    };
}

/**
 * 判断节点能否移动到目标落点。
 */
function canMoveNodeToDrop(rootNode: ProfileTemplateNodeDto, sourceId: string, target: ProfileTemplateDropData): boolean {
    if (sourceId === rootNode.id || sourceId === target.targetId || sourceId === target.parentId) {
        return false;
    }
    const sourceNode = findNode(rootNode, sourceId);
    if (!sourceNode) {
        return false;
    }
    return !containsNode(sourceNode, target.parentId);
}

/**
 * 判断 parent 是否包含 childId。
 */
function containsNode(parent: ProfileTemplateNodeDto, childId: string): boolean {
    return parent.children.some((child) => child.id === childId || containsNode(child, childId));
}

/**
 * 查找指定节点的父节点。
 */
function findParentOfNode(node: ProfileTemplateNodeDto, id: string): ProfileTemplateNodeDto | null {
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
 * 判断一棵子树是否包含指定类型。
 */
function containsType(node: ProfileTemplateNodeDto, type: ProfileTemplateNodeType): boolean {
    return node.type === type || node.children.some((child) => containsType(child, type));
}

/**
 * 判断 dnd-kit data 是否为支持的拖拽源。
 */
function isSupportedDragData(data: Data | undefined): data is ProfileTemplateNodeDragData | ProfileTemplateLibraryDragData {
    return isProfileTemplateNodeDragData(data) || isProfileTemplateLibraryDragData(data);
}

/**
 * 判断 dnd-kit data 是否为 profile 节点拖拽数据。
 */
function isProfileTemplateNodeDragData(data: Data | undefined): data is ProfileTemplateNodeDragData {
    return data?.kind === "profile-template-node"
        && typeof data.nodeId === "string"
        && typeof data.parentId === "string";
}

/**
 * 判断 dnd-kit data 是否为组件库拖拽数据。
 */
function isProfileTemplateLibraryDragData(data: Data | undefined): data is ProfileTemplateLibraryDragData {
    return data?.kind === "library-node" && isProfileTemplateNodeType(data.type);
}

/**
 * 判断 dnd-kit data 是否为 profile drop 落点数据。
 */
function isProfileTemplateDropData(data: Data | undefined): data is ProfileTemplateDropData {
    return data?.kind === "profile-template-drop"
        && typeof data.parentId === "string"
        && (typeof data.targetId === "string" || data.targetId === null)
        && ["before", "after", "inside", "root"].includes(String(data.position));
}

/**
 * 判断是否为可创建的节点类型。
 */
function isProfileTemplateNodeType(value: unknown): value is ProfileTemplateNodeType {
    return typeof value === "string" && componentLibrary.some((item) => item.type === value);
}

/**
 * 判断根落点是否激活。
 */
function isRootDropActive(): boolean {
    return Boolean(dropState.value && displayRoot.value && dropState.value.parentId === displayRoot.value.id && dropState.value.position === "root");
}

/**
 * 清理拖拽过程状态。
 */
function resetDragState(clearVisualRoot: boolean = true): void {
    if (clearVisualRoot) {
        dragVisualRoot.value = null;
    }
    dragSnapshot.value = null;
    activeDragSource.value = null;
    lastValidDropState.value = null;
    dropState.value = null;
}

/**
 * 对比两个落点是否一致。
 */
function isSameDropState(left: ProfileTemplateDropState, right: ProfileTemplateDropState): boolean {
    if (!left || !right) {
        return left === right;
    }
    return left.parentId === right.parentId
        && left.targetId === right.targetId
        && left.position === right.position;
}

/**
 * 根据当前拖拽源和落点生成视觉树或提交树。
 */
function buildDragVisualRoot(snapshot: ProfileTemplateNodeDto, source: NonNullable<ActiveDragSource>, state: NonNullable<ProfileTemplateDropState>): {root: ProfileTemplateNodeDto; selectedNodeId: string} | null {
    const nextRoot = cloneNode(snapshot);
    const insertedNode = source.kind === "library-node"
        ? createNodeWithId(source.type, source.previewNodeId)
        : removeNodeById(nextRoot, source.nodeId);
    if (!insertedNode || !insertNodeAtDrop(nextRoot, insertedNode, state)) {
        return null;
    }
    return {
        root: nextRoot,
        selectedNodeId: insertedNode.id,
    };
}

/**
 * 使用指定 id 创建节点，保证组件库拖入时预览节点 key 稳定。
 */
function createNodeWithId(type: ProfileTemplateNodeType, id: string): ProfileTemplateNodeDto {
    const node = createNode(type);
    node.id = id;
    return node;
}

/**
 * 收集一棵子树的所有节点 id。
 */
function collectNodeIds(node: ProfileTemplateNodeDto): string[] {
    return [node.id, ...node.children.flatMap(collectNodeIds)];
}

/**
 * 返回节点展示标题。
 */
function nodeTitle(node: ProfileTemplateNodeDto): string {
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
 * 生成右侧预览用 TSX 标签片段。
 */
function generatePreviewNodeSource(node: ProfileTemplateNodeDto): string {
    const props = generatePreviewProps(node.props);
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
    }
    const childLines = [
        node.text ? renderPreviewNodeText(node) : "",
        ...node.children.map((child) => generatePreviewNodeSource(child)),
    ].filter(Boolean);
    return [
        `<${node.type}${props}>`,
        ...childLines.map((line) => indentPreviewSource(line, 1)),
        `</${node.type}>`,
    ].join("\n");
}

/**
 * 生成 TSX 标签属性。
 */
function generatePreviewProps(props: ProfileTemplateNodeDto["props"]): string {
    const chunks: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === "") {
            continue;
        }
        if (isExpressionValue(value)) {
            chunks.push(`${key}={${value.code}}`);
            continue;
        }
        if (typeof value === "string") {
            chunks.push(`${key}=${JSON.stringify(value)}`);
        } else {
            chunks.push(`${key}={${String(value)}}`);
        }
    }
    return chunks.length > 0 ? ` ${chunks.join(" ")}` : "";
}

/**
 * 缩进 TSX 片段。
 */
function indentPreviewSource(source: string, level: number): string {
    const prefix = "    ".repeat(level);
    return source.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

/**
 * 转义 TSX 文本内容。
 */
function escapePreviewText(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

/**
 * 渲染预览中的节点文本，source 模式保留原始 TSX children 片段。
 */
function renderPreviewNodeText(node: ProfileTemplateNodeDto): string {
    if (node.textKind === "source") {
        return node.text ?? "";
    }
    return node.text ? renderPreviewPlainText(node.text) : "";
}

/**
 * 判断属性值是否是 TSX 表达式源码。
 */
function isExpressionValue(value: ProfileTemplatePropValue | undefined): value is ProfileTemplateExpressionValue {
    return typeof value === "object" && value !== null && "kind" in value && value.kind === "expression";
}

/**
 * 表单里显示属性值时使用的字符串。
 */
function propInputValue(value: ProfileTemplatePropValue): string {
    if (isExpressionValue(value)) {
        return value.code;
    }
    if (value === null) {
        return "";
    }
    return String(value);
}

/**
 * 表单里的属性标签。
 */
function propLabel(key: string): string {
    const labels: Record<string, string> = {
        id: "ID",
        role: "角色",
        source: "source",
        repeatEveryTurns: "repeatEveryTurns",
        watchPath: "watchPath",
        watchValue: "watchValue",
        when: "when",
        path: "path",
        render: "render",
        previewText: "预览文本",
        condition: "condition",
        text: "text",
    };
    return labels[key] ?? key;
}

/**
 * 返回模板问题的详细定位说明。
 */
function issueDetail(issue: ProfileTemplateIssueDto): string {
    return [
        issue.path ? `位置：${issue.path}` : "",
        issue.nodeId ? `节点：${issue.nodeId}` : "",
        issue.sourceText ? `源码：${issue.sourceText}` : "",
        issue.sourceRange ? `源码范围：${issue.sourceRange.start}-${issue.sourceRange.end}` : "",
    ].filter(Boolean).join(" · ");
}

/**
 * 提取 $fetch / 服务端异常中对用户有意义的错误文本。
 */
function describeFetchError(error: unknown): string {
    const payload = error as {
        data?: {
            message?: string;
            statusMessage?: string;
        };
        message?: string;
        statusMessage?: string;
    };
    return payload.data?.message
        ?? payload.data?.statusMessage
        ?? payload.statusMessage
        ?? payload.message
        ?? "未知错误";
}

/**
 * 普通 Message 文本含尖括号时使用字符串表达式，和服务端生成规则保持一致。
 */
function renderPreviewPlainText(text: string): string {
    if (/[<>{}]/.test(text)) {
        return `{${JSON.stringify(text)}}`;
    }
    return escapePreviewText(text);
}

watch(selectedTemplate, () => {
    void loadTemplate();
});

onMounted(async () => {
    mountThemeHost(themeHostRef.value);
    await loadTemplates();
    await loadTemplate();
});
</script>

<template>
    <div ref="themeHostRef" class="tsx-profile-editor-page flex h-screen flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <!-- 顶部工具栏 -->
        <header class="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4">
            <div class="flex min-w-0 items-center gap-3">
                <div class="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--accent-main)] text-xs font-semibold text-white shadow-sm">TS</div>
                <div class="min-w-0">
                    <div class="flex items-center gap-2 text-[13px] font-semibold">
                        <span class="truncate">TSX Profile 可视化编辑器</span>
                        <span class="i-lucide-chevron-right h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                        <span class="truncate text-[12px] font-medium text-[var(--text-secondary)]">当前位置：{{ selectedTemplateFileName }}</span>
                    </div>
                </div>
            </div>

            <FormSelect v-model="selectedTemplate" :options="templateOptions" placeholder="选择模板" dropdown-direction="down" class="min-w-[220px]" />

            <div class="hidden items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5 lg:flex">
                <button
                    v-for="option in themeOptions"
                    :key="option.value"
                    class="h-6 rounded px-2 text-[11px] font-medium transition-colors"
                    :class="theme === option.value ? 'bg-[var(--bg-panel)] text-[var(--accent-text)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                    @click="setTheme(option.value)"
                >
                    {{ option.label }}
                </button>
            </div>

            <div class="ml-auto flex items-center gap-2">
                <span class="hidden items-center gap-1 text-xs text-emerald-600 md:flex">
                    <span class="i-lucide-circle-check h-3.5 w-3.5"></span>
                    <span>{{ statusText || "等待操作" }}</span>
                </span>
                <div class="mx-2 hidden h-4 w-px bg-[var(--border-color)] lg:block"></div>
                <button class="icon-btn" title="撤销" :disabled="!canUndo" @click="undoEdit">
                    <span class="i-lucide-undo-2 h-4 w-4"></span>
                </button>
                <button class="icon-btn" title="重做" :disabled="!canRedo" @click="redoEdit">
                    <span class="i-lucide-redo-2 h-4 w-4"></span>
                </button>
                <button class="toolbar-btn" :disabled="previewing || !root" @click="void openPreviewDialog()">
                    <span class="i-lucide-play h-3.5 w-3.5"></span>
                    <span>预览</span>
                </button>
                <button class="toolbar-btn" :disabled="validating || !root" @click="void validateTemplate()">
                    <span class="i-lucide-badge-check h-3.5 w-3.5"></span>
                    <span>验证</span>
                </button>
                <button class="toolbar-btn primary" :disabled="saving || !root || issueCount > 0" @click="void saveTemplate()">
                    <span class="i-lucide-save h-3.5 w-3.5"></span>
                    <span>保存</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 opacity-80"></span>
                </button>
            </div>
        </header>

        <DragDropProvider
            :plugins="defaultPreset.plugins"
            :sensors="dndSensors"
            @drag-start="handleNodeDragStart"
            @drag-over="handleNodeDragOver"
            @drag-end="handleNodeDragEnd"
        >
            <main class="grid min-h-0 flex-1 grid-cols-[290px_minmax(560px,1fr)_520px] gap-3 p-3">
            <!-- 组件库 -->
            <aside class="panel flex min-h-0 flex-col">
                <div class="mb-3">
                    <div class="panel-title">组件库</div>
                    <div class="mt-1 text-[11px] text-[var(--text-muted)]">拖拽组件到画布中编辑</div>
                </div>
                <div class="relative mb-3">
                    <span class="i-lucide-search absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <FormInput v-model="componentSearch" placeholder="搜索组件（如：Message）" class="pl-8" type="search" />
                </div>
                <div class="mb-3 flex flex-wrap gap-1">
                    <button
                        v-for="tab in componentGroupTabs"
                        :key="tab.value"
                        class="library-tab"
                        :class="activeComponentGroup === tab.value ? 'active' : ''"
                        @click="activeComponentGroup = tab.value"
                    >
                        {{ tab.label }}
                    </button>
                </div>
                <div class="min-h-0 flex-1 space-y-4 overflow-auto pr-1 custom-scrollbar">
                    <section v-for="group in filteredComponentGroups" :key="group.group">
                        <div class="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">{{ group.label }}</div>
                        <div class="space-y-2">
                            <ProfileTemplateLibraryItem
                                v-for="item in group.items"
                                :key="item.type"
                                :type="item.type"
                                :label="item.label"
                                :description="item.description"
                                :icon-class="item.iconClass"
                                :item-class="`component-${item.group} library-node-${item.type}`"
                                @add="addNode"
                            />
                        </div>
                    </section>
                    <section v-if="activeComponentGroup === 'all' || activeComponentGroup === 'variables'">
                        <div class="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">变量与引用</div>
                        <div class="space-y-2">
                            <button v-for="item in libraryVariableItems" :key="item.value" class="component-item variable-library-item" @click="insertVariable(item.value)">
                                <span class="component-icon">
                                    <span :class="item.iconClass" class="h-3.5 w-3.5"></span>
                                </span>
                                <span class="min-w-0">
                                    <span class="block truncate text-xs font-semibold text-[var(--text-main)]">{{ item.label }}</span>
                                    <span class="mt-1 block truncate text-[11px] text-[var(--text-muted)]">{{ item.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>
                </div>
                <div class="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/60 p-3 text-[11px] leading-5 text-[var(--text-muted)]">
                    <span class="i-lucide-lightbulb mr-1 inline-block h-3.5 w-3.5 align-text-bottom"></span>
                    提示：点击组件快速添加到当前选中节点。
                </div>
            </aside>

            <!-- 模板画布 -->
            <section class="panel flex min-h-0 flex-col">
                <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="i-lucide-chevron-right h-4 w-4 text-[var(--accent-main)]"></span>
                            <div class="panel-title">ProfilePrompt（根节点）</div>
                            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ nodeCount }} 节点</span>
                        </div>
                        <div class="mt-1 text-[11px] text-[var(--text-muted)]">最多包含一个 HistorySet，多个 AppendingSet 会自动合并。</div>
                    </div>
                    <div class="flex shrink-0 gap-2">
                        <button class="small-btn">折叠全部</button>
                        <button class="small-btn">展开全部</button>
                    </div>
                </div>
                <div class="min-h-0 flex-1 overflow-auto pr-1 custom-scrollbar">
                    <div v-if="loading" class="empty-state">加载中...</div>
                    <template v-else-if="displayRoot">
                        <div>
                            <ProfileTemplateNodeView
                                v-for="(child, index) in displayRoot.children"
                                :key="child.id"
                                :node="child"
                                :selected-id="selectedNodeId"
                                :depth="0"
                                :index="index"
                                :parent-id="displayRoot.id"
                                :can-have-children="canHaveChildren(child.type)"
                                :disabled-drop-node-ids="disabledDropNodeIds"
                                @select="selectedNodeId = $event"
                                @prepare-drag="prepareNodeDrag"
                                @duplicate="duplicateNode"
                                @delete="deleteNode"
                            />
                        </div>
                        <ProfileTemplateDropZone
                            :id="`drop-root-${displayRoot.id}`"
                            :parent-id="displayRoot.id"
                            position="root"
                            :active="isRootDropActive()"
                            :disabled="disabledDropNodeIds.includes(displayRoot.id)"
                            label="拖拽组件到根节点末尾"
                        />
                    </template>
                    <div v-else class="empty-state">暂无模板</div>
                    <button class="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/35 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)]" @click="addNode('Message')">
                        <span class="i-lucide-plus h-4 w-4"></span>
                        <span>拖拽组件到此处添加</span>
                    </button>
                </div>
            </section>

            <!-- 预览与属性 -->
            <aside class="flex min-h-0 flex-col gap-3">
                <section class="panel flex min-h-0 flex-[0.9] flex-col">
                    <div class="mb-2 flex shrink-0 items-center justify-between">
                        <div class="panel-title">TSX Profile 预览（JSONC / TSX）</div>
                        <div class="flex items-center gap-2">
                            <button class="small-btn">格式化</button>
                            <span class="text-[11px] text-[var(--text-muted)]">{{ sourceLineCount }} 行</span>
                        </div>
                    </div>
                    <MarkdownSourceEditor
                        class="source-preview min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--border-color)]"
                        :initial-value="sourceSnippet"
                        readonly
                        visible
                        language="typescript"
                        model-path="tsx-profile-preview.tsx"
                        :theme="theme"
                        :monaco-preferences="sourceEditorPreferences"
                    />
                </section>

                <section class="panel flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div class="mb-3 flex shrink-0 border-b border-[var(--border-color)]">
                        <button
                            v-for="tab in inspectorTabs"
                            :key="tab.value"
                            class="relative h-8 px-4 text-xs font-medium transition-colors"
                            :class="inspectorTab === tab.value ? 'text-[var(--accent-text)] after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:bg-[var(--accent-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                            @click="inspectorTab = tab.value"
                        >
                            {{ tab.label }}
                        </button>
                    </div>

                    <div class="min-h-0 flex-1 overflow-auto pr-1 custom-scrollbar">
                        <div v-if="inspectorTab === 'props'">
                            <div v-if="selectedNode" class="space-y-3">
                                <div class="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                                    <span class="i-lucide-message-square h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                    <span>当前选中：</span>
                                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-semibold text-[var(--text-main)]">{{ nodeTitle(selectedNode) }}</span>
                                    <span class="truncate text-[var(--text-muted)]">/ id: {{ selectedNode.id }}</span>
                                </div>
                                <FormField label="ID">
                                    <FormInput :model-value="selectedNode.id" readonly />
                                </FormField>

                                <div v-if="selectedPropEntries.length > 0" class="space-y-3">
                                    <div v-for="[key, value] in selectedPropEntries" :key="key" class="space-y-1">
                                        <div class="flex items-center justify-between gap-2">
                                            <div class="field-label">{{ propLabel(key) }}</div>
                                            <span v-if="isExpressionValue(value)" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">表达式</span>
                                        </div>
                                        <FormSelect v-if="key === 'role'" :model-value="String(value ?? 'system')" :options="roleOptions" @focus="activeTextTarget = key" @update:model-value="updateProp(key, $event)" />
                                        <FormSelect v-else-if="key === 'source'" :model-value="String(value ?? 'context')" :options="sourceOptions" @focus="activeTextTarget = key" @update:model-value="updateProp(key, $event)" />
                                        <FormTextarea
                                            v-else-if="isExpressionValue(value)"
                                            :model-value="propInputValue(value)"
                                            :rows="4"
                                            class="textarea font-mono"
                                            @focus="activeTextTarget = key"
                                            @update:model-value="updateExpressionProp(key, $event)"
                                        />
                                        <FormCheckbox v-else-if="typeof value === 'boolean'" :model-value="value" @focus="activeTextTarget = key" @update:model-value="updateProp(key, $event)" />
                                        <FormInput v-else-if="typeof value === 'number'" :model-value="String(value)" type="number" @focus="activeTextTarget = key" @update:model-value="updateProp(key, Number($event || 0))" />
                                        <FormInput v-else :model-value="propInputValue(value)" @focus="activeTextTarget = key" @update:model-value="updateProp(key, $event)" />
                                    </div>
                                </div>
                                <div v-else class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 px-3 py-2 text-xs text-[var(--text-muted)]">此节点暂无属性。</div>

                                <template v-if="selectedNode.type === 'Message'">
                                    <div class="field-label">{{ selectedNode.textKind === "source" ? "内容（TSX 源片段）" : "内容（支持变量引用）" }}</div>
                                    <StructuredTextEditor
                                        :model-value="selectedNode.text ?? ''"
                                        :rows="8"
                                        :min-height="172"
                                        :max-height="420"
                                        :default-mode="selectedNode.textKind === 'source' ? 'source' : 'rich'"
                                        :show-format-toolbar="selectedNode.textKind !== 'source'"
                                        :theme="theme"
                                        placeholder="输入 Message 正文，可使用 Markdown 与变量引用"
                                        @focus="activeTextTarget = 'text'"
                                        @update:model-value="updateText($event)"
                                    />
                                    <div class="text-right text-[11px] text-[var(--text-muted)]">字数：{{ selectedTextLength }} / 20000</div>
                                    <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                                        <div class="text-[11px] font-semibold text-[var(--text-secondary)]">变量插入提示</div>
                                        <div class="flex flex-wrap gap-2">
                                            <button
                                                v-for="item in (variableGroups[0]?.items ?? []).slice(0, 3)"
                                                :key="item.value"
                                                class="variable-chip"
                                                @click="insertVariable(item.value)"
                                            >
                                                {{ item.value }}
                                            </button>
                                        </div>
                                    </div>
                                </template>
                            </div>
                            <div v-else class="empty-state">请选择一个节点。</div>

                            <div class="mt-4 border-t border-[var(--border-color)] pt-3">
                                <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">验证结果</div>
                                <div v-if="issues.length === 0" class="text-xs text-emerald-600">暂无问题</div>
                                <div v-for="issue in issues" :key="`${issue.message}-${issue.nodeId ?? ''}`" class="mb-1 rounded-md border px-2 py-1 text-xs" :class="issue.severity === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'">
                                    <div class="font-medium">{{ issue.message }}</div>
                                    <div v-if="issueDetail(issue)" class="mt-1 text-[10px] leading-4 opacity-80">{{ issueDetail(issue) }}</div>
                                </div>
                            </div>
                        </div>

                        <div v-else-if="inspectorTab === 'variables'" class="space-y-3">
                            <div class="text-[11px] leading-5 text-[var(--text-muted)]">点击变量会追加到当前聚焦字段；未聚焦时追加到选中节点文本。</div>
                            <section v-for="group in variableGroups" :key="group.group">
                                <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">{{ group.group }}</div>
                                <div class="flex flex-wrap gap-2">
                                    <button v-for="item in group.items" :key="item.value" class="variable-chip" @click="insertVariable(item.value)">{{ item.value }}</button>
                                </div>
                            </section>
                        </div>

                        <div v-else class="space-y-3">
                            <section v-for="group in runtimeVariableGroups" :key="group.group">
                                <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                                    <span class="i-lucide-braces h-3.5 w-3.5"></span>
                                    <span>{{ group.group }}</span>
                                </div>
                                <div class="flex flex-wrap gap-2">
                                    <button v-for="item in group.items" :key="item.value" class="variable-chip" @click="insertVariable(item.value)">{{ item.value }}</button>
                                </div>
                            </section>
                        </div>
                    </div>
                </section>
            </aside>
            </main>
        </DragDropProvider>

        <Dialog
            v-model="previewDialogOpen"
            title="Prompt 预览调试"
            width="min(1100px, calc(100vw - 48px))"
            height="min(780px, calc(100vh - 56px))"
            overlay-type="blur"
            :show-footer="false"
        >
            <template #header-extra>
                <div class="flex shrink-0 items-center gap-2">
                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                        {{ previewUpdatedAt ? `更新于 ${previewUpdatedAt}` : "尚未生成" }}
                    </span>
                    <button class="small-btn" :disabled="previewing || !root" @click="void previewTemplate()">
                        <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="previewing ? 'animate-spin' : ''"></span>
                        <span>刷新</span>
                    </button>
                </div>
            </template>

            <div class="preview-dialog-content">
                <aside class="preview-variable-pane custom-scrollbar">
                    <div class="preview-summary-grid">
                        <div class="preview-summary-card">
                            <div class="preview-summary-label">消息</div>
                            <div class="preview-summary-value">{{ previewMessages.length }}</div>
                        </div>
                        <div class="preview-summary-card">
                            <div class="preview-summary-label">问题</div>
                            <div class="preview-summary-value">{{ issues.length }}</div>
                        </div>
                    </div>

                    <section class="preview-section">
                        <div class="preview-section-title">
                            <span class="i-lucide-file-code-2 h-3.5 w-3.5"></span>
                            <span>{{ selectedTemplateFileName }}</span>
                        </div>
                        <div class="text-[11px] leading-5 text-[var(--text-muted)]">预览会使用当前画布结构生成消息，不会保存模板。</div>
                    </section>

                    <section class="preview-section">
                        <div class="preview-section-title">
                            <span class="i-lucide-braces h-3.5 w-3.5"></span>
                            <span>变量</span>
                        </div>
                        <div class="space-y-3">
                            <section v-for="group in runtimeVariableGroups" :key="`dialog-variable-${group.group}`">
                                <div class="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">{{ group.group }}</div>
                                <div class="flex flex-wrap gap-2">
                                    <button v-for="item in group.items" :key="item.value" class="variable-chip" @click="insertVariable(item.value)">{{ item.value }}</button>
                                </div>
                            </section>
                        </div>
                    </section>

                    <section v-if="issues.length > 0" class="preview-section">
                        <div class="preview-section-title">
                            <span class="i-lucide-triangle-alert h-3.5 w-3.5"></span>
                            <span>问题</span>
                        </div>
                        <div class="space-y-2">
                            <div v-for="issue in issues" :key="`dialog-${issue.message}-${issue.nodeId ?? issue.path ?? ''}`" class="rounded-md border px-3 py-2 text-xs" :class="issue.severity === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'">
                                <div class="font-semibold">{{ issue.message }}</div>
                                <div v-if="issueDetail(issue)" class="mt-1 leading-5 opacity-80">{{ issueDetail(issue) }}</div>
                            </div>
                        </div>
                    </section>
                </aside>

                <section class="preview-message-pane">
                    <div class="preview-section-title">
                        <span class="i-lucide-messages-square h-3.5 w-3.5"></span>
                        <span>Prompt 消息</span>
                        <span class="ml-auto text-[11px] font-medium text-[var(--text-muted)]">{{ previewMessages.length }} 条</span>
                    </div>
                    <div v-if="previewing" class="empty-state min-h-[160px]">正在生成预览...</div>
                    <div v-else-if="previewMessages.length === 0" class="empty-state min-h-[160px]">暂无预览消息。</div>
                    <div v-else class="preview-message-list custom-scrollbar">
                        <article v-for="(message, index) in previewMessages" :key="`${index}-${message.role}-${message.text}`" class="preview-message-card">
                            <div class="mb-2 flex items-center justify-between gap-3">
                                <div class="flex items-center gap-2">
                                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-text)]">{{ message.role }}</span>
                                    <span v-if="message.source" class="text-[11px] text-[var(--text-muted)]">{{ message.source }}</span>
                                </div>
                                <span class="text-[11px] text-[var(--text-muted)]">#{{ index + 1 }}</span>
                            </div>
                            <pre class="preview-message-text">{{ message.text }}</pre>
                        </article>
                    </div>
                </section>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px rgba(15, 23, 42, 0.05);
}

.panel-title {
    color: var(--text-main);
    font-size: 13px;
    font-weight: 700;
}

.toolbar-btn,
.small-btn,
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 12px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.toolbar-btn {
    height: 32px;
    padding: 0 12px;
}

.toolbar-btn.primary {
    border-color: var(--accent-main);
    background: var(--accent-main);
    color: white;
}

.small-btn {
    height: 28px;
    padding: 0 10px;
}

.icon-btn {
    height: 32px;
    width: 32px;
}

.toolbar-btn:hover:not(:disabled),
.small-btn:hover:not(:disabled),
.icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.toolbar-btn:disabled,
.small-btn:disabled,
.icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.component-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: var(--component-bg, var(--bg-input));
    padding: 9px;
    text-align: left;
    transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
}

.component-item:hover {
    border-color: var(--component-accent, var(--accent-main));
    background: color-mix(in srgb, var(--component-bg, var(--bg-input)) 84%, var(--bg-panel));
    transform: translateY(-1px);
}

.component-item-dragging {
    opacity: 0.72;
    transform: translateY(-1px) scale(0.99);
}

.component-icon {
    display: flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: color-mix(in srgb, var(--component-bg, var(--bg-input)) 64%, var(--bg-panel));
    color: var(--component-accent, var(--accent-text));
}

.variable-library-item {
    --component-bg: color-mix(in srgb, var(--accent-bg) 42%, var(--bg-input));
    --component-border: color-mix(in srgb, var(--accent-main) 24%, var(--border-color));
    --component-accent: var(--accent-text);
}

.library-tab {
    height: 24px;
    border-radius: 6px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    transition: background-color 0.18s ease, color 0.18s ease;
}

.library-tab:hover,
.library-tab.active {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.field-label {
    display: block;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
}

.field,
.textarea {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-main);
    font-size: 12px;
    outline: none;
}

.field {
    height: 34px;
    padding: 0 10px;
}

.textarea {
    min-height: 150px;
    resize: vertical;
    padding: 9px 10px;
    line-height: 1.6;
}

.field:focus,
.textarea:focus {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 16%, transparent);
}

.empty-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 55%, transparent);
    color: var(--text-muted);
    font-size: 13px;
}

.profile-template-drop-zone {
    display: flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 35%, transparent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.profile-template-drop-zone[data-active="true"] {
    border-color: var(--accent-main);
    background: var(--accent-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 35%, transparent);
}

.variable-chip {
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    border-radius: 5px;
    background: var(--accent-bg);
    padding: 3px 7px;
    color: var(--accent-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
}

.variable-chip:hover {
    border-color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-bg) 65%, var(--bg-hover));
}

.source-preview {
    background: var(--source-bg);
}

.preview-dialog-content {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
    gap: 14px;
}

.preview-variable-pane,
.preview-message-pane {
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-input));
}

.preview-variable-pane {
    overflow: auto;
    padding: 12px;
}

.preview-message-pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px;
}

.preview-summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
}

.preview-summary-card {
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 10px 12px;
}

.preview-summary-label {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
}

.preview-summary-value {
    margin-top: 4px;
    overflow: hidden;
    color: var(--text-main);
    font-size: 20px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preview-section {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    padding: 12px;
}

.preview-section + .preview-section {
    margin-top: 12px;
}

.preview-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
}

.preview-message-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    overflow: auto;
    padding-right: 4px;
}

.preview-message-card {
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 10px;
}

.preview-message-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-main);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.65;
}
</style>
