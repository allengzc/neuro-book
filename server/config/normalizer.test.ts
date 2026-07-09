import {describe, expect, it} from "vitest";
import {normalizeGlobalConfig, resolveEffectiveConfig} from "nbook/server/config/normalizer";

describe("config normalizer theme", () => {
    it("允许内置 8 主题并保留自定义主题选择", () => {
        const global = normalizeGlobalConfig({
            ui: {
                theme: "custom-night",
                customThemes: [{
                    id: "custom-night",
                    name: "Night",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#111111",
                        "accent-main": "#88ccff",
                        unknown: "#ffffff",
                    },
                } as never, {
                    id: "custom-night",
                    name: "Duplicate",
                    appearance: "light",
                    vars: {"bg-main": "#ffffff"},
                }],
            },
        });
        const effective = resolveEffectiveConfig(global, null);

        expect(effective.ui.theme).toBe("custom-night");
        expect(effective.ui.customThemes).toEqual([{
            id: "custom-night",
            name: "Night",
            appearance: "dark",
            vars: {
                "bg-main": "#111111",
                "accent-main": "#88ccff",
            },
        }]);
    });

    it("未知主题回退 sepia，但 tokyo-night 等内置主题保持有效", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "tokyo-night"},
        }), null).ui.theme).toBe("tokyo-night");

        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "missing-theme"},
        }), null).ui.theme).toBe("sepia");
    });
});
