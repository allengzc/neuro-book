import {assertNovel, requireProjectPath} from "nbook/server/utils/novel-chapter";

/**
 * 查询单个 Project Workspace。
 */
export default defineEventHandler(async (event) => {
    return assertNovel(requireProjectPath(event));
});
