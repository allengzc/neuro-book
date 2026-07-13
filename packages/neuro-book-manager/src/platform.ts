import type {ProductPlatform} from "#manager/types";

/** 解析当前 Product 平台；首版只支持 Windows/Linux x64。 */
export function currentProductPlatform(): ProductPlatform {
    assertManagerPlatform();
    if (process.platform === "win32") {
        return "windows-x64";
    }
    if (process.platform === "linux") {
        const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined;
        if (!report?.header?.glibcVersionRuntime) {
            throw new Error("Manager v1 只支持 Linux x64 glibc，当前环境未检测到 glibc。" );
        }
        return "linux-x64-glibc";
    }
    throw new Error(`当前只支持 Windows/Linux，检测到：${process.platform}`);
}

/** Manager v1 的统一宿主平台门禁。 */
export function assertManagerPlatform(): void {
    if (process.arch !== "x64") throw new Error(`Manager v1 只支持 x64，检测到：${process.arch}`);
    if (process.platform === "win32") return;
    if (process.platform === "linux") {
        const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined;
        if (!report?.header?.glibcVersionRuntime) throw new Error("Manager v1 只支持 Linux x64 glibc。" );
        return;
    }
    throw new Error(`Manager v1 只支持 Windows/Linux，检测到：${process.platform}`);
}

/** 返回平台可执行文件后缀。 */
export function executableName(name: string): string {
    return process.platform === "win32" ? `${name}.exe` : name;
}
