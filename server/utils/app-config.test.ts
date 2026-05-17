import {describe, expect, it} from "vitest";
import {parseAppConfigText} from "nbook/server/utils/app-config";

describe("parseAppConfigText", () => {
    it("auth.enabled 未配置时默认开启", () => {
        const config = parseAppConfigText(``);

        expect(config.auth.enabled).toBe(true);
    });

    it("可以从 config.yaml 关闭全站鉴权", () => {
        const config = parseAppConfigText(`
auth:
  enabled: false
`);

        expect(config.auth.enabled).toBe(false);
    });

    it("会在解析 config.yaml 前展开环境变量占位符", () => {
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
});
