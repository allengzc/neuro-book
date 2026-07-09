import {createEventStream} from "h3";
import type {H3Event} from "h3";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {subscribeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";

type WorkspaceFileEventsDependencies = {
    createEventStream: typeof createEventStream;
    resolveWorkspaceRootInput: typeof resolveWorkspaceRootInput;
    subscribeWorkspaceTreeIndex: typeof subscribeWorkspaceTreeIndex;
    assertProjectOpenForRoot?: typeof assertProjectOpenForRoot;
};

/**
 * 创建 workspace 文件事件 SSE handler，便于测试注入可控依赖。
 */
export function createWorkspaceFileEventsHandler(dependencies: WorkspaceFileEventsDependencies = {
    createEventStream,
    resolveWorkspaceRootInput,
    subscribeWorkspaceTreeIndex,
    assertProjectOpenForRoot,
}) {
    return async (event: H3Event) => {
        const query = getQuery(event);
        const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
        const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
        const workspaceRoot = await dependencies.resolveWorkspaceRootInput({projectPath, workspaceKind});
        dependencies.assertProjectOpenForRoot?.(workspaceRoot);
        const eventStream = dependencies.createEventStream(event);
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

        unsubscribe = await dependencies.subscribeWorkspaceTreeIndex({
            root: workspaceRoot,
            workspaceKind,
        }, async (payload) => {
            await pushWorkspaceEvent(payload);
        });
        if (streamClosed) {
            unsubscribe();
        }

        return eventStream.send();
    };
}

/**
 * 订阅当前小说 workspace 的文件系统变化。
 */
export default defineEventHandler(createWorkspaceFileEventsHandler());
