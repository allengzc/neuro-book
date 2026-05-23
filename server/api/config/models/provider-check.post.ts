import {CheckProviderRequestDtoSchema, type CheckProviderRequestDto} from "nbook/shared/dto/app-settings.dto";
import {checkProviderConnection} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * Provider 连通性测试。当前 Pi provider 检查入口未恢复，返回明确降级结果。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CheckProviderRequestDto>(event, CheckProviderRequestDtoSchema);
    return checkProviderConnection(body.provider);
});
