import {consola} from "consola";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    assertProjectWorkspaceDirectory,
    initProjectDatabase,
    normalizeProjectPath,
} from "nbook/server/workspace-files/project-workspace";

/**
 * ProjectSession：Project 级显式生命周期模块（Task 94，演进自 Task 92 的隐式资源注册表）。
 *
 * 模型：
 * - 项目必须显式 {@link openProject} 才算「打开」——open 时校验目录存在（404 语义）并把
 *   initProjectDatabase 的迁移收敛到这一次执行；数据面守卫用 {@link assertProjectOpen}，
 *   未 open 抛 typed {@link ProjectNotOpenError}（HTTP 层映射 409 + data.code="PROJECT_NOT_OPEN"）。
 * - 在场两路显式声明：用户在场 = presence 连接引用计数（{@link acquireUserPresence}，SSE 连接
 *   即 acquire、断开即 release）；agent 在场 = harness 注册的单槽探针
 *   （{@link registerAgentPresenceProbe}，按「该项目是否有运行中 invocation」回答）。
 * - 状态机：`open` →（presence 归零且 agent 探针 false）→ `grace`（{@link PROJECT_GRACE_MS} 宽限）
 *   → 到期 {@link closeProject}("grace-expired") 级联释放；宽限内任一在场恢复则回 `open`。
 * - 资源属主倒置自注册（{@link registerProjectResourceOwner}）：close 先从 sessions 除名再逐属主
 *   关门，失败者进泄漏表由周期维护（{@link sweepProjectSessions}，30s 定时）重试。
 * - 原 touch 报活降级为 {@link markProjectActivity}：仅刷新 lastActivityAt 供可观测性，
 *   不再承载任何生命周期语义（绝不隐式建 session）。
 *
 * 键形态：projectPath 一律为 `workspace/<slug>` 归一形（normalizeProjectPath 输出）；
 * 各入口先归一化，非法形态由 normalizeProjectPath 抛 400 createError。
 * 本模块刻意不预热 tree watcher（HTTP open 路由负责），避免与 project-workspace-index 循环 import。
 */

/** 谁发起了 open。用于日志归因与删除占用报告。 */
export type ProjectOpener =
    | {kind: "user"}
    | {kind: "agent"; sessionId: number}
    | {kind: "job"; source: string};

/** 数据面守卫错误：项目未 open。HTTP 层应映射 409 + data.code="PROJECT_NOT_OPEN"。 */
export class ProjectNotOpenError extends Error {
    /** 未 open 的 projectPath（`workspace/<slug>` 归一形）。 */
    readonly projectPath: string;

    constructor(projectPath: string) {
        super(`Project 未打开：${projectPath}`);
        this.name = "ProjectNotOpenError";
        this.projectPath = projectPath;
    }
}

/**
 * Project 会话资源属主。各模块加载时自注册（模块没被加载 ⇒ 它必然没打开过资源，天然自洽）。
 */
export type ProjectResourceOwner = {
    /** 属主名。用于日志归因与重复注册去重（同名再注册视为替换，兼容测试/HMR 重复加载）。 */
    name: string;
    /** 关闭指定 Project 已打开的资源。目标未打开时必须是幂等 no-op，不得抛错。 */
    close(projectPath: string): Promise<void>;
    /** 关闭该属主持有的全部资源（服务关停用）。必填：每个属主都必须能整体自关。 */
    closeAll(): Promise<void>;
    /**
     * 该 Project 当前是否仍被属主内部活跃使用（如 SSE 订阅在线）。
     * 可空：缺省视为不忙。当前生命周期判定以 presence/agent 探针为准，busy 保留供属主自查。
     */
    busy?(projectPath: string): boolean;
};

/** presence 归零且 agent 不在场后，进入 grace 到自动 close 的宽限时长。 */
export const PROJECT_GRACE_MS = 5 * 60_000;

/** 周期维护间隔：agent 空闲检测、宽限到期关闭、泄漏重试共用一个定时器。 */
const MAINTENANCE_INTERVAL_MS = 30_000;

/** 单个 Project 的会话状态。 */
type ProjectSessionRecord = {
    /** open = 使用中；grace = 等待宽限到期的待关闭态（对 assertProjectOpen 仍视为打开）。 */
    state: "open" | "grace";
    /** 用户 presence 连接引用计数（多标签页 = 多连接）。 */
    userConnections: number;
    /** 会话建立时刻（ISO 字符串）。 */
    openedAt: string;
    /** 最近一次 markProjectActivity 报活时刻（ISO 字符串），仅供可观测性。 */
    lastActivityAt: string;
    /** open 发起方，日志归因用。 */
    openedBy: ProjectOpener;
    /** grace 到期时刻（epoch ms）。非空当且仅当 state === "grace"。 */
    graceDeadline: number | null;
};

const owners = new Map<string, ProjectResourceOwner>();
const sessions = new Map<string, ProjectSessionRecord>();
/** close 中有属主失败的 Project，由周期维护重跑全部属主 close 直到成功。 */
const leakedProjects = new Set<string>();
/**
 * 每 projectPath 的串行锁：同一 key 的 open 建会话与 close 排队互斥，
 * 避免 close 的逐属主关门（含 await）途中被并发重开的新会话资源被误关（审查确认的核心竞态）。
 */
const keyLocks = new Map<string, Promise<unknown>>();
/** harness 注册的 agent 在场探针（单槽覆盖式）。 */
let agentPresenceProbe: ((projectPath: string) => boolean) | null = null;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
/** 周期维护定时器回调的重入闸：上一轮 sweep 未完（慢属主）时跳过本次 tick。 */
let sweepInFlight = false;

/**
 * 在指定 projectPath 的串行锁内执行 fn：同一 key 的 open/close 依次排队，前一操作成功或失败都继续本操作。
 * 队尾操作在 finally 清理锁表条目，防止 Map 随 key 无限增长。
 */
async function withProjectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = keyLocks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    // guard 是存回锁表的稳定引用（吸收拒绝，防止未处理 rejection），供 finally 判断本操作是否仍是队尾。
    const guard = current.catch(() => undefined);
    keyLocks.set(key, guard);
    try {
        return await current;
    } finally {
        if (keyLocks.get(key) === guard) {
            keyLocks.delete(key);
        }
    }
}

/**
 * 注册资源属主。各模块在自身模块作用域调用一次；同名重复注册按替换处理。
 */
export function registerProjectResourceOwner(owner: ProjectResourceOwner): void {
    owners.set(owner.name, owner);
}

/**
 * 幂等 open：建立（或恢复）Project 会话。
 * - 已有会话：grace 态取消宽限回 open，其余直接返回；
 * - 无会话：校验目录存在且未标记删除（404 语义）→ 跑一次 initProjectDatabase（迁移收敛到 open）→ 建会话。
 * 并发调用经 openInFlight 去重，只有首个调用真正执行建会话流程。
 */
export async function openProject(projectPath: string, opener: ProjectOpener): Promise<void> {
    const key = normalizeProjectPath(projectPath);
    // 全程进锁：与 close 串行。存在性判定必须在锁内做——锁外读到的「已 open」可能是一个正在被
    // close 拆除的旧会话，据此短路会让重开丢失（审查确认的 close-vs-reopen 竞态）。
    await withProjectLock(key, async () => {
        const existing = sessions.get(key);
        if (existing) {
            if (existing.state === "grace") {
                existing.state = "open";
                existing.graceDeadline = null;
                consola.info({projectPath: key, opener}, "ProjectSession 宽限已取消，回到 open");
            }
            return;
        }
        await establishProjectSession(key, opener);
    });
}

/**
 * 真正执行首次 open 的建会话流程：目录校验 → 数据库迁移 → 落会话记录。调用方持有 key 锁。
 */
async function establishProjectSession(key: string, opener: ProjectOpener): Promise<void> {
    await assertProjectWorkspaceDirectory(key);
    await initProjectDatabase(key);
    // 重开取消对该 key 的泄漏重试：旧 orphan 资源让位给新会话，避免下轮 sweep 把新会话资源误关。
    leakedProjects.delete(key);
    const nowIso = new Date().toISOString();
    sessions.set(key, {
        state: "open",
        userConnections: 0,
        openedAt: nowIso,
        lastActivityAt: nowIso,
        openedBy: opener,
        graceDeadline: null,
    });
    ensureMaintenanceTimer();
    consola.info({projectPath: key, opener}, "ProjectSession 已打开");
}

/**
 * 数据面守卫：项目未 open（既非 open 也非 grace）时抛 {@link ProjectNotOpenError}。
 */
export function assertProjectOpen(projectPath: string): void {
    const key = normalizeProjectPath(projectPath);
    if (!sessions.has(key)) {
        throw new ProjectNotOpenError(key);
    }
}

/**
 * 项目是否处于打开状态（open 或 grace 都算）。
 */
export function isProjectOpen(projectPath: string): boolean {
    return sessions.has(normalizeProjectPath(projectPath));
}

/**
 * 列出全部打开中的 Project 会话。删除占用报告与调试用。
 */
export function listOpenProjects(): Array<{projectPath: string; state: "open" | "grace"; userConnections: number; agentActive: boolean; openedAt: string; lastActivityAt: string}> {
    return [...sessions.entries()].map(([projectPath, session]) => ({
        projectPath,
        state: session.state,
        userConnections: session.userConnections,
        agentActive: isAgentActive(projectPath),
        openedAt: session.openedAt,
        lastActivityAt: session.lastActivityAt,
    }));
}

/**
 * 删除路由的占用检查用。session 不存在返回 null。
 */
export function projectOccupancy(projectPath: string): {state: "open" | "grace"; userConnections: number; agentActive: boolean} | null {
    const key = normalizeProjectPath(projectPath);
    const session = sessions.get(key);
    if (!session) {
        return null;
    }
    return {
        state: session.state,
        userConnections: session.userConnections,
        agentActive: isAgentActive(key),
    };
}

/**
 * 声明一路用户在场（presence SSE 连接建立时调用）。未 open 抛 {@link ProjectNotOpenError}。
 * 返回幂等的释放函数（连接断开时调）：计数归零时立即判定——agent 探针在场则保持 open，
 * 否则进入 grace 并起算宽限。
 */
export function acquireUserPresence(projectPath: string): () => void {
    const key = normalizeProjectPath(projectPath);
    const session = sessions.get(key);
    if (!session) {
        throw new ProjectNotOpenError(key);
    }
    session.userConnections += 1;
    if (session.state === "grace") {
        session.state = "open";
        session.graceDeadline = null;
    }
    let released = false;
    return () => {
        // 幂等释放：同一连接重复触发断开回调只扣减一次。
        if (released) {
            return;
        }
        released = true;
        // 绑定会话世代：按对象身份比对，close+重开会替换 record，迟到的旧连接释放不得扣减新会话计数。
        const current = sessions.get(key);
        if (current !== session) {
            return;
        }
        current.userConnections = Math.max(0, current.userConnections - 1);
        if (current.userConnections === 0 && current.state === "open" && !isAgentActive(key)) {
            current.state = "grace";
            current.graceDeadline = Date.now() + PROJECT_GRACE_MS;
            consola.info({projectPath: key, graceMs: PROJECT_GRACE_MS}, "ProjectSession presence 归零，进入宽限");
        }
    };
}

/**
 * 注册 agent 在场探针（单槽覆盖式，非累加）；传 null 注销。
 * 探针语义：该 projectPath 当前是否有运行中的 agent invocation。
 */
export function registerAgentPresenceProbe(probe: ((projectPath: string) => boolean) | null): void {
    agentPresenceProbe = probe;
}

/**
 * 报活：仅更新 lastActivityAt（可观测性）。无 session 时 no-op，绝不隐式建 session。
 */
export function markProjectActivity(projectPath: string): void {
    const session = sessions.get(normalizeProjectPath(projectPath));
    if (!session) {
        return;
    }
    session.lastActivityAt = new Date().toISOString();
}

/**
 * 关闭 Project 会话并级联释放资源。内部动作：宽限到期 / 删除流程 / 服务关停。
 * - 进 key 锁与 open 串行，避免关门途中被并发重开的资源被误关；
 * - grace-expired 在锁内复检：等锁期间被重开或在场恢复则放弃关闭（幂等安全）；
 * - 先 sessions 除名（此后 assertProjectOpen 即失败，严格语义），再逐属主关门；
 * - 无论 session 是否存在都执行属主关闭（删除流程会对未 open 项目调用，属主 close 幂等）；
 * - 逐属主 try/catch，单个失败告警继续；任一失败 → 进泄漏表由周期维护重试，全部成功 → 移出泄漏表；
 * - GC 分级：delete/shutdown 强制 GC，grace-expired 走内置节流 GC。
 * 取舍：宽限到期 close 不做在途请求排空——宽限时长本身即缓冲（Task 94 D5）。
 */
export async function closeProject(projectPath: string, reason: "grace-expired" | "delete" | "shutdown"): Promise<void> {
    const key = normalizeProjectPath(projectPath);
    await withProjectLock(key, async () => {
        if (reason === "grace-expired") {
            // 复检：sweep 决定关闭到真正拿到锁之间，可能有 presence 重连或 openProject 重开。
            const session = sessions.get(key);
            if (!session || session.state !== "grace" || session.userConnections > 0 || isAgentActive(key)) {
                return;
            }
        }
        sessions.delete(key);
        let allClosed = true;
        for (const owner of owners.values()) {
            try {
                await owner.close(key);
            } catch (error) {
                allClosed = false;
                consola.warn({projectPath: key, owner: owner.name, reason, error}, "关闭 Project 资源失败，继续处理其余属主");
            }
        }
        if (allClosed) {
            leakedProjects.delete(key);
        } else {
            leakedProjects.add(key);
            ensureMaintenanceTimer();
            consola.warn({projectPath: key, reason}, "ProjectSession 关闭存在失败属主，已记入泄漏表等待重试");
        }
        if (reason === "delete" || reason === "shutdown") {
            collectReleasedSqliteHandles({force: true});
        } else {
            collectReleasedSqliteHandles();
        }
        consola.info({projectPath: key, reason}, "ProjectSession 已关闭");
    });
}

/**
 * 关闭全部 Project 会话与资源。服务关停（nitro close hook）调用：
 * 逐属主 closeAll（try/catch 隔离告警）→ 清空 sessions 与泄漏表 → 强制 GC。
 */
export async function closeAllProjects(): Promise<void> {
    for (const owner of owners.values()) {
        try {
            await owner.closeAll();
        } catch (error) {
            consola.warn({owner: owner.name, error}, "服务关停时关闭 Project 资源失败");
        }
    }
    sessions.clear();
    leakedProjects.clear();
    collectReleasedSqliteHandles({force: true});
}

/**
 * 周期维护：agent 空闲检测→进入宽限、宽限到期→close、泄漏重试。
 * now 可注入供测试；生产由内部 30s 定时器按当前时间调用。返回本轮 close 的 projectPath 列表。
 */
export async function sweepProjectSessions(now = Date.now()): Promise<string[]> {
    // 泄漏重试快照在处理会话前取：本轮 close 新产生的泄漏留到下轮重试，避免刚失败就立刻空转。
    const leaksToRetry = [...leakedProjects];
    const closed: string[] = [];
    for (const [key, session] of [...sessions.entries()]) {
        if (session.state === "open") {
            // (a) 无用户连接且 agent 不在场 → 进入宽限。
            if (session.userConnections === 0 && !isAgentActive(key)) {
                session.state = "grace";
                session.graceDeadline = now + PROJECT_GRACE_MS;
                consola.info({projectPath: key, graceMs: PROJECT_GRACE_MS}, "ProjectSession 无在场方，进入宽限");
            }
            continue;
        }
        // (b) 宽限中：任一在场恢复则回 open；到期则关闭。
        if (session.userConnections > 0 || isAgentActive(key)) {
            session.state = "open";
            session.graceDeadline = null;
            continue;
        }
        if (session.graceDeadline !== null && session.graceDeadline <= now) {
            await closeProject(key, "grace-expired");
            closed.push(key);
        }
    }
    // (c) 泄漏重试：重跑全部属主 close，全部成功才移出泄漏表。
    for (const key of leaksToRetry) {
        // 已重开的项目跳过：其资源是新会话的活资源，重试 close 会误关；泄漏标记已在 open 时清除，这里是兜底。
        if (sessions.has(key)) {
            leakedProjects.delete(key);
            continue;
        }
        let allClosed = true;
        for (const owner of owners.values()) {
            try {
                await owner.close(key);
            } catch (error) {
                allClosed = false;
                consola.warn({projectPath: key, owner: owner.name, error}, "泄漏重试关闭 Project 资源仍失败");
            }
        }
        if (allClosed) {
            leakedProjects.delete(key);
            consola.info({projectPath: key}, "ProjectSession 泄漏资源重试关闭成功");
        }
    }
    if (leaksToRetry.length > 0) {
        collectReleasedSqliteHandles();
    }
    return closed;
}

/**
 * 测试专用：清空会话、属主、泄漏表、在场探针与在途 open，并停掉维护定时器，保证用例间隔离。
 */
export function resetProjectSessionsForTest(): void {
    owners.clear();
    sessions.clear();
    leakedProjects.clear();
    keyLocks.clear();
    agentPresenceProbe = null;
    sweepInFlight = false;
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
    }
}

/**
 * agent 是否在场：无探针视为不在场；探针异常按不在场处理（关闭路径自身幂等，误关只付重建成本）。
 */
function isAgentActive(projectPath: string): boolean {
    if (!agentPresenceProbe) {
        return false;
    }
    try {
        return agentPresenceProbe(projectPath);
    } catch {
        return false;
    }
}

/**
 * 惰性启动周期维护定时器：首个会话或首条泄漏出现时启动；unref 不阻塞进程退出。
 */
function ensureMaintenanceTimer(): void {
    if (maintenanceTimer) {
        return;
    }
    maintenanceTimer = setInterval(() => {
        // 重入闸：慢属主导致上一轮 sweep 未完时跳过本 tick，避免两轮并发处理同一批会话/泄漏。
        if (sweepInFlight) {
            return;
        }
        sweepInFlight = true;
        void sweepProjectSessions()
            .catch((error: unknown) => {
                consola.warn({error}, "ProjectSession 周期维护失败");
            })
            .finally(() => {
                sweepInFlight = false;
            });
    }, MAINTENANCE_INTERVAL_MS);
    maintenanceTimer.unref?.();
}
