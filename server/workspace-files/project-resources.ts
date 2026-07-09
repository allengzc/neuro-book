import {consola} from "consola";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

/**
 * Project 级资源统一生命周期注册表。
 *
 * 背景：Project Workspace 的常驻资源（Plot 的 PrismaClient 缓存、agent execute_sql 的
 * libsql client、workspace tree index 的 chokidar watcher……）过去各自为政：删除 Project
 * 前靠 `deleteProjectWorkspace` 手工逐个枚举关闭，切换 Project 与服务关停则完全没有关闭
 * 动作——Windows 下表现为 sqlite / 目录句柄悬挂、Project 目录删不掉。
 *
 * 本注册表把「谁持有 Project 资源」倒置为属主自注册：
 * - 各模块加载时注册 {@link ProjectResourceOwner}（模块没被加载 ⇒ 它必然没打开过资源，天然自洽）；
 * - 资源被访问时调用 {@link touchProjectResources} 报活；
 * - 删除 Project → {@link closeProjectResources}；服务关停 → {@link closeAllProjectResources}；
 *   长时间无访问且无活跃订阅 → 空闲清扫自动关闭（解决「切换 Project 后旧资源永不释放」）。
 *
 * 键形态：projectPath 一律为 `workspace/<slug>` 相对形（与 normalizeProjectPath 输出一致）。
 */
export type ProjectResourceOwner = {
    /** 属主名。用于日志归因与重复注册去重（同名再注册视为替换，兼容测试/HMR 重复加载）。 */
    name: string;
    /** 关闭指定 Project 已打开的资源。目标未打开时必须是幂等 no-op，不得抛错。 */
    close(projectPath: string): Promise<void>;
    /**
     * 关闭该属主持有的全部资源（服务关停用）。
     * 可空：缺省时注册表按「报活过的 Project」逐个调用 close 兜底；
     * 持有非 Project 键资源（如 user-assets watcher）的属主应实现它。
     */
    closeAll?(): Promise<void>;
    /**
     * 该 Project 当前是否仍被活跃使用（如 SSE 订阅在线）。
     * 可空：缺省视为不忙。返回 true 时空闲清扫整体跳过该 Project 并刷新报活时间。
     */
    busy?(projectPath: string): boolean;
};

/** 空闲多久后允许清扫关闭（无访问且无活跃订阅）。资源全部支持惰性重开，误关只付出一次重建成本。 */
export const PROJECT_RESOURCE_IDLE_TTL_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const owners = new Map<string, ProjectResourceOwner>();
const lastTouchAt = new Map<string, number>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 注册资源属主。各模块在自身模块作用域调用一次；同名重复注册按替换处理。
 */
export function registerProjectResourceOwner(owner: ProjectResourceOwner): void {
    owners.set(owner.name, owner);
}

/**
 * 资源被访问时报活。属主在「按 projectPath 取资源」的入口调用；首次报活会启动空闲清扫定时器。
 */
export function touchProjectResources(projectPath: string): void {
    const key = normalizeProjectResourceKey(projectPath);
    if (!key) {
        return;
    }
    lastTouchAt.set(key, Date.now());
    ensureSweepTimer();
}

/**
 * 关闭指定 Project 的全部资源。单个属主失败只告警不阻断其余属主（删除流程有墓碑兜底）。
 */
export async function closeProjectResources(projectPath: string): Promise<void> {
    const key = normalizeProjectResourceKey(projectPath);
    if (!key) {
        return;
    }
    lastTouchAt.delete(key);
    for (const owner of owners.values()) {
        try {
            await owner.close(key);
        } catch (error) {
            consola.warn({projectPath: key, owner: owner.name, error}, "关闭 Project 资源失败，继续处理其余属主");
        }
    }
    collectReleasedSqliteHandles({force: true});
}

/**
 * 关闭全部 Project 资源。服务关停（nitro close hook）调用；有 closeAll 的属主整体关闭，
 * 其余按报活记录逐 Project 关闭。
 */
export async function closeAllProjectResources(): Promise<void> {
    const touchedProjects = [...lastTouchAt.keys()];
    lastTouchAt.clear();
    for (const owner of owners.values()) {
        try {
            if (owner.closeAll) {
                await owner.closeAll();
                continue;
            }
            for (const projectPath of touchedProjects) {
                await owner.close(projectPath);
            }
        } catch (error) {
            consola.warn({owner: owner.name, error}, "服务关停时关闭 Project 资源失败");
        }
    }
    collectReleasedSqliteHandles({force: true});
}

/**
 * 空闲清扫：关闭超过 TTL 无访问且无属主报忙的 Project。返回本轮关闭的 projectPath（测试与日志用）。
 * now 可注入以便测试；生产由内部定时器按当前时间调用。
 */
export async function sweepIdleProjectResources(now = Date.now()): Promise<string[]> {
    const closed: string[] = [];
    for (const [projectPath, touchedAt] of [...lastTouchAt.entries()]) {
        if (now - touchedAt < PROJECT_RESOURCE_IDLE_TTL_MS) {
            continue;
        }
        if (isProjectResourceBusy(projectPath)) {
            lastTouchAt.set(projectPath, now);
            continue;
        }
        await closeProjectResources(projectPath);
        consola.info({projectPath}, "Project 资源空闲超时，已自动释放");
        closed.push(projectPath);
    }
    return closed;
}

/**
 * 测试专用：清空属主与报活记录并停掉清扫定时器，保证用例间隔离。
 */
export function resetProjectResourcesForTest(): void {
    owners.clear();
    lastTouchAt.clear();
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
}

function isProjectResourceBusy(projectPath: string): boolean {
    for (const owner of owners.values()) {
        try {
            if (owner.busy?.(projectPath)) {
                return true;
            }
        } catch {
            // busy 探测失败按不忙处理；关闭路径自身是幂等的。
        }
    }
    return false;
}

function ensureSweepTimer(): void {
    if (sweepTimer) {
        return;
    }
    sweepTimer = setInterval(() => {
        void sweepIdleProjectResources().catch((error: unknown) => {
            consola.warn({error}, "Project 资源空闲清扫失败");
        });
    }, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
}

/** 统一键形态：正斜杠、去尾斜杠。projectPath 约定为 `workspace/<slug>`。 */
function normalizeProjectResourceKey(projectPath: string): string {
    return projectPath.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
}
