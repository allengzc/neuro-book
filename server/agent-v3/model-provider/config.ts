import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import yaml from "yaml";
import type {DeepSeekFlashConfig, RawAgentConfig} from "nbook/server/agent-v3/model-provider/config.types";
import {expandEnvTemplate} from "nbook/server/utils/env-template";

const DEEPSEEK_FLASH_MODEL_KEY = "deepseek/deepseek-v4-flash";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/**
 * 读取运行时 config.yaml。部署时可通过环境变量改到 .deploy/config.yaml。
 */
export function readRawAgentConfig(): RawAgentConfig {
    const configuredPath = process.env.NEURO_BOOK_CONFIG_PATH?.trim();
    const configPath = configuredPath ? resolve(process.cwd(), configuredPath) : resolve(process.cwd(), "config.yaml");
    const text = readFileSync(configPath, "utf-8");
    return yaml.parse(expandEnvTemplate(text)) as RawAgentConfig;
}

/**
 * 解析当前 v3 硬编码的 DeepSeek Flash 配置。
 */
export function resolveDeepSeekFlashConfig(config: RawAgentConfig = readRawAgentConfig()): DeepSeekFlashConfig {
    const [providerId, modelName] = DEEPSEEK_FLASH_MODEL_KEY.split("/");
    const provider = config.models?.providers?.[providerId ?? ""];
    if (!provider) {
        throw new Error(`config.yaml 未配置 provider: ${providerId}`);
    }
    if (provider.adapter !== "deepseek-official") {
        throw new Error(`provider ${providerId} 必须使用 deepseek-official adapter`);
    }

    const model = provider.models?.[modelName ?? ""];
    if (!model) {
        throw new Error(`config.yaml 未配置模型: ${DEEPSEEK_FLASH_MODEL_KEY}`);
    }
    if (model.enabled !== true) {
        throw new Error(`模型未启用: ${DEEPSEEK_FLASH_MODEL_KEY}`);
    }

    const apiKey = provider.options?.apiKey?.trim() ?? "";
    if (!apiKey) {
        throw new Error(`provider ${providerId} 未配置 API Key`);
    }

    return {
        providerId: providerId ?? "",
        providerName: provider.name?.trim() || providerId || "deepseek",
        modelKey: DEEPSEEK_FLASH_MODEL_KEY,
        modelId: model.id?.trim() || modelName || "deepseek-v4-flash",
        apiKey,
        baseURL: provider.options?.baseURL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
        proxy: provider.options?.proxy?.trim() ?? "",
    };
}
