import type { MarkdownStudioEditorHandle } from "nbook/app/composables/useMarkdownStudioController";

type MarkdownStudioSyncController = {
    markdown: Ref<string>;
    activeEditor: Ref<"source" | "preview" | null>;
    editorsLocked: ComputedRef<boolean>;
    commitPreviewChange: (markdown: string) => void;
    commitSourceChange: (markdown: string) => void;
    registerSourceHandle: (handle: MarkdownStudioEditorHandle | null) => void;
    registerPreviewHandle: (handle: MarkdownStudioEditorHandle | null) => void;
    setStatusText?: (text: string) => void;
};

type UseMarkdownStudioSyncOptions = {
    controller: MarkdownStudioSyncController;
    sourceEditorRef: Ref<MarkdownStudioEditorHandle | null>;
    previewEditorRef: Ref<MarkdownStudioEditorHandle | null>;
};

/**
 * 协调源码编辑器与预览编辑器之间的显式同步。
 */
export const useMarkdownStudioSync = (options: UseMarkdownStudioSyncOptions) => {
    const {t} = useI18n();
    let pendingEditorSync: "source" | "preview" | null = null;
    let pendingMarkdown = "";

    /**
     * 把一份 Markdown 显式推送到两个编辑器。
     */
    const syncEditors = (markdown: string, skip?: "source" | "preview" | null): void => {
        if (skip !== "preview") {
            updateEditor("preview", markdown);
        }
        if (skip !== "source") {
            updateEditor("source", markdown);
        }
    };

    /**
     * 外部同步不能把输入事件链打断；源码模式下用户可能输入临时不完整的 Markdown。
     */
    const updateEditor = (target: "source" | "preview", markdown: string): void => {
        const handle = target === "source" ? options.sourceEditorRef.value : options.previewEditorRef.value;
        if (!handle) {
            return;
        }

        try {
            handle.update(markdown);
        } catch (error) {
            console.warn(`[MarkdownStudio] ${target} editor sync failed`, error);
            options.controller.setStatusText?.(target === "preview"
                ? t("markdownStudio.workbench.previewSyncFailed")
                : t("markdownStudio.workbench.sourceSyncFailed"));
        }
    };

    /**
     * 处理预览区用户输入。
     */
    const onPreviewChange = (markdown: string): void => {
        if (options.controller.activeEditor.value === "source") {
            return;
        }

        pendingEditorSync = "preview";
        pendingMarkdown = markdown;
        options.controller.commitPreviewChange(markdown);
        updateEditor("source", markdown);
    };

    /**
     * 处理源码区用户输入。
     */
    const onSourceChange = (markdown: string): void => {
        if (options.controller.activeEditor.value === "preview") {
            return;
        }

        pendingEditorSync = "source";
        pendingMarkdown = markdown;
        options.controller.commitSourceChange(markdown);
        updateEditor("preview", markdown);
    };

    watchEffect(() => {
        options.controller.registerSourceHandle(options.sourceEditorRef.value);
    });

    watchEffect(() => {
        options.controller.registerPreviewHandle(options.previewEditorRef.value);
    });

    watch([() => options.previewEditorRef.value, () => options.sourceEditorRef.value], () => {
        syncEditors(options.controller.markdown.value);
    }, { immediate: true });

    watch(() => options.controller.markdown.value, (markdown) => {
        if (pendingEditorSync && pendingMarkdown === markdown) {
            syncEditors(markdown, pendingEditorSync);
            pendingEditorSync = null;
            pendingMarkdown = "";
            return;
        }

        syncEditors(markdown);
        pendingEditorSync = null;
        pendingMarkdown = "";
    });

    return {
        onPreviewChange,
        onSourceChange,
    };
};
