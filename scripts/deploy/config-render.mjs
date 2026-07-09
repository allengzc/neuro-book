/** 部署配置文件渲染（.env, config.yaml, config.json, docker-compose override）。 */

import {randomBytes} from 'node:crypto';
import * as yaml from 'yaml';
import {
    CONFIG_FILENAME,
    GLOBAL_CONFIG_FILENAME,
    LOCAL_GIT_DEPLOY_MODE,
    PROVIDERS,
} from './constants.mjs';

/** 生成 Docker Compose 使用的环境变量文件。 */
export function renderEnv(config, sessionPassword) {
    return [
        `NUXT_PORT=${config.port}`,
        `NUXT_SESSION_PASSWORD=${sessionPassword}`,
        '',
        'DATABASE_KIND=sqlite',
        'DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite',
        '',
    ].join('\n');
}

/** 生成启动/部署期 Boot Config。 */
export function renderBootConfig(config) {
    return `# neuro-book Boot Config.
# This file is for startup/deployment settings only.
# Provider keys, model defaults and Agent profile settings live in ${GLOBAL_CONFIG_FILENAME}.
server:
  host: '0.0.0.0'
  port: ${config.port}
database:
  kind: \${DATABASE_KIND:-sqlite}
  url: \${DATABASE_URL:-file:./workspace/.nbook/neuro-book.sqlite}
`;
}

/** 生成 Workspace Root \`.nbook/config.json\` 业务配置。 */
export function renderGlobalConfig(config, legacyText = null) {
    const legacy = legacyText ? parseLegacyGlobalConfig(legacyText) : null;
    const selectedProvider = config.provider ? createSelectedProvider(config) : null;
    const modelKey = selectedProvider
        ? `${selectedProvider.id}/${selectedProvider.models[0]?.id ?? ''}`
        : null;
    const providers = legacy?.models?.providers?.length && config.provider
        ? ensureSelectedProvider(legacy.models.providers, config)
        : legacy?.models?.providers?.length
        ? legacy.models.providers
        : selectedProvider
        ? [selectedProvider]
        : [];

    return `${JSON.stringify({
        auth: {
            enabled: legacy?.auth?.enabled ?? true,
        },
        models: {
            default: legacy?.models?.default ?? modelKey,
            providers,
        },
        agent: {
            defaultProfileKey: {
                novel: legacy?.agent?.defaultProfileKey?.novel ?? 'leader.default',
                userAssets: legacy?.agent?.defaultProfileKey?.userAssets ?? 'leader.assets',
            },
            profiles: legacy?.agent?.profiles ?? {},
        },
        ui: {
            theme: legacy?.ui?.theme ?? 'sepia',
            customThemes: legacy?.ui?.customThemes ?? [],
            costCurrency: legacy?.ui?.costCurrency ?? 'USD',
        },
        editor: legacy?.editor ?? {},
    }, null, 4)}\n`;
}

/** 确保本次交互选择的 Provider 也存在，但不丢弃旧配置中的其他 Provider。 */
function ensureSelectedProvider(providers, config) {
    if (providers.some((item) => item.id === config.provider)) {
        return providers;
    }
    return [...providers, createSelectedProvider(config)];
}

/** 根据交互输入创建默认 Provider 配置。 */
export function createSelectedProvider(config) {
    const provider = PROVIDERS[config.provider];
    return {
        id: config.provider,
        name: provider.name,
        options: {
            apiKey: config.apiKey,
            baseURL: provider.baseURL,
            proxy: '',
            timeoutMs: 180000,
            requestOptions: {},
        },
        models: [
            {
                name: provider.modelName,
                id: provider.modelId,
                group: provider.modelGroup,
                enabled: true,
                contextWindowTokens: provider.contextWindowTokens,
            },
        ],
    };
}

/** 从旧 config.yaml 提取可迁移的 Global Config 字段。 */
function parseLegacyGlobalConfig(text) {
    const parsed = yaml.parse(text);
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }

    const providers = parsed.models?.providers && typeof parsed.models.providers === 'object' && !Array.isArray(parsed.models.providers)
        ? Object.entries(parsed.models.providers).map(([providerId, provider]) => ({
            id: providerId,
            name: provider?.name ?? providerId,
            options: provider?.options ?? {},
            models: provider?.models && typeof provider.models === 'object' && !Array.isArray(provider.models)
                ? Object.entries(provider.models).map(([modelId, model]) => ({
                    id: model?.id ?? modelId,
                    name: model?.name ?? modelId,
                    group: model?.group ?? null,
                    enabled: model?.enabled ?? true,
                    contextWindowTokens: model?.contextWindowTokens ?? null,
                }))
                : [],
        }))
        : Array.isArray(parsed.models?.providers) ? parsed.models.providers : [];

    return {
        auth: parsed.auth,
        models: {
            default: parsed.models?.default ?? null,
            providers,
        },
        agent: parsed.agent,
        ui: parsed.ui,
        editor: parsed.editor,
    };
}

/** 生成部署 override，避免把本地私有部署文件写进仓库根配置。 */
export function renderGeneratedCompose(config) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return '';
    }

    if (config.deployMode === 'ghcr') {
        return `services:
    app:
        image: ${config.image}
        build: null
        volumes:
            - ./workspace:/app/workspace
            - ./${CONFIG_FILENAME}:/app/config.yaml
`;
    }

    return `services:
    app:
        image: neuro-book-source-runtime:latest
        build:
            context: .
            dockerfile: Dockerfile.source-runtime
        working_dir: /app
        command: ["sh", "./scripts/deploy/docker-entrypoint.sh"]
        volumes:
            - ./:/app
            - ./workspace:/app/workspace
`;
}

/** 解析当前脚本生成的 .env 文本，用于宿主机 source build。 */
export function parseEnv(text) {
    const result = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const index = trimmed.indexOf('=');
        if (index === -1) {
            continue;
        }

        result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }

    return result;
}

/** 生成部署密钥，避免 URL 密码中出现需要转义的字符。 */
export function randomSecret() {
    return randomBytes(32).toString('hex');
}
