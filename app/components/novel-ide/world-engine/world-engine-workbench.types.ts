import type {
    JsonValue,
    WorldPatchOp,
    WorldPreviewSchemaType,
} from "nbook/app/utils/world-engine-preview";

export type WorkbenchJsonValue = JsonValue;

export type WorldSchemaProjectionDto = {
    subjectTypes: WorldPreviewSchemaType[];
    calendar: {
        format: string;
        examples: string[];
    };
};

export type WorldSubjectDto = {
    id: string;
    type: string;
    name: string;
};

export type WorldSlicePatchDto = {
    subjectId: string;
    path: string;
    op: WorldPatchOp;
    value?: WorkbenchJsonValue;
    summary?: string;
};

export type WorldSliceDto = {
    id: string;
    time: string;
    previousTime?: string;
    title: string;
    summary: string;
    kind: string;
    patches?: WorldSlicePatchDto[];
    issues?: WorldIssueDto[];
};

export type SubjectStateDto = {
    subjectId: string;
    type: string;
    attrs: Record<string, WorkbenchJsonValue>;
};

/** 数据校验问题：E（broken-relative / dangling-ref，持久）与 A（base-shifted / masked，一次性）。 */
export type WorldIssueDto = {
    code: "broken-relative" | "dangling-ref" | "base-shifted" | "masked";
    sliceId?: string;
    subjectId: string;
    attr: string;
    message: string;
};

export type WorldStateQueryDto = {
    subjects: SubjectStateDto[];
    issues: WorldIssueDto[];
};

export type WorldStateDto = {
    time: string;
    subjects: SubjectStateDto[];
    issues: WorldIssueDto[];
};

export type SliceWriteResultDto = {
    sliceId: string;
    issues: WorldIssueDto[];
};

export type CreateSubjectResultDto = {
    subjectId: string;
    issues: WorldIssueDto[];
};

export type DeleteSliceResultDto = {
    issues: WorldIssueDto[];
};

export type SubjectEventCommitResultDto = {
    status: "appended" | "already-exists";
    subjectId: string;
    subjectPath: string;
    eventsPath: string;
    sliceId?: string;
    event: {
        tick?: string;
        time?: string;
        text: string;
    };
    line: string;
    dirty: boolean;
};
