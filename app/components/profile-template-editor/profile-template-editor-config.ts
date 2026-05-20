import type {
    ComponentLibraryGroup,
    ComponentLibraryItem,
    LibraryVariableItem,
    SelectOption,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

export const componentLibrary: ComponentLibraryItem[] = [
    {type: "HistorySet", label: "HistorySet", description: "长期记忆集合。适合放会话历史、用户偏好、项目背景等需要进入长期历史的上下文。", iconClass: "i-lucide-archive", group: "sets"},
    {type: "DynamicSet", label: "DynamicSet", description: "本轮临时上下文集合。适合放只影响当前模型调用、不写入长期历史的说明或材料。", iconClass: "i-lucide-panel-top", group: "sets"},
    {type: "AppendingSet", label: "AppendingSet", description: "输出追加集合。适合把运行后产生的消息追加到历史尾部，用于沉淀结果或后续追踪。", iconClass: "i-lucide-panel-bottom", group: "sets"},
    {type: "Message", label: "Message", description: "普通消息节点。可编辑 role 与正文，常用于 system / user / assistant 提示词片段。", iconClass: "i-lucide-message-square", group: "messages"},
    {type: "AIMessage", label: "AIMessage", description: "Assistant 消息节点。用于在预览中表达模型回复，可包含 ToolCall 子节点，适合调试工具调用结构。", iconClass: "i-lucide-sparkles", group: "messages"},
    {type: "ToolCall", label: "ToolCall", description: "工具调用节点。必须放在 AIMessage 内，包含工具名与 JSON 参数，用于预览 assistant tool calls。", iconClass: "i-lucide-wrench", group: "messages"},
    {type: "Reminder", label: "Reminder", description: "提醒节点。用于注入可恢复的提醒内容，适合周期检查、延迟任务和状态回看。", iconClass: "i-lucide-bell-ring", group: "flow"},
    {type: "Watch", label: "Watch", description: "监听节点。观察指定变量或路径的变化，并在变化时补充上下文说明。", iconClass: "i-lucide-eye", group: "flow"},
    {type: "If", label: "If", description: "条件分支容器。只有 condition 成立时才渲染子节点，适合做模式开关和运行时分支。", iconClass: "i-lucide-git-branch", group: "flow"},
    {type: "ActivatedSkills", label: "ActivatedSkills", description: "激活技能内容。把本轮启用的 skill 文本注入 prompt，通常由运行时维护。", iconClass: "i-lucide-sparkles", group: "privileged"},
    {type: "SkillCatalog", label: "SkillCatalog", description: "技能目录节点。展示可用 skill 列表，帮助模型理解当前可调用的工作流能力。", iconClass: "i-lucide-library", group: "privileged"},
];

export const groupLabels: Record<ComponentLibraryGroup, string> = {
    all: "全部",
    sets: "集合",
    messages: "消息",
    flow: "流程控制",
    variables: "变量与引用",
    privileged: "特权节点",
};

export const inspectorTabs: Array<{value: "source" | "props" | "variables" | "runtime" | "agent"; label: string}> = [
    {value: "source", label: "源码"},
    {value: "props", label: "属性面板"},
    {value: "variables", label: "变量面板"},
    {value: "runtime", label: "运行时变量"},
    {value: "agent", label: "Agent"},
];

export const componentGroupTabs: Array<{value: ComponentLibraryGroup; label: string}> = [
    {value: "all", label: "全部"},
    {value: "messages", label: "消息"},
    {value: "sets", label: "集合"},
    {value: "flow", label: "流程控制"},
    {value: "variables", label: "变量"},
    {value: "privileged", label: "工具"},
];

export const roleOptions: SelectOption[] = [
    {value: "system", label: "system"},
    {value: "human", label: "human"},
    {value: "assistant", label: "assistant"},
];

export const toolStatusOptions: SelectOption[] = [
    {value: "drafting", label: "drafting"},
    {value: "running", label: "running"},
    {value: "success", label: "success"},
    {value: "error", label: "error"},
];

export const sourceOptions: SelectOption[] = [
    {value: "context", label: "context"},
    {value: "input", label: "input"},
];

export const libraryVariableItems: LibraryVariableItem[] = [
    {label: "变量引用", description: "插入运行时变量，如 ${scope.time.now}", value: "${scope.time.now}", iconClass: "i-lucide-braces"},
    {label: "变量", description: "定义或查看运行时变量", value: "${scope.studio.workspace}", iconClass: "i-lucide-triangle"},
];

export const sourceEditorPreferences = {
    ...DEFAULT_MONACO_EDITOR_PREFERENCES,
    fontSize: 12,
    lineHeight: 24,
    minimapEnabled: false,
    wordWrap: false,
};
