# Reference Bookshelf Reorg

## User Request

- 将仓库级 `spec/` 硬切改名为 `reference/`。
- 把 `reference/` 整理成 NeuroBook 系统的详细参考书，只放当前稳定合同、Agent / 人类应读的系统参考和实现真相源。
- `docs/` 收敛为任务 walkthrough、调研、草案、归档和模块背景材料；能成为稳定参考的内容提升到 `reference/`。
- 本轮允许激进整理，但不改变业务行为；除 Import 路径、allowlist、build copy、profile compiled metadata 和测试断言外，主要是文档结构调整。

## Goals

- `spec/` 不再作为 active 文档目录存在。
- `reference/` 成为稳定参考入口，并明确区别于 Project Workspace 内的 `reference/` 外部素材目录。
- Profile `<Import />` 合同切换到 `reference/**`，不保留 `spec/**` 兼容。
- `reference/agent/`、`reference/content/`、`reference/plot/` 清理掉明显历史草图、待确认问题和过长迁移说明。
- active docs、README、PROJECT-STATUS 和 AGENTS 索引不再推荐旧 `reference/...`。

## Migration Map

| From | To |
| --- | --- |
| `spec/` | `reference/` |
| `reference/reference/` | `reference/workspace-reference/` |
| `reference/agent/system.md` | `docs/archived/reference/agent-system-v0.1.md` |
| `reference/plot/system.md` old long version | `docs/archived/reference/plot-system-v0.2.md` |
| `docs/modules/agent/harness.md` | `reference/agent/harness.md` |
| `docs/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md` | `reference/agent/harness-black-box-contract.md` |
| `docs/tasks/23-agent-sidecar-profile-pass/README.md` stable contract | `reference/agent/sidecar-profile-pass.md` |
| `reference/content/lorebook-information-control.md` | `reference/content/directory-protocol.md` + `reference/content/information-control.md` |
| `docs/drafts/plot-system.md` | `docs/archived/drafts/plot-system.md` |

## Walkthrough

- Created this task walkthrough.
- Renamed root `spec/` to `reference/`.
- Renamed old `reference/reference/` module to `reference/workspace-reference/`.
- Updated Import allowlist and Nitro runtime context copy from `spec/` to `reference/`.
- Rewrote `reference/README.md`, `reference/agent/README.md`, and `reference/content/README.md` as Reference Bookshelf entries.
- Added stable Agent runtime references for runtime hooks, sidecar profile pass, and harness black-box behavior.
- Split the old lorebook information-control document into `reference/content/directory-protocol.md` and `reference/content/information-control.md`; archived the old long version.
- Added a new current `reference/plot/system.md` and `reference/plot/README.md`.
- Audited the objective against current files and strengthened stable references that were still too thin:
  - `reference/content/directory-protocol.md` now includes the stable `leader.rp` / `rp.actor` / `rp.writer` runtime profile contract and `simulation/runs/` boundary.
  - `reference/plot/system.md` now includes DTO fields, status values, `chapterPath` validation, scene ordering, structured ref URI rules and Agent consumption order.
  - Confirmed `docs/modules/agent/harness.md` no longer exists; the current harness reference lives in `reference/agent/harness.md`.

## Verification

- `rg -uuu -n "spec/|spec/\\*\\*|reference/agent/system\\.md|reference/content/lorebook-information-control\\.md|reference/reference" assets/workspace/.nbook/agent/profiles workspace/.nbook/agent/profiles server/agent/profiles app/components/profile-template-editor scripts/build`：无 active/profile/runtime 残留。
- `rg -n "spec/|reference/agent/system\\.md|docs/drafts/plot-system|reference/reference|Spec Index|Agent Specs|Content Specs" README.md AGENTS.md PROJECT-STATUS.md docs reference assets server app scripts --glob '!docs/archived/**' --glob '!docs/tasks/archived/**' --glob '!server/agent-v2/**' --glob '!assets/agent-v2/**'`：仅剩本任务自身的迁移说明。
- `bun run test server/agent/profiles/profile-dsl.test.ts server/agent/profiles/workbench-service.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/rp-profiles.test.ts`：4 files / 46 tests passed。
- `bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system`：passed。
- `bun scripts/build/profile.ts check builtin/leader.assets.profile.tsx --system`：passed。
- `bun scripts/build/profile.ts check builtin/leader.rp.profile.tsx --system`：passed。
- `bun scripts/build/prepare-system-profile-metadata.ts`：prepared 9 system profiles and profile variable IDE types。
- `bun scripts/build/profile.ts compile --all`：compiled 9 workspace user-assets profile artifacts after the user override kept old `spec/**` Import paths.

## Follow-ups

- 后续若需要完全删除旧文件名兼容入口，可移除 `reference/content/lorebook-information-control.md`，但当前保留短跳转以减少断链。
