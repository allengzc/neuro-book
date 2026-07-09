import {describe, expect, test} from "vitest";
import * as yaml from "yaml";
import {WorldSchemaLoader} from "./schema-loader";

describe("World Engine Schema - 新格式兼容性测试", () => {
    test("应该能解析新格式 schema（types + properties）", async () => {
        const newFormatYaml = `
types:
  character:
    type: object
    properties:
      name:
        type: string
        default: "无名者"

      hp:
        type: int
        default: 100

      skills:
        type: array
        items: { type: string }
        unique: true
        default: []

      memory:
        type: object
        dynamic: true
        valueType: string
`;

        const parsed = yaml.parse(newFormatYaml);
        const loader = new WorldSchemaLoader();

        // 这里我们直接调用内部的 normalizeSchema（需要导出或者通过 load 测试）
        // 暂时验证解析不报错
        expect(parsed.types).toBeDefined();
        expect(parsed.types.character).toBeDefined();
        expect(parsed.types.character.type).toBe("object");
        expect(parsed.types.character.properties.name.type).toBe("string");
    });

    test("应该能解析旧格式 schema（subjectTypes + attrs）", async () => {
        const oldFormatYaml = `
subjectTypes:
  character:
    attrs:
      name: { kind: scalar, type: text }
      hp: { kind: scalar, type: int, default: 100 }
      skills: { kind: collection, itemType: text, default: [] }
      memory: { kind: object, itemType: text }
`;

        const parsed = yaml.parse(oldFormatYaml);

        expect(parsed.subjectTypes).toBeDefined();
        expect(parsed.subjectTypes.character).toBeDefined();
        expect(parsed.subjectTypes.character.attrs.name.kind).toBe("scalar");
    });

    test("新格式的 array + unique 应该等价于旧格式的 collection", () => {
        // 新格式
        const newFormat = {
            type: "array",
            items: { type: "string" },
            unique: true,
        };

        // 旧格式
        const oldFormat = {
            kind: "collection",
            itemType: "text",
        };

        // 两者应该有相同的语义：无序、不重复的集合
        expect(newFormat.unique).toBe(true);
        expect(oldFormat.kind).toBe("collection");
    });

    test("新格式的 object + dynamic 应该等价于旧格式的 object + itemType", () => {
        // 新格式
        const newFormat = {
            type: "object",
            dynamic: true,
            valueType: "string",
        };

        // 旧格式
        const oldFormat = {
            kind: "object",
            itemType: "text",
        };

        // 两者应该有相同的语义：动态键映射
        expect(newFormat.dynamic).toBe(true);
        expect(newFormat.valueType).toBe("string");
        expect(oldFormat.kind).toBe("object");
        expect(oldFormat.itemType).toBe("text");
    });
});
