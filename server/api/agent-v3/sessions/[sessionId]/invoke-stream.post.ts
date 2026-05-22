import {createEventStream} from "h3";
import {AgentV3InvokeRequestDtoSchema} from "nbook/shared/dto/agent-v3.dto";
import {pushAgentV3Event, requireAgentV3SessionId, toInvokeInput, useAgentV3Harness} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 单次 v3 invoke SSE。最后一帧固定为 result。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentV3SessionId(event);
    const body = await validateBody(event, AgentV3InvokeRequestDtoSchema);
    const eventStream = createEventStream(event);
    let streamClosed = false;

    eventStream.onClosed(() => {
        streamClosed = true;
        eventStream.close();
    });

    void (async () => {
        try {
            const result = await useAgentV3Harness().invokeAgent(toInvokeInput(
                sessionId,
                body,
                async (agentEvent) => {
                    if (!streamClosed) {
                        await pushAgentV3Event(eventStream, agentEvent);
                    }
                },
            ));
            if (!streamClosed) {
                await pushAgentV3Event(eventStream, {
                    type: "result",
                    result,
                });
            }
        } catch (error) {
            if (!streamClosed) {
                await pushAgentV3Event(eventStream, {
                    type: "result",
                    result: {
                        sessionId,
                        status: "error",
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        } finally {
            streamClosed = true;
            await eventStream.close();
        }
    })();

    return eventStream.send();
});
