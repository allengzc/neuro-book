import {SaveProfileTemplateRequestDtoSchema, UserProfileTemplateFileRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {saveUserProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 保存用户 assets profile 文件。
 */
export default defineEventHandler(async (event) => {
    const body = UserProfileTemplateFileRequestDtoSchema
        .merge(SaveProfileTemplateRequestDtoSchema)
        .parse(await readBody(event));
    return saveUserProfileTemplate(body.fileName, body);
});
