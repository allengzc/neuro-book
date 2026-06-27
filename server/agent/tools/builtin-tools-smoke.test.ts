import {describe, expect, test} from "vitest";
import {createBuiltinTools} from "./index";

describe("createBuiltinTools smoke test", () => {
    test("should not throw on initialization", () => {
        expect(() => createBuiltinTools()).not.toThrow();
    });

    test("should include execute_world_query and write_world_slice", () => {
        const tools = createBuiltinTools();
        const keys = tools.map((t) => t.key);

        expect(keys).toContain("execute_world_query");
        expect(keys).toContain("write_world_slice");

        // 确认旧的8个工具已移除
        expect(keys).not.toContain("get_world_state");
        expect(keys).not.toContain("list_world_slices");
        expect(keys).not.toContain("edit_world_slice");
        expect(keys).not.toContain("delete_world_slice");
        expect(keys).not.toContain("create_world_subject");
        expect(keys).not.toContain("get_world_schema");
        expect(keys).not.toContain("list_world_subjects");
    });
});
