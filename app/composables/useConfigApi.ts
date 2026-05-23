import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {
    ConfigEditorSnapshotDto,
    ConfigWorkspaceQueryDto,
    GlobalConfigDto,
    ProjectConfigDto,
} from "nbook/shared/dto/config.dto";

/**
 * 统一构造当前 IDE 上下文对应的 Config API 查询与保存入口。
 */
export function useConfigApi() {
    const novelIdeStore = useNovelIdeStore();

    /**
     * 当前设置页对应的 Workspace Root / Project Workspace 查询参数。
     *
     * 小说工作区还没完成初始化时，只能读取 Workspace Root 配置；否则会生成
     * `workspaceKind=novel` 但缺少 `novelId` 的无效请求。
     */
    function currentQuery(): ConfigWorkspaceQueryDto {
        if (novelIdeStore.workspaceKind === "user-assets" || !novelIdeStore.currentNovelId) {
            return {workspaceKind: "user-assets"};
        }
        return {
            workspaceKind: "novel",
            novelId: novelIdeStore.currentNovelId,
        };
    }

    /**
     * 当前 Project Workspace 查询参数；只有小说工作区初始化完成后才存在。
     */
    function projectQuery(): ConfigWorkspaceQueryDto {
        if (novelIdeStore.workspaceKind === "user-assets" || !novelIdeStore.currentNovelId) {
            throw new Error("当前没有可写入的 Project Workspace 配置");
        }
        return {
            workspaceKind: "novel",
            novelId: novelIdeStore.currentNovelId,
        };
    }

    /**
     * 读取设置页编辑快照。后端每次都从配置文件重新读取。
     */
    async function editorSnapshot(query: ConfigWorkspaceQueryDto = currentQuery()): Promise<ConfigEditorSnapshotDto> {
        return $fetch<ConfigEditorSnapshotDto>("/api/config/editor-snapshot", {
            query,
        });
    }

    /**
     * 保存 Workspace Root `.nbook/config.json` 并返回后端重新合并后的快照。
     */
    async function saveGlobal(global: GlobalConfigDto, query: ConfigWorkspaceQueryDto = currentQuery()): Promise<ConfigEditorSnapshotDto> {
        return $fetch<ConfigEditorSnapshotDto>("/api/config/global", {
            method: "PUT",
            query,
            body: global,
        });
    }

    /**
     * 保存 Project Workspace `.nbook/config.json` 并返回后端重新合并后的快照。
     */
    async function saveProject(project: ProjectConfigDto, query: ConfigWorkspaceQueryDto = projectQuery()): Promise<ConfigEditorSnapshotDto> {
        return $fetch<ConfigEditorSnapshotDto>("/api/config/project", {
            method: "PUT",
            query,
            body: project,
        });
    }

    return {
        currentQuery,
        projectQuery,
        editorSnapshot,
        saveGlobal,
        saveProject,
    };
}
