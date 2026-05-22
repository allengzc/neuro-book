import type {CheckProviderRequestDto, CheckProviderResponseDto} from "nbook/shared/dto/app-settings.dto";
import {CheckProviderRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {checkProviderConnection} from "nbook/server/utils/model-settings";

/**
 * Provider 连通性测试。
 */
export default defineEventHandler(async (event): Promise<CheckProviderResponseDto> => {
    const body = await validateBody<CheckProviderRequestDto>(event, CheckProviderRequestDtoSchema);
    return await checkProviderConnection(body.provider);
});
