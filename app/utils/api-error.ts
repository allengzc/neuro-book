const DEFAULT_API_ERROR_MESSAGE = "请求失败";

type I18nRuntime = {
    t: (key: string) => string;
};

/**
 * 读取当前前端 locale 下的默认 API 错误文案；测试或非 Nuxt 上下文回退中文。
 */
function resolveDefaultApiErrorMessage(): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: I18nRuntime};
        return nuxtApp.$i18n?.t("api.requestFailed") ?? DEFAULT_API_ERROR_MESSAGE;
    } catch {
        return DEFAULT_API_ERROR_MESSAGE;
    }
}

export function resolveApiErrorMessage(error: unknown, fallback?: string): string {
    if (typeof error === "object" && error !== null) {
        if ("data" in error && typeof error.data === "object" && error.data !== null) {
            const data = error.data as Record<string, unknown>;

            if (typeof data.message === "string" && data.message) {
                return data.message;
            }
            if (typeof data.statusMessage === "string" && data.statusMessage) {
                return data.statusMessage;
            }
        }

        if ("response" in error && typeof error.response === "object" && error.response !== null) {
            const response = error.response as {_data?: unknown};
            if (typeof response._data === "object" && response._data !== null) {
                const data = response._data as Record<string, unknown>;
                if (typeof data.message === "string" && data.message) {
                    return data.message;
                }
                if (typeof data.statusMessage === "string" && data.statusMessage) {
                    return data.statusMessage;
                }
            }
        }

        if ("statusMessage" in error && typeof error.statusMessage === "string" && error.statusMessage) {
            return error.statusMessage;
        }
        if ("message" in error && typeof error.message === "string" && error.message) {
            return error.message;
        }
    }

    return fallback ?? resolveDefaultApiErrorMessage();
}
