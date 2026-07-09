import {randomBytes} from "node:crypto";
import {createWriteStream, type WriteStream} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type TruncationResult} from "nbook/server/agent/tools/truncate";

export type OutputSnapshot = {
    content: string;
    truncation: TruncationResult;
    fullOutputPath?: string;
};

/**
 * 增量收集 bash 输出。内存只保留尾部，截断时把完整输出写入临时日志。
 */
export class OutputAccumulator {
    private readonly decoder = new TextDecoder();
    private readonly maxRollingBytes = DEFAULT_MAX_BYTES * 2;
    private rawChunks: Buffer[] = [];
    private tailText = "";
    private tailBytes = 0;
    private totalRawBytes = 0;
    private totalDecodedBytes = 0;
    private totalLines = 1;
    private currentLineBytes = 0;
    private finished = false;
    private tempFilePath: string | undefined;
    private tempFileStream: WriteStream | undefined;

    constructor(private readonly tempFilePrefix = "neuro-bash") {}

    /**
     * 追加原始输出 chunk。
     */
    append(data: Buffer): void {
        if (this.finished) {
            throw new Error("Cannot append to a finished output accumulator");
        }
        this.totalRawBytes += data.length;
        this.appendDecodedText(this.decoder.decode(data, {stream: true}));
        if (this.tempFileStream || this.shouldUseTempFile()) {
            this.ensureTempFile();
            this.tempFileStream?.write(data);
            return;
        }
        this.rawChunks.push(data);
    }

    /**
     * 结束收集并 flush decoder。
     */
    finish(): void {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.appendDecodedText(this.decoder.decode());
        if (this.shouldUseTempFile()) {
            this.ensureTempFile();
        }
    }

    /**
     * 生成模型可见快照。
     */
    snapshot(persistIfTruncated = false): OutputSnapshot {
        const truncation = truncateTail(this.tailText, {
            maxLines: DEFAULT_MAX_LINES,
            maxBytes: DEFAULT_MAX_BYTES,
        });
        const truncated = this.totalLines > DEFAULT_MAX_LINES || this.totalDecodedBytes > DEFAULT_MAX_BYTES;
        const finalTruncation: TruncationResult = {
            ...truncation,
            truncated,
            truncatedBy: truncated ? truncation.truncatedBy ?? (this.totalDecodedBytes > DEFAULT_MAX_BYTES ? "bytes" : "lines") : null,
            totalLines: this.totalLines,
            totalBytes: this.totalDecodedBytes,
        };
        if (persistIfTruncated && finalTruncation.truncated) {
            this.ensureTempFile();
        }
        return {
            content: finalTruncation.content,
            truncation: finalTruncation,
            fullOutputPath: this.tempFilePath,
        };
    }

    /**
     * 关闭临时文件流。
     */
    async closeTempFile(): Promise<void> {
        if (!this.tempFileStream) {
            return;
        }
        const stream = this.tempFileStream;
        this.tempFileStream = undefined;
        await new Promise<void>((resolve, reject) => {
            stream.once("error", reject);
            stream.once("finish", resolve);
            stream.end();
        });
    }

    get lastLineBytes(): number {
        return this.currentLineBytes;
    }

    private appendDecodedText(text: string): void {
        if (!text) {
            return;
        }
        const bytes = Buffer.byteLength(text, "utf-8");
        this.totalDecodedBytes += bytes;
        this.tailText += text;
        this.tailBytes += bytes;
        if (this.tailBytes > this.maxRollingBytes * 2) {
            const buffer = Buffer.from(this.tailText, "utf-8");
            const start = Math.max(0, buffer.length - this.maxRollingBytes);
            this.tailText = buffer.subarray(start).toString("utf-8");
            this.tailBytes = Buffer.byteLength(this.tailText, "utf-8");
        }
        let newlines = 0;
        let lastNewline = -1;
        for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
            newlines++;
            lastNewline = index;
        }
        if (newlines === 0) {
            this.currentLineBytes += bytes;
            return;
        }
        this.totalLines += newlines;
        this.currentLineBytes = Buffer.byteLength(text.slice(lastNewline + 1), "utf-8");
    }

    private shouldUseTempFile(): boolean {
        return this.totalRawBytes > DEFAULT_MAX_BYTES || this.totalDecodedBytes > DEFAULT_MAX_BYTES || this.totalLines > DEFAULT_MAX_LINES;
    }

    private ensureTempFile(): void {
        if (this.tempFilePath) {
            return;
        }
        this.tempFilePath = join(tmpdir(), `${this.tempFilePrefix}-${randomBytes(8).toString("hex")}.log`);
        this.tempFileStream = createWriteStream(this.tempFilePath);
        for (const chunk of this.rawChunks) {
            this.tempFileStream.write(chunk);
        }
        this.rawChunks = [];
    }
}
