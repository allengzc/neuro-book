import type {CheckModelRequestDto, CheckModelResponseDto} from "nbook/shared/dto/app-settings.dto";
import {CheckModelRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {checkModelHealth} from "nbook/server/utils/model-settings";

/**
 * 单模型健康检查。
 */
export default defineEventHandler(async (event): Promise<CheckModelResponseDto> => {
    const body = await validateBody<CheckModelRequestDto>(event, CheckModelRequestDtoSchema);
    return await checkModelHealth(body.provider, body.model);
});
