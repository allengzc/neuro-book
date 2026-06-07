<script setup lang="ts">
import {EditorContent, useEditor} from "@tiptap/vue-3";
import type {Content, Editor} from "@tiptap/core";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {createPlainReferenceTextExtensions} from "nbook/app/components/common/form/tiptap/plain-reference-text-extensions";
import {
    parsePlainReferenceInlineContent,
    parsePlainReferenceText,
    serializePlainReferenceDoc,
    type PlainTextProseMirrorNode,
} from "nbook/app/utils/plain-reference-text";

const props = withDefaults(defineProps<{
    modelValue: string;
    placeholder?: string;
    minHeight?: number;
    maxHeight?: number;
    readonly?: boolean;
    borderless?: boolean;
    submitOnEnter?: boolean;
    enableQuickTriggers?: boolean;
    matchPopoverWidth?: boolean;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>(), {
    placeholder: "",
    minHeight: 44,
    maxHeight: 150,
    readonly: false,
    borderless: false,
    submitOnEnter: false,
    enableQuickTriggers: false,
    matchPopoverWidth: false,
    menuRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    onSkillTriggerStart: () => {},
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const bodyRef = ref<HTMLDivElement | null>(null);
const suggestionMenuState = ref<AgentSuggestionMenuState | null>(null);
const activeIndex = ref(0);
const syncingFromOutside = ref(false);
const editorSnapshot = ref(props.modelValue);
const heightPx = ref(props.minHeight);
const overflowing = ref(false);
const skillTriggerStarted = ref(false);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | null = null;

const menuVisible = computed(() => Boolean(suggestionMenuState.value && suggestionMenuState.value.items.length > 0));
const skillTriggerActive = computed(() => suggestionMenuState.value?.contextKind === "skill");
const popoverTeleportTarget = computed(() => wrapperRef.value?.closest(".novel-ide-theme") as HTMLElement | null);
const rootClass = computed(() => props.borderless ? "reference-plain-text-editor--borderless" : "");
const bodyStyle = computed(() => ({
    height: `${heightPx.value}px`,
    minHeight: `${props.minHeight}px`,
    maxHeight: `${props.maxHeight}px`,
    overflowY: overflowing.value ? "auto" as const : "hidden" as const,
}));

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
 * 当前编辑器内容序列化为普通文本。
 */
function readEditorText(currentEditor: Editor | null | undefined): string {
    const json = currentEditor?.state.doc.toJSON() as PlainTextProseMirrorNode | undefined;
    return json ? serializePlainReferenceDoc(json) : editorSnapshot.value;
}

const editor = useEditor({
    content: parsePlainReferenceText(props.modelValue) as Content,
    extensions: createPlainReferenceTextExtensions({
        placeholder: props.placeholder,
        resolveMenu: props.resolveMenu,
        onMenuStateChange: syncMenuState,
        getMenuState: () => suggestionMenuState.value,
        getActiveIndex: () => activeIndex.value,
        setActiveIndex: (index: number) => {
            activeIndex.value = index;
        },
        enableQuickTriggers: props.enableQuickTriggers,
    }),
    editable: !props.readonly,
    editorProps: {
        attributes: {
            class: "reference-plain-text-editor__prosemirror outline-none",
            spellcheck: "false",
        },
        handleDOMEvents: {
            focus: () => {
                emit("focus");
                return false;
            },
            blur: () => {
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
                return false;
            },
            paste: (_view, event) => {
                const text = event.clipboardData?.getData("text/plain") ?? "";
                event.preventDefault();
                if (!text) {
                    return true;
                }
                insertTextIntoEditor(editor.value, text);
                return true;
            },
        },
    },
    onCreate: () => {
        scheduleHeightMeasure();
    },
    onUpdate: ({editor: currentEditor}) => {
        scheduleHeightMeasure();
        if (syncingFromOutside.value) {
            return;
        }
        const nextValue = readEditorText(currentEditor);
        editorSnapshot.value = nextValue;
        emit("update:modelValue", nextValue);
    },
    onTransaction: () => {
        scheduleHeightMeasure();
    },
});

watch(() => props.modelValue, (nextValue) => {
    if (nextValue === editorSnapshot.value) {
        return;
    }
    editorSnapshot.value = nextValue;
    syncingFromOutside.value = true;
    editor.value?.commands.setContent(parsePlainReferenceText(nextValue) as Content, {
        emitUpdate: false,
    });
    scheduleHeightMeasure();
    queueMicrotask(() => {
        syncingFromOutside.value = false;
    });
});

watch(() => props.readonly, (readonly) => {
    editor.value?.setEditable(!readonly);
});

watch(() => [props.minHeight, props.maxHeight], () => {
    scheduleHeightMeasure();
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

onMounted(() => {
    if (bodyRef.value) {
        resizeObserver = new ResizeObserver(() => {
            scheduleHeightMeasure();
        });
        resizeObserver.observe(bodyRef.value);
    }
    scheduleHeightMeasure();
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (resizeFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = null;
});

/**
 * 聚焦编辑器。
 */
function focus(): void {
    editor.value?.commands.focus();
}

/**
 * 在当前光标插入纯文本，并把系统 token 转成 chip。
 */
function insertText(text: string): void {
    insertTextIntoEditor(editor.value, text);
}

/**
 * 获取当前纯文本。
 */
function getText(): string {
    return readEditorText(editor.value);
}

/**
 * 使用菜单项 id 选择当前 suggestion item。
 */
function selectMenuItem(itemId: string): void {
    const state = suggestionMenuState.value;
    const item = state?.items.find((current) => current.id === itemId);
    if (!state || !item || item.disabled) {
        return;
    }
    state.command(item);
}

/**
 * 测量内容高度，保持输入框随内容增长。
 */
function scheduleHeightMeasure(): void {
    if (resizeFrame !== null) {
        return;
    }
    if (typeof requestAnimationFrame === "function") {
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            measureHeight();
        });
        return;
    }
    nextTick(() => {
        resizeFrame = null;
        measureHeight();
    });
}

function measureHeight(): void {
    const body = bodyRef.value;
    if (!body) {
        heightPx.value = props.minHeight;
        overflowing.value = false;
        return;
    }

    const previousHeight = body.style.height;
    const previousOverflowY = body.style.overflowY;
    body.style.height = "auto";
    body.style.overflowY = "hidden";
    const wantedHeight = Math.ceil(body.scrollHeight);
    body.style.height = previousHeight;
    body.style.overflowY = previousOverflowY;

    const boundedHeight = Math.min(Math.max(wantedHeight, props.minHeight), props.maxHeight);
    heightPx.value = boundedHeight;
    overflowing.value = wantedHeight > props.maxHeight;
}

function insertTextIntoEditor(currentEditor: Editor | null | undefined, text: string): void {
    if (!currentEditor || props.readonly) {
        return;
    }
    const content = parsePlainReferenceInlineContent(text) as Content;
    if (Array.isArray(content) && content.length === 0) {
        return;
    }
    currentEditor.chain().focus().insertContent(content).run();
    scheduleHeightMeasure();
}

defineExpose({
    focus,
    insertText,
    getText,
});
</script>

<template>
    <!-- 通用纯文本引用编辑器 -->
    <div
        ref="wrapperRef"
        class="reference-plain-text-editor relative overflow-visible"
        :class="[rootClass, props.borderless ? 'border-none bg-[var(--bg-panel)] shadow-none' : 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]']"
    >
        <div ref="bodyRef" class="reference-plain-text-editor__body" :style="bodyStyle">
            <EditorContent v-if="editor" :editor="editor" class="reference-plain-text-editor__content" />
        </div>

        <ReferenceSelectorPopover
            v-if="menuVisible && suggestionMenuState"
            :title="suggestionMenuState.title"
            :prefix="suggestionMenuState.prefix"
            :sections="suggestionMenuState.sections"
            :active-index="activeIndex"
            :anchor-element="wrapperRef"
            :anchor-rect="suggestionMenuState.anchorRect"
            :teleport-target="popoverTeleportTarget"
            direction="auto"
            density="compact"
            :match-anchor-width="props.matchPopoverWidth"
            @select="selectMenuItem"
            @hover="activeIndex = $event"
        />
    </div>
</template>

<style scoped>
.reference-plain-text-editor {
    --plain-reference-padding: 6px 9px;
    --plain-reference-font-size: 0.8125rem;
    --plain-reference-line-height: 1.45rem;
    border-radius: 8px;
}

.reference-plain-text-editor--borderless {
    border: none !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
    background: var(--bg-panel) !important;
    box-shadow: none !important;
}

.reference-plain-text-editor__body {
    background: var(--bg-panel);
    border-radius: inherit;
}

.reference-plain-text-editor__content {
    min-height: 100%;
}

:deep(.reference-plain-text-editor__prosemirror) {
    min-height: 100%;
    margin: 0;
    padding: var(--plain-reference-padding);
    color: var(--text-main);
    font-family: inherit;
    font-size: var(--plain-reference-font-size);
    line-height: var(--plain-reference-line-height);
    white-space: pre-wrap;
    word-break: break-word;
}

:deep(.reference-plain-text-editor__prosemirror p) {
    margin: 0 0 0.2rem;
}

:deep(.reference-plain-text-editor__prosemirror p:last-child) {
    margin-bottom: 0;
}

:deep(.reference-plain-text-editor__prosemirror p.is-editor-empty:first-child::before) {
    float: left;
    height: 0;
    color: var(--text-muted);
    content: attr(data-placeholder);
    pointer-events: none;
}

:deep(.nb-plain-reference-node) {
    display: inline-flex;
    vertical-align: baseline;
}

:deep(.nb-plain-reference-node .nb-reference-chip),
:deep(.nb-agent-skill-node .nb-skill-chip) {
    vertical-align: baseline;
}
</style>
