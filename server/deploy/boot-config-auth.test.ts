import {describe, expect, it} from "vitest";
import * as yaml from "yaml";
import {readFile} from "node:fs/promises";
import {
    readBootConfigAuth,
    renderBootConfig,
    renderGlobalConfig,
    resolveDeployBootConfig,
    updateBootConfigAuth,
} from "nbook/scripts/deploy/config-render.mjs";
import {
    readPortableBootAuth,
    renderPortableBootConfig,
    updatePortableBootAuth,
} from "nbook/scripts/deploy/windows-portable/launcher/boot-config.mjs";

describe("deploy Boot Config auth", () => {
    it("首次生成会显式写入鉴权选择", () => {
        expect(readBootConfigAuth(resolveDeployBootConfig(null, {port: "3000", authEnabled: true, authExplicit: false}))).toBe(true);
        expect(readBootConfigAuth(resolveDeployBootConfig(null, {port: "3000", authEnabled: false, authExplicit: true}))).toBe(false);
    });

    it("redeploy 未显式选择时保留原文件", () => {
        const existing = renderBootConfig({port: "3000", authEnabled: false});
        expect(resolveDeployBootConfig(existing, {port: "3000", authEnabled: true, authExplicit: false})).toBeNull();
    });

    it("redeploy 显式选择时更新鉴权", () => {
        const existing = renderBootConfig({port: "3000", authEnabled: false});
        const updated = resolveDeployBootConfig(existing, {port: "3000", authEnabled: true, authExplicit: true});
        expect(readBootConfigAuth(updated)).toBe(true);
    });

    it("更新鉴权时保留其他 Boot Config 字段", () => {
        const source = [
            "auth:",
            "  enabled: false",
            "server:",
            "  host: 127.0.0.1",
            "  port: 4321",
            "database:",
            "  kind: sqlite",
            "custom:",
            "  feature: keep-me",
            "",
        ].join("\n");
        const parsed = yaml.parse(updateBootConfigAuth(source, true));

        expect(parsed.auth.enabled).toBe(true);
        expect(parsed.server).toEqual({host: "127.0.0.1", port: 4321});
        expect(parsed.database).toEqual({kind: "sqlite"});
        expect(parsed.custom).toEqual({feature: "keep-me"});
    });

    it("值未变化时不要求重写", () => {
        expect(updateBootConfigAuth("auth:\n  enabled: false\n", false)).toBeNull();
        expect(updateBootConfigAuth("server: {}\n", true)).toBeNull();
    });

    it("损坏 YAML 和非法鉴权字段会明确失败", () => {
        expect(() => readBootConfigAuth("auth: [")).toThrow("无法解析 config.yaml");
        expect(() => readBootConfigAuth("- auth")).toThrow("config.yaml 顶层必须是对象");
        expect(() => readBootConfigAuth("auth: false\n")).toThrow("config.yaml auth 必须是对象");
        expect(() => readBootConfigAuth("auth:\n  enabled: disabled\n")).toThrow("config.yaml auth.enabled 必须是 boolean");
    });

    it("Global Config 永远不包含 auth", () => {
        expect(JSON.parse(renderGlobalConfig({provider: null, authEnabled: false}))).not.toHaveProperty("auth");
    });
});

describe("Windows Portable Boot Config auth", () => {
    it("Portable 打包清单包含 Boot Config 模块", async () => {
        const launcherSource = await readFile("scripts/deploy/windows-portable/launcher/launcher.mjs", "utf-8");
        expect(launcherSource).toContain('"boot-config.mjs"');
        expect(launcherSource).toContain('from "./boot-config.mjs"');
    });

    it("首次初始化默认关闭鉴权", () => {
        expect(readPortableBootAuth(renderPortableBootConfig("3000"))).toBe(false);
    });

    it("创建管理员后开启鉴权并保留其他配置", () => {
        const parsed = yaml.parse(updatePortableBootAuth(renderPortableBootConfig("4321"), true));

        expect(parsed.auth.enabled).toBe(true);
        expect(parsed.server.port).toBe(4321);
        expect(parsed.database.url).toBe("${DATABASE_URL:-file:../data/workspace/.nbook/neuro-book.sqlite}");
    });

    it("值未变化时不重写", () => {
        expect(updatePortableBootAuth(renderPortableBootConfig("3000"), false)).toBeNull();
    });

    it("损坏配置会明确失败", () => {
        expect(() => readPortableBootAuth("auth: [")).toThrow("无法解析 Portable data/config.yaml");
        expect(() => readPortableBootAuth("auth:\n  enabled: disabled\n")).toThrow("auth.enabled 必须是 boolean");
    });
});
