import {beforeEach, describe, expect, it, vi} from "vitest";

const {prismaMock} = vi.hoisted(() => ({
    prismaMock: {
        user: {
            findUnique: vi.fn(),
            count: vi.fn(),
        },
    },
}));

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: prismaMock,
}));

describe("auth utils", () => {
    beforeEach(() => {
        const globals = globalThis as typeof globalThis & {
            createError?: unknown;
        };
        globals.createError = ((input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        }) as never;
    });

    it("密码哈希可以正确校验", async () => {
        const {hashUserPassword, verifyUserPassword} = await import("nbook/server/utils/auth");
        const hash = await hashUserPassword("secret123");
        await expect(verifyUserPassword("secret123", hash)).resolves.toBe(true);
        await expect(verifyUserPassword("wrong", hash)).resolves.toBe(false);
    });

    it("不能移除最后一个可用管理员", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "x",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        });
        prismaMock.user.count.mockResolvedValue(0);

        const {assertCanChangeAdminState} = await import("nbook/server/utils/auth");
        await expect(assertCanChangeAdminState(1, "user", "active")).rejects.toMatchObject({
            statusCode: 400,
        });
    });
});
