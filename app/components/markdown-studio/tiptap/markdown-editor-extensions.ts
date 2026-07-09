import {Placeholder} from "@tiptap/extension-placeholder";
import {TableKit} from "@tiptap/extension-table";
import {Image} from "@tiptap/extension-image";
import {Markdown} from "@tiptap/markdown";
import {StarterKit} from "@tiptap/starter-kit";
import type {AnyExtension} from "@tiptap/core";
import {AgentHardBreak} from "nbook/app/components/novel-ide/agent/tiptap/AgentHardBreak";
import {AgentSkill} from "nbook/app/components/novel-ide/agent/tiptap/AgentSkillNode";
import type {AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {MarkdownAlign} from "nbook/app/components/markdown-studio/tiptap/MarkdownAlign";
import {MarkdownCode} from "nbook/app/components/markdown-studio/tiptap/MarkdownCode";
import {InlineComment} from "nbook/app/components/markdown-studio/tiptap/InlineComment";
import {MarkdownInlineCodeShortcut} from "nbook/app/components/markdown-studio/tiptap/MarkdownInlineCodeShortcut";
import {MarkdownLink} from "nbook/app/components/markdown-studio/tiptap/MarkdownLink";
import {MarkdownSlashCommand} from "nbook/app/components/markdown-studio/tiptap/MarkdownSlashCommand";
import {MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript, MarkdownTextColor} from "nbook/app/components/markdown-studio/tiptap/MarkdownTextMarks";
import {createFallbackWorkspaceReferenceMeta, WorkspaceReference, type WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";

export interface MarkdownSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onMenuStateChange: (state: AgentSuggestionMenuState | null) => void;
    getMenuState: () => AgentSuggestionMenuState | null;
    getActiveIndex: () => number;
    setActiveIndex: (index: number) => void;
}

export interface MarkdownEditorExtensionOptions extends MarkdownSuggestionController {
    placeholder: string;
    openReference: (target: string) => void;
    onInlineCommentSelect?: (index: number) => void;
    sourcePath?: string;
    resolveReference?: WorkspaceReferenceResolver;
    enableQuickTriggers?: boolean;
}

/**
 * 完整 Markdown 编辑器扩展组。输入输出始终是 Markdown，包含项目自定义引用、评论和对齐语法。
 */
export function createMarkdownEditorExtensions(options: MarkdownEditorExtensionOptions): AnyExtension[] {
    return [
        Markdown,
        StarterKit.configure({
            code: false,
            hardBreak: false,
            link: false,
            trailingNode: false,
        }),
        TableKit,
        Image.configure({
            inline: true,
            allowBase64: false,
            HTMLAttributes: {
                class: "nb-markdown-image-node",
            },
        }),
        AgentHardBreak,
        Placeholder.configure({
            placeholder: options.placeholder,
            emptyEditorClass: "is-editor-empty",
        }),
        InlineComment.configure({
            onSelect: options.onInlineCommentSelect ?? (() => {}),
        }),
        MarkdownCode,
        MarkdownInlineCodeShortcut,
        MarkdownAlign,
        MarkdownTextColor,
        MarkdownHighlight,
        MarkdownSuperscript,
        MarkdownSubscript,
        MarkdownLink.configure({
            openOnClick: true,
            enableClickSelection: true,
            linkOnPaste: false,
        }),
        WorkspaceReference.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
            openReference: options.openReference,
            sourcePath: options.sourcePath ?? "",
            resolveReference: options.resolveReference ?? createFallbackWorkspaceReferenceMeta,
        }),
        MarkdownSlashCommand.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
        }),
        ...(options.enableQuickTriggers ? [AgentSkill.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
        })] : []),
    ];
}
