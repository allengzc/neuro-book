---
name: profile-system-guide
description: Guide users and agents through Neuro Book harness, TSX profiles, ProfileTurnPlan, skills, user-assets overlays, profile compile checks, templates, system restore, and safe profile editing.
when_to_use:
  - 用户想创建、修改、诊断或理解 agent/profile/.profile.tsx。
  - 用户问 harness、ProfileTurnPlan、ProfilePrompt、SkillCatalog、user-assets 或系统 profile 覆盖机制是什么。
  - 用户需要恢复系统版本、新建 profile 模板、编译检查或解释 profile 报错。
---

# Profile System Guide

Use this skill when helping users edit Neuro Book agent profiles. The user may not be a developer. Explain with simple words first, then mention exact file paths and commands only when they are useful.

For harness/profile architecture explanations, read `references/harness-profile-system.md` before answering. Keep `SKILL.md` as the workflow card and use the reference for exact runtime details. The runtime does not have a separate skill-loading tool; agents read this `SKILL.md` entry first, then read referenced files only when needed.

## Plain Explanation

- Profile is an agent recipe. It says who the agent is, which tools it may use, and what context it prepares before each run.
- Harness is the runner. It creates sessions, calls the profile, writes visible messages into the session, streams model/tool events, and saves results.
- Skill is a reusable workflow note. It teaches an agent how to do a kind of task, but it is not a profile and it does not run by itself.
- User assets are the user's editable overlay. Prefer editing files under `workspace/.nbook/...`. System files under `assets/workspace/.nbook/...` are the built-in baseline.
- Compile means "load this `.profile.tsx` through the real runtime path and check whether the agent recipe is usable." It does not start a chat session.

## Important Paths

- User profiles: `workspace/.nbook/agent/profiles/`
- System profiles: `assets/workspace/.nbook/agent/profiles/`
- User skills: `workspace/.nbook/agent/skills/`
- System skills: `assets/workspace/.nbook/agent/skills/`
- Profile templates: `assets/workspace/.nbook/agent/profile-templates/`
- Harness docs: `docs/modules/agent/harness.md`
- TSX Profile Workbench task notes: `docs/tasks/tsx-profile-workbench/README.md`
- Agent migration/runtime notes: `docs/tasks/pi-agent-harness-migration/README.md`
- Workspace terms: `spec/workspace/TERMS.md`
- Detailed reference for this skill: `assets/workspace/.nbook/agent/skills/profile-system-guide/references/harness-profile-system.md`

## Editing Strategy

Prefer guidance before automation:

1. Explain the change in plain language.
2. Show the exact file that should change.
3. Read the current file before editing.
4. Make the smallest TSX change that matches the user's request.
5. Ask the user to use Workbench compile/preview, or use a developer-only check when you are explicitly working in the repository source tree.

Use Agent runtime CLI only when it lives under `.nbook/agent/bin` and is on the bash PATH. Do not present repository-root `scripts/` as an Agent runtime contract.

## Common Operations

### Compile a profile

Explain compile in two layers:

- In the Profile Workbench UI, the "编译" button runs the real runtime compile path. It calls `POST /api/agent/profiles/compile`, loads the TSX profile in the background worker, checks the profile contract, and can produce a prepare preview.
- In agent-guided user-assets editing, prefer Workbench compile/preview or a real prepare preview instead of repository-root scripts. The project root `scripts/` directory is for development and deployment, not for the Agent runtime.
- Do not use repository-root profile scripts as the normal Agent-facing workflow.

Do not ask ordinary users to call the HTTP compile endpoint by hand. Mention it only when explaining how Workbench works or debugging the implementation.

### Restore a user profile to the system version

First explain that this deletes the user's override for that file. Then compare paths:

- User override: `workspace/.nbook/agent/profiles/...`
- System baseline: `assets/workspace/.nbook/agent/profiles/...`

If the user confirms, replace the user file with the matching system file content. If they only want to inspect the system version, read the system file instead of overwriting.

Do not restore by editing the system file. Restoring means removing or replacing the user override so the built-in baseline is visible again.

### Create a new profile from a template

Prefer the existing templates:

- Basic agent template: `assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx`
- Report agent template: `assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx`

Create the result under `workspace/.nbook/agent/profiles/`. A good default key is `agent.<slug>`, but it is only a recommendation.

After creating the file, ask the user to compile it in the Workbench or create a real prepare preview.

### Explain a compile error

Translate the error into user language:

- Missing `default export`: "这个文件还没有导出真正的 agent 配方。"
- Missing `inputSchema`: "这个 profile 没说创建 agent 时允许传什么配置。普通 agent 可以用空对象 schema。"
- Both `context` and `prepare`: "一个 profile 只能选一种准备上下文的方式。普通情况用 `context()`。"
- Unknown DSL node: "这个 TSX 标签不是当前 ProfilePrompt 支持的节点。"
- Tool key not found: "这个 agent 请求了一个系统里没有注册的工具。"
- Builtin schema locked: "这是系统内置 profile。你可以改提示词和工具权限，但不能把它的创建参数/输出协议改成另一个形状。"

## Current Profile Contract

A TSX profile usually contains:

- `profileManifest`: key/name/description.
- `InputSchema`: creating the agent/session uses this schema. Ordinary agents can use `Type.Object({})`.
- `OutputSchema`: report result data shape. Empty object schema means no special data fields.
- `allowedToolKeys`: tools visible to this agent.
- `context(ctx)`: recommended user-facing way to prepare prompt/context with TSX DSL.
- `prepare(ctx)`: advanced low-level override that returns `ProfileTurnPlan` directly.
- `ingest(ctx)`: optional post-run hook. Do not redesign it unless the user specifically asks for runtime behavior changes.

`context` and `prepare` are mutually exclusive.

`InputSchema` is for creating the agent/session instance. It is not the user's every-turn message. Ordinary agents can use `Type.Object({})`.

`OutputSchema` describes `report_result` data. Whether an agent must call `report_result` depends on `allowedToolKeys`, not on the schema existing.

## TSX DSL Mental Model

- `<System>` becomes provider-level system prompt. It does not show as a normal chat message.
- `<HistorySet>` is initial model-visible history for an empty session.
- `<AppendingSet>` writes visible messages into the session before the next model run.
- `<ModelContext>` is visible only to the model for the current run, not written into session history.
- `<Message>` creates a user-style context message. Do not use `role="system"`.
- `<Reminder>` and `<Watch>` are dynamic nodes controlled by profile runtime state.
- `<SkillCatalog />`, `<AgentCatalog />`, `<SqlSchemaSummary />`, and `<ActivatedSkills />` are string fragments. Put them inside `<Message>`, `<System>`, or another node that accepts string children.
- `DynamicSet` is an old name. Use `<ModelContext>`.

## Answering Users

- Start with the user's goal: "你想让这个 agent 在每轮开始前看到什么、能用什么工具、最后怎么交付结果？"
- Use everyday language first. Then show the TSX node or command.
- When a user says "帮我改 profile", inspect the target file and compile after editing.
- When a user asks "为什么前端看不到这段内容", check whether the content is in `System`, `ModelContext`, or `AppendingSet`.
- When a user asks "为什么 agent 没有这个工具", check `allowedToolKeys` and the tool registry.
- When a user asks "系统版本更新后为什么没有覆盖我的文件", explain the user-assets overlay and sync state before suggesting restore.

## Safety Rules

- Do not edit system files when a user override is the right place.
- Do not promise that a saved profile is runnable until `compile-profile` or Workbench runtime compile passes.
- Do not hide dangerous changes behind jargon. Say plainly if a change can affect all future agents.
- Do not assume the user knows TypeScript. Explain errors in normal language first.
- Do not run unfamiliar third-party `.profile.tsx` as if it were safe. User profiles are trusted local code.
