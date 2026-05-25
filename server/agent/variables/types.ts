import type {TSchema} from "typebox";
import type {JsonValue} from "nbook/server/agent/messages/types";

export type VariableNamespace = "client" | "global" | "project" | "session";

export type VariableWriter = "frontend" | "agent" | "user";

export type VariableWriteMode = "patch" | "replace";

export type ClientStateSnapshot = {
    ide?: Record<string, JsonValue>;
    studio?: Record<string, JsonValue>;
    [key: string]: JsonValue | Record<string, JsonValue> | undefined;
};

export type VariableDefinition = {
    namespace: VariableNamespace;
    key: string;
    schema: TSchema;
    title?: string;
    summary?: string;
    default?: JsonValue;
    readable?: boolean;
    writableBy?: VariableWriter[];
    writeMode?: VariableWriteMode;
};

export type VariableRootCatalogItem = {
    $ref: string;
    title?: string;
    summary?: string;
    readable: boolean;
    writableByAgent: boolean;
};

export type VariableCatalog = {
    summary: string;
    clientVariables: Record<string, VariableRootCatalogItem>;
    globalVariables: Record<string, VariableRootCatalogItem>;
    projectVariables: Record<string, VariableRootCatalogItem>;
    sessionVariables: Record<string, VariableRootCatalogItem>;
};

export type VariableSchemaDetail = {
    path: string;
    namespace: VariableNamespace;
    key: string;
    schema: TSchema;
    readable: boolean;
    writableByAgent: boolean;
    summary?: string;
};

export type VariableSnapshot = {
    client: Record<string, JsonValue>;
    global: Record<string, JsonValue>;
    project: Record<string, JsonValue>;
    session: Record<string, JsonValue>;
};

export type VariableJsonPatchOperation =
    | {op: "add" | "replace" | "test"; path: string; value: JsonValue}
    | {op: "remove"; path: string};

export type VariablePatchAudit = {
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    source: "agent" | "profile" | "frontend" | "user";
    invocationId?: string;
    toolCallId?: string;
};

export type VariableAccessorIssue = {
    code: "unavailable" | "not_registered" | "not_readable" | "not_writable" | "schema_mismatch" | "storage_error" | "not_compiled" | "compile_stale" | "compiled_load_failed" | "stale_read_required" | "stale_fingerprint";
    path: string;
    message: string;
};

export type VariableReadOptions = {
    maxBytes?: number;
};

export type VariableReadResult = {
    path: string;
    value?: JsonValue;
    truncated?: boolean;
    /** 最近一次成功读取的值指纹。Agent 不需要手写，只由 read-before-patch 防 stale 使用。 */
    fingerprint?: string;
    issue?: VariableAccessorIssue;
};

export type VariableSchemaQuery = {
    namespace?: VariableNamespace;
    prefix?: string;
    paths?: string[];
    writableOnly?: boolean;
    detail?: boolean;
};

export type VariableSchemaResult = {
    catalog: VariableCatalog;
    schemas: VariableSchemaDetail[];
    issues: VariableAccessorIssue[];
};

export type VariablePatchRequest = {
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    invocationId?: string;
    toolCallId?: string;
};

export type VariablePatchAck = {
    namespace: "client";
    path: string;
    operations: VariableJsonPatchOperation[];
    appliedValue?: JsonValue;
    error?: string;
    invocationId?: string;
    toolCallId?: string;
};

export type ClientVariablePatchHandler = (request: VariablePatchRequest) => Promise<VariablePatchAck>;

export type ProfileVariableAccessor = {
    readonly dryRun: boolean;
    catalog(query?: VariableSchemaQuery): VariableSchemaResult;
    get(path: string): Promise<JsonValue | undefined>;
    read(path: string, options?: VariableReadOptions): Promise<VariableReadResult>;
    patch(namespace: VariableNamespace, path: string, operations: VariableJsonPatchOperation[], source?: VariablePatchAudit["source"], toolCallId?: string): Promise<VariableReadResult>;
};

export type VariableInvocationState = {
    readFingerprints: Map<string, string>;
    clientOverlay: Record<string, JsonValue>;
};
