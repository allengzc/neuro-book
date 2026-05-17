import {getCurrentUser, toAuthUser} from "nbook/server/utils/auth";
import {isAuthEnabled} from "nbook/server/utils/auth";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

/**
 * 返回当前 session 对应的有效用户。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    if (!isAuthEnabled()) {
        return {
            authEnabled: false,
            user: null,
        };
    }

    const user = await getCurrentUser(event);
    return {
        authEnabled: true,
        user: user ? toAuthUser(user) : null,
    };
});
