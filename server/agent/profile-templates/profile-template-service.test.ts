import {describe, expect, it} from "vitest";
import {mkdir, readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {
    generateProfileTemplateSource,
    parseProfileTemplateSource,
    previewProfileTemplate,
} from "nbook/server/agent/profile-templates/profile-template-service";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";
import {LeaderInputSchema, WriterInputSchema, type AgentVariableScope, type ProfileKey} from "nbook/server/agent/types";
import {saveProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";

const VALID_SOURCE = `/** @jsxRuntime automatic */
/** @jsxImportSource nbook/server/agent/prompts */

import {Message} from "nbook/server/agent/prompts";
import {AppendingSet, HistorySet, ProfilePrompt, Watch} from "nbook/server/agent/profiles/simple-profile";
import type {ProfilePromptContext} from "nbook/server/agent/profiles/simple-profile";

export default function Demo(_ctx: ProfilePromptContext<"leader.default">) {
    return (
        <ProfilePrompt>
            <HistorySet>
                <Message role="system">system prompt</Message>
            </HistorySet>
            <AppendingSet>
                <Watch path="scope.studio.workspace" />
                <Message role="human" source="input">hello</Message>
            </AppendingSet>
        </ProfilePrompt>
    );
}`;

describe("profile-template-service", () => {
    it("解析合法 TSX 模板为结构化树", () => {
        const result = parseProfileTemplateSource(VALID_SOURCE);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.root?.type).toBe("ProfilePrompt");
        expect(result.root?.children.map((node) => node.type)).toEqual(["HistorySet", "AppendingSet"]);
    });

    it("校验非法根节点和 Watch path", () => {
        const source = VALID_SOURCE
            .replace("<ProfilePrompt>", "<HistorySet>")
            .replace("</ProfilePrompt>", "</HistorySet>")
            .replace("scope.studio.workspace", "studio.workspace");

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("模板根节点必须是 ProfilePrompt");
        expect(result.issues.map((issue) => issue.message)).toContain("Watch.path 必须以 scope. 开头");
    });

    it("从 AST 生成 TSX 后可再次解析", () => {
        const root: ProfileTemplateNodeDto = {
            id: "root",
            type: "ProfilePrompt",
            props: {},
            editable: true,
            children: [{
                id: "history",
                type: "HistorySet",
                props: {},
                editable: true,
                children: [{
                    id: "message",
                    type: "Message",
                    props: {role: "system"},
                    text: "hello",
                    editable: true,
                    children: [],
                }],
            }],
        };

        const source = generateProfileTemplateSource("demo-template", root);
        const result = parseProfileTemplateSource(source);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.root?.children[0]?.children[0]?.text).toBe("hello");
    });

    it("预览模板会返回消息序列", () => {
        const result = previewProfileTemplate({source: VALID_SOURCE});

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
            "system:system prompt",
            "system:Watch: scope.studio.workspace",
            "human:hello",
        ]);
    });

    it("预览模板会返回带当前值的变量", () => {
        const scope = createPreviewScope({
            workspace: "workspace/demo",
            threadId: "thread-1",
        });

        const result = previewProfileTemplate({source: VALID_SOURCE, scope});

        const workspace = result.variables.flatMap((group) => group.items).find((item) => item.path === "scope.studio.workspace");
        const thread = result.variables.flatMap((group) => group.items).find((item) => item.path === "runtime.thread.id");
        expect(workspace?.currentValue).toBe("workspace/demo");
        expect(thread?.currentValue).toBe("thread-1");
    });

    it("预览变量会使用当前 profile.inputSchema 展示 input 字段", () => {
        const baseScope = createPreviewScope({threadId: "thread-writer"});
        const writerProfile = createProfileStub("subagent.writer", WriterInputSchema);
        const scope = {
            ...baseScope,
            agent: {
                ...baseScope.agent,
                profileKey: "subagent.writer",
                kind: "subagent",
            },
            input: {
                prompt: "写一段开场",
                plotPoints: ["scene-1"],
                lorebookEntries: [{path: "lorebook/world/index.md"}],
                constraints: ["保持第三人称"],
            },
        } as AgentVariableScope;

        const result = previewProfileTemplate({
            source: VALID_SOURCE,
            scope,
            profile: writerProfile,
        });
        const variables = result.variables.flatMap((group) => group.items);
        const prompt = variables.find((item) => item.path === "input.prompt");
        const lorebookEntries = variables.find((item) => item.path === "input.lorebookEntries");

        expect(prompt?.source).toBe("profile.inputSchema");
        expect(prompt?.schema).toMatchObject({type: "string"});
        expect(prompt?.currentValue).toBe("写一段开场");
        expect(lorebookEntries?.valueType).toBe("array");
        expect(lorebookEntries?.schema).toMatchObject({type: "array"});
    });

    it("预览变量会给 scope 分组提供 schema 与当前值", () => {
        const profile = createProfileStub("leader.default", LeaderInputSchema);
        const scope = createPreviewScope({
            workspace: "workspace/demo",
            threadId: "thread-1",
        });

        const result = previewProfileTemplate({
            source: VALID_SOURCE,
            scope,
            profile,
        });
        const variables = result.variables.flatMap((group) => group.items);
        const ide = variables.find((item) => item.path === "scope.ide");
        const workspace = variables.find((item) => item.path === "scope.studio.workspace");
        const subagents = variables.find((item) => item.path === "scope.agent.subagents");

        expect(ide?.schema).toMatchObject({type: "object"});
        expect(workspace?.currentValue).toBe("workspace/demo");
        expect(workspace?.source).toBe("clientVariables.studio");
        expect(subagents?.schema).toMatchObject({type: "array"});
    });

    it("预览变量会把 extra 这类动态对象按普通 object 展示", () => {
        const scope = createPreviewScope({
            workspace: "workspace/demo",
            threadId: "thread-1",
        });

        const result = previewProfileTemplate({
            source: VALID_SOURCE,
            scope,
            profile: createProfileStub("leader.default", LeaderInputSchema),
        });
        const selectedStoryThreadId = result.variables
            .flatMap((group) => group.items)
            .find((item) => item.path === "scope.studio.extra.selectedStoryThreadId");

        expect(selectedStoryThreadId?.currentValue).toBe("story-thread-1");
        expect(selectedStoryThreadId?.valueType).toBe("string");
    });

    it("预览模板支持 input.prompt 覆盖 source=input 消息", () => {
        const source = VALID_SOURCE.replace("hello", "");

        const result = previewProfileTemplate({
            source,
            inputOverrides: {
                "input.prompt": "用户的新输入",
            },
        });

        expect(result.messages.at(-1)?.text).toBe("用户的新输入");
    });

    it("预览模板会替换正文中的变量 token", () => {
        const source = VALID_SOURCE.replace("system prompt", "workspace={{scope.studio.workspace}}");
        const scope = createPreviewScope({workspace: "workspace/demo"});

        const result = previewProfileTemplate({source, scope});

        expect(result.messages[0]?.text).toBe("workspace=workspace/demo");
    });

    it("Message 中的变量 token 不会被 TSX 表达式解析吞掉一层大括号", () => {
        const source = VALID_SOURCE.replace("system prompt", "{{scope.studio.workspace}}");

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[0]?.children[0];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(message?.textKind).toBeUndefined();
        expect(message?.text).toBe("{{scope.studio.workspace}}");
        expect(generated).toContain("{{scope.studio.workspace}}");
    });

    it("保留表达式属性并生成 TSX 表达式", () => {
        const source = VALID_SOURCE.replace(
            '<Watch path="scope.studio.workspace" />',
            '<Reminder id="tasks" watchValue={ctx.scope.agent.tasks} repeatEveryTurns={5}><Message role="system">tasks</Message></Reminder>',
        );

        const result = parseProfileTemplateSource(source);
        const reminder = result.root?.children[1]?.children[0];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(reminder?.props.watchValue).toEqual({kind: "expression", code: "ctx.scope.agent.tasks"});
        expect(generated).toContain("watchValue={ctx.scope.agent.tasks}");
    });

    it("保留 Message 中的模板字符串正文", () => {
        const source = VALID_SOURCE.replace("hello", "{`hello ${ctx.runtime.thread.id}`}");

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[1]?.children[1];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(message?.textKind).toBe("template");
        expect(message?.text).toBe("hello ${ctx.runtime.thread.id}");
        expect(generated).toContain("{`hello ${ctx.runtime.thread.id}`}");
    });

    it("Message 中的模板字符串只暴露可编辑正文，不暴露 JSX 包装", () => {
        const source = VALID_SOURCE.replace(
            "hello",
            "{`\\n\\n【当前已关联 subagent】\\n${JSON.stringify(ctx.scope.agent.subagents ?? [])}`}",
        );

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[1]?.children[1];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);
        const normalizedGenerated = stripLineIndent(generated);

        expect(message?.textKind).toBe("template");
        expect(message?.text).toBe("\n\n【当前已关联 subagent】\n${JSON.stringify(ctx.scope.agent.subagents ?? [])}");
        expect(message?.text).not.toContain("{`");
        expect(normalizedGenerated).toContain("{\"\\n\"}\n{\"\\n\"}\n{`【当前已关联 subagent】`}\n{\"\\n\"}\n{`${JSON.stringify(ctx.scope.agent.subagents ?? [])}`}");
    });

    it("Message 普通正文允许直接编辑尖括号文本", () => {
        const root: ProfileTemplateNodeDto = {
            id: "root",
            type: "ProfilePrompt",
            props: {},
            editable: true,
            children: [{
                id: "history",
                type: "HistorySet",
                props: {},
                editable: true,
                children: [{
                    id: "message",
                    type: "Message",
                    props: {role: "system"},
                    text: "<system-reminder>\n# 标题\n</system-reminder>",
                    textKind: "text",
                    editable: true,
                    children: [],
                }],
            }],
        };

        const source = generateProfileTemplateSource("demo-template", root);
        const result = parseProfileTemplateSource(source);
        const normalizedSource = stripLineIndent(source);

        expect(normalizedSource).toContain("{`<system-reminder>`}\n{\"\\n\"}\n{`# 标题`}\n{\"\\n\"}\n{`</system-reminder>`}");
        expect(result.root?.children[0]?.children[0]?.text).toBe("<system-reminder>\n# 标题\n</system-reminder>");
    });

    it("Message 正文统一用模板字符串生成并保留空行", () => {
        const root: ProfileTemplateNodeDto = {
            id: "root",
            type: "ProfilePrompt",
            props: {},
            editable: true,
            children: [{
                id: "history",
                type: "HistorySet",
                props: {},
                editable: true,
                children: [{
                    id: "message",
                    type: "Message",
                    props: {role: "system"},
                    text: "第一行\n\n    保留缩进\n最后一行",
                    editable: true,
                    children: [],
                }],
            }],
        };

        const source = generateProfileTemplateSource("demo-template", root);
        const result = parseProfileTemplateSource(source);
        const normalizedSource = stripLineIndent(source);

        expect(normalizedSource).toContain("{`第一行`}\n{\"\\n\"}\n{\"\\n\"}\n{`    保留缩进`}\n{\"\\n\"}\n{`最后一行`}");
        expect(result.root?.children[0]?.children[0]?.text).toBe("第一行\n\n    保留缩进\n最后一行");
    });

    it("Message 内的小写 JSX 标签按正文处理", () => {
        const source = VALID_SOURCE.replace(
            "hello",
            "<system-reminder># 标题</system-reminder>",
        );

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[1]?.children[1];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(message?.text).toBe("<system-reminder># 标题</system-reminder>");
        expect(generated).toContain("{`<system-reminder># 标题</system-reminder>`}");
    });

    it("Message 节点内不能放 Message 节点", () => {
        const source = VALID_SOURCE.replace(
            '<Message role="system">system prompt</Message>',
            '<Message role="system"><Message role="system">nested</Message></Message>',
        );

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("Message 节点内不能放 Message 节点");
    });

    it("AIMessage 支持 ToolCall 预览", () => {
        const source = VALID_SOURCE
            .replace('import {Message} from "nbook/server/agent/prompts";', 'import {AIMessage, Message, ToolCall} from "nbook/server/agent/prompts";')
            .replace(
                '<Watch path="scope.studio.workspace" />',
                '<AIMessage>我会读取文件<ToolCall id="call-1" name="read_file">{`{"path":"workspace/index.md"}`}</ToolCall></AIMessage>',
            );

        const result = previewProfileTemplate({source});
        const assistant = result.messages.find((message) => message.role === "assistant");
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(assistant?.text).toBe("我会读取文件");
        expect(assistant?.toolCalls).toEqual([{id: "call-1", name: "read_file", argsText: "{\"path\":\"workspace/index.md\"}"}]);
        expect(generated).toContain("AIMessage");
        expect(generated).toContain("Message");
        expect(generated).toContain("<ToolCall id=\"call-1\" name=\"read_file\">");
    });

    it("ToolCall 必须放在 AIMessage 内", () => {
        const source = VALID_SOURCE
            .replace('import {Message} from "nbook/server/agent/prompts";', 'import {Message, ToolCall} from "nbook/server/agent/prompts";')
            .replace('<Watch path="scope.studio.workspace" />', '<ToolCall name="read_file" />');

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("ToolCall 必须放在 AIMessage 内");
    });

    it("SkillCatalog 必须放在 Message 内", () => {
        const source = VALID_SOURCE.replace(
            '<Watch path="scope.studio.workspace" />',
            "<SkillCatalog />",
        );

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("SkillCatalog 返回字符串，必须放在 Message 内");
    });

    it("不支持的模板组件会返回源码定位", () => {
        const source = VALID_SOURCE.replace("<Watch path=\"scope.studio.workspace\" />", "<UnknownNode />");

        const result = parseProfileTemplateSource(source);
        const issue = result.issues.find((item) => item.message === "不支持的模板组件：UnknownNode");

        expect(issue?.path).toMatch(/^template\.tsx:\d+:\d+$/);
        expect(issue?.sourceText).toBe("<UnknownNode />");
        expect(issue?.sourceRange?.end).toBeGreaterThan(issue?.sourceRange?.start ?? 0);
    });

    it("Message 外的小写标签会说明应改为正文文本", () => {
        const source = VALID_SOURCE.replace("<Watch path=\"scope.studio.workspace\" />", "<system-reminder />");

        const result = parseProfileTemplateSource(source);
        const issue = result.issues.find((item) => item.message.includes("不支持的模板组件：system-reminder"));

        expect(issue?.message).toContain("小写标签只有放在 Message 正文中才会按文本保留");
        expect(issue?.sourceText).toBe("<system-reminder />");
    });

    it("leader-runtime 模板可以解析为无错误的 ProfilePrompt", async () => {
        const source = await readFile(resolve(process.cwd(), "server/agent/profiles/templates/leader-runtime.tsx"), "utf-8");
        const result = parseProfileTemplateSource(source);

        expect(result.root?.type).toBe("ProfilePrompt");
        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    });

    it("保存源码时不会自动追加换行", async () => {
        const templatePath = resolve(process.cwd(), "server/agent/profiles/templates/save-no-newline.test.tsx");
        await mkdir(resolve(process.cwd(), "server/agent/profiles/templates"), {recursive: true});
        try {
            await saveProfileTemplate("save-no-newline.test", {source: VALID_SOURCE});

            const saved = await readFile(templatePath, "utf-8");

            expect(VALID_SOURCE.endsWith("\n")).toBe(false);
            expect(saved).toBe(VALID_SOURCE);
        } finally {
            await rm(templatePath, {force: true});
        }
    });
});

function createPreviewScope(input: {
    workspace?: string;
    threadId?: string;
}): AgentVariableScope {
    return {
        ide: {
            panel: null,
            activePanel: null,
            theme: "sepia",
            extra: {
                customFlag: true,
            },
        },
            studio: {
                novelId: "novel-1",
                selectedChapterId: null,
                previousSelectedChapterId: null,
                currentChapterTitle: null,
                previousChapterTitle: null,
                currentChapterLabel: null,
                previousChapterLabel: null,
                workspace: input.workspace ?? null,
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: 0,
                extra: {
                    selectedStoryThreadId: "story-thread-1",
                    selectedStorySceneId: "story-scene-1",
                },
            },
        agent: {
            thread: {
                id: input.threadId ?? "thread-1",
                title: "Leader",
                summary: "",
                status: "idle",
            },
            profileKey: "leader.default",
            kind: "leader",
            tools: [],
            subagents: [],
            tasks: null,
        },
        input: {
            mode: "prompt",
            prompt: "默认输入",
        },
    };
}

function createProfileStub<TKey extends ProfileKey>(key: TKey, inputSchema: AgentProfile<TKey>["inputSchema"]): AgentProfile<TKey> {
    return {
        key,
        kind: key === "leader.default" ? "leader" : "subagent",
        name: key,
        inputSchema,
        allowedToolKeys: [],
        async prepare() {
            throw new Error("profile stub 不应执行 prepare");
        },
        async ingest(input: Parameters<AgentProfile<TKey>["ingest"]>[0]) {
            return input.messages;
        },
    } as unknown as AgentProfile<TKey>;
}

function stripLineIndent(text: string): string {
    return text.split("\n").map((line) => line.trimStart()).join("\n");
}
