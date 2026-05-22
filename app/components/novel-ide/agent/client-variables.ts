import type {ClientVariablesDto} from "nbook/shared/dto/agent-session.dto";

/**
 * Novel IDE 发给 Agent 的客户端变量输入。
 */
export type NovelIdeClientVariablesInput = {
    activePanel: string | null;
    theme: string;
    novelId: string;
    workspace: string | null;
    workspaceKind: "novel" | "user-assets";
    selectedFilePath: string | null;
    selectedStoryThreadId: string | null;
    selectedStorySceneId: string | null;
    previousSelectedFilePath: string | null;
    fileChangedSinceLastSend: boolean;
    selectionVersion: number;
};

/**
 * 组装 Novel IDE 的客户端变量快照。
 */
export function buildNovelIdeClientVariables(input: NovelIdeClientVariablesInput): ClientVariablesDto {
    return {
        ide: {
            panel: null,
            activePanel: input.activePanel,
            theme: input.theme,
            extra: "{}",
        },
        studio: {
            novelId: input.novelId,
            selectedFilePath: input.selectedFilePath,
            selectedStoryThreadId: input.selectedStoryThreadId,
            selectedStorySceneId: input.selectedStorySceneId,
            previousSelectedFilePath: input.previousSelectedFilePath,
            previousChapterTitle: null,
            currentChapterLabel: null,
            previousChapterLabel: null,
            workspace: input.workspace,
            workspaceKind: input.workspaceKind,
            didSwitchFile: input.fileChangedSinceLastSend,
            selectionVersion: input.selectionVersion,
            extra: "{}",
        },
    };
}
