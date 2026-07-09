import type {ProfileArtifactManifest, ProfileReleasePublishOptions} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {AgentProfileCompileResultDto} from "nbook/shared/dto/agent-profile.dto";

/**
 * worker 编译完成后交给主线程发布的 staging release。
 * buildCompiledDir 非空表示目录仍需由主线程发布并清理；失败的 worker 任务不会返回该字段。
 */
export type ProfileCompileStagedRelease = {
    profileRoot: string;
    buildCompiledDir: string;
    manifest: ProfileArtifactManifest;
};

/**
 * worker 线程内部返回值。stagedRelease 是 server 内部字段，不进入 HTTP DTO schema。
 */
export type ProfileCompileWorkerResult = AgentProfileCompileResultDto & {
    stagedRelease?: ProfileCompileStagedRelease;
};

/**
 * 主线程处理 worker staging release 的发布策略。
 */
export type ProfileCompilePublishOptions = ProfileReleasePublishOptions;
