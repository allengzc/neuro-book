export type DiffWorkbenchMode = "diff" | "merge" | "current-base" | "incoming-base";

export type DiffWorkbenchDocument = {
    id: string;
    title: string;
    path?: string;
    language?: string;
    baseContent?: string;
    currentContent: string;
    incomingContent: string;
    resultContent?: string;
    currentLabel?: string;
    incomingLabel?: string;
    baseLabel?: string;
    resultLabel?: string;
};

export type DiffWorkbenchAction =
    | {id: "cancel"; label?: string; tone?: "default" | "primary" | "danger"}
    | {id: "use-current"; label?: string; tone?: "default" | "primary" | "danger"}
    | {id: "use-incoming"; label?: string; tone?: "default" | "primary" | "danger"}
    | {id: "save-result"; label?: string; tone?: "default" | "primary" | "danger"}
    | {id: "open-file"; label?: string; tone?: "default" | "primary" | "danger"}
    | {id: string; label: string; tone?: "default" | "primary" | "danger"};

export type DiffWorkbenchActionPayload = {
    actionId: string;
    resultContent: string;
    document: DiffWorkbenchDocument;
};
