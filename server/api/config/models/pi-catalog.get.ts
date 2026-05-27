import {getModels, getProviders} from "@earendil-works/pi-ai";
import type {KnownProvider, Model} from "@earendil-works/pi-ai";
import {PiBuiltinCatalogDtoSchema, type PiBuiltinCatalogDto} from "nbook/shared/dto/app-settings.dto";

/**
 * 返回 Pi 内置 Provider/Model 目录，供模型连接页快速加入内置模型。
 */
export default defineEventHandler((): PiBuiltinCatalogDto => {
    return PiBuiltinCatalogDtoSchema.parse({
        providers: getProviders().map((providerId) => {
            const models = getModels(providerId as KnownProvider) as Model<any>[];
            return {
                id: providerId,
                name: providerId,
                baseUrl: models[0]?.baseUrl ?? "",
                models: models.map((model) => ({
                    id: model.id,
                    name: model.name,
                    api: model.api,
                    provider: model.provider,
                    baseUrl: model.baseUrl,
                    reasoning: model.reasoning,
                    thinkingLevelMap: model.thinkingLevelMap ?? null,
                    input: [...model.input],
                    cost: model.cost,
                    contextWindowTokens: model.contextWindow,
                    maxTokens: model.maxTokens,
                    compat: model.compat ?? null,
                })),
            };
        }).sort((left, right) => left.id.localeCompare(right.id)),
    });
});
