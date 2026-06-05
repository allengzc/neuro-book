# NeuroBook Project Guide

This document is shared context for agent profiles. It summarizes the stable project file model that agents should use when working inside a NeuroBook Project Workspace.

## Workspace Roots

Agent cwd is the Workspace Root, usually `workspace/`. The Workspace Root is a data container, not a single novel.

The Current Project Workspace is usually `workspace/{project}/`. Runtime reminders may show it as `workspace/{project}`. When file tools or bash operate from the Workspace Root, prefer cwd-relative project paths:

- Use `{project}/lorebook/...`.
- Use `{project}/manuscript/...`.
- Use `{project}/simulation/...`.
- Do not default to `workspace/{project}/...` unless a tool explicitly asks for a Project Workspace path.

Common Project Workspace paths:

| Path | Purpose |
| --- | --- |
| `{project}/AGENTS.md` | Project-level collaboration instructions. |
| `{project}/project.yaml` | Project Workspace manifest with kind, title and summary. |
| `{project}/lorebook/` | File-based canon, prototypes, rules and AI instructions. |
| `{project}/manuscript/` | Manuscript, chapters, drafts and chapter notes. |
| `{project}/simulation/` | World simulation, subjects, entities and run artifacts. |
| `{project}/reference/` | External raw materials and import archives. |
| `{project}/.nbook/` | Project config, Project SQLite and project control files. |
| `{project}/.agent/` | Temporary plans, caches and execution notes. |

See also `reference/workspace/TERMS.md` for canonical workspace terminology.

## Novel Writing Workflow

`leader.default` should treat the writing workflow as a flexible standard, not a mandatory pipeline. The normal path is:

1. Route the user intent.
2. Prepare canon and project context.
3. Invoke or perform simulation only when plot movement, causal simulation, subject reaction, state change or information control is needed; prefer `simulator.leader` for this work.
4. Commit adjudicated state to `simulation/subjects/`, `simulation/entities/` and `simulation/runs/`.
5. Convert selected results into Plot System updates; prefer `director` for Thread / Scene / Plot design and writeback.
6. Use retrieval to select lorebook entries.
7. Invoke the ordinary `writer` for chapter prose.
8. Check whether the finished prose requires a post-write state commit.

In writing-mode discussions, `emulation` means the world-running step that advances current state. The current Project Workspace directory is still `simulation/`; do not create a separate `emulation/` directory unless a future migration explicitly changes the contract.

The ordinary `writer` profile does not maintain `simulation/`. It writes explicit manuscript chapters from `chapterPaths`, Chapter Plot and selected `lorebookEntries`. If world state matters, leader should ask `simulator.leader` to summarize or commit it first, ask `director` to update Plot System when needed, then pass only writer-safe context.

## Content Nodes

`lorebook/` and `manuscript/` use content nodes. A content node is a directory whose `index.md` is the entry body.

Rules:

- `lorebook/**/index.md` and `manuscript/**/index.md` represent their containing directory.
- Files under content roots that are not `index.md` are ordinary files unless a tool explicitly treats them otherwise.
- A directory content node may contain child directories, notes, drafts or references.
- Do not create both `foo.md` and `foo/index.md` for the same stem in one content root.
- `index.md` stores stable text, frontmatter refs and retrieval / inject config.
- Optional `state.md` stores current state. The long-term direction is to keep lorebook mostly stateless and move subject/entity runtime state into `simulation/`, but existing content-node `state.md` remains compatible.

Creation and validation:

- Create nodes with `workspace node new TARGET --type TYPE --title TITLE`.
- Use `--state` when the node needs an initial `state.md`.
- Add state to an existing node with `workspace node state TARGET`.
- Validate changed nodes with `workspace node validate TARGET`.
- After moving or renaming content nodes, enumerate affected `index.md` files and run `workspace node validate --stdin`.

Target paths should be cwd-relative project paths, such as `my-novel/lorebook/character/hero/` or `my-novel/manuscript/001-volume/001-chapter/`.

## Content References

Content-node references split into inline refs and structured refs.

Inline refs are ordinary Markdown links in body text. Use them for appearance, mention, scene location and ordinary relatedness. Inside body text, relative Markdown links are allowed, such as `[荒野祭坛](../../lorebook/location/initial-stage/)`; tool calls still use cwd-relative project paths such as `my-novel/lorebook/location/initial-stage/`.

Structured refs are `frontmatter.refs` relations that the system should understand as stable relationships. Use them for definitions, constraints, dependencies, parent-child ownership, foreshadowing, payoff, direct causality, conflict or derivation.

Guidelines:

- Do not bulk-add all chapter characters, places and mechanisms into structured refs. Prefer inline refs in chapter summary or prose.
- Generic `features`, `mentions` or `related_to` relations usually belong as inline refs, or can be omitted.
- Recommended structured ref relation labels: `defines`, `constrains`, `depends_on`, `part_of`, `contains`, `foreshadows`, `pays_off`, `conflicts_with`, `derived_from`.

## Retrieval And Inject

Content-node frontmatter `inject` is for stable, low-judgment direct context injection to selected profiles.

Content-node frontmatter `retrieval` is for task-driven recall. Use natural-language `retrieval.trigger` to explain when a node is relevant.

For writer handoff:

- Retrieval should return candidate entries with `path`, `reason`, `use` and `risk`.
- Leader reads `reason` / `use` / `risk` / `note` for judgment.
- Only selected `entries[].path` values should be passed to `writer.lorebookEntries`.

## Lorebook

`lorebook/` is the stateless, omniscient project manual for stable facts, prototypes, rules and reusable AI instructions.

Recommended default top-level directories:

| Directory | Meaning |
| --- | --- |
| `world/` | World structure, laws, eras, history and large-scale rules. |
| `character/` | Omniscient character canon, background, secrets and author notes. |
| `location/` | Places organized by actual spatial hierarchy. |
| `faction/` | Important factions, political bodies and conflict groups. |
| `item/` | Artifacts, equipment, documents, consumables and materials. |
| `event/` | Historical events that already happened in canon. |
| `system/` | Game-like systems, procedures, mechanics and rule modules. |
| `instruction/` | Reusable AI instructions for this project, such as style, boundaries, retrieval and disclosure rules. |

Projects may promote other high-frequency types, such as `species/` or `organization/`, when that structure is central to the work.

Do not put these into stable lorebook by default:

- Plot plans and chapter-by-chapter execution.
- Subject private knowledge, mind state, current goals or inventory snapshots.
- Entity current holder, hidden activation state, damage or progress.
- Raw imported SillyTavern cards, MVU scripts, dynamic prompts or low-confidence migration notes.
- Temporary run logs.

Use lorebook for prototypes and canon. Use `simulation/subjects/` for subject-facing knowledge and mind. Use `simulation/entities/` for stateful instances.

## Manuscript

`manuscript/` is the writing area for prose, volumes, chapters, drafts and chapter-local notes.

Rules:

- A volume can be `manuscript/001-volume/index.md`.
- A chapter can be `manuscript/001-volume/001-chapter/index.md`.
- Short stories, extras and nonstandard structures may use other hierarchies.
- Chapter prose belongs in the chapter `index.md`.
- Chapter-local notes, drafts, lorebook summaries and references can live beside the chapter as ordinary files.
- `lorebook-notes.md` or `lorebook-notes/` are temporary summaries, not replacements for formal lorebook entries.

When a manuscript path changes, relative Markdown links may break. Validate affected content nodes after path edits.

## Simulation

`simulation/` is the world simulation layer. It supports RP, writing-time world evolution, subject reactions, information control and entity state maintenance.

Recommended structure:

```text
simulation/
|-- config.yaml
|-- simulator.md
|-- cast.yaml
|-- writer.md
|-- subjects/
|-- entities/
`-- runs/
```

Responsibilities:

- `simulator.md`: simulator leader protocol, ruling principles and information-control rules.
- `cast.yaml`: schedulable subjects, entities, profiles and path registry for a run.
- `writer.md`: writer prompt material, style hints and output contract for simulation/RP rendering.
- `subjects/`: information-control subjects, such as characters, the player, organizations or faction representatives.
- `entities/`: stateful instances, such as unique items, doors, mechanisms, event processes or locations with runtime state.
- `runs/`: Tick logs, scratch notes, briefs and run artifacts.

`actor` is a kind of simulator, not a top-level directory. Character-like simulators live under `simulation/subjects/`.

For writing-mode emulation, prefer compact tick artifacts:

```text
simulation/runs/
|-- current.md
|-- index.md
`-- ticks/
    `-- 000001-short-slug/
        |-- report.md
        `-- prose.md
```

`report.md` records trigger, scope, causal chains, adjudicated events, information boundary, state/entity commits, writer-safe brief, open questions and next hooks. `prose.md` records user-visible prose when a tick produces RP prose, a writing sample or a rendered scene. Future workflow/runtime support may auto-generate files such as `input.md`, `actor-packets.json`, `commits.json` and `tool-log.json`; do not require agents to hand-write those in the first version.

## Subject And Entity Split

Use the Prototype / Instance + Event Sourcing + Subject-facing View pattern:

- `lorebook/` stores prototypes, rules and canon.
- `simulation/entities/` stores instances that need state.
- `simulation/subjects/{id}/events.md` records important events experienced or learned by the subject.
- `simulation/subjects/{id}/knowledge.md` records what the subject knows, believes or misunderstands.
- `simulation/subjects/{id}/mind.md` records current short-term psychology, doubts and motivation.
- `simulation/subjects/{id}/state.md` records current location, visible condition, inventory summary and short-term goals.

A reference to `lorebook/...` is not visibility authorization. A subject only knows what appears in its subject-facing files or what the simulator leader injects after filtering.

Do not instantiate every ordinary item. Three generic blood potions in an inventory can be an inventory count. Create an entity only when the object has independent state, hidden truth, unique identity, holder-specific differences, progress, damage or major plot importance.

## Plot System

The Plot System records future-facing and author-facing story operations. It is not prose and not lorebook canon.

Core levels:

- Thread: long-running line of tension, goal, conflict or promise.
- Scene: a writable scene unit under a Thread; it may be assigned to a manuscript chapter.
- Plot: ordered beat inside a Scene, such as setup, conflict, reveal, payoff or result.

Use plot tools for story structure:

- Read with `get_plot_tree`, `get_story_thread`, `get_story_scene_context` or `get_chapter_plot`.
- Update with `create_story_thread`, `update_story_thread`, `create_story_scene`, `update_story_scene`, `create_story_plot` and `update_story_plot`.
- Always pass `projectPath`, for example `workspace/my-novel`, when plot tools require it.

Plot decisions, foreshadowing, information gaps, choices and consequences belong in the Plot System. Stable facts that have become canon can later be synchronized into lorebook.

After plot edits, check continuity: character motivation, causal chain, reader information and protagonist information should not be accidentally mixed.

## Shell Entry Points

The stable Agent runtime CLI entry is `workspace node ...`, provided by `.nbook/agent/bin` in PATH.

Useful commands:

```bash
workspace project create my-novel --title "Title" --summary "One sentence"
workspace project validate my-novel
workspace project init-db my-novel
workspace node parse my-novel/lorebook/character/hero/
workspace node validate my-novel/lorebook/character/hero/
workspace node new my-novel/lorebook/character/hero --type character --title "Hero" --state
workspace node state my-novel/lorebook/character/hero/
```

Batch examples:

```bash
rg --files | rg '(^|/)index\.md$' | workspace node parse --stdin --ndjson
rg --files | rg '(^|/)index\.md$' | workspace node validate --stdin
```

Prefer `rg --files` and precise path filters. Do not recursively scan an entire Project Workspace without a reason.

Agent runtime config makes `rg --files` output use `/` paths. Shell examples should use bash syntax and `/` separators for workspace-relative paths. Do not write unquoted Windows backslash paths like `lorebook\character\hero`, because bash can parse them as `lorebookcharacterhero`.

## Cross References

- Workspace terms: `reference/workspace/TERMS.md`
- Directory protocol: `reference/content/directory-protocol.md`
- Novel writing workflow: `reference/agent/novel-writing-workflow.md`
- Information control: `reference/content/information-control.md`
- Content-node state compatibility: `reference/content/state.md`
- Retrieval and inject: `reference/content/retrieval.md`
- Plot module: `reference/plot/system.md`
