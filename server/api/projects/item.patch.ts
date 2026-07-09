import {
    UpdateNovelRequestDtoSchema,
    type UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {invalidateNovelListCache, requireProjectPathQuery, updateNovelByTool, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新 Project manifest 信息。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<UpdateNovelRequestDto>(event, UpdateNovelRequestDtoSchema);
    const result = await updateNovelByTool(requireProjectPathQuery(event), body);
    invalidateNovelListCache();
    return result;
});
