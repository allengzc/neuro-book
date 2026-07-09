import {beforeEach, describe, expect, it, vi} from "vitest";

describe("Project 控制面不要求 open", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("POST /api/projects 未 open 时仍可创建 Project", async () => {
        const writeProjectManifest = vi.fn(async () => undefined);
        const copyNovelDirectoryTemplate = vi.fn(async () => undefined);
        const initProjectDatabase = vi.fn(async () => "workspace/new-book/.nbook/project.sqlite");

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({title: "New Book", summary: "control"})),
            invalidateNovelListCache: vi.fn(),
            toNovelResponse: vi.fn((input: unknown) => input),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            buildWorkspaceSlugBase: vi.fn(() => "new-book"),
            copyNovelDirectoryTemplate,
        }));
        vi.doMock("nbook/server/workspace-files/project-workspace", () => ({
            initProjectDatabase,
            listProjectWorkspaces: vi.fn(async () => []),
            projectWorkspaceDirectoryExists: vi.fn(async () => false),
            writeProjectManifest,
        }));

        const handler = (await import("nbook/server/api/projects/index.post")).default;
        await expect(handler({} as never)).resolves.toMatchObject({
            projectPath: "workspace/new-book",
            title: "New Book",
        });
        expect(writeProjectManifest).toHaveBeenCalledWith("workspace/new-book", {
            kind: "novel",
            title: "New Book",
            summary: "control",
        });
        expect(copyNovelDirectoryTemplate).toHaveBeenCalledWith("workspace/new-book");
        expect(initProjectDatabase).toHaveBeenCalledWith("workspace/new-book");
    });

    it("DELETE /api/projects/:item 未 open 时仍可删除 Project", async () => {
        const deleteProjectWorkspace = vi.fn(async () => undefined);
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            requireProjectPathQuery: vi.fn(() => "workspace/delete-me"),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            projectOccupancy: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/workspace-files/project-workspace-delete", () => ({
            deleteProjectWorkspace,
        }));

        const handler = (await import("nbook/server/api/projects/item.delete")).default;
        await expect(handler({} as never)).resolves.toEqual({success: true});
        expect(deleteProjectWorkspace).toHaveBeenCalledWith("workspace/delete-me");
    });
});
