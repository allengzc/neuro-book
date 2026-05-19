import {createEventStream} from "h3";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {subscribeWorkspaceFileEvents} from "nbook/server/workspace-files/workspace-file-events";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 订阅当前小说 workspace 的文件系统变化。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const root = typeof query.root === "string" ? query.root : undefined;
    const novelId = typeof query.novelId === "string" ? query.novelId : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const workspaceRoot = await resolveWorkspaceRootInput(prisma, {root, novelId, workspaceKind});
    const eventStream = createEventStream(event);
    let streamClosed = false;
    let unsubscribe: (() => void) | null = null;

    const pushWorkspaceEvent = async (payload: WorkspaceFileStreamEventDto): Promise<void> => {
        if (streamClosed) {
            return;
        }
        await eventStream.push({
            event: payload.type,
            data: JSON.stringify(payload),
        });
    };

    eventStream.onClosed(() => {
        streamClosed = true;
        unsubscribe?.();
        eventStream.close();
    });

    unsubscribe = await subscribeWorkspaceFileEvents(workspaceRoot, (payload) => {
        void pushWorkspaceEvent(payload);
    });
    if (streamClosed) {
        unsubscribe();
    }

    return eventStream.send();
});
