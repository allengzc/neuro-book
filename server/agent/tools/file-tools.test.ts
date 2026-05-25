import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveBashPathForPlatform} from "nbook/server/agent/tools/file-tools";

describe("v3 file tools", () => {
    let root: string;
    let workspaceRoot: string;
    let harness: NeuroAgentHarness;
    let context: ToolExecutionContext;

    beforeEach(async () => {
        root = resolve(".agent", "agent-file-tools-test", randomUUID());
        workspaceRoot = join(root, "workspace");
        await mkdir(workspaceRoot, {recursive: true});
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
        });
        const session = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot,
        });
        context = {
            harness,
            sessionId: session.sessionId,
            workspaceRoot,
            workspaceKey: "global",
        };
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("read 支持 offset/limit 和 continuation 提示", async () => {
        await writeFile(join(workspaceRoot, "notes.md"), "a\nb\nc\nd", "utf-8");
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-1", {
            path: "notes.md",
            offset: 2,
            limit: 2,
        });

        expect(result?.content).toEqual([
            {type: "text", text: "b\nc\n\n[1 more lines in file. Use offset=4 to continue.]"},
        ]);
    });

    it("read 图片时保留模型可见 image block", async () => {
        await writeFile(join(workspaceRoot, "cover.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        const tool = mustTool("read", harness);

        const result = await tool.executeWithContext?.(context, "read-image-1", {
            path: "cover.jpg",
        });

        expect(result?.content).toEqual([
            {type: "text", text: "Read image file [image/jpeg]"},
            {type: "image", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")},
        ]);
    });

    it("write 创建父目录并写入内容", async () => {
        const tool = mustTool("write", harness);

        await tool.executeWithContext?.(context, "write-1", {
            path: "nested/file.txt",
            content: "hello",
        });

        await expect(readFile(join(workspaceRoot, "nested", "file.txt"), "utf-8")).resolves.toBe("hello");
    });

    it("edit 执行精确替换并拒绝重复 oldText", async () => {
        await writeFile(join(workspaceRoot, "edit.txt"), "one\ntwo\nthree", "utf-8");
        const tool = mustTool("edit", harness);

        const result = await tool.executeWithContext?.(context, "edit-1", {
            path: "edit.txt",
            edits: [{oldText: "two", newText: "TWO"}],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            diff: expect.stringContaining("TWO"),
            firstChangedLine: expect.any(Number),
        }));
        await expect(readFile(join(workspaceRoot, "edit.txt"), "utf-8")).resolves.toBe("one\nTWO\nthree");

        await writeFile(join(workspaceRoot, "edit.txt"), "dup\ndup", "utf-8");
        await expect(tool.executeWithContext?.(context, "edit-2", {
            path: "edit.txt",
            edits: [{oldText: "dup", newText: "x"}],
        })).rejects.toThrow("multiple occurrences");
    });

    it("apply_patch 应用 Codex patch JSON 参数", async () => {
        await writeFile(join(workspaceRoot, "patch.txt"), "old\nline\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-1", patchInput([
            "*** Begin Patch",
            "*** Update File: patch.txt",
            "@@",
            "-old",
            "+new",
            " line",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "patch.txt"), "utf-8")).resolves.toBe("new\nline\n");
    });

    it("apply_patch 支持同一文件多 hunk", async () => {
        await writeFile(join(workspaceRoot, "multi-hunk.txt"), "alpha\nmiddle\nomega\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-multi-hunk", patchInput([
            "*** Begin Patch",
            "*** Update File: multi-hunk.txt",
            "@@",
            "-alpha",
            "+ALPHA",
            " middle",
            "@@",
            "-omega",
            "+OMEGA",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "multi-hunk.txt"), "utf-8")).resolves.toBe("ALPHA\nmiddle\nOMEGA\n");
    });

    it("apply_patch 支持 End of File 标记移除尾随换行", async () => {
        await writeFile(join(workspaceRoot, "no-newline.txt"), "old\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await tool.executeWithContext?.(context, "patch-no-newline", patchInput([
            "*** Begin Patch",
            "*** Update File: no-newline.txt",
            "@@",
            "-old",
            "+new",
            "*** End of File",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "no-newline.txt"), "utf-8")).resolves.toBe("new");
    });

    it("apply_patch 支持新增、删除和移动文件", async () => {
        await writeFile(join(workspaceRoot, "old-name.txt"), "alpha\n", "utf-8");
        await writeFile(join(workspaceRoot, "delete-me.txt"), "bye\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        const result = await tool.executeWithContext?.(context, "patch-multi", patchInput([
            "*** Begin Patch",
            "*** Add File: added.txt",
            "+hello",
            "*** Update File: old-name.txt",
            "*** Move to: nested/new-name.txt",
            "@@",
            "-alpha",
            "+beta",
            "*** Delete File: delete-me.txt",
            "*** End Patch",
        ]));

        await expect(readFile(join(workspaceRoot, "added.txt"), "utf-8")).resolves.toBe("hello\n");
        await expect(readFile(join(workspaceRoot, "nested", "new-name.txt"), "utf-8")).resolves.toBe("beta\n");
        await expect(readFile(join(workspaceRoot, "delete-me.txt"), "utf-8")).rejects.toThrow();
        expect(result?.details).toEqual(expect.objectContaining({
            files: expect.arrayContaining([
                {path: "added.txt", action: "add"},
                {path: "old-name.txt", action: "delete"},
                {path: "nested/new-name.txt", action: "add"},
                {path: "delete-me.txt", action: "delete"},
            ]),
        }));
    });

    it("apply_patch 失败时不产生部分写入", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Update File: missing.txt",
            "@@",
            "-x",
            "+y",
            "*** End Patch",
        ]))).rejects.toThrow("文件不存在");

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
    });

    it("apply_patch 拒绝 Add File 覆盖已有文件", async () => {
        await writeFile(join(workspaceRoot, "existing.txt"), "original\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-existing-add", patchInput([
            "*** Begin Patch",
            "*** Add File: existing.txt",
            "+replacement",
            "*** End Patch",
        ]))).rejects.toThrow("文件已存在");

        await expect(readFile(join(workspaceRoot, "existing.txt"), "utf-8")).resolves.toBe("original\n");
    });

    it("apply_patch 先更新再删除时失败会回滚到 patch 前内容", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        await writeFile(join(workspaceRoot, "blocked"), "not a directory\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-delete-after-update-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Delete File: keep.txt",
            "*** Add File: blocked/file.txt",
            "+created",
            "*** End Patch",
        ]))).rejects.toThrow();

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
        await expect(readFile(join(workspaceRoot, "blocked"), "utf-8")).resolves.toBe("not a directory\n");
    });

    it("apply_patch 缺失上下文时失败", async () => {
        await writeFile(join(workspaceRoot, "context.txt"), "present\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-missing-context", patchInput([
            "*** Begin Patch",
            "*** Update File: context.txt",
            "@@",
            "-missing",
            "+new",
            "*** End Patch",
        ]))).rejects.toThrow("missing context");

        await expect(readFile(join(workspaceRoot, "context.txt"), "utf-8")).resolves.toBe("present\n");
    });

    it("apply_patch 拒绝无效 patch 头", async () => {
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-invalid-header", {
            patch: [
            "--- a/file.txt",
            "+++ b/file.txt",
            "@@",
            "-old",
            "+new",
            ].join("\n"),
        })).rejects.toThrow("*** Begin Patch");
    });

    it("apply_patch 写入阶段失败时会回滚已写文件", async () => {
        await writeFile(join(workspaceRoot, "keep.txt"), "old\n", "utf-8");
        await writeFile(join(workspaceRoot, "blocked"), "not a directory\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-write-fail", patchInput([
            "*** Begin Patch",
            "*** Update File: keep.txt",
            "@@",
            "-old",
            "+new",
            "*** Add File: blocked/file.txt",
            "+created",
            "*** End Patch",
        ]))).rejects.toThrow();

        await expect(readFile(join(workspaceRoot, "keep.txt"), "utf-8")).resolves.toBe("old\n");
        await expect(readFile(join(workspaceRoot, "blocked"), "utf-8")).resolves.toBe("not a directory\n");
    });

    it("apply_patch 暴露 JSON patch 参数", () => {
        const tool = mustTool("apply_patch", harness);

        expect(tool.parameters).toEqual(expect.objectContaining({
            type: "object",
            additionalProperties: false,
            properties: expect.objectContaining({
                patch: expect.objectContaining({type: "string"}),
            }),
        }));
        expect(tool.description).toContain("patch");
    });

    it("apply_patch 拒绝越过 workspaceRoot", async () => {
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-outside", patchInput([
            "*** Begin Patch",
            "*** Add File: ../outside.txt",
            "+nope",
            "*** End Patch",
        ]))).rejects.toThrow("越过 workspaceRoot");
    });

    it("apply_patch 拒绝删除目录", async () => {
        await mkdir(join(workspaceRoot, "folder"), {recursive: true});
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-delete-directory", patchInput([
            "*** Begin Patch",
            "*** Delete File: folder",
            "*** End Patch",
        ]))).rejects.toThrow("不能修改目录");
    });

    it("apply_patch 不接受旧 unified diff patch 内容", async () => {
        await writeFile(join(workspaceRoot, "patch.txt"), "old\nline\n", "utf-8");
        const tool = mustTool("apply_patch", harness);

        await expect(tool.executeWithContext?.(context, "patch-old-json", {
            patch: [
                "@@ -1,2 +1,2 @@",
                "-old",
                "+new",
                " line",
                "",
            ].join("\n"),
        })).rejects.toThrow("*** Begin Patch");
    });

    it("bash 在 workspace root 执行真实 bash 并合并输出", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-1", {
            command: "pwd && echo out && echo err 1>&2",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text).toContain("out");
        expect(text).toContain("err");
    });

    it("bash 自动注入 Agent bin 并允许 workspace CLI 从 workspace cwd 运行", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-workspace-cli", {
            command: "pwd && command -v workspace && workspace --help",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text).toContain(".agent/agent-file-tools-test");
        expect(text).toContain("/workspace");
        expect(text).toContain("agent/bin/workspace");
        expect(text).toContain("Usage: workspace [options] [command]");
    });

    it("bash 能通过 workspace CLI 解析和校验内容节点", async () => {
        await writeFile(join(workspaceRoot, "workspace.yaml"), "schemaVersion: 1\nslug: test\ndisplayName: Test\nnovelId: \"1\"\ncreatedAt: \"2026-05-24T00:00:00.000Z\"\nupdatedAt: \"2026-05-24T00:00:00.000Z\"\n", "utf-8");
        await mkdir(join(workspaceRoot, "lorebook", "character", "hero"), {recursive: true});
        await writeFile(join(workspaceRoot, "lorebook", "character", "hero", "index.md"), "---\ntitle: Hero\ntype: character\nstatus: active\nsummary: 主角。\nrefs: []\n---\n\n正文。", "utf-8");
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-workspace-node", {
            command: "workspace node parse lorebook/character/hero --json && workspace node validate lorebook/character/hero --fix-missing",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text).toContain("\"path\": \"lorebook/character/hero/\"");
        expect(text).toContain("\"type\": \"character\"");
        expect(text).toContain("OK");
    });

    it("bash 优先从 user-assets bin 解析 workspace CLI", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-user-workspace-cli", {
            command: "command -v workspace",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.replaceAll("\\", "/")).toContain("workspace/.nbook/agent/bin/workspace");
    });

    it("bash 会实际执行 user-assets bin 中的覆盖命令", async () => {
        const userBinPath = resolve("workspace", ".nbook", "agent", "bin", "workspace");
        const original = await readFile(userBinPath, "utf-8");
        await writeFile(userBinPath, "#!/usr/bin/env sh\necho user-bin-test\n", "utf-8");
        const tool = mustTool("bash", harness);

        try {
            const result = await tool.executeWithContext?.(context, "bash-user-workspace-exec", {
                command: "workspace",
                timeout: 10,
            });

            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
            expect(text).toContain("user-bin-test");
        } finally {
            await writeFile(userBinPath, original, "utf-8");
        }
    });

    it("bash 在 Git Bash 内也会把 Agent bin 放到 PATH 最前面", async () => {
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-path-order", {
            command: "printf '%s\\n' \"$PATH\"",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        const firstPath = text.split(":")[0]?.replaceAll("\\", "/") ?? "";
        expect(firstPath).toContain("workspace/.nbook/agent/bin");
    });

    it("bash 为 rg 注入 Agent 专用配置并统一输出 / 路径", async () => {
        await writeFile(join(workspaceRoot, "workspace.yaml"), "schemaVersion: 1\nslug: test\ndisplayName: Test\nnovelId: \"1\"\ncreatedAt: \"2026-05-24T00:00:00.000Z\"\nupdatedAt: \"2026-05-24T00:00:00.000Z\"\n", "utf-8");
        await mkdir(join(workspaceRoot, "lorebook", "character", "hero"), {recursive: true});
        await writeFile(join(workspaceRoot, "lorebook", "character", "hero", "index.md"), "---\ntitle: Hero\ntype: character\nstatus: active\nrefs: []\n---\n\n正文。", "utf-8");
        const tool = mustTool("bash", harness);

        const result = await tool.executeWithContext?.(context, "bash-rg-config", {
            command: "printf 'config=%s\\n' \"$RIPGREP_CONFIG_PATH\" && rg --files | rg 'index.md$'",
            timeout: 10,
        });

        const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
        expect(text.replaceAll("\\", "/")).toContain("config=");
        expect(text.replaceAll("\\", "/")).toContain(".nbook/agent/config/ripgreprc");
        expect(text).toContain("lorebook/character/hero/index.md");
        expect(text).not.toContain("lorebook\\character\\hero\\index.md");
    });

    it("bash 优先使用 user-assets rg 配置", async () => {
        const userConfigPath = resolve("workspace", ".nbook", "agent", "config", "ripgreprc");
        let original: string | null = null;
        try {
            original = await readFile(userConfigPath, "utf-8");
        } catch {
            original = null;
        }
        await mkdir(dirname(userConfigPath), {recursive: true});
        await writeFile(userConfigPath, "--path-separator=/\n", "utf-8");
        const tool = mustTool("bash", harness);

        try {
            const result = await tool.executeWithContext?.(context, "bash-user-rg-config", {
                command: "printf '%s\\n' \"$RIPGREP_CONFIG_PATH\"",
                timeout: 10,
            });

            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";
            expect(text.replaceAll("\\", "/")).toContain("workspace/.nbook/agent/config/ripgreprc");
        } finally {
            if (original === null) {
                await rm(userConfigPath, {force: true});
            } else {
                await writeFile(userConfigPath, original, "utf-8");
            }
        }
    });

    it("Windows bash 解析优先使用真实存在的 Git Bash 路径，再查 PATH 命令", () => {
        const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
        const pathBash = "C:\\Tools\\bin\\bash.exe";
        const foundGitBash = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                PATH: "C:\\Tools\\bin",
            },
            pathExists(path) {
                return path === gitBash || path === pathBash;
            },
        });

        const foundPathBash = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                PATH: "C:\\Tools\\bin",
            },
            pathExists(path) {
                return path === pathBash;
            },
        });

        expect(foundGitBash).toBe(gitBash);
        expect(foundPathBash).toBe("bash.exe");
    });

    it("Windows bash 解析支持 Scoop 用户级 Git 安装路径", () => {
        const scoopBash = "C:\\Users\\Ada\\scoop\\apps\\git\\current\\bin\\bash.exe";

        const found = resolveBashPathForPlatform({
            platform: "win32",
            env: {
                USERPROFILE: "C:\\Users\\Ada",
                PATH: "",
            },
            pathExists(path) {
                return path === scoopBash;
            },
        });

        expect(found).toBe(scoopBash);
    });

    it("基础工具 description 对齐 Pi 风格工具选择规则", () => {
        const read = mustTool("read", harness);
        const write = mustTool("write", harness);
        const edit = mustTool("edit", harness);
        const applyPatch = mustTool("apply_patch", harness);
        const bash = mustTool("bash", harness);

        expect(read.description).toContain("Images are sent as attachments");
        expect(read.description).toContain("continue with offset until complete");
        expect(read.description).toContain("instead of cat/head/tail/sed");
        expect(write.description).toContain("new files or complete rewrites");
        expect(edit.description).toContain("one edit call with multiple entries in edits[]");
        expect(edit.description).toContain("matched against the original file");
        expect(edit.description).toContain("small as possible while still unique");
        expect(applyPatch.description).toContain("verified patch");
        expect(applyPatch.description).toContain("prefer one edit call");
        expect(bash.description).toContain("agent workspace root");
        expect(bash.description).toContain("agent bin directories are prepended to PATH");
        expect(bash.description).toContain("workspace node");
        expect(bash.description).toContain("Prefer / path separators");
        expect(bash.description).toContain("quote Windows backslash paths");
        expect(bash.description).toContain("stdout and stderr merged");
        expect(bash.description).toContain("rg/find/ls/git/tests/build/workspace CLI");
        expect(bash.description).toContain("not for file reading or editing");
    });
});

function patchInput(lines: string[]): {patch: string} {
    return {patch: lines.join("\n")};
}

function mustTool(key: string, harness: NeuroAgentHarness) {
    const tool = harness.tools.get(key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing tool ${key}`);
    }
    return tool;
}
