import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {assertCleanWorktree, materializeRepository, repositoryRevision} from "#manager/git";
import {removePath} from "#manager/files";
import {run} from "#manager/process";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => removePath(root)));
});

describe("Git repository materialize", () => {
    it("允许目标目录预先存在 Manager-owned 路径", async () => {
        const fixture = await mkdtemp(join(tmpdir(), "nbook-manager-git-source-"));
        const target = await mkdtemp(join(tmpdir(), "nbook-manager-git-target-"));
        roots.push(fixture, target);
        await run("git", ["init", "-b", "master"], {cwd: fixture});
        await run("git", ["config", "user.email", "manager-test@example.com"], {cwd: fixture});
        await run("git", ["config", "user.name", "Manager Test"], {cwd: fixture});
        await writeFile(join(fixture, "package.json"), "{\"name\":\"neuro-book\"}\n", "utf8");
        await run("git", ["add", "package.json"], {cwd: fixture});
        await run("git", ["commit", "-m", "fixture"], {cwd: fixture});
        await mkdir(join(target, ".runtime"), {recursive: true});

        await materializeRepository(target, fixture, "master");

        expect(await readFile(join(target, "package.json"), "utf8")).toContain("neuro-book");
        expect(await repositoryRevision(target)).toMatch(/^[a-f0-9]{40}$/u);
    });

    it("dirty worktree 明确停止", async () => {
        const fixture = await mkdtemp(join(tmpdir(), "nbook-manager-git-dirty-"));
        roots.push(fixture);
        await run("git", ["init", "-b", "master"], {cwd: fixture});
        await writeFile(join(fixture, "untracked.txt"), "dirty", "utf8");
        await expect(assertCleanWorktree(fixture)).rejects.toThrow("不会自动 restore");
    });
});
