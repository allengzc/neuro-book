import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";
import type {UserInputFormSpec} from "nbook/server/agent/tools/types";

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
            message: event.message,
            assistantMessageEvent: event.assistantMessageEvent,
        };
    }
    if (event.type === "tool_execution_start") {
        return {
            type: "tool_execution_start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
        };
    }
    if (event.type === "tool_execution_update") {
        return {
            type: "tool_execution_update",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            partialResult: event.partialResult,
        };
    }
    if (event.type === "tool_execution_end") {
        return {
            type: "tool_execution_end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
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
            args: event.args,
            ...(formSpec ? {formSpec} : {}),
        };
    }
    return null;
}
