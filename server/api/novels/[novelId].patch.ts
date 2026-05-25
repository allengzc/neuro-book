import {
    UpdateNovelRequestDtoSchema,
    type UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {requireProjectPath, updateNovelByTool, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新 Project manifest 信息。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPath(event);
    const body = await validateBody<UpdateNovelRequestDto>(event, UpdateNovelRequestDtoSchema);
    return updateNovelByTool(projectPath, body);
});
