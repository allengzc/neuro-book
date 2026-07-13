import {createWriteStream} from "node:fs";
import {mkdir} from "node:fs/promises";
import {dirname} from "node:path";
import {pipeline} from "node:stream/promises";

import yazl from "yazl";

export type ZipEntry = {source: string; archivePath: string};

/** 使用 yazl 的惰性文件读取和 Node pipeline 写入 zip，避免 Windows 大目录耗尽文件句柄。 */
export async function writeZipArchive(output: string, files: ZipEntry[], progressEvery = 1000): Promise<void> {
    await mkdir(dirname(output), {recursive: true});
    const zip = new yazl.ZipFile();
    for (const [index, file] of files.entries()) {
        zip.addFile(file.source, file.archivePath.replaceAll("\\", "/"));
        const count = index + 1;
        if (count % progressEvery === 0 || count === files.length) console.log(`ZIP 已登记 ${count}/${files.length} 个文件`);
    }
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(output));
}
