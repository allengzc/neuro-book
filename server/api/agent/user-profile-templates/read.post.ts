import {UserProfileTemplateFileRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {readUserProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 读取用户 assets profile 文件详情。
 */
export default defineEventHandler(async (event) => {
    const body = UserProfileTemplateFileRequestDtoSchema.parse(await readBody(event));
    return readUserProfileTemplate(body.fileName);
});
