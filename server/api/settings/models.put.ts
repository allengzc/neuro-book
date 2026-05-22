import type {ModelSettingsDto, UpdateModelSettingsRequestDto} from "nbook/shared/dto/app-settings.dto";
import {UpdateModelSettingsRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {saveModelSettingsConfig} from "nbook/server/utils/app-config";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {buildModelSettingsDto, convertModelSettingsRequestToConfig} from "nbook/server/utils/model-settings";

/**
 * 保存模型设定。
 */
export default defineEventHandler(async (event): Promise<ModelSettingsDto> => {
    const body = await validateBody<UpdateModelSettingsRequestDto>(event, UpdateModelSettingsRequestDtoSchema);
    const appConfig = await saveModelSettingsConfig(convertModelSettingsRequestToConfig(body));
    return buildModelSettingsDto(appConfig);
});
