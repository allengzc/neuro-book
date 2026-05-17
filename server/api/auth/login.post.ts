import {LoginRequestDtoSchema, type AuthSessionDto} from "nbook/shared/dto/auth.dto";
import {isAuthEnabled, toAuthUser, verifyUserPassword} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 登录并写入全站 session。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isAuthEnabled()) {
        await clearUserSession(event);
        return {
            authEnabled: false,
            user: null,
        };
    }

    const body = await validateBody(event, LoginRequestDtoSchema);
    const user = await prisma.user.findUnique({
        where: {username: body.username},
    });
    if (!user || user.status !== "active") {
        throw createError({
            statusCode: 401,
            message: "用户名或密码错误",
        });
    }

    const passwordMatched = await verifyUserPassword(body.password, user.passwordHash);
    if (!passwordMatched) {
        throw createError({
            statusCode: 401,
            message: "用户名或密码错误",
        });
    }

    const updatedUser = await prisma.user.update({
        where: {id: user.id},
        data: {lastLoginAt: new Date()},
    });
    const sessionUser = toAuthUser(updatedUser);
    await setUserSession(event, {
        user: sessionUser,
    });

    return {
        authEnabled: true,
        user: sessionUser,
    };
});
