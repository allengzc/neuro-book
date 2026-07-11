import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {DEFAULT_PROFILE_SUMMARIZER, profileSummarizerDefaultEnabled, resolveProfileSummarizer} from "nbook/server/agent/profiles/profile-summarizer";

describe("profile summarizer resolver", () => {
    const plain = defineAgentProfile({
        manifest: {key: "test.plain", name: "Plain"},
        initialSchema: Type.Object({}),
        tools: {},
        prepare() {
            return {};
        },
    });
    const declared = defineAgentProfile({
        manifest: {key: "test.declared", name: "Declared"},
        initialSchema: Type.Object({}),
        tools: {},
        summarizer: {
            profileKey: "summarizer",
            input: {trigger: "afterInvocation", interval: {kind: "sourceInvocation", value: 3}},
        },
        prepare() {
            return {};
        },
    });

    it("声明策略的 Profile 默认开启，普通 Profile 默认关闭", () => {
        expect(profileSummarizerDefaultEnabled(declared)).toBe(true);
        expect(resolveProfileSummarizer(declared, undefined)).toBe(declared.summarizer);
        expect(profileSummarizerDefaultEnabled(plain)).toBe(false);
        expect(resolveProfileSummarizer(plain, undefined)).toBeNull();
    });

    it("用户覆盖优先，普通 Profile 开启后使用系统默认策略", () => {
        expect(resolveProfileSummarizer(declared, false)).toBeNull();
        expect(resolveProfileSummarizer(plain, true)).toBe(DEFAULT_PROFILE_SUMMARIZER);
        expect(resolveProfileSummarizer(plain, false, true)).toBe(DEFAULT_PROFILE_SUMMARIZER);
    });
});
