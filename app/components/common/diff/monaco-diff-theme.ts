import {buildMonacoTheme} from "nbook/app/components/markdown-studio/monaco-theme";
import type {MonacoEditorApi} from "nbook/app/components/markdown-studio/load-monaco-editor";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";

export function readDiffThemeVars(host: HTMLElement | null): CSSStyleDeclaration {
    const themeHost = host?.closest(".novel-ide-theme");
    return getComputedStyle(themeHost ?? document.documentElement);
}

export function applyMonacoDiffTheme(monacoApi: MonacoEditorApi, theme: IdeTheme, host: HTMLElement | null): string {
    const cssVars = readDiffThemeVars(host);
    const themeName = `neuro-book-diff-${theme}`;
    monacoApi.editor.defineTheme(themeName, buildMonacoTheme(theme, {
        accent: cssVars.getPropertyValue("--accent-main").trim() || "#3b82f6",
        background: cssVars.getPropertyValue("--source-bg").trim() || "#1f1f1f",
        border: cssVars.getPropertyValue("--border-color").trim() || "#2b3340",
        foreground: cssVars.getPropertyValue("--source-text").trim() || "#f3f4f6",
        hover: cssVars.getPropertyValue("--bg-hover").trim() || "rgba(255,255,255,0.04)",
        muted: cssVars.getPropertyValue("--source-muted").trim() || "#94a3b8",
        selection: cssVars.getPropertyValue("--accent-bg").trim() || "rgba(59,130,246,0.18)",
    }));
    monacoApi.editor.setTheme(themeName);
    return themeName;
}
