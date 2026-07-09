import type {AppendManySessionEntryDraft, SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {profileStateKey} from "nbook/server/agent/profiles/profile-dsl";

export type PrepareRunWritePlanInput = {
    sessionId: number;
    profileKey: string;
    context: NeuroSessionContext;
    prepared: ProfileTurnPlan;
    sessionContextEnabled: boolean;
};

/**
 * 把 ProfileTurnPlan 中需要落盘的 prepare 产物编译成 SessionWritePlan。
 *
 * 这个函数不执行写入；真正 append/publish 由 invoke prepareRun 阶段交给 SessionWriteExecutor。
 */
export function compilePrepareRunWritePlan(input: PrepareRunWritePlanInput): SessionWritePlan | undefined {
    const prepareEntries: AppendManySessionEntryDraft[] = [];
    if (input.sessionContextEnabled && input.prepared.historyInitMessages?.length && input.context.messages.length === 0) {
        prepareEntries.push(...input.prepared.historyInitMessages.map((message) => ({
            type: "custom_message" as const,
            message,
            visibleToModel: true,
        })));
    }
    if (input.sessionContextEnabled) {
        const appendingMessages = [
            ...input.prepared.modelContextAppendingMessages ?? [],
            ...input.prepared.appendingMessages ?? [],
        ];
        prepareEntries.push(...appendingMessages.map((message) => ({
            type: "custom_message" as const,
            message,
            visibleToModel: true,
        })));
    }
    for (const write of input.prepared.stateWrites ?? []) {
        assertValidProfileStateWrite(input.profileKey, write);
        prepareEntries.push(write as AppendManySessionEntryDraft);
    }
    if (prepareEntries.length === 0) {
        return undefined;
    }
    return {
        target: {sessionId: input.sessionId},
        cause: "profile.prepare",
        ops: [{
            kind: "appendMany",
            entries: prepareEntries,
        }],
    };
}

/**
 * profile prepare 只能写自己的 profile state，不能成为任意 session mutation 入口。
 */
export function assertValidProfileStateWrite(profileKey: string, write: SessionEntryDraft): void {
    if (write.type !== "custom" || write.key !== profileStateKey(profileKey)) {
        throw new Error(`profile ${profileKey} stateWrites 只允许写 ${profileStateKey(profileKey)} custom entry。`);
    }
}
