import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

/**
 * 将 node_modules 依赖拆成稳定 vendor chunk。
 * 这不是 lazyload；它只是给 Rollup 输出更稳定的缓存边界和分析命名。
 */
function resolveVendorChunk(id: string): string | undefined {
    const normalizedId = id.replace(/\\/g, "/");
    if (!normalizedId.includes("/node_modules/")) {
        return undefined;
    }

    if (normalizedId.includes("/monaco-editor/")) {
        return "vendor-monaco";
    }
    if (normalizedId.includes("/@tiptap/") || normalizedId.includes("/@milkdown/") || normalizedId.includes("/prosemirror-")) {
        return "vendor-rich-editor";
    }
    if (
        normalizedId.includes("/@vue-flow/")
        || normalizedId.includes("/@dnd-kit/")
        || normalizedId.includes("/json-editor-vue/")
        || normalizedId.includes("/jsoneditor/")
        || normalizedId.includes("/vanilla-jsoneditor/")
    ) {
        return "vendor-studio-widgets";
    }

    return undefined;
}

export default defineNuxtConfig({
    ssr: false,
    alias: {
        nbook: rootDir,
    },
    vite: {
        optimizeDeps: {
            entries: [
                "./app/app.vue",
                "./app/pages/index.vue",
            ],
            include: [
                "@dnd-kit/dom",
                "@dnd-kit/vue",
                "@milkdown/core",
                "@milkdown/prose",
                "@tiptap/core",
                "@tiptap/extension-placeholder",
                "@tiptap/markdown",
                "@tiptap/starter-kit",
                "@tiptap/suggestion",
                "@tiptap/vue-3",
                "@vue-flow/background",
                "@vue-flow/controls",
                "@vue-flow/core",
                "@vue-flow/minimap",
                "dayjs",
                "dompurify",
                "json-editor-vue",
            ],
            exclude: [
                "monaco-editor",
                "monaco-editor/esm/vs/editor/editor.api.js",
                "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js",
                "monaco-editor/esm/vs/editor/editor.worker.js",
            ],
        },
        server: {
            warmup: {
                clientFiles: [
                    "./app/app.vue",
                    "./app/pages/index.vue",
                    "./app/components/markdown-studio/MarkdownStudio.vue",
                    "./app/components/markdown-studio/MarkdownStudioWorkbench.vue",
                    "./app/components/markdown-studio/MarkdownSourceEditor.vue",
                    "./app/components/markdown-studio/TipTapMarkdownEditor.vue",
                    "./app/components/common/form/StructuredTextEditor.vue",
                    "./app/components/novel-ide/NovelAgentDrawer.vue",
                    "./app/components/novel-ide/NovelChapterPanel.vue",
                    "./app/components/novel-ide/NovelIdeSettingsDialog.vue",
                    "./app/components/novel-ide/NovelIdeToolPanel.vue",
                    "./app/components/novel-ide/plot/NovelPlotPanel.vue",
                    "./app/components/novel-ide/plot/PlotTreeView.vue",
                    "./app/components/novel-ide/plot/tree/PlotTreeCanvas.vue",
                ],
                ssrFiles: [
                    "./server/api/agent/sessions/index.get.ts",
                    "./server/api/agent/sessions/[sessionId]/index.get.ts",
                    "./server/api/agent/sessions/[sessionId]/invocations.post.ts",
                    "./server/api/config/editor-snapshot.get.ts",
                    "./server/api/novels/index.get.ts",
                    "./server/agent/http.ts",
                    "./server/agent/harness/neuro-agent-harness.ts",
                    "./server/agent/session/session-repo.ts",
                    "./server/config/config-service.ts",
                    "./server/utils/prisma.ts",
                    "./server/plot/index.ts",
                ],
            },
        },
        build: {
            reportCompressedSize: false,
            rollupOptions: {
                output: {
                    manualChunks: resolveVendorChunk,
                },
            },
        },
    },
    components: [
        {
            path: "~/components/common",
            pathPrefix: false,
            extensions: ["vue"],
        },
        {
            path: "~/components/markdown-studio",
            pathPrefix: false,
            extensions: ["vue"],
        },
        {
            path: "~/components",
            extensions: ["vue"],
        },
    ],
    nitro: {
        alias: {
            nbook: rootDir,
        },
        experimental: {
            openAPI: true,
        },
        openAPI: {
            meta: {
                title: "Neuro Book API",
                version: "1.0.0",
                description: "AI-powered novel writing platform — novels, chapters, plot management, settings, and workspace files",
            },
        },
    },
    css: [
        "the-new-css-reset/css/reset.css",
        "nbook/app/styles/theme-vars.css",
        "@vue-flow/core/dist/style.css",
        "@vue-flow/core/dist/theme-default.css",
        "@vue-flow/controls/dist/style.css",
        "@vue-flow/minimap/dist/style.css",
    ],
    modules: [
        "nuxt-auth-utils",
        "@pinia/nuxt",
        "pinia-plugin-persistedstate/nuxt",
        "@unocss/nuxt",
        "@nuxtjs/color-mode",
        "@vueuse/nuxt",
    ],
    piniaPluginPersistedstate: {
        storage: "localStorage",
    },
    colorMode: {
        preference: "dark",
        fallback: "dark",
        classSuffix: "",
    },
    compatibilityDate: "2026-03-02",
    devtools: {
        enabled: process.env.NUXT_DEVTOOLS === "1",
    },
});
