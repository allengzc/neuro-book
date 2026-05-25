import {
    UpdateNovelRequestDtoSchema,
    type UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {requireProjectPathQuery, updateNovelByTool, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新 Project manifest 信息。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<UpdateNovelRequestDto>(event, UpdateNovelRequestDtoSchema);
    return updateNovelByTool(requireProjectPathQuery(event), body);
});
