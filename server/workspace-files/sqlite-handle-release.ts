/**
 * Bun + libsql 在 Windows 上可能要等 native Database 对象被 GC 后才释放文件句柄。
 */
export function collectReleasedSqliteHandles(): void {
    const runtime = globalThis as typeof globalThis & {
        Bun?: {
            gc?: (force?: boolean) => void;
        };
    };
    runtime.Bun?.gc?.(true);
}
