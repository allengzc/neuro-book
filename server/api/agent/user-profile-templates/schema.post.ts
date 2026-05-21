import {updateUserProfileSchema} from "nbook/server/agent/profile-templates/profile-template-service";
import {UpdateAgentProfileSchemaRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 局部替换用户 assets profile 的 InputSchema 或 OutputSchema 声明。
 */
export default defineEventHandler(async (event) => {
    const body = UpdateAgentProfileSchemaRequestDtoSchema.parse(await readBody(event));
    return updateUserProfileSchema(body.fileName, body.schemaName, body.fields);
});
