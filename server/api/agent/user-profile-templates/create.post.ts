import {createUserProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";
import {CreateUserProfileTemplateRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";

/**
 * 创建用户 assets profile 文件。
 */
export default defineEventHandler(async (event) => {
    const body = CreateUserProfileTemplateRequestDtoSchema.parse(await readBody(event));
    return createUserProfileTemplate(body);
});
