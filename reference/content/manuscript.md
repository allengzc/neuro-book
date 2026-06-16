# Manuscript Directory

`manuscript/` stores formal prose, volumes, chapters, drafts and chapter-local notes.

## Default Shape

```text
manuscript/
`-- 001-volume/
    |-- index.md
    `-- 001-chapter/
        |-- index.md
        |-- notes.md
        `-- drafts/
```

## Rules

- Chapter prose belongs in chapter `index.md`.
- Volume `index.md` can store volume title, summary and author notes.
- Chapter-local drafts, notes and temporary lore summaries can live beside the chapter.
- `lorebook-notes.md` or `lorebook-notes/` are temporary writing aids, not lorebook replacements.
- Plot assignment uses Plot System `chapterPath`, which should persist as Project Workspace relative `manuscript/.../`.

## Path Contract

Common path forms:

| Context | Path |
| --- | --- |
| Agent file tools | `{project}/manuscript/001-volume/001-chapter/index.md` |
| `writer` `invoke_agent.input.path` | `{project}/manuscript/001-volume/001-chapter/index.md` |
| Plot stored `chapterPath` | `manuscript/001-volume/001-chapter/` |
| Markdown link from nearby node | relative link such as `../001-chapter/` |

When a manuscript path changes, relative Markdown links may break. Validate affected content nodes after path edits.

## Boundary

Use `manuscript/` for reader-facing or author-facing prose drafts. Do not store stable world canon here unless it is part of the written text. Stable extracted facts should be curated into `lorebook/`.
