import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";
import type {UserInputFormSpec} from "nbook/server/agent/tools/types";

const TEXT_PREVIEW_LIMIT = 1200;
const LARGE_FIELD_MIN_BYTES = 4096;

/**
 * 扩展 AgentEvent 以支持 user input required 事件
 */
type ExtendedAgentEvent = AgentEvent | {
    type: "tool_user_input_required";
    toolCallId: string;
    toolName: string;
    args: unknown;
    formSpec?: UserInputFormSpec;
};

/**
 * 把 provider/tool 运行期原始事件投影成公开 SSE 事件。
 *
 * `agent_end` / `turn_end` 由 Run Kernel 直接构造 public event，不从 raw Pi 事件透出大字段。
 */
export function projectRuntimeEvent(event: ExtendedAgentEvent): AgentRuntimeStreamEventDto | null {
    if (event.type === "message_start" || event.type === "message_end") {
        return {
            type: event.type,
            message: event.message,
        };
    }
    if (event.type === "message_update") {
        return {
            type: "message_update",
            message: event.message.role === "assistant"
                ? {...event.message, content: []}
                : event.message,
            assistantMessageEvent: compactAssistantMessageEvent(event.assistantMessageEvent),
        };
    }
    if (event.type === "tool_execution_start") {
        return {
            type: "tool_execution_start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: sanitizeToolArgs(event.toolName, event.args),
        };
    }
    if (event.type === "tool_execution_update") {
        return {
            type: "tool_execution_update",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: sanitizeToolArgs(event.toolName, event.args),
            partialResult: sanitizeToolResult(event.toolName, event.partialResult),
        };
    }
    if (event.type === "tool_execution_end") {
        return {
            type: "tool_execution_end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: sanitizeToolResult(event.toolName, event.result),
            isError: event.isError,
        };
    }
    if (event.type === "tool_user_input_required") {
        const formSpec = event.toolName !== "request_user_input" && event.formSpec?.form ? {
            form: event.formSpec.form,
            resultSchema: event.formSpec.resultSchema,
            prompt: event.formSpec.prompt,
            layout: event.formSpec.layout,
        } : undefined;
        return {
            type: "tool.user-input-required",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: sanitizeToolArgs(event.toolName, event.args),
            ...(formSpec ? {formSpec} : {}),
        };
    }
    return null;
}

/**
 * Pi 的 message_update 会在每个 delta 中重复携带完整 partial。
 * 前端已经按 delta 累积消息，因此公开事件只保留增量字段，避免长 thinking/tool args
 * 在 EventHub replay 中形成平方级内存与流量增长。
 */
function compactAssistantMessageEvent(event: AssistantMessageEvent): AssistantMessageEvent {
    if (!("partial" in event)) {
        return event;
    }
    return {
        ...event,
        partial: {
            ...event.partial,
            content: [],
        },
    };
}

/**
 * 瘦身公开事件里的工具参数。
 *
 * `write.content` / `edit.edits[].newText` / `apply_patch.patch` 这类字段可能是整章正文。
 * 如果原样进入 EventHub replay、SSE 队列和前端 state，长时间子 Agent 写作会把同一份文本复制多轮。
 */
function sanitizeToolArgs(toolName: string, args: unknown): unknown {
    if (!isPlainObject(args)) {
        return args;
    }
    if (toolName === "write") {
        const content = typeof args.content === "string" ? summarizeText(args.content) : null;
        return {
            ...args,
            ...(content ? {
                contentPreview: content.preview,
                contentBytes: content.bytes,
                contentOmitted: true,
                omittedFields: appendOmittedField(args.omittedFields, "content"),
            } : {}),
            content: undefined,
        };
    }
    if (toolName === "edit") {
        const edits = Array.isArray(args.edits)
            ? args.edits.map((edit) => sanitizeEditArg(edit))
            : args.edits;
        return {
            ...args,
            edits,
        };
    }
    if (toolName === "apply_patch") {
        const patchText = typeof args.patch === "string" ? args.patch : null;
        const patch = patchText ? summarizeText(patchText) : null;
        return {
            ...args,
            ...(patch ? {
                patchPreview: patch.preview,
                patchBytes: patch.bytes,
                patchOmitted: true,
                touchedFiles: extractPatchTargetPaths(patchText ?? ""),
                omittedFields: appendOmittedField(args.omittedFields, "patch"),
            } : {}),
            patch: undefined,
        };
    }
    if (toolName === "bash" && typeof args.command === "string" && byteLength(args.command) > LARGE_FIELD_MIN_BYTES) {
        const command = summarizeText(args.command);
        return {
            ...args,
            commandPreview: command.preview,
            commandBytes: command.bytes,
            commandOmitted: true,
            omittedFields: appendOmittedField(args.omittedFields, "command"),
            command: undefined,
        };
    }
    return args;
}

/**
 * 瘦身公开事件里的工具结果，避免 edit/apply_patch 的完整 diff 在 live state 中重复驻留。
 */
function sanitizeToolResult(toolName: string, result: unknown): unknown {
    if (!isPlainObject(result)) {
        return result;
    }
    const details = isPlainObject(result.details) ? result.details : null;
    if (!details) {
        return result;
    }
    if (toolName !== "edit" && toolName !== "apply_patch") {
        return result;
    }
    const diff = typeof details.diff === "string" ? summarizeText(details.diff) : null;
    if (!diff) {
        return result;
    }
    return {
        ...result,
        details: {
            ...details,
            diffPreview: diff.preview,
            diffBytes: diff.bytes,
            diffOmitted: true,
            omittedFields: appendOmittedField(details.omittedFields, "diff"),
            diff: undefined,
        },
    };
}

function sanitizeEditArg(edit: unknown): unknown {
    if (!isPlainObject(edit)) {
        return edit;
    }
    const oldText = typeof edit.oldText === "string" ? summarizeText(edit.oldText) : null;
    const newText = typeof edit.newText === "string" ? summarizeText(edit.newText) : null;
    return {
        ...edit,
        ...(oldText ? {
            oldTextPreview: oldText.preview,
            oldTextBytes: oldText.bytes,
            oldTextOmitted: true,
            oldText: undefined,
        } : {}),
        ...(newText ? {
            newTextPreview: newText.preview,
            newTextBytes: newText.bytes,
            newTextOmitted: true,
            newText: undefined,
        } : {}),
        omittedFields: [
            ...(oldText ? ["oldText"] : []),
            ...(newText ? ["newText"] : []),
        ],
    };
}

function summarizeText(text: string): {preview: string; bytes: number} {
    return {
        preview: text.length > TEXT_PREVIEW_LIMIT ? `${text.slice(0, TEXT_PREVIEW_LIMIT)}\n...` : text,
        bytes: byteLength(text),
    };
}

function byteLength(text: string): number {
    return Buffer.byteLength(text, "utf-8");
}

function appendOmittedField(value: unknown, field: string): string[] {
    const fields = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return fields.includes(field) ? fields : [...fields, field];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractPatchTargetPaths(patchText: string): string[] {
    const files: string[] = [];
    for (const line of patchText.split(/\r?\n/)) {
        if (line.startsWith("*** Add File: ")) {
            files.push(line.slice("*** Add File: ".length).trim());
        }
        if (line.startsWith("*** Update File: ")) {
            files.push(line.slice("*** Update File: ".length).trim());
        }
        if (line.startsWith("*** Delete File: ")) {
            files.push(line.slice("*** Delete File: ".length).trim());
        }
    }
    return files.filter(Boolean);
}
