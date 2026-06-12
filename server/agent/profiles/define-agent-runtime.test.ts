import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";

describe("defineAgentRuntime", () => {
    it("profile 未声明 runtime 时使用默认 runtime", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.runtime-default",
                name: "Runtime Default",
            },
            inputSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        });

        expect(profile.runtime?.hooks.map((hook) => hook.name)).toEqual([
            "builtin.profilePrompt",
            "builtin.sessionContext",
            "builtin.transcriptPersistence",
            "builtin.reportResult",
        ]);
        expect(profile.runtime?.hooks.every((hook) => "builtin" in hook && hook.builtin)).toBe(true);
    });

    it("拒绝 sidecar 使用 profile 未开放的工具", () => {
        expect(() => defineAgentProfile({
            manifest: {
                key: "test.sidecar-tool-subset",
                name: "Sidecar Tool Subset",
            },
            inputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                toolKeys: ["read", "report_result"],
                enterPrompt: "load",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        })).toThrow("toolKeys 必须是 profile tools 子集");
    });

    it("拒绝 mainRunToolKeys 使用 profile 未开放的工具", () => {
        expect(() => defineAgentProfile({
            manifest: {
                key: "test.main-run-tool-subset",
                name: "Main Run Tool Subset",
            },
            inputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            // 故意绕过 TS 静态子集校验，覆盖运行时 profile loader 的错误路径。
            mainRunToolKeys: ["read", "report_result"] as any,
            prepare() {
                return {};
            },
        })).toThrow("mainRunToolKeys 必须是 tools 子集");
    });

    it("sidecar 未开放 report_result 时必须声明 outputFallback", () => {
        expect(() => defineAgentProfile({
            manifest: {
                key: "test.sidecar-fallback",
                name: "Sidecar Fallback",
            },
            inputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["read"]),
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                toolKeys: ["read"],
                enterPrompt: "load",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        })).toThrow("必须声明 outputFallback");
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

    it("reportResult built-in hook 会按 caller identity 控制 reminder retry", () => {
        const hook = agentRuntimeBuiltins.defaultSessionRuntime().hooks.find((item) => item.name === "builtin.reportResult");

        expect(hook?.stage).toBe("prepareRun");
        expect(hook?.run({
            invocation: {
                caller: {kind: "user"},
            },
        } as never)).toEqual({
            builtinBehavior: {
                reportResultReminder: false,
            },
        });
        expect(hook?.run({
            invocation: {
                caller: {kind: "agent"},
            },
        } as never)).toEqual({
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
