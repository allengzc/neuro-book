import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";

/** 世界引擎单例门面。 */
export const worldEngineFacade = new WorldEngineFacade();

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
    WorldPatchOp,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";
