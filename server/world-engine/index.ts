import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {registerProjectResourceOwner} from "nbook/server/workspace-files/project-resources";

/** 世界引擎单例门面。 */
export const worldEngineFacade = new WorldEngineFacade();

// Project 资源生命周期：World Engine 不持久缓存 client，close 仅做 GC 兜底，保持与删除流程语义一致。
registerProjectResourceOwner({
    name: "world-engine-facade",
    close: (projectPath) => worldEngineFacade.closeProject(projectPath),
});

export {WorldEngineFacade};
export type {
    Instant,
    JsonValue,
    CreateWorldSubjectResult,
    DeleteSliceResult,
    PatchInput,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    SubjectState,
    WorldIssue,
    WorldIssueCode,
    WorldIssueExplanation,
    WorldIssueLabel,
    WorldIssueSeverity,
    WorldPatchOp,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";
