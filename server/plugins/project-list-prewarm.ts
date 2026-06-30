import {appLogger} from "nbook/server/app-logs/logger";
import {prewarmNovelListCache} from "nbook/server/utils/novel-chapter";

/**
 * 启动后非阻塞预热 Project 列表短缓存，降低用户第一次打开书架时命中全量扫描的概率。
 */
export default defineNitroPlugin(() => {
    setTimeout(() => {
        void prewarmNovelListCache().catch((error) => {
            void appLogger.warn("projects.list.prewarmFailed", {error}, "Project 列表预热失败");
        });
    }, 1_000);
});
