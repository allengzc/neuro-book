import {UserProfileTemplateFileRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {restoreUserProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 用系统 assets 同路径文件恢复用户 profile。
 */
export default defineEventHandler(async (event) => {
    const body = UserProfileTemplateFileRequestDtoSchema.parse(await readBody(event));
    return restoreUserProfileTemplate(body.fileName);
});
