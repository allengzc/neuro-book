import type {ModelSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {loadAppConfig} from "nbook/server/utils/app-config";
import {buildModelSettingsDto} from "nbook/server/utils/model-settings";

/**
 * 读取模型设定。
 */
export default defineEventHandler(async (): Promise<ModelSettingsDto> => {
    const appConfig = await loadAppConfig();
    return buildModelSettingsDto(appConfig);
});
