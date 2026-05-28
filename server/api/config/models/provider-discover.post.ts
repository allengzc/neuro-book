import {createError} from "h3";
import {DiscoverProviderModelsRequestDtoSchema, type DiscoverProviderModelsRequestDto, type ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {discoverProviderModels, withSavedProviderApiKey} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 远程模型发现。草稿未携带明文 API Key 时，回退读取已保存的 Global Config secret。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<DiscoverProviderModelsRequestDto>(event, DiscoverProviderModelsRequestDtoSchema);
    try {
        return await discoverProviderModels(withSavedApiKey(body.provider));
    } catch (error) {
        throw createError({
            statusCode: resolveDiscoveryStatusCode(error),
            message: error instanceof Error ? error.message : "Provider 模型发现失败",
        });
    }
});

/**
 * 补齐设置页不会回传的已保存 API Key。
 */
function withSavedApiKey(providerDraft: ModelProviderDraftDto): ModelProviderDraftDto {
    const savedApiKey = loadGlobalEffectiveConfigSync().models.providers[providerDraft.id]?.options.apiKey ?? "";
    return withSavedProviderApiKey(providerDraft, savedApiKey);
}

/**
 * 将远程发现失败映射成稳定 HTTP 状态。
 */
function resolveDiscoveryStatusCode(error: unknown): number {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("缺少 API Base")) {
        return 400;
    }
    if (message.includes("HTTP 401") || message.includes("HTTP 403")) {
        return 401;
    }
    return 502;
}
