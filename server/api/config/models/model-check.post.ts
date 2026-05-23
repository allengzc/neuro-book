import {CheckModelRequestDtoSchema, type CheckModelRequestDto} from "nbook/shared/dto/app-settings.dto";
import {checkModelHealth} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 单模型健康检查。当前 Pi provider 检查入口未恢复，返回明确降级结果。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CheckModelRequestDto>(event, CheckModelRequestDtoSchema);
    return checkModelHealth(body.provider, body.model);
});
