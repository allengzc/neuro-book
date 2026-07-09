import {describe, expect, it} from "vitest";
import {clearModelCostDraft, createEmptyModelCostDraft, createModelCostDraft, parseModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";

describe("model cost draft", () => {
    it("从已有 USD cost 初始化结构化字段", () => {
        const draft = createModelCostDraft({
            input: 0.14,
            output: 0.28,
            cacheRead: 0.0028,
            cacheWrite: 0,
        });

        expect(draft).toMatchObject({
            input: "0.14",
            output: "0.28",
            cacheRead: "0.0028",
            cacheWrite: "0",
        });
    });

    it("空价格草稿保存为 null", () => {
        expect(parseModelCostDraft(createEmptyModelCostDraft())).toBeNull();
    });

    it("USD 输入保存为完整 cost 对象，空字段按 0 写入", () => {
        const draft = createEmptyModelCostDraft();
        draft.input = "0.14";
        draft.output = "0.28";

        expect(parseModelCostDraft(draft)).toEqual({
            input: 0.14,
            output: 0.28,
            cacheRead: 0,
            cacheWrite: 0,
        });
    });

    it("模型价格输入固定按 USD 保存，不受 UI 显示币种影响", () => {
        const draft = createEmptyModelCostDraft();
        draft.input = "7";

        expect(parseModelCostDraft(draft)?.input).toBe(7);
    });

    it("清空价格覆盖后恢复继承状态", () => {
        const draft = createModelCostDraft({
            input: 1,
            output: 2,
            cacheRead: 0.5,
            cacheWrite: 0,
        });

        clearModelCostDraft(draft);

        expect(parseModelCostDraft(draft)).toBeNull();
    });
});
