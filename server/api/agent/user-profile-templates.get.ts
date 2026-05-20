import {listUserProfileTemplates} from "nbook/server/agent/profile-templates/profile-template-service";

/**
 * 列出用户 assets 中可编辑的动态 profile。
 */
export default defineEventHandler(async () => {
    return listUserProfileTemplates();
});
