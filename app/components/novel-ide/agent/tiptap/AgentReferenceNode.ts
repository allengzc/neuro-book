import {mergeAttributes, Node, type Editor, type NodeViewProps} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {PluginKey} from "@tiptap/pm/state";
import {VueNodeViewRenderer} from "@tiptap/vue-3";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import type {Component} from "vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {
    AgentSuggestionController,
} from "./agent-suggestion";
import {
    createAgentSuggestionRenderer,
    flattenAgentSuggestionItems,
    insertAgentSuggestionItem,
} from "./agent-suggestion";
import AgentReferenceNodeView from "./AgentReferenceNodeView.vue";
import {findAgentTriggerMatch} from "nbook/shared/reference-trigger";
import type {ReferenceKind} from "nbook/shared/reference-link";

type ReferenceTriggerKind = Extract<AgentTriggerMenuContext["kind"], "reference-root" | "chapter" | "volume" | "lorebook" | "thread" | "scene" | "plot">;

interface ReferenceToken extends MarkdownToken {
    kind?: ReferenceKind;
    targetId?: string;
    label?: string;
}

interface ReferenceSuggestionOption {
    kind: ReferenceTriggerKind;
    char: string;
    pluginKey: PluginKey;
}

interface AgentReferenceOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    suggestions: ReferenceSuggestionOption[];
}

const REFERENCE_PATTERN = /^\[([^\]]+)\]\((?:@)?(chapter|volume|lorebook|thread|scene|plot):\/\/([^)]+)\)/;

/**
 * Agent 输入器里的引用节点与引用 trigger。
 */
export const AgentReference = Node.create<AgentReferenceOptions>({
    name: "agentReference",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    priority: 1200,

    addOptions() {
        return {
            resolveMenu: () => ({
                title: "",
                prefix: "",
                sections: [],
            }),
            onMenuStateChange: () => {},
            getMenuState: () => null,
            getActiveIndex: () => 0,
            setActiveIndex: () => {},
            suggestions: [
                {kind: "reference-root", char: "@", pluginKey: new PluginKey("agent-reference-root")},
                {kind: "chapter", char: "@", pluginKey: new PluginKey("agent-reference-chapter")},
                {kind: "volume", char: "@", pluginKey: new PluginKey("agent-reference-volume")},
                {kind: "lorebook", char: "@", pluginKey: new PluginKey("agent-reference-lorebook")},
                {kind: "thread", char: "@", pluginKey: new PluginKey("agent-reference-thread")},
                {kind: "scene", char: "@", pluginKey: new PluginKey("agent-reference-scene")},
                {kind: "plot", char: "@", pluginKey: new PluginKey("agent-reference-plot")},
            ],
        };
    },

    addAttributes() {
        return {
            kind: {
                default: "chapter",
            },
            targetId: {
                default: "",
            },
            label: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-reference-kind][data-reference-target-id][data-reference-label]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    kind: element.dataset.referenceKind ?? "chapter",
                    targetId: element.dataset.referenceTargetId ?? "",
                    label: element.dataset.referenceLabel ?? "",
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-reference-kind": HTMLAttributes.kind,
            "data-reference-target-id": HTMLAttributes.targetId,
            "data-reference-label": HTMLAttributes.label,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return VueNodeViewRenderer(AgentReferenceNodeView as Component<NodeViewProps>);
    },

    markdownTokenizer: {
        name: "agentReference",
        level: "inline",
        start(src: string) {
            return src.search(/\[[^\]]+\]\((?:@)?(?:chapter|volume|lorebook|thread|scene|plot):\/\//);
        },
        tokenize(src: string) {
            const matched = REFERENCE_PATTERN.exec(src);
            if (!matched) {
                return undefined;
            }

            return {
                type: "agentReference",
                raw: matched[0],
                kind: matched[2] as ReferenceKind,
                targetId: matched[3],
                label: matched[1],
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const referenceToken = token as ReferenceToken;
        return helpers.createNode("agentReference", {
            kind: referenceToken.kind ?? "chapter",
            targetId: referenceToken.targetId ?? "",
            label: referenceToken.label ?? "",
        });
    },

    renderMarkdown: (node) => {
        const kind = (node.attrs?.kind ?? "chapter") as ReferenceKind;
        const targetId = String(node.attrs?.targetId ?? "");
        const label = String(node.attrs?.label ?? "");
        return `[${label}](${kind}://${targetId})`;
    },

    addKeyboardShortcuts() {
        return {
            Backspace: () => this.editor.state.selection.empty
                && degradeAdjacentReference(this.editor.state.selection.from, -1, this.editor),
            Delete: () => this.editor.state.selection.empty
                && degradeAdjacentReference(this.editor.state.selection.from, 1, this.editor),
        };
    },

    addProseMirrorPlugins() {
        return this.options.suggestions.map((suggestion) => {
            let currentMenuState: AgentTriggerMenuState | null = null;
            return Suggestion({
                editor: this.editor,
                pluginKey: suggestion.pluginKey,
                char: suggestion.char,
                allow: ({state, range}) => {
                    if (!state.selection.empty) {
                        return false;
                    }

                    const referenceNodeType = state.schema.nodes[this.name];
                    if (!referenceNodeType) {
                        return false;
                    }

                    const $from = state.doc.resolve(range.from);
                    return !!$from.parent.type.contentMatch.matchType(referenceNodeType);
                },
                findSuggestionMatch: ({$position}): SuggestionMatch => {
                    const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                    if (!text) {
                        return null;
                    }

                    const matched = findAgentTriggerMatch(text, suggestion.kind);
                    if (!matched) {
                        return null;
                    }

                    const textStart = $position.pos - text.length;
                    return {
                        range: {
                            from: textStart + matched.from,
                            to: textStart + matched.to,
                        },
                        query: matched.query,
                        text: matched.text,
                    };
                },
                items: ({query}) => {
                    currentMenuState = this.options.resolveMenu({
                        kind: suggestion.kind,
                        query,
                    });
                    return flattenAgentSuggestionItems(currentMenuState.sections);
                },
                render: createAgentSuggestionRenderer({
                    pluginKey: suggestion.pluginKey,
                    controller: this.options,
                    contextKind: suggestion.kind,
                    resolveMenuState: (query) => {
                        if (!currentMenuState) {
                            currentMenuState = this.options.resolveMenu({
                                kind: suggestion.kind,
                                query,
                            });
                        }
                        return currentMenuState;
                    },
                }),
                command: ({editor, range, props}) => {
                    insertAgentSuggestionItem({
                        editor,
                        range,
                        item: props,
                        referenceNodeName: this.name,
                    });
                },
            });
        });
    },
});

/**
 * 将紧邻光标的引用节点退化回 markdown 文本，并删除一个字符。
 */
function degradeAdjacentReference(position: number, direction: -1 | 1, editor: Editor): boolean {
    const resolved = editor.state.doc.resolve(position);
    const adjacentNode = direction < 0 ? resolved.nodeBefore : resolved.nodeAfter;
    if (!adjacentNode || adjacentNode.type?.name !== "agentReference") {
        return false;
    }

    const degradedTrigger = `@${String(adjacentNode.attrs?.kind ?? "chapter")}://${String(adjacentNode.attrs?.targetId ?? "")}`;
    const from = direction < 0 ? position - adjacentNode.nodeSize : position;
    const to = direction < 0 ? position : position + adjacentNode.nodeSize;

    editor.chain().focus().insertContentAt({from, to}, degradedTrigger).run();
    const nextPosition = direction < 0 ? from + degradedTrigger.length : from;
    editor.commands.setTextSelection(nextPosition);
    return true;
}
