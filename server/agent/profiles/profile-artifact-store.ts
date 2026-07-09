import {join} from "node:path";
import {PROFILE_COMPILED_DIR_NAME, type ProfileArtifactManifestItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {AgentProfile, AgentProfileIssueCode} from "nbook/server/agent/profiles/types";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";

/**
 * 按内容寻址 sha 加载 compiled profile artifact。该组件只负责 artifact import，
 * 不读源码、不判 freshness、不写 manifest。
 */
export class ProfileArtifactStore {
    /**
     * 从指定 profile root 的 `.compiled/artifacts/<sha>.mjs` 加载 profile。
     */
    async importProfile(profileRoot: string, item: ProfileArtifactManifestItem): Promise<AgentProfile> {
        const artifactPath = join(profileRoot, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
        const mod = await importRuntimeArtifact<{
            default?: unknown;
        }>(artifactPath, {
            cacheKey: item.artifactSha256,
            cacheNamespace: "profile",
            expectedBytes: item.artifactBytes,
        });
        const profile = mod.default;
        if (!this.isProfile(profile)) {
            throw new ProfileArtifactStoreError("invalid_export", `compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
        }
        return profile;
    }

    private isProfile(value: unknown): value is AgentProfile {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "initialSchema" in value
            && "tools" in value
            && "rootToolKeys" in value
            && "prepare" in value
            && typeof (value as {prepare?: unknown}).prepare === "function",
        );
    }
}

/**
 * artifact import 阶段的可分类错误，供 catalog 转成稳定 issue code。
 */
export class ProfileArtifactStoreError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
