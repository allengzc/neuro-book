# Simulation Directory

`simulation/` stores world runtime state and simulation artifacts. It is shared by writing mode and RP mode.

## Default Shape

```text
simulation/
|-- subjects/
|   `-- {subject-id}/
|       |-- subject.md
|       |-- events.md
|       |-- knowledge.md
|       |-- mind.md
|       `-- state.md
|-- entities/
|   `-- {entity-id}/
|       |-- entity.md
|       |-- events.md
|       `-- state.md
`-- runs/
    |-- current.md
    |-- index.md
    `-- ticks/
```

`roleplay/` is the old directory name. The current target directory is `simulation/`.

Old directory migration:

```text
roleplay/                 -> simulation/
roleplay/actors/{id}/     -> simulation/subjects/{id}/
roleplay/playthrough/     -> simulation/runs/
roleplay/gm.md            -> agent-context/simulator.leader.md
```

## Root Files

| Path | Purpose |
| --- | --- |
| `subjects/` | Information-control subjects, such as characters, the player, organizations or faction representatives. |
| `entities/` | Stateful instances, such as unique items, doors, mechanisms, event processes or locations with runtime state. |
| `runs/` | Tick logs, scratch notes, briefs and run artifacts. |

`actor` is a kind of simulator, not a top-level directory. Character-like simulators live under `simulation/subjects/`.

Profile-specific project guidance lives in `agent-context/`, not in `simulation/`. For example, `simulator.leader` reads `agent-context/simulator.leader.md`, and `rp.writer` reads `agent-context/rp.writer.md`.

## Runtime Profiles

Current RP / simulation profile contract:

| Profile | Role | Reads | Writes |
| --- | --- | --- | --- |
| `simulator.leader` | World simulator leader shared by writing mode and RP. It understands the task or user action, dispatches actor emulators, adjudicates the world, maintains state/entities, builds writer-safe brief and reports the result. | `AGENTS.md`, `agent-context/simulator.leader.md`, recent `simulation/runs/`, subject/entity state, Plot context and god-view lorebook / reference allowed by its context. | Approved subject `state.md`, `simulation/entities/`, necessary `simulation/runs/` and explicit simulation context changes. New subjects/entities should be reported before creation unless the current prompt explicitly grants automatic authority. |
| `simulator.actor` | Single-subject simulator. It only uses actor-safe context injected by sidecar and the current actor-facing packet to output a character response. | Main run sees actor binding metadata, `<actor_sidecar_context>` and the current actor-facing packet. `actor.context-load` sidecar can read bound `subject.md`, `events.md`, `knowledge.md`, `mind.md`, `state.md` and related actor-safe lorebook context. | Main run does not write files; `actor.memory-save` sidecar may maintain `events.md`, `knowledge.md` and `mind.md`. |
| `rp.writer` | Tick prose renderer. It turns simulator leader writer brief into user-visible prose. | Bound `agent-context/rp.writer.md` and writer brief; only extra paths explicitly provided by simulator leader. | Normal assistant prose; writes files only when writer brief explicitly specifies an output path. |

`simulator.leader` must not hand complete `simulation/`, `lorebook/` or `reference/` to actor / writer. It filters god-view context into actor-facing messages or writer briefs.

`leader.rp` is a removed legacy profile. Current RP entry should create or reuse `simulator.leader`.

## Subject To Actor Input

`simulation/subjects/{subject-id}/` to `simulator.actor` input mapping:

| subject file | actor input |
| --- | --- |
| `subject.md` | `instructionPath` |
| `events.md` | `eventsPath` |
| `knowledge.md` | `knowledgePath` |
| `mind.md` | `mindPath` |
| `state.md` | `statePath` |

Subject paths are Project Workspace relative, such as `simulation/subjects/erina/subject.md`. Before invoking an agent, convert them to Agent cwd-relative project paths, such as `{project}/simulation/subjects/erina/subject.md`.

## Subjects

`simulation/subjects/{subject-id}/` stores entities that can know, misunderstand, judge, act and hide information. The player character should also be a subject.

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

| File | Purpose |
| --- | --- |
| `subject.md` | Subject simulation instruction, stable personality, voice and action principles. |
| `events.md` | Important events personally experienced or learned by the subject. |
| `knowledge.md` | What the subject knows, believes or misunderstands. |
| `mind.md` | Current short-term psychology, doubts, judgement, motivation and emotions. |
| `state.md` | Current location, visible condition, inventory summary, relationship pressure and short-term goals. |

## Entities

`simulation/entities/{entity-id}/` stores stateful instances. Instantiation is for state tracking, not information control.

```text
simulation/entities/{entity-id}/
|-- entity.md
|-- events.md
`-- state.md
```

Create an entity when the object has:

- Independent state.
- Hidden truth.
- Unique or near-unique identity.
- Holder-specific differences.
- Damage, activation, progress, location or timer state.
- Major plot importance.

Do not instantiate every ordinary item. Three generic blood potions in an inventory can be an inventory count. A poisoned blood potion should become an entity.

## Runs

`simulation/runs/` stores tick artifacts for world simulation, RP, writing emulation or debugging. It is process record, not canon lorebook and not subject memory.

Recommended compact shape:

```text
simulation/runs/
|-- current.md
|-- index.md
`-- ticks/
    `-- 000001-short-slug/
        |-- report.md
        `-- prose.md
```

| File | Purpose |
| --- | --- |
| `current.md` | Current world time, active scene, active conflicts, recent tick summary and pending next steps. |
| `index.md` | Tick index table: id, title, mode, world time, status and summary. |
| `ticks/{id}-{slug}/report.md` | Background report: trigger, scope, causal chain, adjudicated events, information boundary, state commits, writer-safe brief, open questions and next hooks. |
| `ticks/{id}-{slug}/prose.md` | User-visible prose for an RP tick, writing sample or rendered scene. Formal chapter prose still lives in `manuscript/.../index.md`. |

Rules:

- `runs/` is not named `sessions/`, to avoid confusion with Agent Session.
- Tick directory names should use `000001-short-slug`.
- Subjects do not read full `runs/` by default.
- Results that need to persist should be curated into `simulation/subjects/`, `simulation/entities/`, Plot System or `lorebook/`.
- `report.md` writer brief must contain only writer-safe information.
- `prose.md` stores user-visible prose, not background adjudication.

## Classification Method

For a new concept, classify in this order:

1. Is it stable canon, subject-facing knowledge, entity runtime state, plot plan, run process artifact or raw external material?
2. Stable canon goes to the most fitting `lorebook/` type.
3. Subject-facing knowledge goes to `simulation/subjects/{id}/`.
4. Stateful instances go to `simulation/entities/{id}/`.
5. Runtime process goes to `simulation/runs/`.
6. Plot planning goes to Plot System.
7. Raw external material goes to Project Workspace `reference/`.
