import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createWorkspaceZipStream} from "nbook/server/workspace-files/workspace-archive";

describe("workspace-archive", () => {
    let root: string;

    beforeEach(async () => {
        root = path.join(".agent", "workspace-archive-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("打包 workspace 文件并遵守忽略规则", async () => {
        await writeFile("workspace.yaml", "name: test\n");
        await writeFile("manuscript/001/index.md", "# 第一章\n");
        await writeFile("assets/image.bin", Buffer.from([0, 1, 2, 3]));
        await writeFile("ignored.tmp", "skip\n");
        await writeFile(".git/config", "skip\n");
        await writeFile(".gitignore", "*.tmp\n");

        const archive = await createWorkspaceZipStream(root);
        const buffer = await readStreamBuffer(archive.stream);
        const entries = readZipEntryNames(buffer);

        expect(archive.filename).toBe(`${path.basename(root)}.zip`);
        expect(entries).toEqual(expect.arrayContaining([
            ".gitignore",
            "assets/image.bin",
            "manuscript/001/index.md",
            "workspace.yaml",
        ]));
        expect(entries).not.toContain("ignored.tmp");
        expect(entries.some((entry) => entry.startsWith(".git/"))).toBe(false);
    });

    /**
     * 写入测试文件并自动创建父目录。
     */
    async function writeFile(filePath: string, content: string | Buffer): Promise<void> {
        const absolutePath = path.join(root, filePath);
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, content);
    }
});

/**
 * 读取 Node stream 的完整 Buffer。
 */
async function readStreamBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * 读取 zip 中央目录里的条目名称，用于验证归档路径。
 */
function readZipEntryNames(buffer: Buffer): string[] {
    const names: string[] = [];
    for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            continue;
        }

        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const nameStart = offset + 46;
        const nameEnd = nameStart + nameLength;
        names.push(buffer.subarray(nameStart, nameEnd).toString("utf-8"));
        offset = nameEnd + extraLength + commentLength - 1;
    }
    return names.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}
