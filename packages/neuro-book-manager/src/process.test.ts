import {describe, expect, it} from "vitest";

import {runBun} from "#manager/process";

describe("Bun子进程适配器", () => {
    it("完整转发包含空格的参数", async () => {
        await runBun(process.execPath, [
            "-e",
            "if (process.argv[1] !== 'value with spaces') process.exit(2)",
            "--",
            "value with spaces",
        ], {stdio: "ignore"});
    });

    it("保留子进程非零退出语义", async () => {
        await expect(runBun(process.execPath, ["-e", "process.exit(7)"], {stdio: "ignore"})).rejects.toThrow("退出码 7");
    });
});
