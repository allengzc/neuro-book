import {describe, expect, test} from "vitest";
import writerProfile from "./writer.profile";

describe("writer.profile", () => {
    test("profile manifest is correct", () => {
        expect(writerProfile.manifest.key).toBe("writer");
        expect(writerProfile.manifest.name).toBe("正文写作");
    });

    test("profile has bash tool", () => {
        const toolKeys = writerProfile.rootToolKeys;
        expect(toolKeys).toBeDefined();
        expect(toolKeys).toContain("bash");
    });

    test("profile has World Engine read-only execute tool and no Plot tools", () => {
        const toolKeys = writerProfile.rootToolKeys;

        expect(toolKeys).toContain("execute_world");
        expect(toolKeys).not.toContain("write_world_slice");
        expect(toolKeys).not.toContain("delete_world_slice");
        expect(toolKeys).not.toContain("get_story_thread");
        expect(toolKeys).not.toContain("get_story_scene_context");
        expect(toolKeys).not.toContain("get_story_plot_context");
        expect(toolKeys).not.toContain("get_chapter_plot");
    });

    test("profile has file tools", () => {
        const toolKeys = writerProfile.rootToolKeys;

        expect(toolKeys).toContain("read");
        expect(toolKeys).toContain("write");
        expect(toolKeys).toContain("edit");
        expect(toolKeys).not.toContain("apply_patch");
    });

    test("profile schemas are defined", () => {
        expect(writerProfile.initialSchema).toBeDefined();
        expect(writerProfile.payloadSchema).toBeDefined();
        expect(writerProfile.outputSchema).toBeDefined();
    });
});
