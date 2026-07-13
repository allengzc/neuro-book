import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootDir = fileURLToPath(new URL("./", import.meta.url));
const serverDir = fileURLToPath(new URL("./server/", import.meta.url));
const i18nConfigPath = fileURLToPath(new URL("./app/i18n/i18n.config.ts", import.meta.url));
const runtimeWorkspaceRoot = fileURLToPath(new URL("./workspace/", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const runtimeWorkspaceWatchIgnore = [
    runtimeWorkspaceRoot,
    `${runtimeWorkspaceRoot}/**`,
    runtimeWorkspaceRoot.replace(/\//g, "\\"),
    `${runtimeWorkspaceRoot.replace(/\//g, "\\")}\\**`,
    "workspace",
    "workspace/**",
];

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
        server: {
            watch: {
                ignored: runtimeWorkspaceWatchIgnore,
            },
        },
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
        output: process.env.NEURO_BOOK_OUTPUT_DIR ? {dir: resolve(process.env.NEURO_BOOK_OUTPUT_DIR)} : undefined,
        devStorage: {
            root: {
                driver: "fs",
                readOnly: true,
                base: rootDir,
                watchOptions: {
                    ignored: runtimeWorkspaceWatchIgnore,
                },
            },
            src: {
                driver: "fs",
                readOnly: true,
                base: serverDir,
                watchOptions: {
                    ignored: runtimeWorkspaceWatchIgnore,
                },
            },
        },
        watchOptions: {
            ignored: runtimeWorkspaceWatchIgnore,
        },
        externals: {
            external: [
                "@earendil-works/pi-ai",
                "@earendil-works/pi-agent-core",
            ],
            trace: false,
        },
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
        "nbook/app/styles/reference-chips.css",
        "@vue-flow/core/dist/style.css",
        "@vue-flow/core/dist/theme-default.css",
        "@vue-flow/controls/dist/style.css",
        "@vue-flow/minimap/dist/style.css",
    ],
    modules: [
        "nuxt-auth-utils",
        "@pinia/nuxt",
        "pinia-plugin-persistedstate/nuxt",
        "@nuxtjs/i18n",
        "@unocss/nuxt",
        "@nuxtjs/color-mode",
        "@vueuse/nuxt",
    ],
    i18n: {
        strategy: "no_prefix",
        defaultLocale: "zh-CN",
        detectBrowserLanguage: false,
        locales: [
            {
                code: "zh-CN",
                language: "zh-CN",
                name: "简体中文",
            },
            {
                code: "en-US",
                language: "en-US",
                name: "English",
            },
        ],
        vueI18n: i18nConfigPath,
    },
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
