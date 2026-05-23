import {DiscoverProviderModelsRequestDtoSchema, type DiscoverProviderModelsRequestDto} from "nbook/shared/dto/app-settings.dto";
import {discoverProviderModels} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 远程模型发现。当前 Pi provider 检查入口未恢复，返回空结果。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<DiscoverProviderModelsRequestDto>(event, DiscoverProviderModelsRequestDtoSchema);
    return discoverProviderModels(body.provider);
});
