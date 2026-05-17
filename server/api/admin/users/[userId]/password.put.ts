import {ResetUserPasswordRequestDtoSchema, type AdminUserListItemDto} from "nbook/shared/dto/auth.dto";
import {hashUserPassword, isAuthEnabled, requireAdmin, requireUserId, toAdminUserListItem} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 管理员重置用户密码，并让旧 session 失效。
 */
export default defineEventHandler(async (event): Promise<AdminUserListItemDto> => {
    if (isAuthEnabled()) {
        await requireAdmin(event);
    }
    const userId = requireUserId(event);
    const body = await validateBody(event, ResetUserPasswordRequestDtoSchema);
    const user = await prisma.user.update({
        where: {id: userId},
        data: {
            passwordHash: await hashUserPassword(body.password),
            sessionVersion: {increment: 1},
        },
    }).catch(() => {
        throw createError({
            statusCode: 404,
            message: "用户不存在",
        });
    });

    return toAdminUserListItem(user);
});
