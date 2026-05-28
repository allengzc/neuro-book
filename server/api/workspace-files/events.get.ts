import {createEventStream} from "h3";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {subscribeWorkspaceFileEvents} from "nbook/server/workspace-files/workspace-file-events";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {refreshProjectWorkspaceIndex} from "nbook/server/workspace-files/project-workspace-index";

/**
 * 订阅当前小说 workspace 的文件系统变化。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const workspaceRoot = await resolveWorkspaceRootInput({projectPath, workspaceKind});
    const eventStream = createEventStream(event);
    let streamClosed = false;
    let unsubscribe: (() => void) | null = null;

    const pushWorkspaceEvent = async (payload: WorkspaceFileStreamEventDto): Promise<void> => {
        if (streamClosed) {
            return;
        }
        try {
            await eventStream.push({
                event: payload.type,
                data: JSON.stringify(payload),
            });
        } catch (error) {
            if (isClosingEventStreamError(error)) {
                streamClosed = true;
                unsubscribe?.();
                return;
            }
            throw error;
        }
    };

    eventStream.onClosed(() => {
        streamClosed = true;
        unsubscribe?.();
        eventStream.close();
    });

    unsubscribe = await subscribeWorkspaceFileEvents(workspaceRoot, async (payload) => {
        if (payload.type !== "workspace_files_changed" || workspaceKind === "user-assets") {
            await pushWorkspaceEvent(payload);
            return;
        }
        const snapshot = await refreshProjectWorkspaceIndex({root: workspaceRoot});
        await pushWorkspaceEvent({
            ...payload,
            revision: snapshot.revision,
            validatedAt: snapshot.validatedAt,
        });
    });
    if (streamClosed) {
        unsubscribe();
    }

    return eventStream.send();
});

/**
 * h3 EventStream 在客户端断开附近可能仍抛 closed-stream 错误。
 */
function isClosingEventStreamError(error: unknown): boolean {
    return error instanceof TypeError && error.message.includes("stream is closing or closed");
}
