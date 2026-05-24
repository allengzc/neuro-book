# Agent Tools Reference

## Overview

The agent tool layer maps internal `AgentTool` definitions to LangChain `DynamicStructuredTool` instances via `toLangChainTool()`. Every tool is registered in `AgentSystem.createDefault()`.

The schema metadata (tool `description` and field-level `.describe()`) is part of the **prompt contract** — the LLM reads it to understand how to invoke each tool. All model-facing text must be in English.

## Tool List

| Key | Purpose | Requires Args |
|-----|---------|---------------|
| `read_file` | Read a local text file with line numbers | Yes (filePath) |
| `write_file` | Create or overwrite a local text file | Yes (filePath, content) |
| `edit_file` | Replace a string in a local text file | Yes (filePath, oldString, newString) |
| `apply_patch` | Apply a Codex freeform patch | Yes (raw patch text) |
| `execute_shell` | Run a local shell command | Yes (command) |
| `execute_sql` | Run a single SQL statement | Yes (sql) |
| `update_novel` | Update the current novel's title/summary | Yes (title or summary) |
| `get_plot_tree` | Return the full plot tree | No |
| `get_story_thread` | Read a single story thread detail | No (optional threadId) |
| `get_story_scene_context` | Read scene context (scene + thread + chapter) | No (optional sceneId) |
| `get_chapter_plot` | Read scenes/plots in a manuscript chapter path | Yes (chapterPath) |
| `create_story_thread` | Create a new story thread | Yes |
| `update_story_thread` | Update a story thread | No (optional threadId) |
| `create_story_scene` | Create a new story scene | Yes |
| `update_story_scene` | Update a story scene | No (optional sceneId) |
| `create_story_plot` | Create a new plot under a scene | No (optional sceneId) |
| `update_story_plot` | Update a plot | Yes (plotId) |
| `create_subagent` | Create a subagent thread | Yes (profileKey) |
| `invoke_subagent` | Invoke a subagent and wait for result | Yes (subagentThreadId, input) |
| `list_subagents` | List attached subagents | No |
| `request_user_input` | Ask the user a structured question | Yes (question, options) |
| `report_result` | Submit final agent result | Yes (walkthrough) |

## Behavioral Boundaries

### File Tools (`read_file`, `write_file`, `edit_file`, `apply_patch`)

- **Read-before-write rule**: `write_file`, `edit_file`, and `apply_patch` require that `read_file` was called on the same file within the last 6 visible messages (enforced by `assertRecentlyReadResource()`).
- All paths must be within the project root.
- `edit_file` auto-strips line-number prefixes when the user pastes text from `read_file` output.
- `apply_patch` is a freeform Codex-style patch tool. The model passes raw patch text wrapped by `*** Begin Patch` / `*** End Patch`; it must not pass JSON, `{ path, patch }`, or `fuzzFactor`.

### SQL Tool (`execute_sql`)

- **Single statement only**: `;` characters are rejected.
- **Allowed commands**: SELECT, WITH, INSERT, UPDATE, DELETE.
- **Prohibited**: DDL, transaction control (BEGIN/COMMIT/ROLLBACK), session control, COPY, VACUUM, ANALYZE, GRANT, REVOKE, CALL, TRUNCATE.
- **Row limit**: `AGENT_SQL_ROW_LIMIT` (200 rows).
- **Timeout**: `AGENT_SQL_TIMEOUT_MS` (1500ms).
- **Identifier quoting**: Business table names with uppercase (e.g., `"Novel"`, `"StoryScene"`) and camelCase columns (e.g., `"novelId"`) must be double-quoted. System tables (`information_schema.*`) use standard lowercase.
- Read queries run in `BEGIN READ ONLY` transactions.

### Shell Tool (`execute_shell`)

- `workdir` must be within the project root.
- `timeoutMs` range: 1000–600000 (default 120000).
- stdout/stderr are truncated at `OUTPUT_LIMIT` (60,000 chars).
- On Windows, commands run via `powershell.exe`; on Unix, via `$SHELL` or `/bin/sh`.
- No sandboxing, privilege escalation, or permission policies in current version.

### Plot Tools

- When an entity ID (`threadId`, `sceneId`) is omitted, the tool falls back to the **currently selected entity in the IDE**.
- Chapter-scoped plot tools use `chapterPath`, for example `manuscript/001-volume/001-chapter/`. This is a workspace content-node path, not a database Chapter ID.
- If no selection exists in the IDE scope, the tool returns an error asking the caller to provide an explicit ID.
- `create_*` and `update_*` tools auto-sync the IDE selection to the created/updated entity.

### `request_user_input`

- Pauses the current agent run and dispatches a `waiting_user` status event.
- The UI presents the question with the provided options and waits for the user's answer.
- On answer, the agent run resumes with the selected option as the tool result.
- Options must be mutually exclusive; the recommended option should be listed first.
- `defaultOptionIndex` / `defaultOptionIndexes` preselect option indexes when the prompt opens. Option-level `defaultSelected: true` is also accepted.
- The UI always offers an additional free-form answer path for option questions, and an open text answer for questions without options.

## Tool Schema Authoring Spec

### Description Language

- `AgentTool.description` **must** be in English.
- Every field in the input schema **must** have `.describe(...)` with English text.
- Validation error messages (`.min()`, `.max()`, `ctx.addIssue()`) may remain in Chinese — they are shown to developers/operators, not the LLM.

### Schema Requirements

- **Non-empty input schemas**: Every field must have `.describe()`. The description should explain the field's purpose, format, and constraints.
- **Empty input schemas**: Use `z.object({})`. The tool `description` must explicitly state that the tool takes no arguments.
- **DTO reuse**: When a tool reuses an API DTO schema, the `.describe()` calls should be added to the shared DTO file (e.g., `shared/dto/plot.dto.ts`), not duplicated in the tool file.
- **Shared schema helpers**: `PlotEntityIdSchema`, `NovelTitleSchema`, etc. in `server/agent/tools/shared/` must have `.describe()` since they become part of multiple tool input schemas.

### Prohibited

- Do NOT use Zod v4 deprecated APIs: `.finite()`.
- Do NOT write Chinese in `.describe()` or tool `description`.
- Do NOT leave fields without `.describe()` in tool-facing schemas.
