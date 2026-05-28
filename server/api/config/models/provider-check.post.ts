import {CheckProviderRequestDtoSchema, type CheckProviderRequestDto} from "nbook/shared/dto/app-settings.dto";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {checkProviderConnection, withSavedProviderApiKey} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * Provider 连通性测试。草稿未携带明文 API Key 时，回退读取已保存的 Global Config secret。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CheckProviderRequestDto>(event, CheckProviderRequestDtoSchema);
    const savedProvider = loadGlobalEffectiveConfigSync().models.providers[body.provider.id];
    const provider = body.useSavedApiKey
        ? withSavedProviderApiKey(body.provider, savedProvider?.options.apiKey)
        : body.provider;
    const modelDrafts = body.models.length > 0
        ? body.models
        : body.useSavedModels
            ? Object.values(savedProvider?.models ?? {})
                .filter((model) => model.enabled)
                .map((model) => ({
                    name: model.name,
                    id: model.id,
                    group: model.group,
                    provider: model.provider,
                    api: model.api,
                    baseUrl: model.baseUrl,
                    reasoning: model.reasoning,
                    input: model.input,
                    maxTokens: model.maxTokens,
                    cost: model.cost,
                    compat: model.compat,
                    contextWindowTokens: model.contextWindowTokens,
                }))
            : [];
    return checkProviderConnection(provider, modelDrafts);
});
