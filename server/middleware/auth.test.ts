import {describe, expect, it, vi} from "vitest";

describe("auth middleware public paths", () => {
    it("允许部署健康检查读取应用版本，但不放开其他应用接口", async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        const {isPublicPath} = await import("nbook/server/middleware/auth");

        expect(isPublicPath("/api/app/version")).toBe(true);
        expect(isPublicPath("/api/app/logs/status")).toBe(false);

        vi.unstubAllGlobals();
    });
});
