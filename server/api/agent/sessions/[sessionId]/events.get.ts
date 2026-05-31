import {createEventStream, getQuery} from "h3";
import {pushAgentSessionEvent, requireAgentSessionId, subscribeAgentSessionEvents} from "nbook/server/agent/http";
import {AgentSessionEventsQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 订阅 Agent session event envelope。snapshot 才是恢复真相，事件只做增量同步。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const query = AgentSessionEventsQueryDtoSchema.parse(getQuery(event));
    const eventStream = createEventStream(event);
    const subscription = subscribeAgentSessionEvents(sessionId, {
        eventEpoch: query.eventEpoch,
        after: query.after,
    });
    let closed = false;

    eventStream.onClosed(() => {
        closed = true;
        void subscription[Symbol.asyncIterator]().return?.();
        eventStream.close();
    });

    void (async () => {
        try {
            await pushAgentSessionEvent(eventStream, subscription.connected);
            for await (const payload of subscription) {
                if (closed) {
                    break;
                }
                await pushAgentSessionEvent(eventStream, payload);
            }
        } finally {
            closed = true;
            await eventStream.close();
        }
    })();

    return eventStream.send();
});
