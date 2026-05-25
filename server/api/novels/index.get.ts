import {listNovels} from "nbook/server/utils/novel-chapter";

/**
 * 查询 Project Workspace 列表。
 */
export default defineEventHandler(async () => listNovels());
