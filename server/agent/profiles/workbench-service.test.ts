import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {createProfileSource, listProfileTemplates, readProfileSource, saveProfileSource} from "nbook/server/agent/profiles/workbench-service";

describe("profile workbench service", () => {
    it("列出系统 profile 模板", async () => {
        await expect(listProfileTemplates()).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({name: "basic-agent"}),
            expect.objectContaining({name: "report-agent"}),
        ]));
    });

    it("拒绝越界 fileName", async () => {
        const catalog = new AgentProfileCatalog();

        await expect(saveProfileSource(catalog, {
            fileName: "../bad.profile.tsx",
            source: "",
        })).rejects.toThrow("相对路径");
    });

    it("从模板创建的 profile 可被 catalog 加载", async () => {
        const root = resolve(".agent", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
        const catalog = new AgentProfileCatalog(join(root, "assets", ".nbook", "agent", "profiles"), userRoot);
        try {
            const created = await createProfileSource(catalog, {
                profileKey: "agent.created",
                templateName: "report-agent",
                name: "Created",
                description: "",
                systemPrompt: "你是测试 Agent。",
            }, {
                userProfileRoot: userRoot,
            });

            expect(created.manifest?.key).toBe("agent.created");
            await expect(catalog.get("agent.created")).resolves.toEqual(expect.objectContaining({
                manifest: expect.objectContaining({key: "agent.created"}),
                allowedToolKeys: expect.arrayContaining(["report_result"]),
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("验证源码覆盖不写入真实用户 profile 文件", async () => {
        const root = resolve(".agent", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
        const catalog = new AgentProfileCatalog(join(root, "assets", ".nbook", "agent", "profiles"), userRoot);
        try {
            await createProfileSource(catalog, {
                profileKey: "agent.override",
                templateName: "basic-agent",
                name: "Override",
                description: "",
                systemPrompt: "原始提示词",
            }, {
                userProfileRoot: userRoot,
            });
            const fileName = "agent.override.profile.tsx";
            const filePath = join(userRoot, fileName);
            const originalSource = await readFile(filePath, "utf8");
            const checked = await readProfileSource(catalog, {
                fileName,
                source: originalSource.replace("原始提示词", "未保存提示词"),
            }, {
                userProfileRoot: userRoot,
            });

            expect(checked.source).toContain("未保存提示词");
            await expect(readFile(filePath, "utf8")).resolves.toBe(originalSource);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
