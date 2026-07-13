import fs from "node:fs/promises";
import {defineNitroPlugin} from "nitropack/runtime";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";

export default defineNitroPlugin(async () => {
    await fs.mkdir(resolveStateWorkspaceRoot(), {recursive: true});
});
