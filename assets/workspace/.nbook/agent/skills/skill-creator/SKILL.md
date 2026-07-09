---
name: skill-creator
description: Create or update a Neuro Book skill under .nbook/agent/skills. Use this when you need to design a new skill, refactor an existing skill, tighten trigger descriptions, reorganize bundled resources, or add optional helper scripts and references for the project skill system.
---

# Skill Creator

Create and maintain skills for the Neuro Book repository.

This project currently discovers skills by scanning `assets/workspace/.nbook/agent/skills/*/SKILL.md` and `workspace/.nbook/agent/skills/*/SKILL.md` (or legacy `skill.md`) and reading only the frontmatter fields `name`, `description`, and `when_to_use`. The skill body is loaded later with `read` from the catalog location only when the model decides the skill is relevant.

Treat this as the ground truth while editing skills. Do not design around external Codex conventions that are not implemented in this repo.

## What A Neuro Book Skill Is

Each skill is a folder under `assets/workspace/.nbook/agent/skills/<folder>` or the user overlay `workspace/.nbook/agent/skills/<folder>`.

Required file:

```text
<folder>/
└── SKILL.md
```

Optional resources:

```text
<folder>/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

- `scripts/`: executable helpers when deterministic or repetitive work is useful
- `references/`: detailed documentation that should be read only when needed
- `assets/`: templates, images, sample files, or other output resources

Do not create extra process documentation such as `README.md`, `CHANGELOG.md`, or onboarding notes unless the user explicitly asks for them.

## Frontmatter Rules

The current runtime only needs:

```yaml
---
name: your-skill-name
description: Explain what the skill does and when it should be used.
---
```

Rules:

- `name` must be usable as `$name`
- `name` may be English or Chinese
- `name` must not contain spaces
- prefer short names because the user may type them in the editor
- `description` is the main trigger hint, so include both capability and usage context

Good `description` fields mention:

- what the skill helps with
- which task patterns should trigger it
- any domain, artifact, or workflow constraints that matter

Bad `description` fields are generic labels such as "Helper skill" or "Writing support".

## Creation Workflow

Follow this order unless the user explicitly asks for something narrower.

1. Understand the concrete task the skill should help with.
2. Decide what belongs in `SKILL.md` versus `references/`, `scripts/`, or `assets/`.
3. Create or update the skill folder under `workspace/.nbook/agent/skills` for user changes, or `assets/workspace/.nbook/agent/skills` when explicitly changing the system baseline.
4. Write concise frontmatter and a focused `SKILL.md` body.
5. Add helper resources only when they directly reduce repeated work.
6. Validate the structure manually or with `scripts/quick_validate.py` if shell execution is available.

## How To Decide The Structure

Keep `SKILL.md` short and procedural. Put only the information that another agent needs immediately after the skill is activated.

Use `references/` when:

- the material is long
- only part of it is needed for a given task
- the agent should selectively read deeper material

Use `scripts/` when:

- the same transformation would otherwise be rewritten repeatedly
- a deterministic helper is better than free-form text instructions
- the future shell-enabled workflow should have a ready-made utility

Use `assets/` when:

- the skill needs templates or example output artifacts
- the file should be copied or adapted rather than read into context

## Writing Guidelines

Write the body as instructions for another agent, not for a human reader.

- use imperative wording
- prefer short sections over long essays
- explain decisions that are non-obvious
- link directly to specific `references/...` files when deeper reading is needed
- avoid duplicating the same detail in both `SKILL.md` and `references/`

When a skill supports multiple modes or variants, keep the routing logic in `SKILL.md` and move variant-specific detail into `references/`.

## Default Location

Unless the user asks otherwise, create new skills in:

```text
workspace/.nbook/agent/skills/<folder>
```

If shell execution is available, `scripts/init_skill.py` can generate a starter folder there. If shell execution is not available, create the files manually with the same structure.

## Optional Helper Scripts

This skill includes two helper scripts:

- `scripts/init_skill.py`: generate a new Neuro Book skill skeleton
- `scripts/quick_validate.py`: run lightweight validation against the current project rules

These scripts are optional accelerators. Do not block on them if the environment cannot execute shell commands.

## Manual Validation Checklist

If you cannot run the validator, check these points manually:

- the skill folder lives under `workspace/.nbook/agent/skills` or `assets/workspace/.nbook/agent/skills`
- `SKILL.md` exists
- frontmatter contains only `name` and `description`
- `name` can be typed as `$name` without spaces
- `description` clearly states when the skill should be used
- `SKILL.md` does not mention outdated Codex-specific paths or metadata files
- optional `references/`, `scripts/`, and `assets/` directories are only present when they are actually useful

## When Updating An Existing Skill

When modifying an existing skill:

- preserve the intent of the original skill unless the user asks to reposition it
- tighten vague trigger descriptions
- remove outdated instructions that no longer match the current repo
- avoid adding speculative structure that the project does not consume yet

If the existing skill contains project-irrelevant residue, remove it instead of explaining around it.
