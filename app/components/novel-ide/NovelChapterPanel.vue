<script setup lang="ts">
import { DragDropProvider, KeyboardSensor, PointerSensor } from "@dnd-kit/vue";
import type { DragDropProviderEmits } from "@dnd-kit/vue";
import { defaultPreset } from "@dnd-kit/dom";
import { isSortable } from "@dnd-kit/vue/sortable";
import dayjs from "dayjs";
import {storeToRefs} from "pinia";
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";
import {useDialog} from "nbook/app/composables/useDialog";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {apiFetch} from "nbook/app/utils/api-fetch";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import FormAnnotationDialog from "nbook/app/components/novel-ide/ai/FormAnnotationDialog.vue";
import {useDetailSession} from "nbook/app/composables/useDetailSession";
import NovelChapterVolumeCard from "nbook/app/components/novel-ide/NovelChapterVolumeCard.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {
    PLOT_KIND_LABELS,
    PLOT_SCENE_STATUS_LABELS,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {
    applyChapterDragMove,
    applyVolumeDragMove,
    buildChapterReorderItems,
    buildChapterGroups,
    buildLocalVolumes,
    buildVolumeReorderItems,
    cloneLocalVolumes,
    hasChapterGroupsChanged,
    hasVolumeOrderChanged,
    isChapterDragData,
    isVolumeDragData,
    type LocalVolume,
} from "nbook/app/components/novel-ide/novel-chapter-dnd";
import type {
    ChapterDetailDto,
    ChapterStatusDto,
    ChapterSummaryDto,
    ReorderChaptersRequestDto,
    ReorderVolumesRequestDto,
    UpdateVolumeRequestDto,
    VolumeDto,
} from "nbook/shared/dto/novel-chapter.dto";
import type {JsonObject} from "nbook/shared/dto/ai-form-annotation.dto";
import type {ChapterPlotDetailDto, ChapterPlotSceneDto} from "nbook/shared/dto/plot.dto";

type VolumeDetailForm = { title: string; summary: string };
type ChapterQuickForm = {
    title: string;
    status: ChapterStatusDto;
    summary: string;
    characters: string;
    todos: string;
};

type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];

const props = defineProps<{
    selectedChapterId: string;
    volumes: VolumeDto[];
    creating: boolean;
}>();

const novelIdeStore = useNovelIdeStore();
const {
    currentNovelId,
    selectedStoryThreadId,
    selectedStorySceneId,
} = storeToRefs(novelIdeStore);
const {choose} = useDialog();
const {resolveMenu, menuRefreshKey} = useStructuredReferenceMenu({
    novelId: currentNovelId,
    selectedStoryThreadId,
    selectedStorySceneId,
});

const emit = defineEmits<{
    (e: "update:selectedChapterId", value: string): void;
    (e: "createVolume"): void;
    (e: "createChapter", volumeId: string, title: string): void;
    (e: "updateChapter", chapterId: string, payload: Partial<ChapterDetailDto>): void;
    (e: "updateVolume", volumeId: string, payload: UpdateVolumeRequestDto): void;
    (e: "reorderVolumes", items: ReorderVolumesRequestDto["items"]): void;
    (e: "reorderChapters", items: ReorderChaptersRequestDto["items"]): void;
    (e: "deleteVolume", volumeId: string): void;
    (e: "deleteChapter", chapterId: string): void;
}>();

const searchQuery = ref("");
const detailPanelHeight = ref(260);
const chapterPlotLoading = ref(false);
const chapterPlotError = ref("");
const chapterPlotDetailMap = ref<Record<string, ChapterPlotDetailDto>>({});
const chapterPlotRequestId = ref(0);
const volumes = ref<LocalVolume[]>([]);
const selectedVolumeId = ref("");
const inlineCreatingVolumeId = ref("");
const inlineChapterTitle = ref("");
const editingChapterId = ref("");
const showEditChapterDialog = ref(false);
const savingEditChapter = ref(false);
const editChapterError = ref("");
const editChapterOriginalSnapshot = ref("");
const editingVolumeId = ref("");
const showEditVolumeDialog = ref(false);
const savingEditVolume = ref(false);
const editVolumeError = ref("");
const editVolumeOriginalSnapshot = ref("");
const editVolumeForm = ref<VolumeDetailForm>({ title: "", summary: "" });
const volumeDragSnapshot = ref<LocalVolume[] | null>(null);
const chapterDragSnapshot = ref<LocalVolume[] | null>(null);
const detailAiDialogOpen = ref(false);
const chapterDetailForm = ref<ChapterQuickForm>({
    title: "",
    status: "DRAFT",
    summary: "",
    characters: "",
    todos: "",
});
const volumeDetailForm = ref<VolumeDetailForm>({title: "", summary: ""});
const editChapterForm = ref({
    title: "",
    status: "DRAFT" as ChapterStatusDto,
    summary: "",
    characters: "",
    todos: "",
});

const chapterStatusOptions: ChapterStatusDto[] = ["NOT_STARTED", "DRAFT", "REVISING", "DONE"];
const dndSensors = [
    PointerSensor.configure({
        activatorElements(source) {
            return [source.handle];
        },
    }),
    KeyboardSensor,
];

const dragDisabled = computed(() => (
    props.creating
    || searchQuery.value.trim().length > 0
    || inlineCreatingVolumeId.value !== ""
    || showEditChapterDialog.value
    || showEditVolumeDialog.value
));

watch(() => props.volumes, (nextVolumes) => {
    volumes.value = buildLocalVolumes(nextVolumes, volumes.value);
    if (selectedVolumeId.value && !nextVolumes.some((volume) => volume.id === selectedVolumeId.value)) {
        selectedVolumeId.value = "";
    }
}, { immediate: true });

watch(() => props.selectedChapterId, (chapterId) => {
    if (!chapterId) {
        return;
    }
    selectedVolumeId.value = "";
    const targetVolumeId = props.volumes.find((volume) => volume.chapters.some((chapter) => chapter.id === chapterId))?.id;
    if (!targetVolumeId) {
        return;
    }
    volumes.value = volumes.value.map((volume) => volume.id === targetVolumeId ? { ...volume, isExpanded: true } : volume);
}, { immediate: true });

watch(() => novelIdeStore.currentNovelId, () => {
    chapterPlotDetailMap.value = {};
    chapterPlotError.value = "";
    chapterPlotLoading.value = false;
    chapterPlotRequestId.value += 1;
});

watch(() => props.selectedChapterId, (chapterId) => {
    if (!chapterId || selectedVolumeId.value) {
        chapterPlotLoading.value = false;
        chapterPlotError.value = "";
        return;
    }

    void loadChapterPlotDetail(chapterId);
}, { immediate: true });

const selectedChapter = computed<ChapterSummaryDto | null>(() => {
    for (const volume of volumes.value) {
        const chapter = volume.chapters.find((item) => item.id === props.selectedChapterId);
        if (chapter) {
            return chapter;
        }
    }
    return null;
});

const selectedVolume = computed<LocalVolume | null>(() => volumes.value.find((volume) => volume.id === selectedVolumeId.value) ?? null);
const selectedChapterPlotDetail = computed<ChapterPlotDetailDto | null>(() => {
    if (!props.selectedChapterId) {
        return null;
    }

    return chapterPlotDetailMap.value[props.selectedChapterId] ?? null;
});
const chapterDetailHistoryKey = computed(() => selectedChapter.value ? `chapter:${selectedChapter.value.id}` : "");
const volumeDetailHistoryKey = computed(() => selectedVolume.value ? `volume:${selectedVolume.value.id}` : "");
const chapterDetailSession = useDetailSession({
    historyKey: chapterDetailHistoryKey,
    createSnapshot: () => JSON.stringify(chapterDetailForm.value),
    applySnapshot: (snapshot) => {
        chapterDetailForm.value = JSON.parse(snapshot) as ChapterQuickForm;
    },
});
const volumeDetailSession = useDetailSession({
    historyKey: volumeDetailHistoryKey,
    createSnapshot: () => JSON.stringify(volumeDetailForm.value),
    applySnapshot: (snapshot) => {
        volumeDetailForm.value = JSON.parse(snapshot) as VolumeDetailForm;
    },
});
const isChapterDetailDirty = computed(() => Boolean(selectedChapter.value) && chapterDetailSession.isDirty.value);
const isVolumeDetailDirty = computed(() => Boolean(selectedVolume.value) && volumeDetailSession.isDirty.value);
const canRollbackDetail = computed(() => {
    const key = selectedChapter.value ? chapterDetailHistoryKey.value : volumeDetailHistoryKey.value;
    if (!key) {
        return false;
    }

    return selectedChapter.value
        ? chapterDetailSession.canUndo.value
        : volumeDetailSession.canUndo.value;
});
const chapterAnnotationDraft = computed<JsonObject>(() => ({
    title: chapterDetailForm.value.title,
    status: chapterDetailForm.value.status,
    summary: chapterDetailForm.value.summary,
    characters: chapterDetailForm.value.characters.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    todos: chapterDetailForm.value.todos.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
}));
const editChapterDirty = computed(() => Boolean(editingChapterId.value) && createChapterEditorSnapshot() !== editChapterOriginalSnapshot.value);
const editVolumeDirty = computed(() => Boolean(editingVolumeId.value) && createVolumeEditorSnapshot() !== editVolumeOriginalSnapshot.value);

/**
 * 搜索匹配章节。
 */
const matchChapter = (chapter: ChapterSummaryDto): boolean => {
    if (!searchQuery.value.trim()) {
        return true;
    }
    const keyword = searchQuery.value.trim().toLowerCase();
    return [
        chapterNumber(chapter.sortOrder),
        chapter.title,
        chapter.summary,
        chapter.characters.join(" "),
        chapter.todos.join(" "),
    ].join(" ").toLowerCase().includes(keyword);
};

/**
 * 搜索匹配篇。
 */
const matchVolume = (volume: LocalVolume): boolean => {
    if (!searchQuery.value.trim()) {
        return true;
    }
    const keyword = searchQuery.value.trim().toLowerCase();
    return [volume.title, volume.summary].join(" ").toLowerCase().includes(keyword) || volume.chapters.some(matchChapter);
};

/**
 * 状态颜色。
 */
const statusClass = (status: ChapterStatusDto): string => {
    if (status === "DRAFT") return "text-sky-500";
    if (status === "REVISING") return "text-amber-500";
    if (status === "DONE") return "text-emerald-500";
    return "text-[var(--text-muted)]";
};

/**
 * 状态文案。
 */
const statusLabel = (status: ChapterStatusDto): string => {
    if (status === "DRAFT") return "草稿中";
    if (status === "REVISING") return "待修改";
    if (status === "DONE") return "已完成";
    return "未开始";
};

const statusDropdownItems = computed<DropdownItem[]>(() => chapterStatusOptions.map((status) => ({
    label: statusLabel(status),
    value: status,
    active: editChapterForm.value.status === status,
    iconClass: `i-lucide-circle ${statusClass(status)}`,
    rightIconClass: editChapterForm.value.status === status ? "i-lucide-check" : undefined,
})));

/**
 * 章节编号。
 */
const chapterNumber = (sortOrder: number): string => `第${String(sortOrder + 1).padStart(2, "0")}章`;

/**
 * 更新时间文案。
 */
const updatedLabel = (updatedAt: string): string => dayjs(updatedAt).isValid() ? dayjs(updatedAt).format("MM-DD HH:mm") : "-";

/**
 * Scene 状态文案。
 */
const sceneStatusLabel = (status: ChapterPlotSceneDto["status"]): string => PLOT_SCENE_STATUS_LABELS[status];

/**
 * 判断合法状态。
 */
const isChapterStatus = (value: string): value is ChapterStatusDto => chapterStatusOptions.includes(value as ChapterStatusDto);

/**
 * 更新章节状态选择。
 */
const selectChapterStatus = (value: string): void => {
    if (isChapterStatus(value)) {
        editChapterForm.value.status = value;
    }
};

/**
 * 切换篇展开。
 */
const toggleVolume = (volumeId: string): void => {
    volumes.value = volumes.value.map((volume) => volume.id === volumeId ? { ...volume, isExpanded: !volume.isExpanded } : volume);
};

/**
 * 选中篇详情。
 */
const selectVolume = (volumeId: string): void => {
    selectedVolumeId.value = volumeId;
    if (detailPanelHeight.value <= 0) {
        detailPanelHeight.value = 260;
    }
};

function createChapterEditorSnapshot(): string {
    return JSON.stringify(editChapterForm.value);
}

function createVolumeEditorSnapshot(): string {
    return JSON.stringify(editVolumeForm.value);
}

/**
 * 选中章节详情。
 */
const selectChapter = (chapterId: string): void => {
    selectedVolumeId.value = "";
    if (detailPanelHeight.value <= 0) {
        detailPanelHeight.value = 260;
    }
    emit("update:selectedChapterId", chapterId);
};

/**
 * 关闭底部详情面板。
 */
const closeDetailPanel = (): void => {
    selectedVolumeId.value = "";
    emit("update:selectedChapterId", "");
};

/**
 * 同步章节 detail 草稿。
 */
function syncChapterDetailForm(): void {
    if (!selectedChapter.value) {
        chapterDetailForm.value = {
            title: "",
            status: "DRAFT",
            summary: "",
            characters: "",
            todos: "",
        };
        chapterDetailSession.resetSession();
        return;
    }

    chapterDetailForm.value = {
        title: selectedChapter.value.title,
        status: selectedChapter.value.status,
        summary: selectedChapter.value.summary,
        characters: selectedChapter.value.characters.join("，"),
        todos: selectedChapter.value.todos.join("，"),
    };
    chapterDetailSession.applyServerValue();
}

/**
 * 同步篇 detail 草稿。
 */
function syncVolumeDetailForm(): void {
    if (!selectedVolume.value) {
        volumeDetailForm.value = {title: "", summary: ""};
        volumeDetailSession.resetSession();
        return;
    }

    volumeDetailForm.value = {
        title: selectedVolume.value.title,
        summary: selectedVolume.value.summary,
    };
    volumeDetailSession.applyServerValue();
}

/**
 * 自动保存章节 detail。
 */
function saveChapterDetail(): void {
    if (!selectedChapter.value || !isChapterDetailDirty.value) {
        return;
    }

    chapterDetailSession.pushUndo();
    emit("updateChapter", selectedChapter.value.id, {
        title: chapterDetailForm.value.title.trim() || undefined,
        status: chapterDetailForm.value.status,
        summary: chapterDetailForm.value.summary.trim(),
        characters: chapterDetailForm.value.characters.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        todos: chapterDetailForm.value.todos.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    });
}

/**
 * 自动保存篇 detail。
 */
function saveVolumeDetail(): void {
    if (!selectedVolume.value || !isVolumeDetailDirty.value) {
        return;
    }

    const title = volumeDetailForm.value.title.trim();
    if (!title) {
        return;
    }

    volumeDetailSession.pushUndo();
    emit("updateVolume", selectedVolume.value.id, {
        title,
        summary: volumeDetailForm.value.summary.trim(),
    });
}

/**
 * 回退当前 detail 草稿。
 */
function rollbackDetail(): void {
    if (selectedChapter.value) {
        chapterDetailSession.undo();
        return;
    }

    volumeDetailSession.undo();
}

/**
 * 打开章节 AI 批注。
 */
function openChapterAiDialog(): void {
    detailAiDialogOpen.value = true;
}

/**
 * 应用章节 AI 草稿。
 */
function applyChapterAiDraft(nextDraft: JsonObject): void {
    chapterDetailSession.pushUndo();

    if (typeof nextDraft.title === "string") {
        chapterDetailForm.value.title = nextDraft.title;
    }
    if (typeof nextDraft.status === "string") {
        chapterDetailForm.value.status = nextDraft.status as ChapterStatusDto;
    }
    if (typeof nextDraft.summary === "string") {
        chapterDetailForm.value.summary = nextDraft.summary;
    }
    if (Array.isArray(nextDraft.characters)) {
        chapterDetailForm.value.characters = nextDraft.characters.filter((item): item is string => typeof item === "string").join("，");
    }
    if (Array.isArray(nextDraft.todos)) {
        chapterDetailForm.value.todos = nextDraft.todos.filter((item): item is string => typeof item === "string").join("，");
    }
}

/**
 * 从 detail 进入章节完整编辑。
 */
function openChapterEditorFromDetail(): void {
    saveChapterDetail();
    if (selectedChapter.value) {
        startEditChapter(selectedChapter.value);
    }
}

/**
 * 从 detail 进入篇完整编辑。
 */
function openVolumeEditorFromDetail(): void {
    saveVolumeDetail();
    if (selectedVolume.value) {
        startEditVolume(selectedVolume.value);
    }
}

/**
 * 读取章节下的剧情 Scene / Plot。
 */
async function loadChapterPlotDetail(chapterId: string): Promise<void> {
    if (!novelIdeStore.currentNovelId || !chapterId) {
        return;
    }

    if (chapterPlotDetailMap.value[chapterId]) {
        chapterPlotError.value = "";
        return;
    }

    const requestId = chapterPlotRequestId.value + 1;
    chapterPlotRequestId.value = requestId;
    chapterPlotLoading.value = true;
    chapterPlotError.value = "";

    try {
        const detail = await $fetch<ChapterPlotDetailDto>("/api/projects/plot/chapter", {
            query: {
                projectPath: novelIdeStore.currentNovelId,
                chapterPath: chapterId,
            },
        });
        if (chapterPlotRequestId.value !== requestId) {
            return;
        }

        chapterPlotDetailMap.value = {
            ...chapterPlotDetailMap.value,
            [chapterId]: detail,
        };
    } catch (error) {
        if (chapterPlotRequestId.value !== requestId) {
            return;
        }

        chapterPlotError.value = error instanceof Error ? error.message : "加载章节剧情失败";
    } finally {
        if (chapterPlotRequestId.value === requestId) {
            chapterPlotLoading.value = false;
        }
    }
}

/**
 * 开启行内新建章。
 */
const startInlineCreate = (volumeId: string): void => {
    volumes.value = volumes.value.map((volume) => volume.id === volumeId ? { ...volume, isExpanded: true } : volume);
    inlineCreatingVolumeId.value = volumeId;
    inlineChapterTitle.value = "";
};

/**
 * 取消行内新建章。
 */
const cancelInlineCreate = (): void => {
    inlineCreatingVolumeId.value = "";
    inlineChapterTitle.value = "";
};

/**
 * 确认行内新建章。
 */
const confirmInlineCreate = (): void => {
    if (!inlineCreatingVolumeId.value) {
        return;
    }
    const title = inlineChapterTitle.value.trim();
    if (title) {
        emit("createChapter", inlineCreatingVolumeId.value, title);
    }
    cancelInlineCreate();
};

/**
 * 打开章节编辑。
 */
const startEditChapter = (chapter: ChapterSummaryDto): void => {
    editingChapterId.value = chapter.id;
    editChapterError.value = "";
    editChapterForm.value = {
        title: chapter.title,
        status: chapter.status,
        summary: chapter.summary,
        characters: chapter.characters.join("，"),
        todos: chapter.todos.join("，"),
    };
    editChapterOriginalSnapshot.value = createChapterEditorSnapshot();
    showEditChapterDialog.value = true;
};

/**
 * 提交章节编辑。
 */
const confirmEditChapter = async (): Promise<void> => {
    if (!editingChapterId.value) {
        return;
    }

    savingEditChapter.value = true;
    editChapterError.value = "";

    try {
        const detail = await apiFetch<ChapterDetailDto>(`/api/novels/${novelIdeStore.currentNovelId}/chapters/${editingChapterId.value}`, {
            method: "PATCH",
            body: {
                title: editChapterForm.value.title.trim() || undefined,
                status: editChapterForm.value.status,
                summary: editChapterForm.value.summary.trim(),
                characters: editChapterForm.value.characters.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                todos: editChapterForm.value.todos.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
            },
            notify: false,
        });
        novelIdeStore.syncChapterSummary(detail);
        editChapterOriginalSnapshot.value = createChapterEditorSnapshot();
        showEditChapterDialog.value = false;
    } catch (error) {
        editChapterError.value = resolveApiErrorMessage(error, "保存章节失败");
    } finally {
        savingEditChapter.value = false;
    }
};

/**
 * 打开篇编辑。
 */
const startEditVolume = (volume: LocalVolume): void => {
    editingVolumeId.value = volume.id;
    editVolumeError.value = "";
    editVolumeForm.value = {
        title: volume.title,
        summary: volume.summary,
    };
    editVolumeOriginalSnapshot.value = createVolumeEditorSnapshot();
    showEditVolumeDialog.value = true;
};

/**
 * 提交篇编辑。
 */
const confirmEditVolume = async (): Promise<void> => {
    if (!editingVolumeId.value) {
        return;
    }
    const title = editVolumeForm.value.title.trim();
    if (!title) {
        return;
    }

    savingEditVolume.value = true;
    editVolumeError.value = "";

    try {
        const volume = await apiFetch<VolumeDto>(`/api/novels/${novelIdeStore.currentNovelId}/volumes/${editingVolumeId.value}`, {
            method: "PATCH",
            body: {
                title,
                summary: editVolumeForm.value.summary.trim(),
            } satisfies UpdateVolumeRequestDto,
            notify: false,
        });
        novelIdeStore.syncVolumeSummary(volume);
        editVolumeOriginalSnapshot.value = createVolumeEditorSnapshot();
        showEditVolumeDialog.value = false;
    } catch (error) {
        editVolumeError.value = resolveApiErrorMessage(error, "保存篇失败");
    } finally {
        savingEditVolume.value = false;
    }
};

async function handleEditChapterRequestClose(reason: "overlay" | "cancel" | "close-button" | "esc"): Promise<void> {
    if (savingEditChapter.value) {
        return;
    }

    if (reason !== "overlay" || !editChapterDirty.value) {
        showEditChapterDialog.value = false;
        return;
    }

    const action = await choose("当前章节表单有未保存修改，是否先保存？", [
        {label: "保存", value: "save", tone: "primary"},
        {label: "放弃", value: "discard", tone: "danger"},
        {label: "取消", value: "cancel"},
    ], "未保存修改");
    if (action === "save") {
        await confirmEditChapter();
        return;
    }
    if (action === "discard") {
        showEditChapterDialog.value = false;
    }
}

async function handleEditVolumeRequestClose(reason: "overlay" | "cancel" | "close-button" | "esc"): Promise<void> {
    if (savingEditVolume.value) {
        return;
    }

    if (reason !== "overlay" || !editVolumeDirty.value) {
        showEditVolumeDialog.value = false;
        return;
    }

    const action = await choose("当前篇表单有未保存修改，是否先保存？", [
        {label: "保存", value: "save", tone: "primary"},
        {label: "放弃", value: "discard", tone: "danger"},
        {label: "取消", value: "cancel"},
    ], "未保存修改");
    if (action === "save") {
        await confirmEditVolume();
        return;
    }
    if (action === "discard") {
        showEditVolumeDialog.value = false;
    }
}

/**
 * 删除篇。
 */
const deleteVolume = (volumeId: string): void => {
    emit("deleteVolume", volumeId);
};

/**
 * 当前篇下可见章节。
 */
const visibleChapters = (volume: LocalVolume): ChapterSummaryDto[] => volume.chapters.filter(matchChapter);

/**
 * 记录拖拽开始前的快照，供取消拖拽时回滚。
 */
const handleDragStart = (event: DragStartPayload): void => {
    const source = event.operation.source;
    if (!source || !isSortable(source)) {
        volumeDragSnapshot.value = null;
        chapterDragSnapshot.value = null;
        return;
    }

    if (isVolumeDragData(source.data)) {
        volumeDragSnapshot.value = cloneLocalVolumes(volumes.value);
        chapterDragSnapshot.value = null;
        return;
    }

    if (isChapterDragData(source.data)) {
        chapterDragSnapshot.value = cloneLocalVolumes(volumes.value);
        volumeDragSnapshot.value = null;
        return;
    }

    volumeDragSnapshot.value = null;
    chapterDragSnapshot.value = null;
};

/**
 * 按 dnd-kit 官方 multiple lists 模式，在 dragOver 阶段实时同步排序状态。
 */
const handleDragOver = (event: DragOverPayload): void => {
    const source = event.operation.source;
    const target = event.operation.target;

    if (dragDisabled.value || !source || !isSortable(source)) {
        event.preventDefault();
        return;
    }

    if (isVolumeDragData(source.data)) {
        if (!target || !isSortable(target) || !isVolumeDragData(target.data)) {
            event.preventDefault();
            return;
        }

        if (!volumeDragSnapshot.value) {
            volumeDragSnapshot.value = cloneLocalVolumes(volumes.value);
        }

        volumes.value = applyVolumeDragMove(volumes.value, event);
        return;
    }

    if (isChapterDragData(source.data)) {
        if (!target || !isSortable(target) || (!isChapterDragData(target.data) && !isVolumeDragData(target.data))) {
            event.preventDefault();
            return;
        }

        if (!chapterDragSnapshot.value) {
            chapterDragSnapshot.value = cloneLocalVolumes(volumes.value);
        }

        volumes.value = applyChapterDragMove(volumes.value, event);
        return;
    }

    event.preventDefault();
};

/**
 * 拖拽结束时只负责回滚和提交排序快照。
 */
const handleDragEnd = (event: DragEndPayload): void => {
    const source = event.operation.source;
    if (dragDisabled.value || !source || !isSortable(source)) {
        volumeDragSnapshot.value = null;
        chapterDragSnapshot.value = null;
        return;
    }

    if (isVolumeDragData(source.data)) {
        const snapshot = volumeDragSnapshot.value ? cloneLocalVolumes(volumeDragSnapshot.value) : cloneLocalVolumes(volumes.value);
        volumeDragSnapshot.value = null;

        if (event.canceled) {
            volumes.value = snapshot;
            return;
        }

        if (!hasVolumeOrderChanged(snapshot, volumes.value)) {
            return;
        }

        emit("reorderVolumes", buildVolumeReorderItems(volumes.value));
        return;
    }

    if (!isChapterDragData(source.data)) {
        volumeDragSnapshot.value = null;
        chapterDragSnapshot.value = null;
        return;
    }

    const snapshot = chapterDragSnapshot.value ? cloneLocalVolumes(chapterDragSnapshot.value) : cloneLocalVolumes(volumes.value);
    chapterDragSnapshot.value = null;

    if (event.canceled) {
        volumes.value = snapshot;
        return;
    }

    const snapshotGroups = buildChapterGroups(snapshot);
    const currentGroups = buildChapterGroups(volumes.value);
    if (!hasChapterGroupsChanged(snapshotGroups, currentGroups)) {
        return;
    }

    emit("reorderChapters", buildChapterReorderItems(volumes.value));
};

watch(selectedChapter, () => {
    syncChapterDetailForm();
}, {immediate: true});

watch(selectedVolume, () => {
    syncVolumeDetailForm();
}, {immediate: true});
</script>

<template>
    <!-- 章节管理面板 -->
    <div class="flex min-h-0 flex-1 flex-col">
        <div class="shrink-0 space-y-2.5 border-b border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="relative">
                <span class="i-lucide-search absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" placeholder="搜索篇、章节、标签、角色…" class="w-full rounded-3 border border-[var(--border-color)] bg-[var(--bg-input)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]">
            </div>
            <div class="flex items-center justify-between">
                <div class="flex gap-1">
                    <button class="inline-flex items-center gap-1 rounded-2 px-1.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.creating" @click="emit('createVolume')">
                        <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        <span>新建篇</span>
                    </button>
                    <button class="inline-flex items-center gap-1 rounded-2 px-1.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.creating" @click="startInlineCreate(volumes[0]?.id || '')">
                        <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        <span>新建章</span>
                    </button>
                </div>
                <span v-if="searchQuery.trim()" class="text-[10px] text-[var(--text-muted)]">搜索中已禁用拖拽</span>
            </div>
        </div>

        <!-- 篇与章节列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <DragDropProvider :plugins="defaultPreset.plugins" :sensors="dndSensors" @drag-start="handleDragStart" @drag-over="handleDragOver" @drag-end="handleDragEnd">
                <div class="space-y-2">
                    <NovelChapterVolumeCard
                        v-for="(volume, volumeIndex) in volumes"
                        v-show="matchVolume(volume)"
                        :key="volume.id"
                        :volume="volume"
                        :index="volumeIndex"
                        :visible-chapters="visibleChapters(volume)"
                        :selected-volume-id="selectedVolumeId"
                        :selected-chapter-id="props.selectedChapterId"
                        :drag-disabled="dragDisabled"
                        :creating="props.creating"
                        :show-inline-create="inlineCreatingVolumeId === volume.id"
                        :inline-title="inlineChapterTitle"
                        :chapter-number="chapterNumber"
                        :status-label="statusLabel"
                        :status-class="statusClass"
                        @toggle="toggleVolume"
                        @select-volume="selectVolume"
                        @start-inline-create="startInlineCreate"
                        @update:inline-title="inlineChapterTitle = $event"
                        @confirm-inline-create="confirmInlineCreate"
                        @cancel-inline-create="cancelInlineCreate"
                        @select-chapter="selectChapter"
                        @edit-chapter="startEditChapter"
                        @delete-chapter="emit('deleteChapter', $event)"
                        @edit-volume="startEditVolume"
                        @delete-volume="deleteVolume($event.id)"
                    />
                </div>
            </DragDropProvider>
        </div>

        <!-- 底部详情区 -->
        <SideDetailPanel
            :visible="Boolean(selectedVolume || selectedChapter)"
            :height="detailPanelHeight"
            @update:height="detailPanelHeight = $event"
            @close="closeDetailPanel"
        >
            <template #header>
                <div v-if="selectedVolume" class="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                    <span
                        v-if="isVolumeDetailDirty"
                        class="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                        title="有未保存修改"
                    ></span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                        <span class="truncate font-serif text-sm font-bold text-[var(--text-main)]">{{ selectedVolume.title }}</span>
                        <span class="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-[var(--text-muted)]">
                            <span class="shrink-0">{{ selectedVolume.chapters.length }}章</span>
                            <span class="shrink-0">·</span>
                            <span class="shrink-0">{{ (selectedVolume.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) / 10000).toFixed(1) }}万字</span>
                            <span class="shrink-0">·</span>
                            <span class="truncate">{{ updatedLabel(selectedVolume.updatedAt) }}</span>
                        </span>
                    </span>
                </div>
                <div v-else-if="selectedChapter" class="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                    <span
                        v-if="isChapterDetailDirty"
                        class="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                        title="有未保存修改"
                    ></span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                        <span class="truncate font-serif text-sm font-bold text-[var(--text-main)]">{{ chapterNumber(selectedChapter.sortOrder) }} {{ selectedChapter.title }}</span>
                        <span class="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-[var(--text-muted)]">
                            <span class="shrink-0" :class="statusClass(selectedChapter.status)">{{ statusLabel(selectedChapter.status) }}</span>
                            <span class="shrink-0">·</span>
                            <span class="shrink-0">{{ selectedChapter.wordCount }}字</span>
                            <span class="shrink-0">·</span>
                            <span class="truncate">{{ updatedLabel(selectedChapter.updatedAt) }}</span>
                        </span>
                    </span>
                </div>
            </template>

            <template #actions>
                <button
                    v-if="detailPanelHeight > 44 && (selectedVolume || selectedChapter)"
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="!canRollbackDetail"
                    title="回退"
                    @click="rollbackDetail"
                >
                    <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                </button>
                <button
                    v-if="detailPanelHeight > 44 && selectedChapter"
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    title="AI 批注"
                    @click="openChapterAiDialog"
                >
                    <span class="i-lucide-sparkles h-3 w-3"></span>
                </button>
                <button
                    v-if="detailPanelHeight > 44 && selectedChapter"
                    type="button"
                    class="inline-flex h-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    @click="openChapterEditorFromDetail"
                >编辑</button>
                <button
                    v-else-if="detailPanelHeight > 44 && selectedVolume"
                    type="button"
                    class="inline-flex h-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    @click="openVolumeEditorFromDetail"
                >编辑</button>
            </template>

            <template #default>
                <div class="px-4 pb-4 pt-3 text-xs">
                    <div v-if="selectedVolume" class="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-[var(--text-secondary)]">
                        <label class="block space-y-1">
                            <span class="font-medium text-[var(--text-secondary)]">标题</span>
                            <input
                                v-model="volumeDetailForm.title"
                                type="text"
                                class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                @blur="saveVolumeDetail"
                            >
                        </label>
                        <div class="space-y-1">
                            <span class="font-medium text-[var(--text-secondary)]">摘要</span>
                            <StructuredTextEditor
                                v-model="volumeDetailForm.summary"
                                :rows="4"
                                default-mode="rich"
                                placeholder="概括当前篇的整体内容..."
                                :menu-refresh-key="menuRefreshKey"
                                :resolve-menu="resolveMenu"
                                @blur="saveVolumeDetail"
                            />
                        </div>
                        <div class="flex gap-2">
                            <span class="w-12 shrink-0 text-[var(--text-muted)]">章节：</span>
                            <span class="flex-1">{{ selectedVolume.chapters.length }} 章</span>
                        </div>
                        <div class="flex gap-2">
                            <span class="w-12 shrink-0 text-[var(--text-muted)]">字数：</span>
                            <span class="flex-1">{{ selectedVolume.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) }} 字</span>
                        </div>
                    </div>

                    <div v-else-if="selectedChapter" class="space-y-3">
                        <div class="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-[var(--text-secondary)]">
                            <label class="block space-y-1">
                                <span class="font-medium text-[var(--text-secondary)]">标题</span>
                                <input
                                    v-model="chapterDetailForm.title"
                                    type="text"
                                    class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                    @blur="saveChapterDetail"
                                >
                            </label>
                            <div class="grid grid-cols-2 gap-3">
                                <label class="block space-y-1">
                                    <span class="font-medium text-[var(--text-secondary)]">状态</span>
                                    <select
                                        v-model="chapterDetailForm.status"
                                        class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                        @change="saveChapterDetail"
                                    >
                                        <option v-for="status in chapterStatusOptions" :key="status" :value="status">
                                            {{ statusLabel(status) }}
                                        </option>
                                    </select>
                                </label>
                            </div>
                            <div class="space-y-1">
                                <span class="font-medium text-[var(--text-secondary)]">摘要</span>
                                <StructuredTextEditor
                                    v-model="chapterDetailForm.summary"
                                    :rows="5"
                                    default-mode="rich"
                                    placeholder="概括当前章节..."
                                    :menu-refresh-key="menuRefreshKey"
                                    :resolve-menu="resolveMenu"
                                    @blur="saveChapterDetail"
                                />
                            </div>
                            <label class="block space-y-1">
                                <span class="font-medium text-[var(--text-secondary)]">角色</span>
                                <input
                                    v-model="chapterDetailForm.characters"
                                    type="text"
                                    class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                    @blur="saveChapterDetail"
                                >
                            </label>
                            <label class="block space-y-1">
                                <span class="font-medium text-[var(--text-secondary)]">待办</span>
                                <input
                                    v-model="chapterDetailForm.todos"
                                    type="text"
                                    class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                    @blur="saveChapterDetail"
                                >
                            </label>
                        </div>

                        <div class="space-y-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)]/70 p-3">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-semibold tracking-[0.16em] text-[var(--text-secondary)]">剧情 Scene</span>
                                <span v-if="selectedChapterPlotDetail" class="text-[10px] text-[var(--text-muted)]">
                                    {{ selectedChapterPlotDetail.totalScenes }} Scene / {{ selectedChapterPlotDetail.totalPlots }} Plot
                                </span>
                            </div>

                            <div v-if="chapterPlotLoading" class="space-y-2 py-1">
                                <div class="h-10 animate-pulse rounded-xl bg-[var(--bg-panel)]/70"></div>
                                <div class="h-10 animate-pulse rounded-xl bg-[var(--bg-panel)]/60"></div>
                            </div>

                            <div v-else-if="chapterPlotError" class="rounded-xl border border-rose-500/20 bg-rose-500/6 px-3 py-2 text-[11px] text-rose-700">
                                {{ chapterPlotError }}
                            </div>

                            <div v-else-if="!selectedChapterPlotDetail || selectedChapterPlotDetail.scenes.length === 0" class="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-3 py-2 text-[11px] text-[var(--text-muted)]">
                                本章尚未编排剧情 Scene
                            </div>

                            <div v-else class="space-y-2">
                                <div
                                    v-for="scene in selectedChapterPlotDetail.scenes"
                                    :key="scene.id"
                                    class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5"
                                >
                                    <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0 flex-1">
                                            <div class="truncate text-[12px] font-semibold text-[var(--text-main)]">
                                                {{ scene.chapterSortOrder !== null ? `#${scene.chapterSortOrder + 1} ` : "" }}{{ scene.title }}
                                            </div>
                                            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                                                <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                                                    {{ scene.threadTitle }}
                                                </span>
                                                <span v-if="scene.threadIsMain" class="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
                                                    主线
                                                </span>
                                                <span>{{ sceneStatusLabel(scene.status) }}</span>
                                            </div>
                                        </div>
                                        <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ scene.plots.length }} Plot</span>
                                    </div>

                                    <div v-if="scene.summary" class="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                                        {{ scene.summary }}
                                    </div>
                                    <div v-if="scene.purpose" class="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                                        目的：{{ scene.purpose }}
                                    </div>

                                    <div v-if="scene.plots.length > 0" class="mt-2 space-y-1.5 border-t border-[var(--border-color)]/70 pt-2">
                                        <div
                                            v-for="plot in scene.plots"
                                            :key="plot.id"
                                            class="rounded-lg bg-[var(--bg-input)]/60 px-2 py-1.5"
                                        >
                                            <div class="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                                                <span class="font-mono">#{{ plot.sortOrder + 1 }}</span>
                                                <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5">
                                                    {{ PLOT_KIND_LABELS[plot.kind] }}
                                                </span>
                                            </div>
                                            <div class="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                                                {{ plot.summary || "暂无 Plot 摘要" }}
                                            </div>
                                            <div v-if="plot.effect" class="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                                                结果：{{ plot.effect }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else class="mt-2 rounded-lg border border-dashed border-[var(--border-color)] px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
                                        暂无 Plot
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </SideDetailPanel>

        <FormAnnotationDialog
            v-if="selectedChapter"
            v-model="detailAiDialogOpen"
            title="章节 AI 批注"
            form-kind="chapter_meta"
            :draft="chapterAnnotationDraft"
            :context="{chapterId: selectedChapter.id, novelId: novelIdeStore.currentNovelId ?? ''}"
            @applied="applyChapterAiDraft"
        />

        <!-- 章节编辑对话框 -->
        <Dialog :model-value="showEditChapterDialog" title="编辑章节信息" width="480px" :busy="savingEditChapter" @request-close="handleEditChapterRequestClose" @update:model-value="showEditChapterDialog = $event">
            <template #header-extra>
                <div v-if="savingEditChapter || editChapterError" class="ml-2 flex items-center text-xs">
                    <span v-if="savingEditChapter" class="flex items-center gap-1 text-[var(--text-muted)]">
                        <span class="i-lucide-loader-circle animate-spin"></span>
                        保存中
                    </span>
                    <span v-else class="text-rose-500">{{ editChapterError }}</span>
                </div>
            </template>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">标题</label>
                <input v-model="editChapterForm.title" type="text" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="请输入章节标题">
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">状态</label>
                <Dropdown :items="statusDropdownItems" menu-class="left-0 top-full mt-2 w-full" @select="selectChapterStatus">
                    <button type="button" class="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)]">
                        <span class="inline-flex items-center gap-2">
                            <span class="i-lucide-circle h-3.5 w-3.5" :class="statusClass(editChapterForm.status)"></span>
                            <span>{{ statusLabel(editChapterForm.status) }}</span>
                        </span>
                        <span class="i-lucide-chevron-down h-4 w-4 text-[var(--text-muted)]"></span>
                    </button>
                </Dropdown>
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">摘要</label>
                <textarea v-model="editChapterForm.summary" rows="3" class="w-full resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="章节内容概要..."></textarea>
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">角色 (使用逗号分隔)</label>
                <input v-model="editChapterForm.characters" type="text" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="例如：张三，李四">
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">待办 (使用逗号分隔)</label>
                <input v-model="editChapterForm.todos" type="text" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="例如：修改对话，补充细节">
            </div>
            <template #footer>
                <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingEditChapter" @click="showEditChapterDialog = false">取消</button>
                <button class="inline-flex min-w-[92px] items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-white transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingEditChapter" @click="confirmEditChapter">
                    <span v-if="savingEditChapter" class="flex items-center gap-1">
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        保存中
                    </span>
                    <span v-else>确定</span>
                </button>
            </template>
        </Dialog>

        <!-- 篇编辑对话框 -->
        <Dialog :model-value="showEditVolumeDialog" title="编辑篇信息" width="480px" :busy="savingEditVolume" @request-close="handleEditVolumeRequestClose" @update:model-value="showEditVolumeDialog = $event">
            <template #header-extra>
                <div v-if="savingEditVolume || editVolumeError" class="ml-2 flex items-center text-xs">
                    <span v-if="savingEditVolume" class="flex items-center gap-1 text-[var(--text-muted)]">
                        <span class="i-lucide-loader-circle animate-spin"></span>
                        保存中
                    </span>
                    <span v-else class="text-rose-500">{{ editVolumeError }}</span>
                </div>
            </template>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">标题</label>
                <input v-model="editVolumeForm.title" type="text" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="请输入篇标题">
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-[var(--text-secondary)]">摘要</label>
                <textarea v-model="editVolumeForm.summary" rows="4" class="w-full resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]" placeholder="请输入篇摘要..."></textarea>
            </div>
            <template #footer>
                <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingEditVolume" @click="showEditVolumeDialog = false">取消</button>
                <button class="inline-flex min-w-[92px] items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-white transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="savingEditVolume" @click="confirmEditVolume">
                    <span v-if="savingEditVolume" class="flex items-center gap-1">
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        保存中
                    </span>
                    <span v-else>确定</span>
                </button>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.chapter-row[data-dragging="true"] {
    opacity: 0.95;
    transform: rotate(0.4deg);
}

.chapter-row[data-drop-target="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 45%, transparent);
}
</style>
