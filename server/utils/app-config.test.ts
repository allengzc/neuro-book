import {describe, expect, it} from "vitest";
import {parseAppConfigText} from "nbook/server/utils/app-config";

describe("parseAppConfigText", () => {
    it("auth.enabled 未配置时默认开启", () => {
        const config = parseAppConfigText(``);

        expect(config.auth.enabled).toBe(true);
    });

    it("兼容旧 config.yaml 文本里的 auth.enabled", () => {
        const config = parseAppConfigText(`
auth:
  enabled: false
`);

        expect(config.auth.enabled).toBe(false);
    });

    it("会在解析旧配置文本前展开环境变量占位符", () => {
        const config = parseAppConfigText(`
models:
  default: deepseek/deepseek-v4-flash
  providers:
    deepseek:
      name: DeepSeek
      adapter: deepseek-official
      options:
        apiKey: \${DEEPSEEK_API_KEY}
        baseURL: \${DEEPSEEK_API_BASE:-https://api.deepseek.com/v1}
      models:
        deepseek-v4-flash:
          id: deepseek-v4-flash
`, {
            DEEPSEEK_API_KEY: "sk-test",
        });

        expect(config.models.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(config.models.providers.deepseek?.options).toMatchObject({
            apiKey: "sk-test",
            baseURL: "https://api.deepseek.com/v1",
        });
    });

    it("会把缺失环境变量收敛为空配置文本", () => {
        const config = parseAppConfigText(`
models:
  providers:
    deepseek:
      options:
        apiKey: \${MISSING_API_KEY}
`, {});

        expect(config.models.providers.deepseek?.options.apiKey).toBe("");
    });

    it("支持 adapter 字符串简写，并默认开启 openai-compatible reasoning replay", () => {
        const config = parseAppConfigText(`
models:
  providers:
    mimo:
      adapter: openai-compatible
`);

        expect(config.models.providers.mimo?.adapter).toEqual({
            type: "openai-compatible",
            reasoningContentReplay: true,
        });
    });

    it("支持 adapter 对象形式关闭 reasoning replay", () => {
        const config = parseAppConfigText(`
models:
  providers:
    custom:
      adapter:
        type: openai-compatible
        reasoningContentReplay: false
`);

        expect(config.models.providers.custom?.adapter).toEqual({
            type: "openai-compatible",
            reasoningContentReplay: false,
        });
    });

    it("支持严格 OpenAI 官方 adapter", () => {
        const config = parseAppConfigText(`
models:
  providers:
    openai:
      adapter: openai-official
`);

        expect(config.models.providers.openai?.adapter).toEqual({
            type: "openai-official",
            reasoningContentReplay: false,
        });
    });

    it("支持配置 provider 请求超时时间", () => {
        const config = parseAppConfigText(`
models:
  providers:
    mimo:
      options:
        timeoutMs: 180000
`);

        expect(config.models.providers.mimo?.options.timeoutMs).toBe(180000);
    });
});
