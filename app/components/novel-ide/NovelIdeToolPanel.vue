<script setup lang="ts">
import {onMounted, ref, useAttrs} from "vue";
import {storeToRefs} from "pinia";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import WorkspaceCharacterPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterPanel.vue";
import NovelPlotPanel from "nbook/app/components/novel-ide/plot/NovelPlotPanel.vue";
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";

const props = defineProps<{
    activeTab: NovelIdeTab | null;
}>();

defineOptions({
    inheritAttrs: false,
});

const emit = defineEmits<{
    (e: "close"): void;
}>();

const titleMap: Record<NovelIdeTab, string> = {
    files: "文件",
    characters: "角色",
    outline: "剧情大纲",
};

const novelIdeStore = useNovelIdeStore();
const {plotWorkbenchOpen} = storeToRefs(novelIdeStore);
const attrs = useAttrs();
const isMounted = ref(false);

onMounted(() => {
    isMounted.value = true;
});
</script>

<template>
    <!-- 左侧工具窗 -->
    <div class="contents">
        <aside v-if="activeTab" v-bind="attrs" class="z-10 flex w-[340px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]">
            <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">
                    {{ titleMap[activeTab] }}
                </span>

                <div class="flex items-center gap-0.5">
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]">
                        <span class="i-lucide-ellipsis h-4 w-4"></span>
                    </button>
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-minus h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <WorkspaceFilePanel v-if="activeTab === 'files'" />

            <WorkspaceCharacterPanel v-else-if="activeTab === 'characters'" />

            <NovelPlotPanel v-else-if="activeTab === 'outline'" />
        </aside>

        <!-- 剧本工作台 Dialog 宿主：允许顶部按钮直接打开，不强制切换左侧剧情大纲 tab。 -->
        <NovelPlotPanel v-if="isMounted && activeTab !== 'outline' && plotWorkbenchOpen" class="hidden" />
    </div>
</template>
