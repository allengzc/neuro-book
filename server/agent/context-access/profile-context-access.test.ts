import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    normalizeContentAccessPath,
    recordContextAccess,
    recordExplicitContextEntries,
    renderGeneratedRecommendations,
    type ContextAccessState,
} from "nbook/server/agent/context-access/profile-context-access";

describe("profile context access", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-context-access-"));
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("按内容节点目录归一化 index.md 和 state.md", () => {
        expect(normalizeContentAccessPath("lorebook/location/castle/index.md")).toEqual({
            path: "lorebook/location/castle/",
            signal: "index-read",
        });
        expect(normalizeContentAccessPath("lorebook/location/castle/state.md")).toEqual({
            path: "lorebook/location/castle/",
            signal: "state-read",
        });
        expect(normalizeContentAccessPath("reference/raw.md")).toBeNull();
    });

    it("记录 read 访问并渲染 generated recommendation", async () => {
        await recordContextAccess({
            projectRoot,
            projectSlug: "novel-1",
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            filePath: "lorebook/location/castle/index.md",
            now: new Date("2026-06-06T00:00:00.000Z"),
        });
        await recordContextAccess({
            projectRoot,
            projectSlug: "novel-1",
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            filePath: "lorebook/location/castle/state.md",
            now: new Date("2026-06-06T00:01:00.000Z"),
        });

        const state = JSON.parse(await readFile(path.join(projectRoot, ".nbook/context-access/writer.json"), "utf-8")) as ContextAccessState;
        expect(state.profile).toBe("writer");
        expect(state.entries).toHaveLength(1);
        expect(state.entries[0]).toMatchObject({
            path: "lorebook/location/castle/",
            accessCount: 2,
            signals: {
                "index-read": 1,
                "state-read": 1,
            },
        });

        const generated = await readFile(path.join(projectRoot, "agent-context/generated/writer.md"), "utf-8");
        expect(generated).toContain("# writer generated context");
        expect(generated).toContain("## possible");
        expect(generated).toContain("### lorebook/location/castle/");
        expect(generated).toContain("- signals: index-read:1, state-read:1");
    });

    it("显式 lorebookEntries 多次出现时进入 strong", async () => {
        await recordExplicitContextEntries({
            projectRoot,
            projectSlug: "novel-1",
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            entries: [{path: "lorebook/character/hero/"}],
            now: new Date("2026-06-06T00:00:00.000Z"),
        });
        await recordExplicitContextEntries({
            projectRoot,
            projectSlug: "novel-1",
            profileKey: "subagent.writer",
            sessionId: "thread-2",
            entries: [{path: "workspace/novel-1/lorebook/character/hero/index.md"}],
            now: new Date("2026-06-06T00:01:00.000Z"),
        });

        const generated = await readFile(path.join(projectRoot, "agent-context/generated/writer.md"), "utf-8");
        expect(generated).toContain("## strong");
        expect(generated).toContain("### lorebook/character/hero/");
        expect(generated).toContain("- signals: explicitInput:2");
        expect(generated).toContain("- sessions: 2");
    });

    it("渲染 avoid section 时只输出事实数据", () => {
        const markdown = renderGeneratedRecommendations({
            version: 1,
            project: {slug: "novel-1"},
            profile: "writer",
            updatedAt: "2026-06-06T00:00:00.000Z",
            entries: [{
                path: "lorebook/system/AI指令/",
                kind: "lorebook",
                title: "AI指令",
                lastAccessedAt: "2026-06-06T00:00:00.000Z",
                accessCount: 1,
                sessions: [{sessionId: "thread-1", lastAccessedAt: "2026-06-06T00:00:00.000Z", accessCount: 1}],
                signals: {read: 1},
                score: {value: 0.08, updatedAt: "2026-06-06T00:00:00.000Z"},
            }],
        });

        expect(markdown).toContain("## avoid");
        expect(markdown).toContain("### lorebook/system/AI指令/");
        expect(markdown).toContain("- signals: read:1");
        expect(markdown).not.toContain("推荐原因");
    });
});
