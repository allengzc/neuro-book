# llmlint Standalone Development Repository

## User Request / Topic

用户决定把 `llmlint` 从 NeuroBook 内嵌 skill 的复杂形态中独立出来：规则、CLI、评测 harness 后续还会继续膨胀，未来可能增加 web，因此需要一个真正的 sibling 开发仓，而 NeuroBook 只保留可运行的 bundled snapshot。

## Goal

- `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\llmlint` 成为 llmlint 真相源。
- llmlint 仓库根是开发工作区；真正可安装 / 可同步的 Agent Skill package 固定为 `skill/`。
- NeuroBook `assets/workspace/.nbook/agent/skills/llmlint/` 只作为 `../llmlint/skill` 的 vendored runtime snapshot。
- `evals/` 进入 llmlint 仓 git，作为评测 harness 与基线语料；不进入 `skill/`，不随 user-assets 同步到用户 runtime。

## Decisions

- 本轮不做 monorepo / workspace；根目录先承载 `skill/`、`evals/`、`tests/`、开发脚本和根 `package.json`，未来出现 web 再升级。
- 不保留 assets 下嵌套 `.git`。所有 llmlint git 操作都在 sibling 仓执行。
- NeuroBook 通过 `scripts/cli/sync-llmlint-skill.ts` 从 sibling `skill/` 镜像 snapshot，并排除 `.git/`、`node_modules/`、`.bun/`、`.agent/`、`evals/`、`tests/`、coverage/report 临时产物。
- `workspace/.nbook/agent/skills/llmlint/` 是 runtime-only 副本；user-assets 同步硬切清理旧 `.git`、`node_modules`、`evals` 和旧 `.gitignore`。

## Implementation Walkthrough

### 2026-07-01 迁移实现

已完成：

- 从 `assets/workspace/.nbook/agent/skills/llmlint` 复制当前嵌套仓到 sibling `../llmlint`，保留未提交源码改动和原 ignored `evals/`。
- 将 runtime package 下沉到 `../llmlint/skill/`；根目录新增开发 `package.json`、`tsconfig.json`、README / README.en。
- `evals/` 留在仓库根并更新说明：它现在进入 llmlint 仓 git，但不属于可安装 skill。
- `tests/llmlint.test.ts` 从 NeuroBook 测试迁出，改为直接 import `skill/src/*`；旧 `旧中文规则样本目录` 依赖改成最小 fixture。
- 新增 NeuroBook 同步脚本 `scripts/cli/sync-llmlint-skill.ts`，从 sibling `skill/` 镜像到 bundled snapshot。
- 执行同步脚本后，NeuroBook assets 中的旧嵌套 `.git`、`node_modules`、`evals` 和 `.gitignore` 已不再存在。
- 扩展 user-assets 硬切清理，真实 `workspace/.nbook/agent/skills/llmlint/` 也已清到 runtime-only。

计划出入：

- 计划中只写“evals 可以进 git”，实现时进一步明确为：`evals/` 进 sibling llmlint 仓 git，但不会放进 `skill/`，也不会进 NeuroBook user runtime。
- 旧 `旧中文规则样本目录` 已不存在；独立仓测试改用 fixture 覆盖导入器行为，而不是继续依赖已消失的 scratch 目录。

## Verification

待最终记录本轮命令结果：

- `bun install`（llmlint 仓根）
- `bun test`（llmlint 仓根）
- `bun run typecheck`（llmlint 仓根）
- `bun skill/bin/llmlint.ts --version`
- `bun skill/bin/llmlint.ts show-llm-rules --format json`
- `bun evals/score.ts --corpus evals/fixtures/corpus --out .agent/evals/fixture-report --min-support 1`
- `bun scripts/cli/sync-user-assets.ts`
- `bun vitest run server/agent/skills/skill-catalog.test.ts server/workspace-files/workspace-files.test.ts`
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts --help`
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules --format json`

## References

- llmlint sibling source: `../llmlint/`
- llmlint skill package: `../llmlint/skill/`
- NeuroBook bundled snapshot: `assets/workspace/.nbook/agent/skills/llmlint/`
- Runtime user copy: `workspace/.nbook/agent/skills/llmlint/`
- Rule registry history: [Task 77](../77-llmlint-rule-registry/README.md)
- Eval harness history: [Task 82](../82-llmlint-eval-harness/README.md)
