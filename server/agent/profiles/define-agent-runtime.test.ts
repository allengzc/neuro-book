import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";

describe("defineAgentRuntime", () => {
    it("profile 未声明 runtime 时使用默认 runtime", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.runtime-default",
                name: "Runtime Default",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        });

        expect(profile.runtime?.hooks.map((hook) => hook.name)).toEqual([
            "builtin.profilePrompt",
            "builtin.sessionContext",
            "builtin.transcriptPersistence",
            "builtin.compact",
            "builtin.reportResult",
        ]);
        expect(profile.runtime?.hooks.every((hook) => "builtin" in hook && hook.builtin)).toBe(true);
    });

    it("defineAgentRuntime 会展开内置 runtime bundle", () => {
        const runtime = defineAgentRuntime({
            hooks: [
                agentRuntimeBuiltins.sessionRuntime(),
                {
                    name: "custom",
                    stage: "prepareRun",
                    run() {
                        return {};
                    },
                },
            ],
        });

        expect(runtime.hooks.map((hook) => hook.name)).toEqual([
            "builtin.profilePrompt",
            "builtin.sessionContext",
            "builtin.transcriptPersistence",
            "builtin.compact",
            "builtin.reportResult",
            "custom",
        ]);
    });

    it("transcriptPersistence built-in hook 会显式声明默认 persist transcript", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.transcriptPersistence");

        expect(hook?.run({} as never)).toEqual({
            transcript: "persist",
        });
    });

    it("profilePrompt built-in hook 会显式声明默认 profile prompt", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.profilePrompt");

        expect(hook?.run({} as never)).toEqual({
            builtinBehavior: {
                profilePrompt: true,
            },
        });
    });

    it("sessionContext built-in hook 会在 prepareRun 显式声明默认 session context", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.sessionContext");

        expect(hook?.stage).toBe("prepareRun");
        expect(hook?.run({} as never)).toEqual({
            builtinBehavior: {
                sessionContext: true,
            },
        });
    });

    it("compact built-in hook 会显式声明 automatic compaction", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.compact");

        expect(hook?.stage).toBe("prepareNextTurn");
        expect(hook?.run({} as never)).toEqual({
            builtinBehavior: {
                automaticCompaction: true,
            },
        });
    });

    it("reportResult built-in hook 会在 prepareRun 显式声明 reminder retry", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.reportResult");

        expect(hook?.stage).toBe("prepareRun");
        expect(hook?.run({} as never)).toEqual({
            builtinBehavior: {
                reportResultReminder: true,
            },
        });
    });

    it("拒绝同 stage 同名 hook", () => {
        expect(() => defineAgentRuntime({
            hooks: [
                {
                    name: "same",
                    stage: "prepareTurn",
                    run() {
                        return {};
                    },
                },
                {
                    name: "same",
                    stage: "prepareTurn",
                    run() {
                        return {};
                    },
                },
            ],
        })).toThrow("runtime hook 重复");
    });
});
