import fs from "node:fs/promises";
import path from "node:path";
import {defineNitroPlugin} from "nitropack/runtime";
import {WORKSPACE_CONTAINER_ROOT} from "nbook/server/workspace-files/novel-workspace";

export default defineNitroPlugin(async () => {
    await fs.mkdir(path.resolve(process.cwd(), WORKSPACE_CONTAINER_ROOT), {recursive: true});
});
