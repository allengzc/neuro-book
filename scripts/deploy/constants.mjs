/** 部署脚本常量与 Provider 定义。 */

export const REPO_URL = "https://github.com/notnotype/neuro-book.git";
export const DEFAULT_IMAGE = "ghcr.io/notnotype/neuro-book:latest";
export const DEPLOY_DIRNAME = ".deploy";
export const ENV_FILENAME = ".env";
export const CONFIG_FILENAME = "config.yaml";
export const GLOBAL_CONFIG_FILENAME = "workspace/.nbook/config.json";
export const LOCAL_GIT_DEPLOY_MODE = "local-git";
export const DEPLOY_MODES = [LOCAL_GIT_DEPLOY_MODE, "ghcr", "source"];
export const DOCKER_DEPLOY_MODES = ["ghcr", "source"];
export const NATIVE_REQUIRED_COMMANDS = [
    {command: "git", label: "Git", required: true},
    {command: "bun", label: "Bun", required: true},
    {command: "rg", label: "ripgrep", required: true},
];
export const NATIVE_UNIX_COMMANDS = [
    {command: "bash", label: "bash", required: true},
    {command: "env", label: "coreutils", required: true, args: []},
    {command: "find", label: "findutils", required: true, args: [".", "-type", "d", "-prune"]},
];
export const NATIVE_RECOMMENDED_COMMANDS = [
    {command: "python3", label: "Python 3", required: false},
];
export const PROVIDERS = {
    deepseek: {
        name: "DeepSeek",
        baseURL: "",
        modelId: "deepseek-v4-flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    doubao: {
        name: "Doubao",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        modelId: "doubao-seed-2-0-pro",
        modelName: "Doubao Seed 2.0 Pro",
        modelGroup: "doubao",
        contextWindowTokens: 262144,
    },
    qwen: {
        name: "Qwen",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen3.6-plus",
        modelName: "Qwen 3.6 Plus",
        modelGroup: "qwen",
        contextWindowTokens: 262144,
    },
    siliconflow: {
        name: "SiliconFlow",
        baseURL: "https://api.siliconflow.cn/v1",
        modelId: "deepseek-ai/DeepSeek-V4-Flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    gemini: {
        name: "Gemini",
        baseURL: "",
        modelId: "gemini-3-pro-preview-maxthinking",
        modelName: "Gemini 3 Pro Preview MaxThinking",
        modelGroup: "gemini",
        contextWindowTokens: null,
    },
};

export const REGENERATED_SYSTEM_ARTIFACTS = [
    "assets/workspace/.nbook/agent/profiles/.compiled/manifest.json",
    "assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json",
    "assets/workspace/.nbook/agent/variables/.compiled/manifest.json",
    "server/agent/variables/generated-profile-variable-types.d.ts",
];
