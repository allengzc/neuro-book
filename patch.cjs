const fs = require('fs');
let content = fs.readFileSync('app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue', 'utf8');

content = content.replace(/<button type="button" class="workbench-top-button" @click="emit\('createThread'\)">[\s\S]*?<span class="i-lucide-plus h-3.5 w-3.5"><\/span>[\s\S]*?线程[\s\S]*?<\/button>\s*/, '');
content = content.replace(/<button type="button" class="workbench-top-button">[\s\S]*?<span class="i-lucide-plus h-3.5 w-3.5"><\/span>[\s\S]*?Scene[\s\S]*?<\/button>\s*/, '');
content = content.replace(/<button type="button" class="workbench-top-button">[\s\S]*?<span class="i-lucide-plus h-3.5 w-3.5"><\/span>[\s\S]*?Plot[\s\S]*?<\/button>\s*/, '');

content = content.replace(/<nav class="grid h-10 shrink-0 grid-cols-6 border-b border-\[var\(--border-color\)\] bg-\[var\(--bg-panel\)\]\/88 text-\[12px\]">/, '<nav class="flex h-11 shrink-0 items-center justify-center gap-10 border-b border-[var(--border-color)] bg-[var(--bg-panel)]/88 px-8 text-[12px] font-medium shadow-sm">');

content = content.replace(/<button[\s\S]*?v-for="tab in tabs"[\s\S]*?<\/button>/, `<button
                    v-for="tab in tabs"
                    :key="tab.value"
                    type="button"
                    class="relative inline-flex h-full items-center justify-center gap-2 transition-colors"
                    :class="activeTab === tab.value ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'"
                    @click="activeTab = tab.value"
                >
                    <span :class="tab.icon" class="h-4 w-4 transition-opacity" :class="activeTab === tab.value ? 'opacity-100' : 'opacity-60'"></span>
                    <span class="truncate">{{ tab.label }}</span>
                    <div v-if="activeTab === tab.value" class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-[var(--accent-main)]"></div>
                </button>`);

fs.writeFileSync('app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue', content);
