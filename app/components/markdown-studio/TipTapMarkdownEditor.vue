<script setup lang="ts">
import {EditorContent, useEditor} from "@tiptap/vue-3";
import {getTextBetween, getTextSerializersFromSchema, type Editor} from "@tiptap/core";
import {flattenAgentSuggestionItems, type AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import MarkdownSelectionMenu from "nbook/app/components/markdown-studio/MarkdownSelectionMenu.vue";
import TipTapFrontmatterPanel from "nbook/app/components/markdown-studio/TipTapFrontmatterPanel.vue";
import type {MarkdownFormatCommand, MarkdownInlineCommentItem, MarkdownStudioEditorHandle} from "nbook/app/composables/useMarkdownStudioController";
import {createMarkdownEditorExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-editor-extensions";
import {collectInlineComments, INLINE_COMMENT_PLUGIN_KEY, type InlineCommentRange} from "nbook/app/components/markdown-studio/tiptap/InlineComment";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {refreshWorkspaceReferenceNodes, type WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, type FrontmatterProfileKind, type MarkdownEditorPreferences} from "nbook/shared/editor-workbench";
import {splitMarkdownFrontmatter} from "nbook/shared/editor-workbench";
import YAML from "yaml";

type PopoverDirection = "auto" | "up" | "down";

const props = withDefaults(defineProps<{
    initialValue?: string;
    visible?: boolean;
    readonly?: boolean;
    editorPreferences?: MarkdownEditorPreferences;
    placeholder?: string;
    autofocus?: boolean;
    activePath?: string;
    referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    showFrontmatterPanel?: boolean;
    submitOnEnter?: boolean;
    enableQuickTriggers?: boolean;
    onSkillTriggerStart?: () => void;
    popoverDirection?: PopoverDirection;
    matchPopoverWidth?: boolean;
}>(), {
    initialValue: "",
    visible: true,
    readonly: false,
    editorPreferences: () => ({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
    placeholder: "请输入 Markdown 内容...",
    autofocus: false,
    activePath: "",
    referenceRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    openReference: () => {},
    showFrontmatterPanel: true,
    submitOnEnter: false,
    enableQuickTriggers: false,
    onSkillTriggerStart: () => {},
    popoverDirection: "auto",
    matchPopoverWidth: false,
});

const emit = defineEmits<{
    (e: "change", value: string): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
    (e: "submit"): void;
    (e: "shift-tab"): void;
    (e: "open-frontmatter-profile", kind: FrontmatterProfileKind): void;
    (e: "inline-comments-change", comments: MarkdownInlineCommentItem[]): void;
    (e: "inline-comment-select", index: number): void;
}>();

const {prompt} = useDialog();
const notification = useNotification();
const wrapperRef = ref<HTMLDivElement | null>(null);
const focused = ref(false);
const syncingFromOutside = ref(false);
const suggestionMenuState = ref<AgentSuggestionMenuState | null>(null);
const activeIndex = ref(0);
const initialSplit = splitMarkdownFrontmatter(props.initialValue);
const frontmatterText = ref(initialSplit.frontmatterText);
const hasFrontmatter = ref(initialSplit.hasFrontmatter);
const frontmatterOpen = ref(false);
const editorSnapshot = ref(props.initialValue);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const skillTriggerStarted = ref(false);
const menuVisible = computed(() => Boolean(suggestionMenuState.value && suggestionMenuState.value.items.length > 0));
const skillTriggerActive = computed(() => suggestionMenuState.value?.contextKind === "skill");
const editorPreferenceStyle = computed(() => {
    const preferences = props.editorPreferences;
    const fontSize = clampNumber(preferences.fontSize, 12, 28, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontSize);
    const lineHeight = clampNumber(preferences.lineHeight, 1.2, 2.6, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.lineHeight);
    const contentWidth = clampNumber(preferences.contentWidth, 520, 1280, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.contentWidth);
    const paragraphIndent = preferences.paragraphIndentEnabled
        ? `${clampNumber(preferences.paragraphIndentEm, 0, 4, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEm)}em`
        : "0em";

    return {
        "--nb-markdown-editor-font-family": preferences.fontFamily || DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontFamily,
        "--nb-markdown-editor-font-size": `${fontSize}px`,
        "--nb-markdown-editor-line-height": `${lineHeight}`,
        "--nb-markdown-editor-content-width": `${contentWidth}px`,
        "--nb-markdown-editor-paragraph-indent": paragraphIndent,
    };
});

/**
 * TipTap Markdown 编辑器。
 * 输入输出始终是完整 Markdown；frontmatter 在顶部 YAML 区编辑，正文交给 TipTap。
 */
function composeMarkdown(body: string): string {
    if (!hasFrontmatter.value) {
        return body;
    }
    return `---\n${frontmatterText.value.trimEnd()}\n---\n\n${body}`;
}

/**
 * 校验 YAML 结构；错误只提示，不阻止用户继续修复。
 */
const frontmatterError = computed(() => {
    if (!hasFrontmatter.value || !frontmatterText.value.trim()) {
        return "";
    }
    try {
        const parsed = YAML.parse(frontmatterText.value) as unknown;
        if (parsed === null || (typeof parsed === "object" && !Array.isArray(parsed))) {
            return "";
        }
        return "frontmatter 必须是对象";
    } catch (error) {
        return error instanceof Error ? error.message : "frontmatter 解析失败";
    }
});

/**
 * 同步引用选择菜单状态。
 */
function syncMenuState(state: AgentSuggestionMenuState | null): void {
    suggestionMenuState.value = state;
    if (!state || activeIndex.value >= state.items.length) {
        activeIndex.value = 0;
    }
}

/**
 * 获取当前 TipTap Markdown。
 */
function readEditorMarkdown(currentEditor: Editor | null | undefined): string {
    return currentEditor?.getMarkdown() ?? splitMarkdownFrontmatter(editorSnapshot.value).body;
}

const editor = useEditor({
    content: splitMarkdownFrontmatter(props.initialValue).body,
    contentType: "markdown",
    extensions: createMarkdownEditorExtensions({
        placeholder: props.placeholder,
        resolveMenu: props.resolveMenu,
        onMenuStateChange: syncMenuState,
        getMenuState: () => suggestionMenuState.value,
        getActiveIndex: () => activeIndex.value,
        setActiveIndex: (index: number) => {
            activeIndex.value = index;
        },
        openReference: props.openReference,
        onInlineCommentSelect: handleInlineCommentSelect,
        sourcePath: props.activePath,
        resolveReference: props.resolveReference,
        enableQuickTriggers: props.enableQuickTriggers,
    }),
    editable: !props.readonly,
    editorProps: {
        attributes: {
            class: "nb-markdown-editor prose-mirror-markdown h-full min-h-full outline-none",
            spellcheck: "false",
        },
        handleDOMEvents: {
            focus: () => {
                focused.value = true;
                emit("focus");
                return false;
            },
            blur: () => {
                focused.value = false;
                emit("blur");
                return false;
            },
            keydown: (_view, event) => {
                if (event.key === "Tab" && event.shiftKey) {
                    event.preventDefault();
                    emit("shift-tab");
                    return true;
                }
                if (props.submitOnEnter && event.key === "Enter" && !event.shiftKey && !menuVisible.value) {
                    event.preventDefault();
                    emit("submit");
                    return true;
                }
                if (!isSaveShortcut(event)) {
                    return false;
                }
                event.preventDefault();
                emit("save-request");
                return true;
            },
        },
    },
    onCreate: ({editor: currentEditor}) => {
        syncInlineComments(currentEditor);
    },
    onSelectionUpdate: ({editor: currentEditor}) => {
        syncInlineComments(currentEditor);
    },
    onTransaction: ({editor: currentEditor}) => {
        syncInlineComments(currentEditor);
    },
    onUpdate: ({editor: currentEditor}) => {
        const nextMarkdown = composeMarkdown(currentEditor.getMarkdown());
        editorSnapshot.value = nextMarkdown;
        syncInlineComments(currentEditor);
        if (syncingFromOutside.value || props.readonly || !props.visible || !focused.value) {
            return;
        }
        emit("change", nextMarkdown);
    },
});

watch(() => props.readonly, (readonly) => {
    editor.value?.setEditable(!readonly);
});
const frontmatterProfileKind = computed<FrontmatterProfileKind | null>(() => {
    if (!hasFrontmatter.value || frontmatterError.value) {
        return null;
    }
    try {
        const parsed = YAML.parse(frontmatterText.value) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const type = (parsed as Record<string, unknown>).type;
        if (type === "character" || type === "location" || type === "rule") {
            return type;
        }
        return null;
    } catch {
        return null;
    }
});

watch(() => props.referenceRefreshKey, () => {
    refreshWorkspaceReferenceNodes();

    if (suggestionMenuState.value) {
        const menuState = props.resolveMenu({
            kind: suggestionMenuState.value.contextKind,
            query: suggestionMenuState.value.query,
        });
        const items = flattenAgentSuggestionItems(menuState.sections);
        const activeIndex = Math.min(suggestionMenuState.value.items.length - 1, Math.max(0, activeIndex.value));
        
        suggestionMenuState.value = {
            ...suggestionMenuState.value,
            title: menuState.title,
            prefix: menuState.prefix,
            sections: menuState.sections,
            items,
        };
        // 自动纠正索引避免越界
        if (activeIndex >= items.length) {
            activeIndex.value = 0;
        }
    }
});

watch(skillTriggerActive, (active) => {
    if (active && !skillTriggerStarted.value) {
        skillTriggerStarted.value = true;
        props.onSkillTriggerStart();
        return;
    }

    if (!active) {
        skillTriggerStarted.value = false;
    }
});

/**
 * 显式更新编辑器内容。
 */
function update(markdown: string): void {
    if (markdown === editorSnapshot.value) {
        return;
    }

    const split = splitMarkdownFrontmatter(markdown);
    frontmatterText.value = split.frontmatterText;
    hasFrontmatter.value = split.hasFrontmatter;
    editorSnapshot.value = markdown;
    syncingFromOutside.value = true;
    editor.value?.commands.setContent(split.body, {
        contentType: "markdown",
        emitUpdate: false,
    });
    nextTick(() => syncInlineComments(editor.value));
    queueMicrotask(() => {
        syncingFromOutside.value = false;
    });
}

/**
 * 开始在当前 Markdown 中维护 frontmatter。
 */
function addFrontmatter(): void {
    if (props.readonly) {
        return;
    }
    hasFrontmatter.value = true;
    frontmatterText.value = frontmatterText.value.trim() || "title: \"\"";
    frontmatterOpen.value = true;
    emitFrontmatterChange();
}

/**
 * 删除 frontmatter 区块，正文保持不变。
 */
function removeFrontmatter(): void {
    if (props.readonly) {
        return;
    }
    hasFrontmatter.value = false;
    frontmatterText.value = "";
    frontmatterOpen.value = false;
    emitFrontmatterChange();
}

/**
 * 更新 YAML 文本并写回完整 Markdown。
 */
function updateFrontmatterText(value: string): void {
    frontmatterText.value = value;
    emitFrontmatterChange();
}

/**
 * frontmatter 变化时向父层提交完整 Markdown。
 */
function emitFrontmatterChange(): void {
    const nextMarkdown = composeMarkdown(readEditorMarkdown(editor.value));
    editorSnapshot.value = nextMarkdown;
    if (props.readonly || !props.visible) {
        return;
    }
    emit("change", nextMarkdown);
}

/**
 * frontmatter 编辑区获得焦点时标记为富文本侧输入源。
 */
function handleFrontmatterFocus(): void {
    focused.value = true;
    emit("focus");
}

/**
 * frontmatter 编辑区失焦时向外触发保存请求。
 */
function handleFrontmatterBlur(): void {
    focused.value = false;
    emit("blur");
}

/**
 * 聚焦富文本编辑器。
 */
function focus(): void {
    editor.value?.commands.focus();
}

/**
 * 滚动到顶部。
 */
function scrollToTop(): void {
    wrapperRef.value?.scrollTo({top: 0, behavior: "auto"});
}

/**
 * 获取合并 frontmatter 后的 Markdown。
 */
function getMarkdown(): string {
    return composeMarkdown(readEditorMarkdown(editor.value));
}

/**
 * 撤销编辑。
 */
function undo(): void {
    editor.value?.chain().focus().undo().run();
}

/**
 * 重做编辑。
 */
function redo(): void {
    editor.value?.chain().focus().redo().run();
}

/**
 * 选择当前 suggestion 菜单项。
 */
function selectMenuItem(itemId: string): void {
    const state = suggestionMenuState.value;
    const item = state?.items.find((entry) => entry.id === itemId);
    if (!state || !item) {
        return;
    }
    state.command(item);
}

/**
 * 在当前光标插入 Markdown。
 */
function insertMarkdown(markdown: string): void {
    editor.value?.chain().focus().insertContent(markdown, {contentType: "markdown"}).run();
}

/**
 * 用 Markdown 替换当前选区。
 */
function replaceSelection(markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    currentEditor.chain().focus().insertContentAt({
        from: currentEditor.state.selection.from,
        to: currentEditor.state.selection.to,
    }, markdown, {contentType: "markdown"}).run();
}

/**
 * 将 Markdown 追加到正文末尾。
 */
function appendMarkdown(markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    currentEditor.chain().focus().insertContentAt(currentEditor.state.doc.content.size, markdown, {contentType: "markdown"}).run();
}

/**
 * 给选区插入内联评论。
 */
function addComment(body: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    const {state, view} = currentEditor;
    const {from, to} = state.selection;
    if (from === to) {
        return;
    }
    const inlineComment = state.schema.marks.inlineComment;
    if (!inlineComment) {
        return;
    }
    const id = nextInlineCommentId();
    const ranges = collectInlineRangesInSelection(state.doc, from, to);
    if (ranges.length === 0) {
        return;
    }
    const tr = state.tr.removeMark(from, to, inlineComment);
    ranges.forEach((range, index) => {
        tr.addMark(range.from, range.to, inlineComment.create({
            id,
            body: index === 0 ? body : "",
        }));
    });
    tr.scrollIntoView();
    view.dispatch(tr);
    view.focus();
    emitCurrentMarkdownChange(currentEditor);
}

/**
 * 编辑当前光标所在的 inline-comment。
 */
async function editActiveComment(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const activeComment = findActiveInlineComment(editor.value);
    if (!activeComment) {
        return;
    }
    const body = await prompt("评论内容", activeComment.body, "编辑评论");
    if (body === null) {
        return;
    }
    updateInlineComment(activeComment.index, body.trim());
}

/**
 * 删除当前 inline-comment 标签，保留其内部正文。
 */
function deleteActiveComment(): void {
    if (props.readonly) {
        return;
    }
    const activeComment = findActiveInlineComment(editor.value);
    if (!activeComment) {
        return;
    }
    deleteInlineComment(activeComment.index);
}

/**
 * 将当前块包裹成对齐块。
 */
function setAlign(align: "left" | "center" | "right" | "justify"): void {
    editor.value?.chain().focus().setMarkdownAlign(align).run();
}

/**
 * 执行表单工具条暴露的常用 Markdown 格式命令。
 */
function applyMarkdownFormat(command: MarkdownFormatCommand): void {
    const currentEditor = editor.value;
    if (!currentEditor || props.readonly) {
        return;
    }
    const chain = currentEditor.chain().focus();
    if (command === "paragraph") {
        chain.setParagraph().run();
        return;
    }
    if (command === "heading-2") {
        chain.toggleHeading({level: 2}).run();
        return;
    }
    if (command === "heading-3") {
        chain.toggleHeading({level: 3}).run();
        return;
    }
    if (command === "bold") {
        chain.toggleBold().run();
        return;
    }
    if (command === "italic") {
        chain.toggleItalic().run();
        return;
    }
    if (command === "underline") {
        chain.toggleUnderline().run();
        return;
    }
    if (command === "strike") {
        chain.toggleStrike().run();
        return;
    }
    if (command === "code") {
        chain.toggleCode().run();
        return;
    }
    if (command === "bullet-list") {
        chain.toggleBulletList().run();
        return;
    }
    if (command === "ordered-list") {
        chain.toggleOrderedList().run();
        return;
    }
    if (command === "blockquote") {
        chain.toggleBlockquote().run();
        return;
    }
    chain.unsetAllMarks().clearNodes().run();
}

/**
 * 读取当前选区纯文本。
 */
function selectedText(): string {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return "";
    }
    return currentEditor.state.doc.textBetween(
        currentEditor.state.selection.from,
        currentEditor.state.selection.to,
        "\n",
    );
}

/**
 * 当前选区的剪贴板文本；引用节点输出 Markdown，避免 chip 复制为空。
 */
function selectedClipboardText(): string {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return "";
    }
    return getTextBetween(
        currentEditor.state.doc,
        {
            from: currentEditor.state.selection.from,
            to: currentEditor.state.selection.to,
        },
        {
            blockSeparator: "\n",
            textSerializers: getTextSerializersFromSchema(currentEditor.state.schema),
        },
    );
}

/**
 * 当前选区是否包含内容。
 */
function hasSelection(): boolean {
    const currentEditor = editor.value;
    return Boolean(currentEditor && currentEditor.state.selection.from !== currentEditor.state.selection.to);
}

/**
 * 使用剪贴板 API 复制当前选区。
 */
async function copySelection(): Promise<void> {
    const text = selectedClipboardText();
    if (!text) {
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        notification.warning("浏览器拒绝访问剪贴板，请使用系统快捷键复制。", {title: "复制失败"});
    }
}

/**
 * 剪切当前选区。
 */
async function cutSelection(): Promise<void> {
    if (props.readonly || !hasSelection()) {
        return;
    }
    try {
        await navigator.clipboard.writeText(selectedClipboardText());
        editor.value?.chain().focus().deleteSelection().run();
    } catch {
        notification.warning("浏览器拒绝访问剪贴板，请使用系统快捷键剪切。", {title: "剪切失败"});
    }
}

/**
 * 从剪贴板读取纯文本并插入当前光标。
 */
async function pasteText(): Promise<void> {
    if (props.readonly) {
        return;
    }
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            insertMarkdown(text);
        }
    } catch {
        notification.warning("浏览器拒绝读取剪贴板，请使用系统快捷键粘贴。", {title: "粘贴失败"});
    }
}

/**
 * 插入 Markdown 链接。
 */
async function insertLinkFromMenu(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const label = await prompt("链接文本", selectedText() || "title", "插入链接");
    if (label === null) {
        return;
    }
    const url = await prompt("链接地址", "https://", "插入链接");
    if (url === null || !url.trim()) {
        return;
    }
    replaceSelection(`[${label || "title"}](${url.trim()})`);
}

/**
 * 插入 Markdown 图片。
 */
async function insertImageFromMenu(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const url = await prompt("图片地址", "", "插入图片");
    if (url === null || !url.trim()) {
        return;
    }
    replaceSelection(`![](${url.trim()})`);
}

/**
 * 给当前选区添加评论。
 */
async function addCommentFromMenu(): Promise<void> {
    if (props.readonly || !hasSelection()) {
        return;
    }
    const body = await prompt("评论内容", "", "添加评论");
    if (body === null || !body.trim()) {
        return;
    }
    addComment(body.trim());
}

/**
 * 插入 @ 触发引用菜单。
 */
function openReferenceMenuFromContext(): void {
    if (props.readonly) {
        return;
    }
    insertMarkdown("@");
}

/**
 * 构造富文本编辑器右键菜单。
 */
function buildContextMenuItems(): ContextMenuItem[] {
    const writeDisabled = props.readonly;
    const selectionDisabled = !hasSelection();
    const activeComment = findActiveInlineComment(editor.value);
    return [
        {label: "保存", iconClass: "i-lucide-save", shortcut: "Ctrl+S", action: () => emit("save-request")},
        {separator: true},
        {label: "撤销", iconClass: "i-lucide-undo-2", shortcut: "Ctrl+Z", disabled: writeDisabled, action: undo},
        {label: "重做", iconClass: "i-lucide-redo-2", shortcut: "Ctrl+Y", disabled: writeDisabled, action: redo},
        {separator: true},
        {label: "剪切", iconClass: "i-lucide-scissors", shortcut: "Ctrl+X", disabled: writeDisabled || selectionDisabled, action: () => void cutSelection()},
        {label: "复制", iconClass: "i-lucide-copy", shortcut: "Ctrl+C", disabled: selectionDisabled, action: () => void copySelection()},
        {label: "粘贴", iconClass: "i-lucide-clipboard-paste", shortcut: "Ctrl+V", disabled: writeDisabled, action: () => void pasteText()},
        {separator: true},
        {label: "插入引用", iconClass: "i-lucide-at-sign", disabled: writeDisabled, action: openReferenceMenuFromContext},
        {label: "插入链接", iconClass: "i-lucide-link", disabled: writeDisabled, action: () => void insertLinkFromMenu()},
        {label: "插入图片", iconClass: "i-lucide-image", disabled: writeDisabled, action: () => void insertImageFromMenu()},
        {label: "添加评论", iconClass: "i-lucide-message-square-plus", disabled: writeDisabled || selectionDisabled, action: () => void addCommentFromMenu()},
        ...(activeComment ? [
            {label: "编辑评论", iconClass: "i-lucide-message-square-text", disabled: writeDisabled, action: () => void editActiveComment()},
            {label: "删除评论", iconClass: "i-lucide-message-square-x", disabled: writeDisabled, action: deleteActiveComment},
        ] : []),
    ];
}

/**
 * 打开富文本右键菜单。
 */
function openEditorContextMenu(event: MouseEvent): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    const position = currentEditor.view.posAtCoords({left: event.clientX, top: event.clientY});
    if (position) {
        const selection = currentEditor.state.selection;
        const insideSelection = selection.from <= position.pos && position.pos <= selection.to && selection.from !== selection.to;
        if (!insideSelection) {
            currentEditor.chain().focus().setTextSelection(position.pos).run();
        } else {
            currentEditor.commands.focus();
        }
    } else {
        currentEditor.commands.focus();
    }

    syncMenuState(null);
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = buildContextMenuItems();
    contextMenuVisible.value = true;
}

onMounted(() => {
    if (props.autofocus) {
        focus();
    }
});

defineExpose<MarkdownStudioEditorHandle>({
    update,
    focus,
    scrollToTop,
    undo,
    redo,
    insertMarkdown,
    replaceSelection,
    appendMarkdown,
    addComment,
    getInlineComments,
    selectInlineComment,
    activateInlineComment,
    updateInlineComment,
    deleteInlineComment,
    setAlign,
    applyMarkdownFormat,
    getValue: getMarkdown,
});

function findActiveInlineComment(currentEditor: Editor | null | undefined): {
    index: number;
    from: number;
    to: number;
    body: string;
} | null {
    if (!currentEditor) {
        return null;
    }

    const {selection} = currentEditor.state;
    const comments = getInlineComments();
    return comments.find((comment) => comment.active)
        ?? comments.find((comment) => selection.from >= comment.from && selection.from <= comment.to)
        ?? null;
}

function getInlineComments(): MarkdownInlineCommentItem[] {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return [];
    }
    const {selection} = currentEditor.state;
    return collectInlineComments(currentEditor.state.doc, selection.from, selection.to);
}

function syncInlineComments(currentEditor: Editor | null | undefined): void {
    if (!currentEditor) {
        emit("inline-comments-change", []);
        return;
    }
    const {selection} = currentEditor.state;
    emit("inline-comments-change", collectInlineComments(currentEditor.state.doc, selection.from, selection.to));
}

function findInlineCommentByIndex(index: number): MarkdownInlineCommentItem | null {
    return getInlineComments().find((comment) => comment.index === index) ?? null;
}

function selectInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment) {
        return;
    }
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(INLINE_COMMENT_PLUGIN_KEY, {activeIndex: index})
        .setMeta("addToHistory", false));
    currentEditor.view.focus();
    requestAnimationFrame(() => {
        scrollInlineCommentIntoView(currentEditor, comment.ranges[0]?.from ?? comment.from);
    });
    syncInlineComments(currentEditor);
}

function activateInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment) {
        return;
    }
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(INLINE_COMMENT_PLUGIN_KEY, {activeIndex: index})
        .setMeta("addToHistory", false));
    scrollInlineCommentIntoView(currentEditor, comment.ranges[0]?.from ?? comment.from);
    syncInlineComments(currentEditor);
}

function updateInlineComment(index: number, body: string): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment || props.readonly) {
        return;
    }
    currentEditor.chain().focus().command(({state, tr}) => {
        const inlineComment = state.schema.marks.inlineComment;
        if (!inlineComment) {
            return false;
        }
        for (const range of comment.ranges) {
            tr.removeMark(range.from, range.to, inlineComment);
        }
        comment.ranges.forEach((range, rangeIndex) => {
            tr.addMark(range.from, range.to, inlineComment.create({
                id: comment.id,
                body: rangeIndex === 0 ? body : "",
            }));
        });
        return true;
    }).run();
    emitCurrentMarkdownChange(currentEditor);
}

function deleteInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment || props.readonly) {
        return;
    }
    currentEditor.chain().focus().command(({state, tr}) => {
        const inlineComment = state.schema.marks.inlineComment;
        if (!inlineComment) {
            return false;
        }
        for (const range of comment.ranges) {
            tr.removeMark(range.from, range.to, inlineComment);
        }
        return true;
    }).run();
    emitCurrentMarkdownChange(currentEditor);
}

function handleInlineCommentSelect(index: number): void {
    emit("inline-comment-select", index);
}

function emitCurrentMarkdownChange(currentEditor: Editor | null | undefined): void {
    if (!currentEditor || props.readonly || !props.visible) {
        return;
    }
    const nextMarkdown = composeMarkdown(currentEditor.getMarkdown());
    editorSnapshot.value = nextMarkdown;
    emit("change", nextMarkdown);
    syncInlineComments(currentEditor);
}

function scrollInlineCommentIntoView(currentEditor: Editor, position: number): void {
    const domAtPos = currentEditor.view.domAtPos(position);
    const element = domAtPos.node instanceof HTMLElement
        ? domAtPos.node
        : domAtPos.node.parentElement;
    element?.scrollIntoView({block: "center", inline: "nearest", behavior: "smooth"});
}

function nextInlineCommentId(): string {
    const comments = getInlineComments();
    const maxNumericId = comments.reduce((max, comment) => {
        const id = comment.id ?? "";
        return /^\d+$/.test(id) ? Math.max(max, Number(id)) : max;
    }, 0);
    return String(maxNumericId + 1);
}

function collectInlineRangesInSelection(doc: Editor["state"]["doc"], from: number, to: number): InlineCommentRange[] {
    const ranges: InlineCommentRange[] = [];
    doc.nodesBetween(from, to, (node, position) => {
        if (!node.isTextblock) {
            return;
        }
        const blockFrom = position + 1;
        const blockTo = position + node.nodeSize - 1;
        const rangeFrom = Math.max(blockFrom, from);
        const rangeTo = Math.min(blockTo, to);
        if (rangeFrom >= rangeTo) {
            return;
        }
        ranges.push({
            from: rangeFrom,
            to: rangeTo,
            body: "",
            text: doc.textBetween(rangeFrom, rangeTo, "\n"),
        });
    });
    return ranges;
}

/**
 * 把用户输入的显示配置限制在合理区间，避免布局被异常值撑坏。
 */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(value, min), max);
}

/**
 * 判断是否是跨平台保存快捷键。
 */
function isSaveShortcut(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
}
</script>

<template>
    <div ref="wrapperRef" class="tiptap-markdown-wrapper" :style="editorPreferenceStyle">
        <!-- Markdown frontmatter 编辑区 -->
        <TipTapFrontmatterPanel
            v-if="props.showFrontmatterPanel"
            :model-value="frontmatterText"
            :has-frontmatter="hasFrontmatter"
            :open="frontmatterOpen"
            :readonly="props.readonly"
            :error="frontmatterError"
            :profile-kind="frontmatterProfileKind"
            @update:model-value="updateFrontmatterText"
            @update:open="frontmatterOpen = $event"
            @add="addFrontmatter"
            @remove="removeFrontmatter"
            @focus="handleFrontmatterFocus"
            @blur="handleFrontmatterBlur"
            @save-request="emit('save-request')"
            @open-profile="emit('open-frontmatter-profile', $event)"
        />

        <!-- Markdown 富文本正文区 -->
        <EditorContent v-if="editor" :editor="editor" class="tiptap-markdown-content" @contextmenu.prevent="openEditorContextMenu" />
        <MarkdownSelectionMenu
            v-if="editor"
            :editor="editor"
            :readonly="props.readonly"
            @insert-reference="openReferenceMenuFromContext"
            @insert-image="void insertImageFromMenu()"
            @add-comment="void addCommentFromMenu()"
        />

        <ReferenceSelectorPopover
            v-if="menuVisible && suggestionMenuState"
            :title="suggestionMenuState.title"
            :prefix="suggestionMenuState.prefix"
            :sections="suggestionMenuState.sections"
            :active-index="activeIndex"
            :anchor-element="wrapperRef"
            :anchor-rect="suggestionMenuState.anchorRect"
            density="compact"
            :direction="props.popoverDirection"
            :match-anchor-width="props.matchPopoverWidth"
            @hover="activeIndex = $event"
            @select="selectMenuItem"
        />

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="contextMenuVisible = false"
        />
    </div>
</template>

<style scoped>
.tiptap-markdown-wrapper {
    position: relative;
    height: 100%;
    min-height: 100%;
    overflow-y: auto;
    background: var(--editor-preview-bg);
}

.tiptap-markdown-content {
    min-height: 100%;
}

:deep(.nb-markdown-editor) {
    counter-reset: nb-inline-comment;
    max-width: calc(var(--nb-markdown-editor-content-width) + 48px);
    min-height: 100%;
    margin: 0 auto;
    padding: 20px 24px 32px;
    color: var(--text-main);
    font-family: var(--nb-markdown-editor-font-family);
    font-size: var(--nb-markdown-editor-font-size);
    line-height: var(--nb-markdown-editor-line-height);
    white-space: pre-wrap;
    word-break: break-word;
}

:deep(.nb-markdown-editor p) {
    margin: 0 0 0.75rem;
}

:deep(.nb-markdown-editor > p) {
    text-indent: var(--nb-markdown-editor-paragraph-indent);
}

:deep(.nb-markdown-editor h1),
:deep(.nb-markdown-editor h2),
:deep(.nb-markdown-editor h3) {
    margin: 1.2em 0 0.6em;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    font-weight: 700;
    line-height: 1.22;
}

:deep(.nb-markdown-editor h1) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.72);
}

:deep(.nb-markdown-editor h2) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.42);
}

:deep(.nb-markdown-editor h3) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.18);
}

:deep(.nb-markdown-editor strong) {
    font-weight: 700;
}

:deep(.nb-markdown-editor em) {
    font-style: italic;
}

:deep(.nb-markdown-editor u) {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
}

:deep(.nb-markdown-editor s),
:deep(.nb-markdown-editor del),
:deep(.nb-markdown-editor strike) {
    text-decoration: line-through;
}

:deep(.nb-markdown-editor sup) {
    vertical-align: super;
    font-size: 0.72em;
    line-height: 0;
}

:deep(.nb-markdown-editor sub) {
    vertical-align: sub;
    font-size: 0.72em;
    line-height: 0;
}

:deep(.nb-markdown-editor mark) {
    border-radius: 0.2em;
    padding: 0.02em 0.12em;
}

:deep(.nb-markdown-editor ul),
:deep(.nb-markdown-editor ol) {
    margin: 0 0 0.9rem;
    padding-left: 1.7em;
    white-space: normal;
}

:deep(.nb-markdown-editor ul) {
    list-style: disc;
}

:deep(.nb-markdown-editor ol) {
    list-style: decimal;
}

:deep(.nb-markdown-editor li) {
    margin: 0.25rem 0;
    padding-left: 0.15em;
}

:deep(.nb-markdown-editor li > p) {
    margin: 0.2rem 0;
    text-indent: 0;
}

:deep(.nb-markdown-editor .tableWrapper) {
    margin: 0 0 1rem;
    overflow-x: auto;
}

:deep(.nb-markdown-editor table) {
    width: 100%;
    min-width: 24rem;
    border-collapse: collapse;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--editor-preview-bg);
    table-layout: fixed;
    white-space: normal;
}

:deep(.nb-markdown-editor th),
:deep(.nb-markdown-editor td) {
    min-width: 6rem;
    border: 1px solid var(--border-color);
    padding: 0.45rem 0.6rem;
    color: var(--text-main);
    text-align: left;
    vertical-align: top;
}

:deep(.nb-markdown-editor th) {
    background: var(--source-bg);
    color: var(--text-secondary);
    font-weight: 700;
}

:deep(.nb-markdown-editor td p),
:deep(.nb-markdown-editor th p) {
    margin: 0;
    text-indent: 0;
}

:deep(.nb-markdown-editor blockquote) {
    margin: 0 0 1rem;
    border-left: 3px solid color-mix(in srgb, var(--accent-main) 56%, var(--border-color));
    padding-left: 1rem;
    color: var(--text-secondary);
    font-style: italic;
}

:deep(.nb-markdown-editor pre) {
    margin: 0 0 1rem;
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--source-bg);
    padding: 0.9rem 1rem;
    white-space: pre;
}

:deep(.nb-markdown-editor pre code) {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--source-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9em;
}

:deep(.nb-markdown-editor :not(pre) > code) {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--source-bg);
    padding: 0.04rem 0.34rem;
    color: color-mix(in srgb, var(--text-main) 90%, #92400e);
    font-family: inherit;
    font-size: 0.95em;
    line-height: 1.25;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
}

:deep(.nb-markdown-editor img.nb-markdown-image-node) {
    display: block;
    max-width: min(100%, 560px);
    max-height: 360px;
    margin: 0.25rem 0 1rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: color-mix(in srgb, var(--source-bg) 88%, #000 12%);
    object-fit: contain;
}

:deep(.nb-markdown-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    color: var(--text-muted);
}

:deep(.nb-markdown-editor a) {
    color: #2563eb;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    cursor: pointer;
}

:deep(.nb-markdown-editor a:hover) {
    color: #1d4ed8;
}

:deep(.nb-inline-comment-mark) {
    position: relative;
    border-radius: 0.18em;
    background: transparent;
    padding: 0;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    cursor: text;
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: #f59e0b;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
}

:deep(.nb-inline-comment-mark.is-active) {
    background: color-mix(in srgb, #f59e0b 20%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59e0b 42%, transparent);
}

:deep(.nb-inline-comment-mark[data-inline-comment-index])::after {
    content: attr(data-inline-comment-index);
    position: absolute;
    right: -0.52em;
    top: -0.64em;
    z-index: 1;
    display: inline-flex;
    min-width: 0.82rem;
    height: 0.82rem;
    align-items: center;
    justify-content: center;
    border: 1px solid #f59e0b;
    border-radius: 999px;
    background: var(--editor-preview-bg);
    color: #d97706;
    font-size: 0.52em;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
}

:deep(.nb-inline-comment-mark.is-active[data-inline-comment-index])::after {
    background: #f59e0b;
    color: #fff;
}

:deep(.nb-workspace-reference-node) {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin: 0 0.1rem;
    vertical-align: baseline;
}

:deep(.nb-workspace-reference-node .nb-reference-chip) {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: min(100%, 24rem);
    padding: 0.04rem 0.38rem;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 0.8rem;
    background: color-mix(in srgb, currentColor 9%, var(--bg-panel));
    color: var(--text-main);
    line-height: 1.2;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 4%, transparent);
}

:deep(.nb-workspace-reference-node .nb-reference-chip__icon) {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    opacity: 0.88;
}

:deep(.nb-workspace-reference-node .nb-reference-chip__label) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.88em;
    line-height: 1.25;
    font-weight: 600;
}

:deep(.nb-workspace-reference-node .nb-reference-chip__badge) {
    flex: none;
    padding: 0.02rem 0.26rem;
    border-radius: 0.6rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: color-mix(in srgb, currentColor 78%, var(--text-main));
    font-size: 0.58rem;
    line-height: 1.1;
    letter-spacing: 0.08em;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-chapter) {
    color: #2563eb;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-character),
:deep(.nb-workspace-reference-node .nb-reference-chip.is-lorebook) {
    color: #0f766e;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-location) {
    color: #0891b2;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-item) {
    color: #c2410c;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-rule) {
    color: #be123c;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-note) {
    color: #6b7280;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-plan) {
    color: #4f46e5;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-file) {
    color: #475569;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-folder) {
    color: #b45309;
}

:deep(.nb-workspace-reference-node .nb-reference-chip.is-broken) {
    color: #dc2626;
    text-decoration: line-through;
}

:deep(align[value="center"]) {
    display: block;
    text-align: center;
}

:deep(align[value="right"]) {
    display: block;
    text-align: right;
}

:deep(align[value="justify"]) {
    display: block;
    text-align: justify;
}
</style>
