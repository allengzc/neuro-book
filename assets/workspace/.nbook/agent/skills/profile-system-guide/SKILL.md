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
- User assets are the user's editable Workspace Root `.nbook` overlay. Prefer editing files under `workspace/.nbook/...`. System files under `assets/workspace/.nbook/...` are the built-in baseline.
- Saving a profile source file does not make it runnable. Compile means "turn the saved `.profile.tsx` recipe into the runtime artifact the catalog can load." It does not start a chat session.
- Variable definitions also compile. Editing `agent/variables/definitions.ts` changes source only; runtime uses `agent/variables/.compiled/`.

## Important Paths

- Workspace Root `.nbook`: `workspace/.nbook/`
- User profiles: `workspace/.nbook/agent/profiles/`
- System profiles: `assets/workspace/.nbook/agent/profiles/`
- User skills: `workspace/.nbook/agent/skills/`
- System skills: `assets/workspace/.nbook/agent/skills/`
- User writing presets: `workspace/.nbook/agent/writing-presets/{styles,references}/`
- System writing presets: `assets/workspace/.nbook/agent/writing-presets/{styles,references}/`
- User global variable definitions: `workspace/.nbook/agent/variables/definitions.ts`
- Variable definition artifacts: `workspace/.nbook/agent/variables/.compiled/`
- Profile templates: `assets/workspace/.nbook/agent/profile-templates/`
- Harness docs: `docs/modules/agent/harness.md`
- TSX Profile Workbench task notes: `docs/tasks/04-tsx-profile-workbench/README.md`
- Agent migration/runtime notes: `docs/tasks/02-pi-agent-harness-migration/README.md`
- Workspace terms: `reference/workspace/TERMS.md`
- Detailed reference for this skill: `assets/workspace/.nbook/agent/skills/profile-system-guide/references/harness-profile-system.md`

## Editing Strategy

Prefer guidance before automation:

1. Explain the change in plain language.
2. Show the exact file that should change.
3. Read the current file before editing.
4. Make the smallest TSX change that matches the user's request.
5. Ask the user to use Workbench compile/preview, or use the `profile` CLI when it is available on the Agent runtime PATH.
6. If variable definitions changed, run the `variable definition` CLI checks too.

Use Agent runtime CLI only when it lives under `.nbook/agent/bin` and is on the bash PATH. Do not present repository-root `scripts/` as an Agent runtime contract.

## Common Operations

### Compile a profile

Explain compile in two layers:

- In the Profile Workbench UI, the "编译" button saves the source and runs background compile. A successful compile writes the runtime `.compiled` artifact for that profile.
- In agent-guided user-assets editing, prefer Workbench compile/preview or the Agent runtime `profile` CLI instead of repository-root scripts. The project root `scripts/` directory is for development and deployment, not for the Agent runtime.
- Do not use repository-root profile scripts as the normal Agent-facing workflow.

Useful CLI commands:

- `profile status <fileName-or-key>`: show source, compiled artifact, stale/not compiled/load failed, and sync warning.
- `profile check <fileName-or-key>`: check saved source and profile contract without writing `.compiled`.
- `profile compile <fileName-or-key>`: compile saved disk source and write `.compiled` artifact.
- `profile preview <fileName-or-key>`: dry-run saved source through prepare and show context sections without writing `.compiled`.
- Add `--project <projectPath>` when checking project variable types for a specific Project Workspace.
- Add `--strict-variables` when literal variable paths should fail if they are not registered.

Do not ask ordinary users to call the HTTP compile endpoint by hand. Mention it only when debugging the Workbench implementation.

### Compile variable definitions

Explain variable definitions in two layers:

- `definitions.ts` declares which `global.*` or `project.*` variables exist and what schema they use.
- `.compiled` is the runtime artifact. Runtime registry, profile prepare, and tools do not automatically compile definition source.

Useful CLI commands:

- `variable definition status --global`: show Workspace Root definition status.
- `variable definition check --global`: check Workspace Root definitions without writing artifacts.
- `variable definition compile --global`: compile Workspace Root definitions.
- `variable definition status --project <projectWorkspace>`: show a Project Workspace definition status.
- `variable definition check --project <projectWorkspace>`: check a Project Workspace definition.
- `variable definition compile --project <projectWorkspace>`: compile a Project Workspace definition.

Do not edit `.compiled` by hand. If a definition is `not_compiled`, `compile_stale`, or `compiled_load_failed`, fix the source first and compile again.

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

After creating the file, ask the user to compile it in the Workbench or run `profile compile`. Use `profile preview` when they want to inspect the prepared context without changing runtime artifacts.

### Explain a compile error

Translate the error into user language:

- Missing `default export`: "这个文件还没有导出真正的 agent 配方。"
- Missing `inputSchema`: "这个 profile 没说创建 agent 时允许传什么配置。普通 agent 可以用空对象 schema。"
- Both `context` and `prepare`: "一个 profile 只能选一种准备上下文的方式。普通情况用 `context()`。"
- Unknown DSL node: "这个 TSX 标签不是当前 ProfilePrompt 支持的节点。"
- Tool key not found: "这个 agent 请求了一个系统里没有注册的工具。"
- `not_compiled`: "这个 profile 还只有源码，没有可运行产物。保存后还需要编译。"
- `compile_stale`: "源码已经改过，但运行产物还是旧的。需要重新编译。"
- `compiled_load_failed`: "编译产物存在，但加载失败。先看编译诊断，再重新编译。"
- `builtin_schema_locked`: "这是系统内置 profile。你可以改提示词和工具权限，但不能把它的创建参数/输出协议改成另一个形状。"
- Variable path warning: "这个变量路径没有注册。普通检查可能只是 warning，`--strict-variables` 会把它当成错误。"

## Current Profile Contract

A TSX profile usually contains:

- `profileManifest`: key/name/description.
- `InputSchema`: creating the agent/session uses this schema. Ordinary agents can use `Type.Object({})`.
- `OutputSchema`: report result data shape. Empty object schema means no special data fields.
- `tools`: profile root tool bindings; this controls visible tool schema and maximum tool permission.
- `mainRunToolKeys`: optional main-run execution subset of `tools`.
- `context(ctx)`: recommended user-facing way to prepare prompt/context with TSX DSL.
- `prepare(ctx)`: advanced low-level override that returns `ProfileTurnPlan` directly.
- `ingest(ctx)`: optional post-run hook. Do not redesign it unless the user specifically asks for runtime behavior changes.

`context` and `prepare` are mutually exclusive.

`InputSchema` is for creating the agent/session instance. It is not the user's every-turn message. Ordinary agents can use `Type.Object({})`.

`OutputSchema` describes `report_result.data`. Whether an agent can call `report_result` depends on `tools` containing a `report_result` binding, not on the schema existing.

## TSX DSL Mental Model

- `<System>` becomes provider-level system prompt. It does not show as a normal chat message.
- `<HistorySet>` is initial model-visible history for an empty session.
- `<AppendingSet>` writes visible messages into the session before the next model run.
- `<ModelContext>` is visible only to the model for the current run, not written into session history.
- `<Message>` creates a user-style context message. Do not use `role="system"`.
- `<Reminder>` and `<Watch>` are dynamic nodes controlled by profile runtime state.
- `<SkillCatalog />`, `<AgentCatalog />`, `<SqlSchemaSummary />`, and `<ActivatedSkills />` are string fragments. Put them inside `<Message>`, `<System>`, or another node that accepts string children.
- `DynamicSet` is an old name. Use `<ModelContext>`.
- `.compiled` is the runtime artifact area, not the editing surface. Do not manually edit files under `.compiled`.

## Variable Authoring Model

- `ctx.input` is profile creation input. It is not the user's every-turn message and it no longer carries browser state.
- `ctx.vars` is the profile's variable access capability.
- Variable namespaces are fixed: `client.*`, `global.*`, `project.*`, and `session.*`.
- Use `<Variable>` to render variable values into current model context.
- Use `<VariableSchema>` to render variable schema and read/write capability notes.
- First version rule: place `<Variable>` and `<VariableSchema>` directly under `<ModelContext>`, not under `<System>`, `<HistorySet>`, or `<AppendingSet>`.
- Agent variable edits should use `variable_schema`, `variable_read`, then `variable_patch`, and read again when the result matters.
- Type artifacts and generated `.d.ts` files help TSX authors with autocomplete. Runtime truth remains the variable registry, schema validation, variable files, and session JSONL.

## Answering Users

- Start with the user's goal: "你想让这个 agent 在每轮开始前看到什么、能用什么工具、最后怎么交付结果？"
- Use everyday language first. Then show the TSX node or command.
- When a user says "帮我改 profile", inspect the target file and compile after editing.
- When a user asks "为什么前端看不到这段内容", check whether the content is in `System`, `ModelContext`, or `AppendingSet`.
- When a user asks "为什么 agent 没有这个工具", check root `tools`, `mainRunToolKeys` / sidecar `toolKeys`, and the tool registry.
- When a user asks "系统版本更新后为什么没有覆盖我的文件", explain the user-assets overlay and sync state before suggesting restore.
- When a user asks "为什么变量读不到", check namespace, current Project Workspace, definition compile status, and whether the profile was checked with the right `--project`.

## Safety Rules

- Do not edit system files when a user override is the right place.
- Do not promise that a saved profile is runnable until Workbench compile or `profile compile` passes.
- Do not hide dangerous changes behind jargon. Say plainly if a change can affect all future agents.
- Do not assume the user knows TypeScript. Explain errors in normal language first.
- Do not run unfamiliar third-party `.profile.tsx` as if it were safe. User profiles are trusted local code.
