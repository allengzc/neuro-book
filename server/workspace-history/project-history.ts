import path from "node:path";
import fs from "node:fs/promises";
import {consola} from "consola";
import {
    HistoryError,
    WorkspaceHistory,
    type OperationActor,
    type UnseenGroup,
} from "nbook/server/vendor/nb-history/index";
import {isProjectOpen, registerProjectResourceOwner, type ProjectResourceOwner} from "nbook/server/workspace-files/project-session";
import {normalizeProjectPath, resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {onProjectWorkspaceFileChange} from "nbook/server/workspace-files/project-workspace-index";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {loadEffectiveConfig, loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {isHistoryTrackedRelativePath} from "nbook/server/workspace-history/history-paths";
import type {WorkspaceFileChangeEventDto} from "nbook/shared/dto/workspace-file-events.dto";

/**
 * Project 文件历史门面（Task 95：nb-history 集成）。
 *
 * 职责：
 * - 每项目一个 `.nbook/history.sqlite`（vendored nb-history 模块），随 ProjectSession 生命周期
 *   打开（open 预热 + 首次使用懒开兜底）与级联关闭（资源属主自注册）。
 * - 记账入口（recordProjectWrite/Delete/Rename）：写入收口层调用，**fail-open**——记账失败绝不
 *   阻断用户写文件，漏账由模块写入口内建对账与 watcher reconcile 收敛为 external 条目（只丢归因不丢历史）。
 * - watcher 对账：订阅 tree index 的文件变更批，读盘现状喂 `reconcile`（回声被模块 hash 比对吸收）。
 * - open 后维护（fire-and-forget）：D15 全量对账扫描（closed 期间外部变更补 external 账）→
 *   auto-accept（组内最新条目也超龄才整组接受）→ prune，进程内每项目 24h 一轮。
 * - harness 消费面：`readUnseenForAgent`（懒 initCursor）/ `advanceAgentCursor`。
 *
 * 隐私红线：history.sqlite 含全文快照，严禁进入 task 72 可分享日志包或任何导出诊断流程。
 */

/** 收件箱审查者：单机产品固定本地用户（D10）；模块本身 n 用户就绪，将来接真实 userId 零迁移。 */
export const LOCAL_USER_ID = "local";

const HISTORY_DATABASE_RELATIVE_PATH = ".nbook/history.sqlite";
/** open 后维护（对账扫描 + auto-accept + prune）的进程内最小间隔。 */
const MAINTENANCE_MIN_INTERVAL_MS = 24 * 60 * 60_000;
/** 对账面单文件读取上限：超大二进制不主动读盘对账（正文场景不存在，历史链例外记录于注释）。 */
const RECONCILE_MAX_BYTES = 8 * 1024 * 1024;

/** 每项目已打开实例（in-flight promise 去重；open 失败会移除以便下次重试）。 */
const openHistories = new Map<string, Promise<WorkspaceHistory>>();
/** open 后维护的进程内水位：projectPath → 上次执行 epoch ms。 */
const maintenanceRanAt = new Map<string, number>();

/** 全局总开关（Global Config 独有；改动在项目下次 open 生效）。 */
function historyEnabled(): boolean {
    return historyEnabledOverrideForTest ?? loadGlobalEffectiveConfigSync().history.enabled;
}

let historyEnabledOverrideForTest: boolean | null = null;

/** 测试专用：覆盖 history.enabled 判定（隔离真实 Global Config），null 恢复真实配置。 */
export function setHistoryEnabledOverrideForTest(value: boolean | null): void {
    historyEnabledOverrideForTest = value;
}

/**
 * 取得（必要时打开）项目的 history 实例。
 * 返回 null 的两种情况：功能未启用；项目未 open（close 竞态窗口，静默跳过是 fail-open 总方针的一部分）。
 */
export async function ensureProjectHistory(projectPath: string): Promise<WorkspaceHistory | null> {
    const key = normalizeProjectPath(projectPath);
    if (!historyEnabled() || !isProjectOpen(key)) {
        return null;
    }
    const existing = openHistories.get(key);
    if (existing) {
        return existing;
    }
    const opening = openHistoryInstance(key);
    openHistories.set(key, opening);
    try {
        return await opening;
    } catch (error) {
        openHistories.delete(key);
        throw error;
    }
}

/** 真正打开库实例：retention 参数取项目覆盖后的 effective config（D9/N6）。 */
async function openHistoryInstance(key: string): Promise<WorkspaceHistory> {
    const workspaceRoot = resolveProjectAbsolutePath(key);
    const databasePath = path.join(workspaceRoot, ...HISTORY_DATABASE_RELATIVE_PATH.split("/"));
    await fs.mkdir(path.dirname(databasePath), {recursive: true});
    const config = (await loadEffectiveConfig({workspaceKind: "novel", projectPath: key})).history;
    const history = await WorkspaceHistory.open({
        databasePath,
        workspaceRoot,
        config: {
            retentionFullDays: config.retentionFullDays,
            keepDailyLastAfterWindow: config.keepDailyLastAfterWindow,
        },
    });
    consola.info({projectPath: key}, "workspace-history 已打开");
    return history;
}

/** 关闭并移除项目实例。未打开时幂等 no-op；close 失败向上抛（由 ProjectSession 泄漏表重试）。 */
async function closeProjectHistory(projectPath: string): Promise<void> {
    const key = normalizeProjectPath(projectPath);
    const opening = openHistories.get(key);
    if (!opening) {
        return;
    }
    openHistories.delete(key);
    const history = await opening.catch(() => null);
    if (!history) {
        return;
    }
    await history.close();
    // 与宿主既有 sqlite 释放机制对齐：关库后促发 native 句柄回收（项目删除路径需要「库文件可删」）。
    collectReleasedSqliteHandles();
    consola.info({projectPath: key}, "workspace-history 已关闭");
}

/**
 * 资源属主定义（Task 94 D7：history 库是 ProjectSession 会话资源）。
 * 模块加载时自注册；测试 reset owners 后可用本导出重新注册。
 */
export const workspaceHistoryResourceOwner: ProjectResourceOwner = {
    name: "workspace-history",
    async close(projectPath) {
        await closeProjectHistory(projectPath);
    },
    async closeAll() {
        for (const key of [...openHistories.keys()]) {
            await closeProjectHistory(key).catch((error) => {
                consola.warn({projectPath: key, error}, "workspace-history 关停关闭失败");
            });
        }
    },
};

registerProjectResourceOwner(workspaceHistoryResourceOwner);

/** 测试专用：关闭全部实例并清空进程内状态（enabled 覆盖由 setHistoryEnabledOverrideForTest 单独控制）。 */
export async function resetWorkspaceHistoryForTest(): Promise<void> {
    await workspaceHistoryResourceOwner.closeAll();
    openHistories.clear();
    maintenanceRanAt.clear();
}

// watcher 对账：tree index 的防抖合并批（仅 project-workspace）→ 逐路径读盘 reconcile。
onProjectWorkspaceFileChange(({root, projectPath, events}) => {
    void reconcileWatcherBatch(projectPath, root, events).catch((error) => {
        consola.warn({projectPath, error}, "workspace-history watcher 对账批失败");
    });
});

/**
 * watcher 变更批对账。回声（模块自身落盘触发的 watcher 事件）与账实一致的路径
 * 被模块 hash 比对吸收为 no-op；不一致者补 external 条目（外部编辑器/CLI 直写归因，D11）。
 * 导出供 watcher listener 与测试直接调用。
 */
export async function reconcileWatcherBatch(projectPath: string, root: string, events: WorkspaceFileChangeEventDto[]): Promise<void> {
    if (!historyEnabled()) {
        return;
    }
    const history = await ensureProjectHistory(projectPath).catch(() => null);
    if (!history) {
        return;
    }
    for (const event of events) {
        if (!isHistoryTrackedRelativePath(event.path) || event.kind === "addDir") {
            continue;
        }
        try {
            if (event.kind === "unlink" || event.kind === "unlinkDir") {
                // 目录路径账面无文件条目，reconcile 为 no-op；子文件删除由各自 unlink 事件处理。
                await history.reconcile(event.path, null);
            } else {
                await history.reconcile(event.path, await readFileForReconcile(root, event.path));
            }
        } catch (error) {
            consola.warn({projectPath, path: event.path, error}, "workspace-history 单路径对账失败");
        }
    }
}

/** 对账用读盘：文件不存在 / 读失败 / 超过大小上限按「不存在 / 跳过」处理。 */
async function readFileForReconcile(root: string, relativePath: string): Promise<Uint8Array | null> {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile() || stat.size > RECONCILE_MAX_BYTES) {
        return null;
    }
    return fs.readFile(absolutePath).catch(() => null);
}

// ── 写入记账面（S4/S5 收口层调用；全部 fail-open）─────────────────────────

/** 记一次写入（create/edit 由模块按账面自动判定）。before 为 null 表示此前文件不存在。 */
export async function recordProjectWrite(input: {
    projectPath: string;
    relativePath: string;
    actor: OperationActor;
    before: Uint8Array | null;
    after: Uint8Array;
}): Promise<void> {
    const relativePath = normalizeRecordPath(input.relativePath);
    await recordSafely(input.projectPath, relativePath, async (history) => {
        await history.registerWrite(input.actor, relativePath, input.before, input.after);
    });
}

/** 记一次删除。before 是删除前内容（删除找回的快照来源）。 */
export async function recordProjectDelete(input: {
    projectPath: string;
    relativePath: string;
    actor: OperationActor;
    before: Uint8Array;
}): Promise<void> {
    const relativePath = normalizeRecordPath(input.relativePath);
    await recordSafely(input.projectPath, relativePath, async (history) => {
        await history.registerDelete(input.actor, relativePath, input.before);
    });
}

/** 记一次改名（内容不变）。from/to 任一不在记账范围则整条跳过（罕见的跨界移动，注释于谓词）。 */
export async function recordProjectRename(input: {
    projectPath: string;
    fromPath: string;
    toPath: string;
    actor: OperationActor;
}): Promise<void> {
    const fromPath = normalizeRecordPath(input.fromPath);
    const toPath = normalizeRecordPath(input.toPath);
    if (!isHistoryTrackedRelativePath(fromPath)) {
        return;
    }
    await recordSafely(input.projectPath, toPath, async (history) => {
        await history.registerRename(input.actor, fromPath, toPath);
    });
}

/** 记账公共外壳：路径归一化 + 谓词过滤 + 实例获取 + fail-open（记账失败告警降级，绝不向调用方抛出，N3）。 */
async function recordSafely(projectPath: string, relativePath: string, fn: (history: WorkspaceHistory) => Promise<void>): Promise<void> {
    if (!isHistoryTrackedRelativePath(relativePath)) {
        return;
    }
    try {
        const history = await ensureProjectHistory(projectPath);
        if (!history) {
            return;
        }
        await fn(history);
    } catch (error) {
        consola.warn({projectPath, path: relativePath, error}, "workspace-history 记账失败（fail-open 降级，历史由对账自愈）");
    }
}

/** 归一化记账相对路径：正斜杠、去首尾斜杠（vendored 模块的 validateRelativePath 拒绝反斜杠与绝对路径）。 */
function normalizeRecordPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}

// ── harness 消费面（S6）────────────────────────────────────────────────

/**
 * 会话未见变更（fail-open：任何失败返回空数组）。
 * 游标懒初始化（N8）：会话首次查询时以「当下」为基线建游标并返回空——新会话不被历史淹没，
 * 也避免在 createAgent（无 ensure-open 保证）挂 initCursor。
 */
export async function readUnseenForAgent(projectPath: string, sessionId: number): Promise<UnseenGroup[]> {
    if (!historyEnabled()) {
        return [];
    }
    try {
        const history = await ensureProjectHistory(projectPath);
        if (!history) {
            return [];
        }
        try {
            return await history.unseenChanges(String(sessionId));
        } catch (error) {
            // 与 vendored 模块的错误文案耦合（VENDOR.json 锁定版本）：游标未初始化 = 会话首次接触该项目。
            if (error instanceof HistoryError && error.message.includes("游标未初始化")) {
                await history.initCursor(String(sessionId));
                return [];
            }
            throw error;
        }
    } catch (error) {
        consola.warn({projectPath, sessionId, error}, "workspace-history 未见变更查询失败（视为无变更）");
        return [];
    }
}

/** 推进会话游标（提醒成功送达后调用；fail-open）。 */
export async function advanceAgentCursor(projectPath: string, sessionId: number, entryId: number): Promise<void> {
    try {
        const history = await ensureProjectHistory(projectPath);
        await history?.advanceCursor(String(sessionId), entryId);
    } catch (error) {
        consola.warn({projectPath, sessionId, error}, "workspace-history 游标推进失败（下轮提醒将重复出现）");
    }
}

// ── open 预热与维护（open.post.ts fire-and-forget 调用）─────────────────

/**
 * 项目 open 后的 history 预热：开库 → D15 全量对账扫描 → 24h 维护（auto-accept → prune）。
 * 整体 fire-and-forget，任何失败只告警；agent 懒开路径不跑扫描（写路径内建对账兜底）。
 */
export async function openProjectHistoryAndMaintain(projectPath: string): Promise<void> {
    if (!historyEnabled()) {
        return;
    }
    const key = normalizeProjectPath(projectPath);
    const history = await ensureProjectHistory(key);
    if (!history) {
        return;
    }
    await reconcileFullScan(key, history).catch((error) => {
        consola.warn({projectPath: key, error}, "workspace-history open 对账扫描失败");
    });
    await runMaintenanceIfDue(key, history).catch((error) => {
        consola.warn({projectPath: key, error}, "workspace-history 维护失败");
    });
}

/**
 * D15 全量对账扫描：closed 期间的外部变更补 external 账。
 * 拆「记账 / 呈现」两半——此处只补记账保历史链完整；呈现侧天然安全：external 条目不触发
 * 用户收件箱（模块 R5 只由 agent/system 触发），而会话 unseen 恰好需要让 agent 看到这些变更。
 * 未变文件被模块 hash 比对吸收为 no-op；账面存活但磁盘缺失的文件补删除条目。
 */
async function reconcileFullScan(key: string, history: WorkspaceHistory): Promise<void> {
    const root = resolveProjectAbsolutePath(key);
    const diskFiles = await collectTrackedDiskFiles(root, "");
    for (const relativePath of diskFiles) {
        try {
            await history.reconcile(relativePath, await readFileForReconcile(root, relativePath));
        } catch (error) {
            consola.warn({projectPath: key, path: relativePath, error}, "workspace-history open 对账单文件失败");
        }
    }
    const diskSet = new Set(diskFiles);
    for (const live of await history.liveFiles()) {
        if (diskSet.has(live.path)) {
            continue;
        }
        try {
            await history.reconcile(live.path, null);
        } catch (error) {
            consola.warn({projectPath: key, path: live.path, error}, "workspace-history open 删除对账失败");
        }
    }
}

/** 递归收集受管文件相对路径（正斜杠）；排除段目录整树跳过。写面目录记账与 open 对账扫描共用。 */
export async function collectTrackedDiskFiles(root: string, prefix: string): Promise<string[]> {
    const absolute = prefix ? path.join(root, ...prefix.split("/")) : root;
    const entries = await fs.readdir(absolute, {withFileTypes: true}).catch(() => []);
    const files: string[] = [];
    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!isHistoryTrackedRelativePath(relativePath)) {
            continue;
        }
        if (entry.isDirectory()) {
            files.push(...await collectTrackedDiskFiles(root, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files;
}

/** 24h 一轮维护：auto-accept（D8）→ prune。进程内水位，重启后首次 open 会再跑一轮（幂等无害）。 */
async function runMaintenanceIfDue(key: string, history: WorkspaceHistory): Promise<void> {
    const last = maintenanceRanAt.get(key) ?? 0;
    if (Date.now() - last < MAINTENANCE_MIN_INTERVAL_MS) {
        return;
    }
    maintenanceRanAt.set(key, Date.now());
    const accepted = await runAutoAccept(key, history);
    const report = await history.prune();
    consola.info({projectPath: key, autoAccepted: accepted, ...report}, "workspace-history 维护完成");
}

/**
 * auto-accept（D8）：收件箱组内**最后一条**条目也超过 autoAcceptDays 未审查时整组接受——
 * 活跃变更（组内还有新条目）整组保留不被吞；兼解「未接受段永不 prune」导致库只增不减。
 */
async function runAutoAccept(key: string, history: WorkspaceHistory): Promise<number> {
    const config = (await loadEffectiveConfig({workspaceKind: "novel", projectPath: key})).history;
    if (!config.autoAcceptEnabled) {
        return 0;
    }
    const cutoff = Date.now() - config.autoAcceptDays * 24 * 60 * 60_000;
    let accepted = 0;
    for (const group of await history.inbox(LOCAL_USER_ID)) {
        const last = group.entries[group.entries.length - 1];
        if (!last || Date.parse(last.occurredAt) > cutoff) {
            continue;
        }
        try {
            await history.accept(LOCAL_USER_ID, group.path);
            accepted += 1;
        } catch (error) {
            consola.warn({projectPath: key, path: group.path, error}, "workspace-history auto-accept 单组失败");
        }
    }
    return accepted;
}
