import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {buildSystemPromptRoot} from "nbook/server/agent/profiles/profile-http-service";
import {
    createProfileSource,
    createProfileSourceDraft,
    listProfileFiles,
    listProfileTemplates,
    readProfileSource,
    readProfileSourceDraft,
    saveProfileSource,
} from "nbook/server/agent/profiles/workbench-service";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";

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
        const root = resolve(".agent", "workspace", "profile-workbench-test", randomUUID());
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

    it("轻量 draft 读取不触发 runtime catalog", async () => {
        const root = resolve(".agent", "workspace", "profile-workbench-test", randomUUID());
        const userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
        try {
            const created = await createProfileSourceDraft({
                profileKey: "agent.draft",
                templateName: "basic-agent",
                name: "Draft",
                description: "",
                systemPrompt: "轻量草稿",
            }, {
                userProfileRoot: userRoot,
            });
            expect(created.name).toBe("agent.draft");

            const listed = await listProfileFiles({userProfileRoot: userRoot});
            expect(listed).toEqual([expect.objectContaining({
                fileName: "agent.draft.profile.tsx",
                profileKey: "agent.draft",
                loadStatus: "loaded",
            })]);

            const detail = await readProfileSourceDraft({
                fileName: "agent.draft.profile.tsx",
                source: created.source.replace("轻量草稿", "未保存草稿"),
            }, {
                userProfileRoot: userRoot,
            });
            expect(detail.source).toContain("未保存草稿");
            expect(detail.root?.type).toBe("ProfilePrompt");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("解析新 TSX DSL 为 ProfilePrompt tree", () => {
        const root = buildSystemPromptRoot(`
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

export default defineAgentProfile({
    manifest: {key: "agent.parser", name: "Parser"},
    inputSchema: {},
    outputSchema: {},
    allowedToolKeys: [],
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <HistorySet>
                    <AIMessage>
                        <ToolCall id="call_read" name="read" args={{ path: "workspace/" }} />
                    </AIMessage>
                    <ToolResult toolCallId="call_read" toolName="read">ok</ToolResult>
                    <Message>历史初始化</Message>
                </HistorySet>
                <ModelContext>
                    <Message>{ctx.runtime?.now}</Message>
                </ModelContext>
                <AppendingSet>
                    <Reminder id="plan">
                        <Message>提醒</Message>
                    </Reminder>
                    <Watch path="ctx.input.prompt" />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
        `);

        expect(root).toEqual(expect.objectContaining({
            type: "ProfilePrompt",
            sourceRange: expect.objectContaining({
                start: expect.any(Number),
                end: expect.any(Number),
            }),
        }));
        expect(root?.children.map((node) => node.type)).toEqual([
            "System",
            "HistorySet",
            "ModelContext",
            "AppendingSet",
        ]);
        expect(root?.children[0]?.children[0]).toEqual(expect.objectContaining({
            type: "Text",
            textKind: "source",
            text: "renderSystemPrompt()",
        }));
        const toolCall = root?.children[1]?.children[0]?.children[0];
        expect(toolCall).toEqual(expect.objectContaining({
            type: "ToolCall",
            textKind: "source",
            text: "{ path: \"workspace/\" }",
        }));
        expect(root?.children[2]?.children.map((node) => node.type)).toEqual(["Message"]);
    });

    it("验证源码覆盖不写入真实用户 profile 文件", async () => {
        const root = resolve(".agent", "workspace", "profile-workbench-test", randomUUID());
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
            expect(checked.root?.children.map((node: ProfileTemplateNodeDto) => node.type)).toContain("System");
            await expect(readFile(filePath, "utf8")).resolves.toBe(originalSource);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
