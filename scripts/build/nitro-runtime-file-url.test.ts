import {describe, expect, it} from "vitest";

import {
    containsAbsoluteNodeModuleFileUrl,
    patchAbsoluteNodeModuleFileUrls,
} from "nbook/scripts/build/nitro-runtime-file-url.mjs";

describe("Nitro Product绝对依赖路径", () => {
    it.each([
        "file://C:/Users/name/AppData/Local/Temp/build/node_modules/zod/index.js",
        "file:///C:/Users/NAME~1/AppData/Local/Temp/build/node_modules/zod/index.js",
        "file:///home/user/build/node_modules/zod/index.js",
    ])("替换长路径、8.3短路径和POSIX路径：%s", (source) => {
        const patched = patchAbsoluteNodeModuleFileUrls(`import '${source}';`, "./node_modules");
        expect(patched).toBe("import './node_modules/zod/index.js';");
        expect(containsAbsoluteNodeModuleFileUrl(patched)).toBe(false);
    });

    it("保留已经可迁移的相对Product依赖", () => {
        const source = "import './node_modules/zod/index.js';";
        expect(patchAbsoluteNodeModuleFileUrls(source, "../node_modules")).toBe(source);
        expect(containsAbsoluteNodeModuleFileUrl(source)).toBe(false);
    });
});
