import {closeAllProjectResources} from "nbook/server/workspace-files/project-resources";

/**
 * 服务关停时统一释放 Project 级常驻资源（SQLite 客户端、chokidar watcher 等）。
 * 属主清单见 project-resources 注册表；不释放会在 Windows 上留下句柄悬挂，
 * 拖住进程退出或锁死 workspace 目录。
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook("close", async () => {
        await closeAllProjectResources();
    });
});
