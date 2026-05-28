import {CheckModelRequestDtoSchema, type CheckModelRequestDto} from "nbook/shared/dto/app-settings.dto";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {checkModelHealth, withSavedProviderApiKey} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 单模型健康检查。草稿未携带明文 API Key 时，回退读取已保存的 Global Config secret。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CheckModelRequestDto>(event, CheckModelRequestDtoSchema);
    const savedApiKey = loadGlobalEffectiveConfigSync().models.providers[body.provider.id]?.options.apiKey;
    const provider = body.useSavedApiKey
        ? withSavedProviderApiKey(body.provider, savedApiKey)
        : body.provider;
    return checkModelHealth(provider, body.model);
});
