import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {openProject} from "nbook/server/workspace-files/project-session";
import {readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import {openProjectHistoryAndMaintain} from "nbook/server/workspace-history/project-history";

const OpenProjectBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
});

/**
 * 显式打开 Project 会话（Task 94）。
 * openProject 内部完成目录校验（404）与数据库迁移收敛；未 open 前数据面接口会以 409 拒绝。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, OpenProjectBodySchema);
    await openProject(body.projectPath, {kind: "user"});
    // D11：open 即预热 tree watcher（fire-and-forget，不阻塞响应，失败静默——首个 tree 请求会自然重建）。
    // 预热放在路由层而非 project-session 内部，避免 project-session 与 project-workspace-index 循环 import。
    void readProjectWorkspaceTreeSnapshot({root: body.projectPath}).catch(() => undefined);
    // Task 95 D13/D14/D15：预热 history 库 + closed 期间外部变更对账扫描 + 24h 维护（同样 fire-and-forget）。
    void openProjectHistoryAndMaintain(body.projectPath).catch(() => undefined);
    return {success: true};
});
