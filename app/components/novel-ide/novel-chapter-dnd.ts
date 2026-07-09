import type { Data } from "@dnd-kit/abstract";
import { move } from "@dnd-kit/helpers";
import type { DragDropProviderEmits } from "@dnd-kit/vue";
import type {
    ChapterSummaryDto,
    ReorderChaptersRequestDto,
    ReorderVolumesRequestDto,
    VolumeDto,
} from "nbook/shared/dto/novel-chapter.dto";

export type LocalVolume = VolumeDto & { isExpanded: boolean };
export type ChapterGroups = Record<string, ChapterSummaryDto[]>;

export type VolumeDragData = {
    kind: "volume";
    volumeId: string;
};

export type ChapterDragData = {
    kind: "chapter";
    chapterId: string;
    volumeId: string;
};

type DragOverPayload = DragDropProviderEmits["dragOver"][0];

/**
 * 判断是否为篇拖拽数据。
 */
export const isVolumeDragData = (data: Data | undefined): data is VolumeDragData => data?.kind === "volume" && typeof data.volumeId === "string";

/**
 * 判断是否为章节拖拽数据。
 */
export const isChapterDragData = (data: Data | undefined): data is ChapterDragData => (
    data?.kind === "chapter"
    && typeof data.chapterId === "string"
    && typeof data.volumeId === "string"
);

/**
 * 深拷贝本地篇列表，避免拖拽中直接污染父层 props。
 */
export const cloneLocalVolumes = (items: LocalVolume[]): LocalVolume[] => items.map((volume) => ({
    ...volume,
    chapters: volume.chapters.map((chapter) => ({ ...chapter })),
}));

/**
 * 保留展开状态，同步后端最新树。
 */
export const buildLocalVolumes = (nextVolumes: VolumeDto[], currentVolumes: LocalVolume[]): LocalVolume[] => {
    const expandedMap = new Map(currentVolumes.map((volume) => [volume.id, volume.isExpanded]));
    return cloneLocalVolumes(nextVolumes.map((volume, index) => ({
        ...volume,
        isExpanded: expandedMap.get(volume.id) ?? index === 0,
    })));
};

/**
 * 将篇列表转换成 dnd-kit 官方 move helper 使用的分组结构。
 */
export const buildChapterGroups = (volumes: LocalVolume[]): ChapterGroups => Object.fromEntries(
    volumes.map((volume) => [
        volume.id,
        volume.chapters.map((chapter) => ({ ...chapter })),
    ])
);

/**
 * 将分组结构回写为本地篇列表，并重算章节编号与所属篇。
 */
export const applyChapterGroups = (volumes: LocalVolume[], groups: ChapterGroups): LocalVolume[] => volumes.map((volume) => ({
    ...volume,
    chapters: (groups[volume.id] ?? []).map((chapter, index) => ({
        ...chapter,
        volumeId: volume.id,
        sortOrder: index,
    })),
}));

/**
 * 判断章节分组顺序是否发生变化。
 */
export const hasChapterGroupsChanged = (left: ChapterGroups, right: ChapterGroups): boolean => {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        const leftIds = (left[key] ?? []).map((chapter) => chapter.id);
        const rightIds = (right[key] ?? []).map((chapter) => chapter.id);
        if (leftIds.length !== rightIds.length) {
            return true;
        }
        if (leftIds.some((id, index) => id !== rightIds[index])) {
            return true;
        }
    }

    return false;
};

/**
 * 判断篇顺序是否发生变化。
 */
export const hasVolumeOrderChanged = (left: LocalVolume[], right: LocalVolume[]): boolean => left.some((volume, index) => volume.id !== right[index]?.id);

/**
 * 构建篇排序快照。
 */
export const buildVolumeReorderItems = (volumes: LocalVolume[]): ReorderVolumesRequestDto["items"] => volumes.map((volume, index) => ({
    volumeId: volume.id,
    sortOrder: index,
}));

/**
 * 构建章节排序快照。
 */
export const buildChapterReorderItems = (volumes: LocalVolume[]): ReorderChaptersRequestDto["items"] => volumes.flatMap((volume) => volume.chapters.map((chapter, index) => ({
    chapterId: chapter.id,
    volumeId: volume.id,
    sortOrder: index,
})));

/**
 * 应用篇拖拽中的乐观排序。
 */
export const applyVolumeDragMove = (volumes: LocalVolume[], event: DragOverPayload): LocalVolume[] => move(volumes, event) as LocalVolume[];

/**
 * 应用章节拖拽中的乐观排序。
 */
export const applyChapterDragMove = (volumes: LocalVolume[], event: DragOverPayload): LocalVolume[] => {
    const currentGroups = buildChapterGroups(volumes);
    const nextGroups = move(currentGroups, event) as ChapterGroups;
    return applyChapterGroups(volumes, nextGroups);
};
