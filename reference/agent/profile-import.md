# Profile Import Node

`Import` is a TSX Profile DSL string fragment. Profile authors use it to load shared text files into a profile prompt without copying long protocol text into each profile.

`Import` is explicit, not automatic. A profile only receives files that the profile author declares.

## API

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

Supported props:

| Prop | Required | Meaning |
| --- | --- | --- |
| `path` | Yes | Repo / app root relative path. |
| `heading` | No | Markdown heading text. When set, only that heading section is imported. |
| `maxBytes` | No | Positive UTF-8 byte limit. Truncated imports are marked before the fenced block. |
| `required` | No | Missing files default to empty output. When `true`, missing files throw. Missing headings still throw by default; set `false` to make missing headings empty too. |
| `label` | No | Reserved compatibility prop. Current fenced output does not display it. |
| `as` | No | Future extension point. V1 only supports `text`. |

Rendered text is a Markdown fenced block whose info string is the imported path:

```text
```reference/agent/project-workspace-guide.md
...
```
```

If `maxBytes` truncates the import, a short marker is placed before the block:

```text
[Import truncated: reference/agent/project-workspace-guide.md maxBytes=12000]
```reference/agent/project-workspace-guide.md
...
```
```

## Placement

Recommended placement:

- Stable shared references: `HistorySet > Message > Import`.
- Temporary or run-specific context: do not use `Import`; use profile initial, variables, runtime reminders, sidecars, or file tools instead.
- System identity and profile-specific behavior should remain in `<System>`.

`Import` can be used anywhere a string fragment is valid, including `<System>` and `<Message>`. For long project specs, prefer `HistorySet` so the content becomes the initial stable prompt prefix.

## Safety Boundary

V1 only allows these roots:

- `AGENTS.md`
- `reference/**`
- `docs/**`

The path must be relative. Absolute paths, URL-like paths, empty paths and `..` traversal are rejected.

`Import` is not a replacement for runtime file tools. Do not use it to read Project Workspace files such as `lorebook/...`, `manuscript/...`, `simulation/...`, or user scratch files. Project content should be read by the agent using its permitted tools, or injected through profile/runtime mechanisms with explicit information-control rules.

## Build Contract

Build and release artifacts that run compiled profiles must include the files allowed above. The current build patch copies `AGENTS.md`, `reference/` and `docs/` into `.output/server/` so imports still work when the runtime cwd is the compiled server output.
