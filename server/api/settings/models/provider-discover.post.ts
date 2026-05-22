import type {DiscoverProviderModelsRequestDto, DiscoverProviderModelsResponseDto} from "nbook/shared/dto/app-settings.dto";
import {DiscoverProviderModelsRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {discoverProviderModels} from "nbook/server/utils/model-settings";

/**
 * Provider 远程模型发现。
 */
export default defineEventHandler(async (event): Promise<DiscoverProviderModelsResponseDto> => {
    const body = await validateBody<DiscoverProviderModelsRequestDto>(event, DiscoverProviderModelsRequestDtoSchema);
    return await discoverProviderModels(body.provider);
});
