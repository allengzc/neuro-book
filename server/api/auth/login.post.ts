import {getRequestIP} from "h3";
import {LoginRequestDtoSchema, type AuthSessionDto} from "nbook/shared/dto/auth.dto";
import {isAuthEnabled, toAuthUser, verifyUserPassword} from "nbook/server/utils/auth";
import {assertLoginAttemptAllowed, clearLoginFailures, loginDummyPasswordHash, loginFailureMessage, recordLoginFailure} from "nbook/server/utils/login-security";
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
    const requestIp = getRequestIP(event, {xForwardedFor: true}) ?? "unknown";
    assertLoginAttemptAllowed(requestIp, body.username);

    const user = await prisma.user.findUnique({
        where: {username: body.username},
    });
    const passwordHash = user?.status === "active" ? user.passwordHash : loginDummyPasswordHash;
    const passwordMatched = await verifyUserPassword(body.password, passwordHash);

    if (!user || user.status !== "active" || !passwordMatched) {
        recordLoginFailure(requestIp, body.username);
        throw createError({
            statusCode: 401,
            message: loginFailureMessage,
        });
    }

    clearLoginFailures(requestIp, body.username);
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
