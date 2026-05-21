import {HumanMessage, type BaseMessage} from "@langchain/core/messages";
import {describe, expect, it} from "vitest";
import {AssetsEditorProfile} from "nbook/server/agent/profiles/builtin/assets-editor.profile";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {SkillCatalogItem, ToolKey} from "nbook/server/agent/types";

/**
 * 创建用户资产 profile 的最小 runtime。
 */
function createAssetsRuntime(input: {
    profile?: AssetsEditorProfile;
    history?: BaseMessage[];
    skillCatalog?: readonly SkillCatalogItem[];
    workspace?: string | null;
    tools?: ToolKey[];
} = {}) {
    const profile = input.profile ?? new AssetsEditorProfile();
    const workspace = input.workspace ?? "workspace/.nbook/assets";

    return {
        thread: createThreadRecord({
            profileKey: "leader.assets",
        }),
        profile,
        input: {
            prompt: "帮我调整 skill",
        },
        scope: {
            ide: {
                panel: null,
                activePanel: null,
                theme: null,
                extra: {},
            },
            studio: {
                novelId: null,
                selectedChapterId: null,
                previousSelectedChapterId: null,
                currentChapterTitle: null,
                previousChapterTitle: null,
                currentChapterLabel: null,
                previousChapterLabel: null,
                workspace,
                workspaceKind: "user-assets",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: {},
            },
            agent: {
                thread: {
                    id: "thread-assets",
                    title: "用户资产",
                    summary: "",
                    status: "idle",
                },
                profileKey: "leader.assets" as const,
                kind: "leader" as const,
                tools: input.tools ?? profile.allowedToolKeys,
                subagents: [],
                tasks: null,
            },
            input: {
                prompt: "帮我调整 skill",
            },
        },
        skillCatalog: input.skillCatalog ?? [],
        options: {},
        messageStore: {} as never,
        loadHistoryMessages: async () => input.history ?? [new HumanMessage("history")],
        threadRepository: {} as never,
        variableStore: {} as never,
    } satisfies ProfileContextRuntime<"leader.assets">;
}

describe("AssetsEditorProfile", () => {
    it("只注入用户资产编辑语义，不注入小说工作台语义", async () => {
        const profile = new AssetsEditorProfile();
        const preparedRun = await profile.prepare(createAssetsRuntime({profile}));
        const combined = preparedRun.modelMessages.map((message) => message.text).join("\n\n");

        expect(profile.key).toBe("leader.assets");
        expect(profile.kind).toBe("leader");
        expect(profile.allowedToolKeys).toContain("read_file");
        expect(profile.allowedToolKeys).toContain("skill");
        expect(profile.allowedToolKeys).not.toContain("create_subagent");
        expect(profile.allowedToolKeys).not.toContain("get_plot_tree");
        expect(combined).toContain("workspace/.nbook/assets");
        expect(combined).toContain("覆盖仓库内置 `assets/`");
        expect(combined).toContain("agent/skills/<skill>/SKILL.md");
        expect(combined).toContain("不要把单本小说内容写进这里");
        expect(combined).not.toContain("Anatomy Lorebook");
        expect(combined).not.toContain("Anatomy Manuscript");
        expect(combined).not.toContain("Plot System");
        expect(combined).not.toContain("subagent.writer");
    });
});
