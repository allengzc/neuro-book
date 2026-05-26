# Harness And Profile System Reference

Read this reference when a user asks how Neuro Book's agent harness, TSX profiles, `ProfileTurnPlan`, skills, or user-assets profile overlays actually work. Keep explanations user-friendly, but use the exact terms below when editing files or diagnosing runtime behavior.

## Table Of Contents

- Mental model
- Current architecture
- Session truth
- Invoke lifecycle
- Profile contract
- ProfileTurnPlan sections
- TSX DSL nodes
- Reminder and Watch state
- Skills and profiles
- User-assets overlay
- Compile, preview, and run
- Common troubleshooting
- Source index

## Mental Model

- Profile: the agent recipe. It defines the agent name/key, creation input, optional output shape, visible tools, and how to prepare context before each run.
- Harness: the runner. It owns sessions, calls the profile, writes pre-loop messages, starts the model/tool loop, streams events, and saves final messages.
- Session: the append-only record. It stores chat messages, visible profile messages, state changes, custom state, compaction, and the current active branch.
- Skill: a workflow note that the agent may read from the skill catalog. A skill is not a profile and does not start an agent by itself.
- user-assets: the editable user overlay under `workspace/.nbook/...`. System baselines live under `assets/workspace/.nbook/...`.
- Workspace Root `.nbook`: `workspace/.nbook/`. It stores Global Config, user agent assets, global variable values, and user overrides.
- Project Workspace: `workspace/{project}/`. It stores manuscript, lorebook, Project Config, and Project SQLite for one project.

Useful ordinary-user explanation:

> Profile 是 agent 的配方，harness 是照着配方做菜的运行器，session 是每一步留下来的流水账，skill 是一本可按需翻开的操作说明书。

## Current Architecture

Current active stack:

- Active backend: `server/agent`.
- Old v2 reference only: `server/agent-v2` and `assets/agent-v2`.
- HTTP entry: `/api/agent/sessions/**`.
- Profile roots:
  - system: `assets/workspace/.nbook/agent/profiles`
  - user: `workspace/.nbook/agent/profiles`
- Skill roots:
  - system: `assets/workspace/.nbook/agent/skills`
  - user: `workspace/.nbook/agent/skills`

Neuro Book borrowed Pi's message, event, tool, and append-only session ideas, but it owns its own `NeuroAgentHarness`. Do not tell users that the app simply embeds the Pi coding agent. The current design is Pi-compatible at the message/event level and Neuro-Book-specific at the product harness level.

## Session Truth

The session JSONL append-only tree is the source of truth. Branch switching moves the active leaf; it does not delete old history.

Important entry kinds:

- `message`: model-visible user / assistant / toolResult messages.
- `custom_message`: profile or harness messages. When `visibleToModel: true`, they enter model context and the frontend history.
- `custom`: reduced into `ctx.session.customState`, for example `agent.tasks`, `agent.planMode`, `plot.selection`, and `profileState.<profileKey>`.
- `session_update`: title and summary changes.
- `model_change`, `thinking_level_change`, `profile_change`: per-session runtime configuration.
- `variable_patch`: variable changes. `global.*` and `project.*` also write their variable files; `session.*` lives in the session JSONL.
- `client_variable_patch_ack`: frontend acknowledgement for a requested `client.*` patch.
- `compaction`: summarized history and retained tail boundary.
- `invocation_lifecycle`: start/end/error/aborted markers.
- `leaf`: current active branch pointer.

The reducer builds `NeuroSessionContext` with:

- `messages`
- `customState`
- `linkedAgents`
- model, thinking level, profile key, title, summary, plan mode, workspace root, and other session state

If something should be visible in frontend history and replayable after refresh, it must be written as a session entry. Model-only context is invisible to the stable chat history.

## Invoke Lifecycle

Prompt invocation order:

1. Harness writes `invocation_lifecycle:start`.
2. Harness constructs the pending user message, but does not write it yet.
3. For `continue + resolution`, harness first writes the toolResult resolution.
4. Harness reads and reduces the current session.
5. Harness calls the profile and gets `ProfileTurnPlan`.
6. Harness writes pre-loop profile content in this order:
   - `historyInitMessages`
   - `modelContextAppendingMessages`
   - `appendingMessages`
   - `stateWrites`
7. Harness writes the pending user message.
8. Harness reduces the session again.
9. Harness may compact context if needed.
10. Harness builds final ReAct input from reduced session messages plus `modelContextMessages`.
11. ReAct loop streams assistant/tool events.
12. `message_end` persists assistant and toolResult messages.
13. Current `ingest` hook runs after the loop.
14. Harness writes lifecycle end/error/aborted.
15. Steer queue drains at safe points before the next model call when possible.
16. Follow-up queue drains after the current loop truly ends, one item at a time.

Frontend effect:

- Appending/profile reminders can appear before the user's message.
- Then the user's message appears.
- Then the live assistant stream appears.
- `System` and plain `ModelContext` do not appear as chat messages.
- `steer` and `followUp` are harness/Composer control-plane operations. Profiles should not pretend to implement those queues in prompt text.

## Profile Contract

Profile modules use TypeBox and `defineAgentProfile`:

```ts
defineAgentProfile({
    manifest,
    inputSchema,
    outputSchema,
    allowedToolKeys,
    context, // recommended
    prepare, // advanced
    ingest, // optional post-run hook
});
```

Rules:

- `context(ctx) => JSX` is the normal authoring path.
- `prepare(ctx) => ProfileTurnPlan` is the low-level override path.
- `context` and `prepare` are mutually exclusive.
- Tools visible to the model come from `allowedToolKeys`, not from `prepare`.
- `InputSchema` validates agent/session creation input. It is not the per-turn user prompt.
- `InputSchema = Type.Object({})` means the agent does not need special creation input.
- `OutputSchema` describes `report_result.data`. The report protocol is enabled only when `allowedToolKeys` contains `report_result`.
- `OutputSchema = Type.Object({})` plus `report_result` means the final report has `walkthrough` but no extra structured data fields.
- `OutputSchema` without `report_result` is just metadata until a profile allows that tool.

`ctx.runtime.pendingUserMessage` may be available during prompt mode. It lets the profile inspect the current user input before it is written to session. The harness still writes the user message after profile pre-loop writes.

Variable context:

- `ctx.input` is profile creation input. It is not the every-turn user prompt and it no longer carries browser state.
- `ctx.invocation` may carry one-turn invocation data such as current frontend client state.
- `ctx.vars` is the variable accessor for `client.*`, `global.*`, `project.*`, and `session.*`.
- `project.*` requires a current Project Workspace from `client.currentProjectWorkspace`; it does not fall back to old `novelId` state.

## ProfileTurnPlan Sections

Current shape:

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

Section meanings:

- `systemPrompt`: provider-level system prompt. It is not a session message.
- `historyInitMessages`: initial model-visible history. Harness writes it only when the active path has no model-visible message.
- `appendingMessages`: visible pre-loop session messages. This is the normal profile/user layer append channel.
- `modelContextAppendingMessages`: messages produced by `Reminder` inside `ModelContext`. They are written like appending messages and can show in the frontend.
- `modelContextMessages`: model-only messages for the current provider call. They are not persisted and not shown in frontend history.
- `stateWrites`: controlled session state writes. Current profile runtime only allows `custom profileState.<profileKey>` for Reminder/Watch state.

Do not return old fields such as `toolKeys`, `messages`, `contextMessages`, or `dynamicMessages`.

## TSX DSL Nodes

Active core nodes:

- `<ProfilePrompt>`: root node.
- `<System>`: builds `systemPrompt`; accepts string fragments only.
- `<HistorySet>`: first-run initial context.
- `<AppendingSet>`: visible pre-loop session append.
- `<ModelContext>`: model-only context; `Reminder` inside it may still append visible messages.
- `<Message>`: user-style message. `role="system"` is forbidden.
- `<AIMessage>`: assistant example message.
- `<ToolCall>`: child of `AIMessage`.
- `<ToolResult>`: matching tool result example.
- `<Reminder>`: stateful reminder.
- `<Watch>`: observes a value/path and renders when it changes.
- `<If>`: condition false means children are not rendered and do not touch state.
- `<SkillCatalog>`: string fragment with available skills.
- `<ActivatedSkills>`: string fragment for explicitly mentioned skills.
- `<AgentCatalog>`: string fragment with available agent profiles and schema summaries.
- `<SqlSchemaSummary>`: string fragment with database schema summary for SQL guidance.
- `<Variable>`: renders selected variable values into model context.
- `<VariableSchema>`: renders selected variable schema and read/write capability notes into model context.

Convenience string/reminder nodes also exist in the runtime, including `SystemReminder`, `RuntimeContext`, `LinkedAgentsSummary`, `WorkspaceReminder`, `LinkedAgentsReminder`, `TaskReminder`, `PlanModeReminder`, `ActivePlanModeReminder`, `MentionedSkillsReminder`, and `PlotFocusReminder`.

Old name:

- `DynamicSet` is removed. Use `<ModelContext>`.

Placement guidance:

- Put stable identity and behavior in `<System>`.
- Put initial examples/background in `<HistorySet>`.
- Put user-visible runtime reminders in `<AppendingSet>`.
- Put one-run-only model context in `<ModelContext>`.
- Put `<Variable>` and `<VariableSchema>` directly under `<ModelContext>` in the current version.
- Put catalog fragments inside `<Message>`, `<System>`, or another node that accepts string children.
- Do not use `<Message role="system">`.

## Reminder And Watch State

`Reminder` and `Watch` store profile runtime state in:

```text
custom entry key: profileState.<profileKey>
```

Current practical rules:

- `Reminder` can be used in `AppendingSet` or `ModelContext`.
- `Watch` can be used in `AppendingSet` or `ModelContext`.
- `Reminder` may use variable `watchPath`, function `watch`, `watchValue`, and `repeatEveryTurns`.
- `Watch` may use a variable `path`, explicit `value`, children, or `render(change)`.
- `repeatEveryTurns` counts real prompt user messages, not appending messages or harness reminders.
- `If` false does not render children and does not update Reminder/Watch state.

Explain to users:

- Reminder is "show this reminder only when the runtime says it is useful."
- Watch is "notice that a variable path or explicit function value changed, then show related context."

Path guidance:

- `watchPath` and `Watch path` are variable paths such as `client.currentProjectWorkspace`, `global.userPreferences`, `project.affections`, or `session.draftGoal`.
- Use function watches for non-variable facts such as `ctx.session.planModeActive` or a custom fingerprint.
- Do not use old roots such as `ctx.workspace` or `ctx.input.studio`.

## Skills And Profiles

Skills are discovered by directory key:

- system first: `assets/workspace/.nbook/agent/skills/<skillKey>/SKILL.md`
- user overlay second: `workspace/.nbook/agent/skills/<skillKey>/SKILL.md`
- same key means the whole user skill directory overrides the system skill directory

Model-visible skill catalog is produced by `<SkillCatalog />`. The current runtime does not expose a separate `skill` tool. The agent should use the catalog `location` and the normal `read` tool to open the relevant `SKILL.md`. If that entry points to references, scripts, templates, or examples, read only the specific relative files needed for the task.

Current runtime discovers profile source files, but it only runs fresh `.compiled` artifacts. Source files are the editing truth, while compiled artifacts are the runtime truth. A loaded profile becomes runnable through its `manifest.key`. Bad, uncompiled, or stale profile files should be fixed through source editing and compile diagnostics; they are not normal runnable catalog items.

## User-Assets Overlay

System baselines:

- profiles: `assets/workspace/.nbook/agent/profiles`
- skills: `assets/workspace/.nbook/agent/skills`
- writing presets: `assets/workspace/.nbook/agent/writing-presets`
- variable definitions: `assets/workspace/.nbook/agent/variables`
- templates: `assets/workspace/.nbook/templates`

User editable overlay:

- profiles: `workspace/.nbook/agent/profiles`
- skills: `workspace/.nbook/agent/skills`
- writing presets: `workspace/.nbook/agent/writing-presets`
- variable definitions: `workspace/.nbook/agent/variables`
- templates: `workspace/.nbook/templates`

Overlay rules:

- Prefer editing the user path.
- System path is the built-in baseline.
- User profile with the same relative path/key shadows the system profile.
- Builtin profile keys have locked Input/Output schema contracts. User overrides may change implementation and tool list, but should not redefine the builtin schema shape.
- User profiles are trusted local code, not sandboxed plugins.
- System profile sync copies missing files and can update unmodified user copies using sync metadata. If a user file was hand edited or lacks sync state, do not overwrite silently.
- user-assets is not a Project Workspace. Do not put manuscript, lorebook, project plot data, or Project SQLite changes under `workspace/.nbook`.
- Project SQLite lives under `workspace/{project}/.nbook/project.sqlite` and belongs to the Project Workspace.

When explaining restore:

- "恢复系统版本" usually means replace or remove the user override so the system baseline is used again.
- Always say if this will discard the user's custom changes.

## Compile, Preview, And Run

Workbench compile:

- UI saves the source and runs background compile.
- Successful compile writes the profile root `.compiled` artifact and manifest.
- It can also produce prepare preview for the current profile.
- Ordinary users should not be asked to call the HTTP endpoint manually.

Agent runtime CLI:

- `profile status`: shows source/compiled status, stale/not compiled/load failed, and sync warnings.
- `profile check`: validates saved source and contract without writing `.compiled`.
- `profile compile`: compiles saved source from disk and writes `.compiled`.
- `profile preview`: dry-runs saved source through `prepare()` and shows `systemPrompt`, HistorySet, AppendingSet, ModelContext, `stateWrites`, final ReAct messages, and `report_result` schema. It does not write `.compiled`.

Developer source-tree checks:

- Repository-root `scripts/` are for development and deployment, not the Agent runtime contract.
- Old repository-root profile scripts such as `scripts/compile-profile.ts`, `scripts/check-profile.ts`, and `scripts/profile-compile-cli.ts` have been removed. Do not present them as the normal user-assets Agent workflow.

Run/create session:

- A profile is runnable only when the runtime catalog can load a fresh compiled artifact for it.
- Creating a session uses `/api/agent/sessions` and a `profileKey`.
- "New profile can run immediately" means: after compile passes and the profile contract is correct, the UI or API can create a session with that `profileKey`. It does not mean the Workbench automatically opens a session.

Planned `.compiled` artifact layout:

- system artifacts: `assets/workspace/.nbook/agent/profiles/.compiled/`
- user artifacts: `workspace/.nbook/agent/profiles/.compiled/`
- system artifacts ship with system assets and Docker images
- user artifacts are generated at runtime by Workbench or `profile compile`
- `.agent/workspace/profile-module-cache` is not the runtime contract

Variable definition artifacts:

- Workspace Root/global definition source: `workspace/.nbook/agent/variables/definitions.ts`
- Workspace Root/global artifact: `workspace/.nbook/agent/variables/.compiled/`
- Project definition source: `workspace/{project}/.nbook/agent/variables/definitions.ts`
- Project artifact: `workspace/{project}/.nbook/agent/variables/.compiled/`
- Runtime only loads fresh compiled artifacts. It does not compile definition source during catalog, profile prepare, variable read, or variable patch.

Type artifacts:

- Hash or fixed `.types.d.ts` outputs are authoring aids for profile TSX autocomplete.
- Missing or stale type artifacts should not change runtime variable truth.
- Runtime truth is the registry, TypeBox schema validation, `variables.json`, and session JSONL.

## Common Troubleshooting

Saved file but agent still fails:

- Saving only writes the source file.
- Compile/runtime catalog decides whether it can run.
- Use Workbench compile, `profile compile`, or `profile status`.
- Use `profile preview` when the user wants to inspect prepared context without changing runtime artifacts.

Variable definition changed but variable schema is old:

- Saving `definitions.ts` is not enough.
- Run `variable definition status/check/compile`.
- Make sure project-specific checks pass the right `--project <projectWorkspace>` or use the Project Workspace definition command.
- Use `--strict-variables` in profile checks when literal path mistakes should fail fast.

Content does not show in frontend history:

- `<System>` is provider-level only.
- plain `<ModelContext>` is model-only.
- use `<AppendingSet><Message>...</Message></AppendingSet>` when the user should see it in the session.

Agent cannot use a tool:

- Check `allowedToolKeys`.
- Check the actual tool registry.
- Tools are not returned from `prepare`.

Run error appears in the frontend:

- Harness writes `invocation_lifecycle.errorInfo`.
- Frontend projects it as a Run Error system card.
- If HTTP invoke returns an error and the snapshot does not contain the same run error, frontend may also show a notification as a fallback.

Steer or follow-up is confusing:

- `steer` is queued while a run is active and drains at a safe point before another model call.
- `followUp` is queued for after the current loop ends and starts a fresh loop.
- Idle sessions reject explicit `steer` / `followup`; late or aborting runs also reject new queue items.

History appears only on first turn:

- That is expected for `<HistorySet>`.
- It only writes when the active path has no model-visible message.

User override did not receive system update:

- User assets protect hand-edited files.
- Compare user file with system file.
- Restore explicitly if the user wants the system version.

`report_result` behavior is confusing:

- The tool must be in `allowedToolKeys` to enable report completion.
- `OutputSchema = Type.Object({})` means walkthrough-only report data.
- No `report_result` tool means normal assistant completion is allowed.

## Source Index

Primary implementation files:

- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/profiles/types.ts`
- `server/agent/profiles/profile-dsl.ts`
- `server/agent/profiles/catalog.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/session/types.ts`
- `server/agent/skills/skill-catalog.ts`

Primary docs:

- `docs/modules/agent/harness.md`
- `docs/research/pi-agent-harness.md`
- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `docs/tasks/04-tsx-profile-workbench/README.md`
- `docs/tasks/05-leader-profile-v2-adaptation/README.md`
- `docs/tasks/archived/user-assets-workspace/README.md`
- `spec/workspace/TERMS.md`
