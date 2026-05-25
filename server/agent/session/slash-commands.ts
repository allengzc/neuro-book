import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntryId, SessionId, SessionSnapshot, SessionTreeNode} from "nbook/server/agent/session/types";

export type SlashCommandResult =
    | {
        kind: "not_command";
    }
    | {
        kind: "new";
        session: SessionSnapshot;
    }
    | {
        kind: "tree";
        tree: SessionTreeNode[];
        session: SessionSnapshot;
    }
    | {
        kind: "fork";
        session: SessionSnapshot;
    }
    | {
        kind: "retry";
        session: SessionSnapshot;
        continueFrom: SessionEntryId | null;
    }
    | {
        kind: "compact";
        instructions: string;
    };

/**
 * 处理 session 级 slash command。命令不会作为普通 user message 写入模型上下文。
 */
export async function handleSlashCommand(input: {
    repo: JsonlSessionRepository;
    sessionId: SessionId;
    text: string;
}): Promise<SlashCommandResult> {
    const text = input.text.trim();
    if (!text.startsWith("/")) {
        return {kind: "not_command"};
    }

    const [command = "", ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    const snapshot = await input.repo.readSession(input.sessionId);

    if (command === "new") {
        const session = await input.repo.createSession({
            profileKey: snapshot.metadata.profileKey,
            input: snapshot.metadata.input,
            workspaceRoot: snapshot.metadata.workspaceRoot,
            workspaceKey: snapshot.metadata.workspaceKey,
            projectPath: snapshot.metadata.projectPath,
            title: snapshot.metadata.title,
        });
        return {kind: "new", session};
    }

    if (command === "tree") {
        if (arg) {
            await input.repo.moveLeaf(input.sessionId, arg);
        }
        const nextSnapshot = await input.repo.readSession(input.sessionId);
        return {
            kind: "tree",
            tree: input.repo.tree(nextSnapshot),
            session: nextSnapshot,
        };
    }

    if (command === "fork") {
        return {
            kind: "fork",
            session: await input.repo.forkSession(input.sessionId, arg || snapshot.leafId || undefined),
        };
    }

    if (command === "retry") {
        const entryId = arg || snapshot.leafId;
        if (entryId) {
            const entry = snapshot.entries.find((candidate) => candidate.id === entryId);
            const continueFrom = entry?.type === "message" && entry.message.role === "assistant"
                ? entry.parentId
                : entryId;
            await input.repo.moveLeaf(input.sessionId, continueFrom);
            return {
                kind: "retry",
                session: await input.repo.readSession(input.sessionId),
                continueFrom,
            };
        }
        return {
            kind: "retry",
            session: snapshot,
            continueFrom: null,
        };
    }

    if (command === "compact") {
        return {
            kind: "compact",
            instructions: arg,
        };
    }

    return {kind: "not_command"};
}
