import type {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import type {SessionEntry, SessionEntryDraft, SessionId} from "nbook/server/agent/session/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";

export type SessionWritePlan = {
    target: {
        sessionId: SessionId;
    };
    /** 写入原因，用于错误归因和后续诊断。 */
    cause: string;
    durability?: "immediate" | "savePoint";
    ops: SessionWriteOp[];
};

export type SessionWriteOp =
    | {
        kind: "append";
        entry: SessionEntryDraft;
        projection?: boolean;
    }
    | {
        kind: "appendMany";
        entries: AppendManySessionEntryDraft[];
    }
    | {
        kind: "moveLeaf";
        leafId: SessionEntry["id"] | null;
    };

export type AppendManySessionEntryDraft = Exclude<SessionEntryDraft, {type: "leaf"}>;

export type SessionWriteResult = {
    entries: SessionEntry[];
};

export type SessionWriteExecutorInput = {
    repo: JsonlSessionRepository;
    eventHub: AgentSessionEventHub;
    snapshotProvider: (sessionId: SessionId) => Promise<unknown>;
};

/**
 * 统一执行 session write plan。
 *
 * Hook、profile 和 tool 只能生成 plan，不能直接 append repo 或 publish event。
 * 第一版不做 batch commit marker；同一个 plan 会先整体校验，再按 op 顺序写入并发布。
 */
export class SessionWriteExecutor {
    private readonly repo: JsonlSessionRepository;
    private readonly eventHub: AgentSessionEventHub;
    private readonly snapshotProvider: (sessionId: SessionId) => Promise<unknown>;

    constructor(input: SessionWriteExecutorInput) {
        this.repo = input.repo;
        this.eventHub = input.eventHub;
        this.snapshotProvider = input.snapshotProvider;
    }

    /**
     * 执行一组 plan，并在写入后发布 session_entry 和 session_state_changed。
     */
    async execute(plans: SessionWritePlan[], invocationId?: string): Promise<SessionWriteResult> {
        for (const plan of plans) {
            this.assertValidPlan(plan);
        }

        const written: SessionEntry[] = [];
        const touchedSessionIds = new Set<SessionId>();

        for (let index = 0; index < plans.length; index++) {
            const plan = plans[index]!;
            if (plan.durability === "savePoint" && this.canMergeSavePoint(plan)) {
                const merge = this.collectSavePointPlans(plans, index);
                const entries = await this.repo.appendEntries(plan.target.sessionId, merge.entries);
                for (const entry of entries) {
                    written.push(entry);
                    this.publishSessionEntry(plan.target.sessionId, invocationId, entry);
                }
                touchedSessionIds.add(plan.target.sessionId);
                index = merge.endIndex;
                continue;
            }
            for (const op of plan.ops) {
                const entries = await this.executeOp(plan.target.sessionId, op);
                for (const entry of entries) {
                    written.push(entry);
                    this.publishSessionEntry(plan.target.sessionId, invocationId, entry);
                }
                touchedSessionIds.add(plan.target.sessionId);
            }
        }

        for (const sessionId of touchedSessionIds) {
            await this.publishSessionState(sessionId, invocationId);
        }

        return {entries: written};
    }

    private canMergeSavePoint(plan: SessionWritePlan): boolean {
        return plan.ops.every((op) => op.kind === "appendMany" || (op.kind === "append" && !op.projection));
    }

    private collectSavePointPlans(plans: SessionWritePlan[], startIndex: number): {entries: AppendManySessionEntryDraft[]; endIndex: number} {
        const first = plans[startIndex]!;
        const entries: AppendManySessionEntryDraft[] = [];
        let endIndex = startIndex;
        for (let index = startIndex; index < plans.length; index++) {
            const plan = plans[index]!;
            if (plan.durability !== "savePoint" || plan.target.sessionId !== first.target.sessionId || !this.canMergeSavePoint(plan)) {
                break;
            }
            for (const op of plan.ops) {
                if (op.kind === "appendMany") {
                    entries.push(...op.entries);
                    continue;
                }
                if (op.kind === "append") {
                    entries.push(op.entry as AppendManySessionEntryDraft);
                }
            }
            endIndex = index;
        }
        return {entries, endIndex};
    }

    private async executeOp(sessionId: SessionId, op: SessionWriteOp): Promise<SessionEntry[]> {
        if (op.kind === "appendMany") {
            return this.repo.appendEntries(sessionId, op.entries);
        }
        if (op.kind === "moveLeaf") {
            return [await this.repo.moveLeaf(sessionId, op.leafId)];
        }
        const entry = op.projection
            ? await this.repo.appendProjectionEntry(sessionId, op.entry)
            : await this.repo.appendEntry(sessionId, op.entry);
        return [entry];
    }

    private assertValidPlan(plan: SessionWritePlan): void {
        if (!plan.target || typeof plan.target.sessionId !== "number" || !Number.isInteger(plan.target.sessionId) || plan.target.sessionId <= 0) {
            throw new Error("SessionWritePlan.target.sessionId 必须是正整数。");
        }
        if (!plan.cause.trim()) {
            throw new Error("SessionWritePlan.cause 不能为空。");
        }
        if (!Array.isArray(plan.ops)) {
            throw new Error("SessionWritePlan.ops 必须是数组。");
        }
    }

    private publishSessionEntry(sessionId: number, invocationId: string | undefined, entry: SessionEntry): void {
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_entry",
                entry,
            },
        });
    }

    private async publishSessionState(sessionId: number, invocationId?: string): Promise<void> {
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_state_changed",
                snapshot: await this.snapshotProvider(sessionId) as never,
            },
        });
    }
}
