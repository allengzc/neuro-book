<script setup lang="ts">
import {EditorContent, useEditor} from "@tiptap/vue-3";
import {Extension, getTextBetween, getTextSerializersFromSchema, type Editor, type JSONContent} from "@tiptap/core";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
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
import {buildSelectionRefChip, locateSelectionRange, type InlineEditReference, type InlineEditReferenceTextRange, type SelectionRangeLocation} from "nbook/app/utils/inline-editor-selection";
import YAML from "yaml";

type PopoverDirection = "auto" | "up" | "down";

const INLINE_AI_REFERENCE_HIGHLIGHT_PLUGIN_KEY = new PluginKey<DecorationSet>("inlineAiReferenceHighlight");

const inlineAiReferenceHighlightExtension = Extension.create({
    name: "inlineAiReferenceHighlight",
    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: INLINE_AI_REFERENCE_HIGHLIGHT_PLUGIN_KEY,
                state: {
                    init: () => DecorationSet.empty,
                    apply(transaction, decorationSet) {
                        const nextDecorationSet = transaction.getMeta(INLINE_AI_REFERENCE_HIGHLIGHT_PLUGIN_KEY) as DecorationSet | undefined;
                        if (nextDecorationSet) {
                            return nextDecorationSet;
                        }
                        return transaction.docChanged
                            ? decorationSet.map(transaction.mapping, transaction.doc)
                            : decorationSet;
                    },
                },
                props: {
                    decorations(state) {
                        return INLINE_AI_REFERENCE_HIGHLIGHT_PLUGIN_KEY.getState(state) ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});

const props = withDefaults(defineProps<{
    initialValue?: string;
    visible?: boolean;
    readonly?: boolean;
    editorPreferences?: MarkdownEditorPreferences;
    placeholder?: string;
    autofocus?: boolean;
    activePath?: string;
    inlineAiReferences?: InlineEditReference[];
    inlineAiHighlightReference?: InlineEditReference | null;
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
    placeholder: "",
    autofocus: false,
    activePath: "",
    inlineAiReferences: () => [],
    inlineAiHighlightReference: null,
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
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "open-frontmatter-profile", kind: FrontmatterProfileKind): void;
    (e: "inline-comments-change", comments: MarkdownInlineCommentItem[]): void;
    (e: "inline-comment-select", index: number): void;
    (e: "inline-ai-reference", reference: InlineEditReference): void;
}>();

const {prompt} = useDialog();
const notification = useNotification();
const {t} = useI18n();
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
const popoverTeleportTarget = computed(() => wrapperRef.value?.closest(".novel-ide-theme") as HTMLElement | null);
const editorPlaceholder = computed(() => props.placeholder || t("markdownStudio.editor.placeholder"));
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
        return t("markdownStudio.editor.frontmatterObjectError");
    } catch (error) {
        return error instanceof Error ? error.message : t("markdownStudio.editor.frontmatterParseFailed");
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

/**
 * 计算正文第一行在完整 Markdown 里的行号偏移，保证 selection chip 指向真实文件行号。
 */
function frontmatterLineOffset(): number {
    if (!hasFrontmatter.value) {
        return 0;
    }
    return `---\n${frontmatterText.value.trimEnd()}\n---\n\n`.split("\n").length - 1;
}

const editor = useEditor({
    content: splitMarkdownFrontmatter(props.initialValue).body,
    contentType: "markdown",
    extensions: [
        ...createMarkdownEditorExtensions({
            placeholder: editorPlaceholder.value,
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
        inlineAiReferenceHighlightExtension,
    ],
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
                    emit("submit", {ctrlKey: event.ctrlKey, metaKey: event.metaKey});
                    return true;
                }
                if (!isSaveShortcut(event)) {
                    return false;
                }
                event.preventDefault();
                emit("save-request");
                return true;
            },
            paste: (_view, event) => {
                event.preventDefault();
                if (props.readonly) {
                    return true;
                }
                const text = event.clipboardData?.getData("text/plain") ?? "";
                if (!text) {
                    return true;
                }
                insertMarkdown(text);
                return true;
            },
        },
    },
    onCreate: ({editor: currentEditor}) => {
        syncInlineComments(currentEditor);
        refreshInlineAiReferenceHighlight(currentEditor);
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

watch(() => [props.inlineAiReferences, props.inlineAiHighlightReference, props.activePath] as const, () => {
    refreshInlineAiReferenceHighlight();
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
            hasPlainTextBeforeTrigger: suggestionMenuState.value.hasPlainTextBeforeTrigger,
        });
        const items = flattenAgentSuggestionItems(menuState.sections);
        const nextActiveIndex = items.length > 0
            ? Math.min(items.length - 1, Math.max(0, activeIndex.value))
            : 0;
        
        suggestionMenuState.value = {
            ...suggestionMenuState.value,
            title: menuState.title,
            prefix: menuState.prefix,
            sections: menuState.sections,
            items,
        };
        activeIndex.value = nextActiveIndex;
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
    nextTick(() => {
        syncInlineComments(editor.value);
        refreshInlineAiReferenceHighlight();
    });
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
    const body = await prompt(t("markdownStudio.editor.commentBody"), activeComment.body, t("markdownStudio.editor.editComment"));
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
 * 用 TipTap 选区位置推导 Markdown 行号；失败时由调用方回退到文本匹配。
 */
function locateSelectionRangeFromEditor(currentEditor: Editor): SelectionRangeLocation {
    const {from, to} = currentEditor.state.selection;
    if (from === to) {
        return {match: "unknown"};
    }
    try {
        const offset = frontmatterLineOffset();
        const startLine = offset + countMarkdownLines(serializeEditorPrefix(currentEditor, from));
        const endLine = offset + countMarkdownLines(serializeEditorPrefix(currentEditor, to));
        return {
            match: "unique",
            range: {
                startLine,
                endLine: Math.max(startLine, endLine),
            },
        };
    } catch {
        return {match: "unknown"};
    }
}

/**
 * 序列化从文档开头到指定 ProseMirror 位置的 Markdown 前缀。
 */
function serializeEditorPrefix(currentEditor: Editor, position: number): string {
    const manager = currentEditor.markdown;
    if (!manager) {
        return "";
    }
    const safePosition = Math.floor(clampNumber(position, 0, currentEditor.state.doc.content.size, 0));
    const prefixDoc = currentEditor.state.doc.cut(0, safePosition);
    return manager.serialize(prefixDoc.toJSON() as JSONContent);
}

/**
 * 统计 Markdown 片段占用的行数；空前缀仍位于第 1 行。
 */
function countMarkdownLines(markdown: string): number {
    if (!markdown) {
        return 1;
    }
    return markdown.replace(/\r\n/g, "\n").split("\n").length;
}

/**
 * 根据 PromptBar 当前 hover 的 Inline AI 引用刷新编辑器里的临时高亮。
 */
function refreshInlineAiReferenceHighlight(targetEditor?: Editor): void {
    const currentEditor = targetEditor ?? editor.value;
    if (!currentEditor) {
        return;
    }
    const decorations = buildInlineAiReferenceDecorations(
        currentEditor,
        props.inlineAiReferences,
        props.inlineAiHighlightReference,
    );
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(INLINE_AI_REFERENCE_HIGHLIGHT_PLUGIN_KEY, decorations)
        .setMeta("addToHistory", false));
}

/**
 * 将所有 PromptBar 引用映射成正文标记；hover 中的引用额外叠加背景高亮。
 */
function buildInlineAiReferenceDecorations(currentEditor: Editor, references: InlineEditReference[], highlightedReference: InlineEditReference | null | undefined): DecorationSet {
    const decorations: Decoration[] = [];

    for (const reference of references) {
        if (!inlineAiReferencePathMatches(reference.path, props.activePath)) {
            continue;
        }
        const highlighted = inlineAiReferenceEquals(reference, highlightedReference);
        const textRange = locateInlineAiReferenceText(currentEditor, reference);
        if (textRange) {
            decorations.push(Decoration.inline(textRange.from, textRange.to, {
                class: highlighted
                    ? "nb-inline-ai-reference-mark nb-inline-ai-reference-highlight"
                    : "nb-inline-ai-reference-mark",
            }));
            continue;
        }
        decorations.push(...buildInlineAiReferenceLineDecorations(currentEditor, reference, highlighted));
    }

    return DecorationSet.create(currentEditor.state.doc, decorations);
}

/**
 * 优先用 reference.text 定位具体字符范围；chip 行号只用于缩小搜索范围。
 */
function locateInlineAiReferenceText(currentEditor: Editor, reference: InlineEditReference): {from: number; to: number} | null {
    const needle = normalizeInlineAiReferenceText(reference.text);
    if (!needle) {
        return null;
    }

    const mappedText = buildInlineAiReferenceTextMap(currentEditor);
    const searchBounds = inlineAiReferenceSearchBounds(mappedText.text, reference);
    const globalIndex = bestInlineAiReferenceTextIndex(mappedText.text, needle, searchBounds, reference.textRange);
    if (globalIndex < 0) {
        return null;
    }

    const from = firstMappedPosition(mappedText.positions, globalIndex, globalIndex + needle.length);
    const to = lastMappedPosition(mappedText.positions, globalIndex, globalIndex + needle.length);
    if (from === null || to === null || from >= to) {
        return null;
    }
    return {from, to};
}

/**
 * 在重复文本中优先选择离原始选区 offset 最近的候选。
 */
function bestInlineAiReferenceTextIndex(text: string, needle: string, bounds: {from: number; to: number}, preferredRange?: InlineEditReferenceTextRange): number {
    const boundedCandidates = collectInlineAiReferenceTextIndexes(text, needle, bounds.from, bounds.to);
    if (boundedCandidates.length > 0) {
        return nearestInlineAiReferenceTextIndex(boundedCandidates, preferredRange);
    }
    const globalCandidates = collectInlineAiReferenceTextIndexes(text, needle, 0, text.length);
    if (globalCandidates.length === 0) {
        return -1;
    }
    return nearestInlineAiReferenceTextIndex(globalCandidates, preferredRange);
}

function collectInlineAiReferenceTextIndexes(text: string, needle: string, from: number, to: number): number[] {
    const indexes: number[] = [];
    const safeFrom = Math.max(0, Math.min(from, text.length));
    const safeTo = Math.max(safeFrom, Math.min(to, text.length));
    let index = text.indexOf(needle, safeFrom);
    while (index >= 0 && index + needle.length <= safeTo) {
        indexes.push(index);
        index = text.indexOf(needle, index + Math.max(1, needle.length));
    }
    return indexes;
}

function nearestInlineAiReferenceTextIndex(indexes: number[], preferredRange?: InlineEditReferenceTextRange): number {
    if (!preferredRange) {
        return indexes[0] ?? -1;
    }
    const targetOffset = Math.max(0, Math.floor(preferredRange.startOffset));
    return indexes.reduce((nearest, candidate) => {
        return Math.abs(candidate - targetOffset) < Math.abs(nearest - targetOffset)
            ? candidate
            : nearest;
    }, indexes[0] ?? -1);
}

/**
 * 生成“正文纯文本 offset -> ProseMirror position”的映射，供精确 inline decoration 使用。
 */
function buildInlineAiReferenceTextMap(currentEditor: Editor): {text: string; positions: Array<number | null>} {
    const textParts: string[] = [];
    const positions: Array<number | null> = [];
    let firstBlock = true;

    currentEditor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) {
            return;
        }
        if (!firstBlock) {
            textParts.push("\n");
            positions.push(null);
        }
        firstBlock = false;
        node.descendants((child, childPosition) => {
            if (!child.isText) {
                return;
            }
            const text = child.text ?? "";
            const absoluteStart = position + 1 + childPosition;
            for (let index = 0; index < text.length; index += 1) {
                textParts.push(text[index] ?? "");
                positions.push(absoluteStart + index);
            }
        });
    });

    return {text: textParts.join(""), positions};
}

function inlineAiReferenceSearchBounds(text: string, reference: InlineEditReference): {from: number; to: number} {
    if (!reference.range) {
        return {from: 0, to: text.length};
    }
    const bodyStartLine = Math.max(1, Math.floor(reference.range.startLine) - frontmatterLineOffset());
    const bodyEndLine = Math.max(bodyStartLine, Math.floor(reference.range.endLine) - frontmatterLineOffset());
    return {
        from: textOffsetAtLine(text, bodyStartLine),
        to: textOffsetAtLine(text, bodyEndLine + 1),
    };
}

function textOffsetAtLine(text: string, line: number): number {
    if (line <= 1) {
        return 0;
    }
    let currentLine = 1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== "\n") {
            continue;
        }
        currentLine += 1;
        if (currentLine === line) {
            return index + 1;
        }
    }
    return text.length;
}

function firstMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = from; index < to; index += 1) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position;
        }
    }
    return null;
}

function lastMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = to - 1; index >= from; index -= 1) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position + 1;
        }
    }
    return null;
}

/**
 * 记录选区在正文纯文本中的 offset，解决同一行重复文本的高亮歧义。
 */
function locateInlineAiSelectionTextRange(currentEditor: Editor): InlineEditReferenceTextRange | undefined {
    const {from, to} = currentEditor.state.selection;
    if (from === to) {
        return undefined;
    }
    const mappedText = buildInlineAiReferenceTextMap(currentEditor);
    const startOffset = firstTextOffsetAtOrAfter(mappedText.positions, from, to);
    const endOffset = lastTextOffsetBefore(mappedText.positions, from, to);
    if (startOffset === null || endOffset === null || startOffset >= endOffset) {
        return undefined;
    }
    return {startOffset, endOffset};
}

function firstTextOffsetAtOrAfter(positions: Array<number | null>, fromPosition: number, toPosition: number): number | null {
    for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index] ?? null;
        if (position !== null && position >= fromPosition && position < toPosition) {
            return index;
        }
    }
    return null;
}

function lastTextOffsetBefore(positions: Array<number | null>, fromPosition: number, toPosition: number): number | null {
    for (let index = positions.length - 1; index >= 0; index -= 1) {
        const position = positions[index] ?? null;
        if (position !== null && position >= fromPosition && position < toPosition) {
            return index + 1;
        }
    }
    return null;
}

/**
 * 精确文本无法匹配时，退回到行号文本块标记，避免引用提示完全消失。
 */
function buildInlineAiReferenceLineDecorations(currentEditor: Editor, reference: InlineEditReference, highlighted: boolean): Decoration[] {
    if (!reference.range) {
        return [];
    }
    const targetStartLine = Math.max(1, Math.floor(reference.range.startLine));
    const targetEndLine = Math.max(targetStartLine, Math.floor(reference.range.endLine));
    const lineOffset = frontmatterLineOffset();
    const decorations: Decoration[] = [];

    currentEditor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) {
            return;
        }
        const blockFrom = position + 1;
        const blockTo = position + node.nodeSize - 1;
        const blockStartLine = lineOffset + countMarkdownLines(serializeEditorPrefix(currentEditor, blockFrom));
        const blockEndLine = lineOffset + countMarkdownLines(serializeEditorPrefix(currentEditor, blockTo));
        if (blockEndLine < targetStartLine || blockStartLine > targetEndLine) {
            return;
        }
        decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: highlighted
                ? "nb-inline-ai-reference-mark nb-inline-ai-reference-highlight"
                : "nb-inline-ai-reference-mark",
        }));
    });

    return decorations;
}

/**
 * 比较 PromptBar 引用路径和当前打开路径，兼容 Project Workspace 前缀差异。
 */
function inlineAiReferencePathMatches(referencePath: string, currentPath: string): boolean {
    const normalizedReferencePath = normalizeInlineAiReferencePath(referencePath);
    const normalizedCurrentPath = normalizeInlineAiReferencePath(currentPath);
    if (!normalizedReferencePath || !normalizedCurrentPath) {
        return false;
    }
    return normalizedReferencePath === normalizedCurrentPath
        || normalizedReferencePath.endsWith(`/${normalizedCurrentPath}`)
        || normalizedCurrentPath.endsWith(`/${normalizedReferencePath}`);
}

function normalizeInlineAiReferencePath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function normalizeInlineAiReferenceText(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

function inlineAiReferenceEquals(reference: InlineEditReference, other: InlineEditReference | null | undefined): boolean {
    if (!other) {
        return false;
    }
    return reference.ref === other.ref
        && reference.path === other.path
        && reference.text === other.text;
}

/**
 * 把当前选区加入 Inline AI 引用。
 */
function addAiReferenceFromSelection(): void {
    const currentEditor = editor.value;
    const path = props.activePath.trim();
    if (!path) {
        notification.warning(t("markdownStudio.editor.currentPathMissing"));
        return;
    }

    const text = selectedClipboardText().trim();
    if (!text) {
        notification.warning(t("markdownStudio.editor.selectBodyFirst"));
        return;
    }

    const locatedFromEditor: SelectionRangeLocation = currentEditor ? locateSelectionRangeFromEditor(currentEditor) : {match: "unknown"};
    const located = locatedFromEditor.match === "unique"
        ? locatedFromEditor
        : locateSelectionRange(getMarkdown(), text);
    const textRange = currentEditor ? locateInlineAiSelectionTextRange(currentEditor) : undefined;
    emit("inline-ai-reference", {
        ref: buildSelectionRefChip({
            path,
            range: located.range,
        }),
        path,
        range: located.range,
        textRange,
        match: located.match,
        text,
    });
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
        notification.warning(t("markdownStudio.editor.copyFailed"), {title: t("markdownStudio.editor.copyFailedTitle")});
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
        notification.warning(t("markdownStudio.editor.cutFailed"), {title: t("markdownStudio.editor.cutFailedTitle")});
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
        notification.warning(t("markdownStudio.editor.pasteFailed"), {title: t("markdownStudio.editor.pasteFailedTitle")});
    }
}

/**
 * 插入 Markdown 链接。
 */
async function insertLinkFromMenu(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const label = await prompt(t("markdownStudio.editor.linkText"), selectedText() || "title", t("markdownStudio.editor.insertLink"));
    if (label === null) {
        return;
    }
    const url = await prompt(t("markdownStudio.editor.linkUrl"), "https://", t("markdownStudio.editor.insertLink"));
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
    const url = await prompt(t("markdownStudio.editor.imageUrl"), "", t("markdownStudio.editor.insertImage"));
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
    const body = await prompt(t("markdownStudio.editor.commentBody"), "", t("markdownStudio.editor.addComment"));
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
        {label: t("markdownStudio.editor.menuSave"), iconClass: "i-lucide-save", shortcut: "Ctrl+S", action: () => emit("save-request")},
        {separator: true},
        {label: t("markdownStudio.editor.menuUndo"), iconClass: "i-lucide-undo-2", shortcut: "Ctrl+Z", disabled: writeDisabled, action: undo},
        {label: t("markdownStudio.editor.menuRedo"), iconClass: "i-lucide-redo-2", shortcut: "Ctrl+Y", disabled: writeDisabled, action: redo},
        {separator: true},
        {label: t("markdownStudio.editor.menuCut"), iconClass: "i-lucide-scissors", shortcut: "Ctrl+X", disabled: writeDisabled || selectionDisabled, action: () => void cutSelection()},
        {label: t("markdownStudio.editor.menuCopy"), iconClass: "i-lucide-copy", shortcut: "Ctrl+C", disabled: selectionDisabled, action: () => void copySelection()},
        {label: t("markdownStudio.editor.menuPaste"), iconClass: "i-lucide-clipboard-paste", shortcut: "Ctrl+V", disabled: writeDisabled, action: () => void pasteText()},
        {separator: true},
        {label: t("markdownStudio.editor.menuInsertReference"), iconClass: "i-lucide-at-sign", disabled: writeDisabled, action: openReferenceMenuFromContext},
        {label: t("markdownStudio.editor.menuInsertLink"), iconClass: "i-lucide-link", disabled: writeDisabled, action: () => void insertLinkFromMenu()},
        {label: t("markdownStudio.editor.menuInsertImage"), iconClass: "i-lucide-image", disabled: writeDisabled, action: () => void insertImageFromMenu()},
        {label: t("markdownStudio.editor.menuAddComment"), iconClass: "i-lucide-message-square-plus", disabled: writeDisabled || selectionDisabled, action: () => void addCommentFromMenu()},
        ...(activeComment ? [
            {label: t("markdownStudio.editor.menuEditComment"), iconClass: "i-lucide-message-square-text", disabled: writeDisabled, action: () => void editActiveComment()},
            {label: t("markdownStudio.editor.menuDeleteComment"), iconClass: "i-lucide-message-square-x", disabled: writeDisabled, action: deleteActiveComment},
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
            @add-ai-reference="addAiReferenceFromSelection"
        />

        <ReferenceSelectorPopover
            v-if="menuVisible && suggestionMenuState"
            :title="suggestionMenuState.title"
            :prefix="suggestionMenuState.prefix"
            :sections="suggestionMenuState.sections"
            :active-index="activeIndex"
            :anchor-element="wrapperRef"
            :anchor-rect="suggestionMenuState.anchorRect"
            :teleport-target="popoverTeleportTarget"
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
    background: var(--editor-bg);
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
    background: var(--editor-bg);
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
    color: var(--source-text);
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
    background: color-mix(in srgb, var(--source-bg) 88%, var(--shadow-color) 12%);
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
    color: var(--accent-text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    cursor: pointer;
}

:deep(.nb-markdown-editor a:hover) {
    color: color-mix(in srgb, var(--accent-text) 82%, var(--text-main));
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
    text-decoration-color: var(--status-warning);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
}

:deep(.nb-inline-comment-mark.is-active) {
    background: var(--status-warning-bg);
    box-shadow: inset 0 0 0 1px var(--status-warning-border);
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
    border: 1px solid var(--status-warning);
    border-radius: 999px;
    background: var(--editor-bg);
    color: var(--status-warning);
    font-size: 0.52em;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
}

:deep(.nb-inline-comment-mark.is-active[data-inline-comment-index])::after {
    background: var(--status-warning);
    color: var(--text-inverse);
}

:deep(.nb-workspace-reference-node) {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin: 0 0.1rem;
    vertical-align: baseline;
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

:deep(.nb-inline-ai-reference-mark) {
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: color-mix(in srgb, var(--accent-main) 78%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    border-radius: 3px;
}

:deep(.nb-inline-ai-reference-highlight) {
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent-main) 18%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 20%, transparent);
    transition: background 120ms ease, box-shadow 120ms ease;
}
</style>
