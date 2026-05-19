import {syncSystemAssetsToUserAssets} from "nbook/server/workspace-files/novel-workspace";

/**
 * 同步系统 assets 到用户 assets，只补缺失文件。
 */
export default defineEventHandler(async () => {
    return syncSystemAssetsToUserAssets();
});
