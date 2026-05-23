import {useAgentHarness} from "nbook/server/agent/http";
import {listProfileFiles} from "nbook/server/agent/profiles/workbench-service";

/**
 * 列出用户 profile root 下的源码文件，包含坏文件。
 */
export default defineEventHandler(async () => {
    return listProfileFiles(useAgentHarness().profiles);
});
