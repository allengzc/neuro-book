import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {assertManagedProjectDataPlaneOpen, managedProjectPath} from "nbook/server/workspace-files/project-data-plane-guard";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";

describe("project-data-plane-guard", () => {
    it("managedProjectPath 只识别 workspace 下一级 Project Path", () => {
        expect(managedProjectPath(" workspace/alpha/ ")).toBe("workspace/alpha");
        expect(managedProjectPath("workspace")).toBeNull();
        // user-assets（Workspace Root .nbook）是控制面资源，不纳入 ProjectSession
        expect(managedProjectPath("workspace/.nbook")).toBeNull();
        expect(managedProjectPath("workspace/alpha/nested")).toBeNull();
        expect(managedProjectPath("user-assets/agents")).toBeNull();
        expect(managedProjectPath(resolve("workspace", "alpha"))).toBeNull();
        expect(managedProjectPath(undefined)).toBeNull();
    });

    it("assertManagedProjectDataPlaneOpen 只拒绝未 open 的 managed Project", () => {
        const projectPath = `workspace/not-open-${randomUUID()}`;

        expect(() => assertManagedProjectDataPlaneOpen(projectPath)).toThrow(ProjectNotOpenError);
        expect(() => assertManagedProjectDataPlaneOpen(undefined)).not.toThrow();
        expect(() => assertManagedProjectDataPlaneOpen("user-assets/agents")).not.toThrow();
        expect(() => assertManagedProjectDataPlaneOpen(resolve("workspace", "external"))).not.toThrow();
    });
});
