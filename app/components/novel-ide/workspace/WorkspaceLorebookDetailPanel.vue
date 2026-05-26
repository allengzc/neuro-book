<script setup lang="ts">
import YAML from "yaml";
import {storeToRefs} from "pinia";
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import {
    getWorkspaceLorebookStatusIndicatorClass,
    getWorkspaceLorebookTypeMeta,
} from "nbook/app/components/novel-ide/workspace/workspace-entry-meta";
import {useNovelIdeStore, type WorkspaceFileIssue, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {normalizeLucideIconName, readLucideIconClass} from "nbook/app/utils/lucide-icons";

type LorebookFileRef = {
    relation: string;
    target: string;
    note: string | null;
};

type LorebookFileDraft = {
    title: string;
    name: string;
    path: string;
    icon: string | null;
    type: "location" | "character" | "item" | "rule" | "note";
    subtype: string | null;
    status: string;
    aliases: string[];
    tags: string[];
    summary: string;
    content: string;
    refs: LorebookFileRef[];
    retrieval: {
        enabled: boolean;
        trigger: string | null;
    };
    inject: {
        profiles: string[];
        always: boolean;
    };
    governance: {
        source: string;
        review: string;
    };
    /** 旧内容节点可能保留的废弃 writingTip 字段；仅用于原样写回。 */
    legacyWritingTip?: string | null;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const LOCATION_SUBTYPES = ["world", "continent", "nation", "region", "city", "district", "building", "room", "landmark", "facility", "ruin", "dungeon", "settlement", "transport"];
const ITEM_SUBTYPES = ["artifact", "consumable", "equipment", "resource", "document", "token"];
const CHARACTER_SUBTYPES = ["person", "important", "background", "unknown", "group"];
const RULE_SUBTYPES = ["system", "physics", "social", "constraint", "interaction", "local", "behavior"];
const NOTE_SUBTYPES = ["note", "rumor", "meta", "todo"];

const props = defineProps<{
    node: WorkspaceFileNode | null;
    issues: WorkspaceFileIssue[];
    height: number;
}>();

const emit = defineEmits<{
    (e: "update:height", value: number): void;
    (e: "close"): void;
    (e: "refresh"): void;
}>();

const store = useNovelIdeStore();
const {selectedFileContent, savingFile} = storeToRefs(store);
const editForm = ref<LorebookFileDraft | null>(null);
const lastAppliedContent = ref("");
const diagnostics = ref("");
const expandedSections = ref({
    retrieval: false,
    refs: false,
    governance: false,
});

const typeMeta = computed(() => editForm.value ? getWorkspaceLorebookTypeMeta(editForm.value.type) : null);
const currentIconName = computed(() => normalizeLucideIconName(editForm.value?.icon) ?? normalizeLucideIconName(props.node?.icon));
const currentIconClass = computed(() => readLucideIconClass(currentIconName.value) ?? typeMeta.value?.icon ?? "i-lucide-scroll-text");
const isDirty = computed(() => editForm.value ? renderDraft(editForm.value) !== selectedFileContent.value : false);
const relatedIssues = computed(() => {
    if (!props.node) {
        return [];
    }
    const currentPath = props.node.path.replace(/\/$/, "");
    return props.issues.filter((issue) => issue.path === props.node?.path || issue.path.startsWith(currentPath));
});

const typeOptions = computed<SelectOption[]>(() => [
    {value: "location", label: "地点 (Location)", iconClass: "i-lucide-map-pinned"},
    {value: "character", label: "角色 (Character)", iconClass: "i-lucide-user-round"},
    {value: "item", label: "物品 (Item)", iconClass: "i-lucide-package"},
    {value: "rule", label: "规则 (Rule)", iconClass: "i-lucide-book-key"},
    {value: "note", label: "笔记 (Note)", iconClass: "i-lucide-scroll-text"},
]);
const statusOptions = computed<SelectOption[]>(() => [
    {value: "draft", label: "草稿中", description: "尚未确认，不应强依赖", indicatorClass: getWorkspaceLorebookStatusIndicatorClass("draft")},
    {value: "pending", label: "待定", description: "未决设定或待回答问题", indicatorClass: getWorkspaceLorebookStatusIndicatorClass("pending")},
    {value: "active", label: "已生效", description: "已确认，可稳定引用", indicatorClass: getWorkspaceLorebookStatusIndicatorClass("active")},
    {value: "archived", label: "已归档", description: "历史保留，不默认使用", indicatorClass: getWorkspaceLorebookStatusIndicatorClass("archived")},
]);
const subtypeOptions = computed(() => {
    if (!editForm.value) {
        return [];
    }
    if (editForm.value.type === "location") {
        return LOCATION_SUBTYPES;
    }
    if (editForm.value.type === "item") {
        return ITEM_SUBTYPES;
    }
    if (editForm.value.type === "character") {
        return CHARACTER_SUBTYPES;
    }
    if (editForm.value.type === "rule") {
        return RULE_SUBTYPES;
    }
    return NOTE_SUBTYPES;
});

/**
 * 将表单写回当前 Markdown 文件。
 */
const saveDraft = async (): Promise<void> => {
    if (!editForm.value || savingFile.value) {
        return;
    }

    const nextContent = renderDraft(editForm.value);
    if (nextContent === selectedFileContent.value) {
        return;
    }

    selectedFileContent.value = nextContent;
    await store.saveCurrentFile();
    lastAppliedContent.value = nextContent;
    diagnostics.value = "";
};

/**
 * 新增一条引用。
 */
const addRef = (): void => {
    if (!editForm.value) {
        return;
    }
    editForm.value.refs.push({
        relation: "",
        target: "",
        note: null,
    });
    expandedSections.value.refs = true;
};

/**
 * 删除一条引用并保存。
 */
const removeRef = (index: number): void => {
    if (!editForm.value) {
        return;
    }
    editForm.value.refs.splice(index, 1);
    void saveDraft();
};

watch(() => [props.node?.path, selectedFileContent.value], () => {
    if (!props.node || selectedFileContent.value === lastAppliedContent.value) {
        return;
    }
    const parsed = parseMarkdownDocument(selectedFileContent.value);
    editForm.value = createDraft(props.node, parsed.frontmatter, parsed.body);
    lastAppliedContent.value = selectedFileContent.value;
    diagnostics.value = parsed.error ?? "";
}, {immediate: true});

function parseMarkdownDocument(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
    error: string | null;
} {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {frontmatter: {}, body: content, error: null};
    }

    try {
        const parsed = YAML.parse(match[1] ?? "", {logLevel: "silent"});
        return {
            frontmatter: isPlainObject(parsed) ? parsed : {},
            body: content.slice(match[0].length),
            error: isPlainObject(parsed) || parsed === null ? null : "frontmatter 必须是对象",
        };
    } catch (error) {
        return {
            frontmatter: {},
            body: content.slice(match[0].length),
            error: error instanceof Error ? error.message : "frontmatter 解析失败",
        };
    }
}

function createDraft(node: WorkspaceFileNode, frontmatter: Record<string, unknown>, body: string): LorebookFileDraft {
    const legacyWritingTip = Object.prototype.hasOwnProperty.call(frontmatter, "writingTip")
        ? {legacyWritingTip: readNullableString(frontmatter.writingTip)}
        : {};
    return {
        title: readString(frontmatter.title, node.title || basename(node.path)),
        name: basename(node.path).replace(/\.md$/i, ""),
        path: node.path,
        icon: normalizeLucideIconName(frontmatter.icon),
        type: readLorebookType(frontmatter.type),
        subtype: readNullableString(frontmatter.subtype),
        status: readString(frontmatter.status, "draft"),
        aliases: readStringArray(frontmatter.aliases),
        tags: readStringArray(frontmatter.tags),
        summary: readString(frontmatter.summary, ""),
        content: body,
        refs: readRefs(frontmatter.refs),
        retrieval: readRetrieval(frontmatter.retrieval),
        inject: readInject(frontmatter.inject),
        governance: readGovernance(frontmatter.governance),
        ...legacyWritingTip,
    };
}

function renderDraft(draft: LorebookFileDraft): string {
    const frontmatter = {
        title: draft.title,
        icon: draft.icon,
        type: draft.type,
        subtype: draft.subtype,
        status: draft.status,
        aliases: draft.aliases,
        tags: draft.tags,
        summary: draft.summary,
        refs: draft.refs,
        retrieval: draft.retrieval,
        inject: draft.inject,
        governance: draft.governance,
        ...(draft.legacyWritingTip !== undefined ? {writingTip: draft.legacyWritingTip} : {}),
    };
    return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${draft.content}`;
}

function readLorebookType(value: unknown): LorebookFileDraft["type"] {
    return ["location", "character", "item", "rule", "note"].includes(String(value))
        ? String(value) as LorebookFileDraft["type"]
        : "note";
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRefs(value: unknown): LorebookFileRef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isPlainObject).map((item) => ({
        relation: readString(item.relation, ""),
        target: readString(item.target, ""),
        note: readNullableString(item.note),
    }));
}

function readRetrieval(value: unknown): LorebookFileDraft["retrieval"] {
    if (!isPlainObject(value)) {
        return {enabled: true, trigger: null};
    }
    return {
        enabled: typeof value.enabled === "boolean" ? value.enabled : true,
        trigger: readNullableString(value.trigger),
    };
}

function readInject(value: unknown): LorebookFileDraft["inject"] {
    if (!isPlainObject(value)) {
        return {profiles: [], always: false};
    }
    return {
        profiles: readStringArray(value.profiles),
        always: typeof value.always === "boolean" ? value.always : false,
    };
}

function readGovernance(value: unknown): LorebookFileDraft["governance"] {
    if (!isPlainObject(value)) {
        return {source: "manual", review: "proposed"};
    }
    return {
        source: readString(value.source, "manual"),
        review: readString(value.review, "proposed"),
    };
}

function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
</script>

<template>
    <SideDetailPanel :visible="Boolean(props.node)" :height="props.height" @update:height="emit('update:height', $event)" @close="emit('close')">
        <template #header>
            <div class="flex min-w-0 items-center gap-2 overflow-hidden">
                <template v-if="editForm && typeMeta">
                    <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[11px]" :class="typeMeta.iconClass">
                        <span :class="currentIconClass" class="h-3.5 w-3.5"></span>
                    </span>
                    <span v-if="isDirty" class="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="有未保存修改"></span>
                    <span class="truncate font-serif text-sm font-bold tracking-wide text-[var(--text-main)]">{{ editForm.title || editForm.name }}</span>
                </template>
            </div>
        </template>

        <template #actions>
            <button class="rounded-md px-2 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" @click="emit('refresh')">刷新</button>
            <button class="rounded-md px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" type="button" :disabled="savingFile" @click="void saveDraft()">保存</button>
        </template>

        <div v-if="editForm" class="space-y-4 p-3 pb-6 text-[11px]" :class="savingFile ? 'pointer-events-none opacity-80' : ''">
            <div v-if="diagnostics" class="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] leading-5 text-amber-800">{{ diagnostics }}</div>
            <div v-for="issue in relatedIssues" :key="`${issue.code}:${issue.path}:${issue.message}`" class="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] leading-5 text-amber-800">
                [{{ issue.level }}] {{ issue.message }}
            </div>

            <!-- 路径与标题信息 -->
            <div class="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)]/20 p-3">
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">路径 (Path)</label>
                    <div class="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-panel)] px-2 py-1.5 font-mono text-[10px] text-[var(--text-muted)]">{{ editForm.path }}</div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1">
                        <label class="font-medium text-[var(--text-secondary)]">Slug 名称 (Name)</label>
                        <input :value="editForm.name" type="text" disabled class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-xs font-mono text-[var(--text-muted)] outline-none">
                    </div>
                    <div class="space-y-1">
                        <label class="font-medium text-[var(--text-secondary)]">显示标题 (Title)</label>
                        <input v-model="editForm.title" type="text" class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" @blur="void saveDraft()">
                    </div>
                </div>
            </div>

            <!-- 分类信息 -->
            <div class="grid grid-cols-3 gap-4">
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">设置类别</label>
                    <FormSelect :model-value="editForm.type" :options="typeOptions" @update:model-value="editForm.type = $event as LorebookFileDraft['type']; void saveDraft()" />
                </div>
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">细分类别</label>
                    <Combobox :model-value="editForm.subtype" :options="subtypeOptions" placeholder="输入或选择子类..." @update:model-value="editForm.subtype = $event; void saveDraft()" />
                </div>
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">当前状态</label>
                    <FormSelect :model-value="editForm.status" :options="statusOptions" @update:model-value="editForm.status = $event; void saveDraft()" />
                </div>
            </div>

            <!-- 别名与标签 -->
            <div class="space-y-3">
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">别名 (Aliases)</label>
                    <TagInput :model-value="editForm.aliases" placeholder="添加后回车..." @update:model-value="editForm.aliases = $event; void saveDraft()" />
                </div>
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">标签 (Tags)</label>
                    <TagInput :model-value="editForm.tags" placeholder="添加后回车..." accentStyle @update:model-value="editForm.tags = $event; void saveDraft()" />
                </div>
            </div>

            <!-- 摘要信息 -->
            <div class="space-y-4">
                <div class="space-y-1">
                    <label class="font-medium text-[var(--text-secondary)]">设定摘要 (Summary)</label>
                    <textarea v-model="editForm.summary" rows="5" class="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" @blur="void saveDraft()"></textarea>
                </div>
            </div>

            <!-- AI 注入策略 -->
            <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                <button type="button" class="flex w-full items-center justify-between bg-[var(--bg-sidebar)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]" @click="expandedSections.retrieval = !expandedSections.retrieval">
                    <span class="flex items-center gap-2 font-medium text-[var(--text-main)]"><span class="i-lucide-target h-3.5 w-3.5 text-[var(--text-muted)]"></span>AI 上下文策略</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-200" :class="expandedSections.retrieval ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.retrieval" class="space-y-3 bg-[var(--bg-input)]/30 p-2.5">
                    <label class="flex items-center gap-2 text-[var(--text-secondary)]">
                        <input v-model="editForm.retrieval.enabled" type="checkbox" class="h-4 w-4 rounded border-[var(--border-color)]" @change="void saveDraft()">
                        <span>允许 AI 检索召回</span>
                    </label>
                    <textarea :value="editForm.retrieval.trigger ?? ''" rows="2" class="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" placeholder="自然语言触发条件；为空表示不需要额外触发判断" @input="editForm.retrieval.trigger = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                    <TagInput :model-value="editForm.inject.profiles" placeholder="直接注入 profile，例如 leader.default..." @update:model-value="editForm.inject.profiles = $event; void saveDraft()" />
                    <label class="flex items-center gap-2 text-[var(--text-secondary)]">
                        <input v-model="editForm.inject.always" type="checkbox" class="h-4 w-4 rounded border-[var(--border-color)]" @change="void saveDraft()">
                        <span>对上述 profile 默认直接注入</span>
                    </label>
                </div>
            </div>

            <!-- 引用关系 -->
            <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                <button type="button" class="flex w-full items-center justify-between bg-[var(--bg-sidebar)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]" @click="expandedSections.refs = !expandedSections.refs">
                    <span class="flex items-center gap-2 font-medium text-[var(--text-main)]"><span class="i-lucide-link h-3.5 w-3.5 text-[var(--text-muted)]"></span>外链与节点 (References)</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-200" :class="expandedSections.refs ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.refs" class="bg-[var(--bg-input)]/30 p-2">
                    <div v-for="(entryRef, index) in editForm.refs" :key="index" class="group mb-1.5 flex items-center gap-1">
                        <input v-model="entryRef.relation" type="text" placeholder="关系" class="w-[76px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-1 text-[11px] outline-none" @blur="void saveDraft()">
                        <span class="i-lucide-arrow-right h-3 w-3 shrink-0 text-[var(--text-muted)]"></span>
                        <input v-model="entryRef.target" type="text" placeholder="目标 path 或 pending" class="min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-1 text-[11px] font-mono outline-none" @blur="void saveDraft()">
                        <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-500" @click="removeRef(index)">
                            <span class="i-lucide-x h-3.5 w-3.5"></span>
                        </button>
                    </div>
                    <button type="button" class="mt-2 flex items-center gap-1 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="addRef">
                        <span class="i-lucide-plus h-3 w-3"></span>添加引用
                    </button>
                </div>
            </div>

            <!-- 治理信息 -->
            <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                <button type="button" class="flex w-full items-center justify-between bg-[var(--bg-sidebar)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]" @click="expandedSections.governance = !expandedSections.governance">
                    <span class="flex items-center gap-2 font-medium text-[var(--text-main)]"><span class="i-lucide-shield-check h-3.5 w-3.5 text-[var(--text-muted)]"></span>治理与来源 (Governance)</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-200" :class="expandedSections.governance ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.governance" class="space-y-3 bg-[var(--bg-input)]/30 p-2.5">
                    <div class="grid grid-cols-2 gap-3">
                        <input v-model="editForm.governance.source" type="text" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-xs outline-none" placeholder="source" @blur="void saveDraft()">
                        <input v-model="editForm.governance.review" type="text" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-xs outline-none" placeholder="review" @blur="void saveDraft()">
                    </div>
                </div>
            </div>
        </div>
    </SideDetailPanel>
</template>
