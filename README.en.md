# NeuroBook

[中文](README.md) | English

[![GitHub Release](https://img.shields.io/github/v/release/notnotype/neuro-book?include_prereleases&label=release)](https://github.com/notnotype/neuro-book/releases)
[![GHCR App](https://img.shields.io/badge/GHCR-neuro--book-8957e5?logo=github&label=app)](https://github.com/notnotype/neuro-book/pkgs/container/neuro-book)
[![Bun](https://img.shields.io/badge/runtime%20%2B%20build-Bun-000000?logo=bun)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

NeuroBook is a Nuxt-based IDE for long-form novel writing and AI roleplay. It is author-led and integrates a file-based Project Workspace, Markdown Studio, story structure management, and domain-specific Agent systems for long-form writing, world simulation, AI RP, and SillyTavern character card migration.

The runtime is extended from the Pi framework and reuses core abstractions such as multi-provider model access, tool calling, and an append-only session tree. NeuroBook builds NeuroAgentHarness on top of that foundation. It also introduces Profile, TSX Profile, and Sidecar Context so Agents can build searchable, reviewable, memorable, and maintainable workflows around novel writing and roleplay.

<div style="display: flex; justify-content: space-between;">
  <img src="./docs/images/主页.png" width="31%"/>
  <img src="./docs/images/剧本工作台.png" width="31%"/>
  <img src="./docs/images/TSX可视化编辑器.png" width="31%"/>
</div>
<br/>

> Demo site: http://8.148.4.22:3001/

## Core Features

- **Long-form novel IDE**: Manage `lorebook/`, `manuscript/`, `simulation/`, `reference/`, and project configuration through Project Workspace, so settings, prose, state, and external materials can be maintained by both authors and Agents.
- **Domain-specific Agent design**: Writing and RP responsibilities are split across leader, writer, retrieval, researcher, simulator leader, actor, rp.writer, and related roles, instead of forcing retrieval, arbitration, writing, and memory maintenance into one model call.
- **NeuroAgentHarness**: Built on Pi-style multi-provider access, tool calling, and append-only session trees, with support for Multi-Agent collaboration, HITL (Human-in-the-Loop), runtime Profile / Tool Catalog, context compaction, session summaries, lifecycle management, and Runtime Hooks.
- **Profile**: Defines Agent behavior boundaries, including tool allowlists, input / output schemas, system prompts, dynamic context, compaction policy, summary policy, and Runtime Hooks.
- **TSX Profile**: Uses TSX as a context template language. Nodes such as System, History, Dynamic Context, Reminder, Import, and SkillCatalog describe context structure while keeping templates type-safe, previewable, and friendly to low-code editing.
- **Sidecar Context**: Forks runtime-only branches before or after a main Agent run for retrieval, reflection, memory maintenance, or state cleanup. Sidecar transcripts do not enter the main history; only the processed result is merged back into the main line.
- **SillyTavern character card migration**: Supports the `inspect -> unpack -> import` flow, preserves original cards and worldbook archives, migrates stable setting material into lorebook, and keeps dynamic mechanism material available for later RP / simulation migration.

## Quick Selection

| Option | Best for | Notes |
| --- | --- | --- |
| Windows Product Portable | Regular Windows users | Unzip and start; includes Bun and a prebuilt Product Payload. |
| Product Bun | Local machines or servers that already have Bun | Start from an unpacked Product Payload with Bun; source code and root `node_modules` are not required. |
| ghcr | Low-memory servers | Pull the prebuilt Docker image; the server does not run a Nuxt build. |
| Source Dev | Developers | Source checkout, local dependency install, development, and tests. |

If unsure: Windows users should choose Product Portable; servers should prefer `ghcr` or Product Bun.

## Windows Product Portable

Download the Windows x64 zip from [GitHub Releases](https://github.com/notnotype/neuro-book/releases), unzip it into a new directory, and run:

```powershell
.\Start Neuro Book.cmd
```

The package already includes the prebuilt `app/` Product Payload and `runtime/bun/`. On first start, it initializes `data/`, runs SQLite migrations, and guides administrator creation if no user exists. It does not clone source code, install dependencies, or run a Nuxt build.

To update, run:

```powershell
.\Update Neuro Book.cmd
```

The updater lists available GitHub Releases that include Windows packages, including stable and canary releases. After you choose a target version, it downloads the zip, verifies `SHA256SUMS`, preserves `data/`, and switches to the new `app/`, `launcher/`, and root startup scripts. The bundled `runtime/bun/` keeps the current version to avoid replacing a running `bun.exe`.

Directory boundaries:

- `app/`: replaceable Product Payload.
- `data/`: runtime state preserved during upgrades, including `workspace/`, `.env`, `config.yaml`, and the SQLite database.
- `launcher/`: Windows Launcher.
- `runtime/bun/`: bundled Bun runtime.

## Product Bun

Product Bun is for local machines or servers that already have Bun. On the build machine, generate the Product Payload:

```bash
bun run nuxt:build
bun run product:stage
```

On the runtime machine, start from the Product Root:

```bash
cd product
bun .output/server/scripts/deploy/product-start.mjs
```

## local-git

`local-git` remains as a transitional source deployment mode for users who are comfortable with the command line and want to follow source updates:

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```

The script asks for the deployment directory, port, and deployment mode. `local-git` clones or pulls source code on the host, installs dependencies, builds the app, runs SQLite migrations, and generates startup instructions in `.deploy/README.md`.

You can also clone the repository and run:

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
bun scripts/deploy/neuro-book-deploy.mjs --deploy-mode local-git
```

## ghcr

Recommended for Docker deployments where the server should not run a Nuxt build:

```bash
bunx --bun --package github:notnotype/neuro-book neuro-book-deploy
```

Choose `ghcr` as the deployment mode. The script uses the prebuilt image:

```text
ghcr.io/notnotype/neuro-book:latest
```

Data, configuration, and Project Workspace remain in the host-mounted `workspace/` directory.
The GHCR image keeps the source directory for troubleshooting, but the app runner uses the Bun runtime. Service startup, SQLite migrations, and administrator scripts all use prebuilt `.output/server/scripts/**` files inside the image. The server and container do not install dependencies or require root `node_modules` at startup.

## Source Dev

Recommended for development servers or Docker deployments that need a mounted source tree:

```bash
git clone https://github.com/notnotype/neuro-book.git
cd neuro-book
bun scripts/deploy/neuro-book-deploy.mjs --deploy-mode source
```

`source` mode builds the runtime container and mounts the host project directory to `/app` in the container. The host still needs dependencies installed and the app built. Prefer `ghcr` for low-memory servers.

## Administrator And Model Configuration

Full-site authentication is enabled by default. Windows Product Portable guides administrator creation on first start. For source deployments, create an administrator manually from the app directory when needed:

```powershell
bun run auth:create-admin admin
```

The script hides password input. Do not pass the password as a command argument.

Model Provider, API Key, default model, and Agent Profile model overrides are configured in the frontend settings page. Long-term configuration is saved in:

```text
workspace/.nbook/config.json
```

This file is local runtime state. Do not commit it to Git.

## Local Development

```bash
bun install
bun run dev
```

Common commands:

```bash
bun run typecheck
bun run test
bun run docs:dev
bun run docs:build
```

## Documentation

Most documentation is currently in Chinese.

- [Chinese documentation home](docs/index.md)
- [Quick start](docs/quick-start.md)
- [Deployment](docs/deployment.md)
- [Tutorials](docs/tutorials/index.md)
- [Agent mental model](docs/agent/index.md)
- [Profile introduction](docs/profile/index.md)
- [Profile TSX introduction](docs/profile-tsx/index.md)
- [Sidecar Context](docs/agent/sidecar.md)
- [NeuroBook Reference Bookshelf](reference/README.md)
- [PROJECT-STATUS.md](PROJECT-STATUS.md)

If you want another Agent to help with deployment, updates, or troubleshooting, send it [docs/operator-bridge.md](docs/operator-bridge.md) first.

## License

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify, and share the software for noncommercial purposes.

Commercial use requires prior written permission from the copyright holder. Personal authors may use NeuroBook to create, edit, and publish their own original works, including commercially published writing. The commercial restriction applies to commercial use of the software itself, not to the user's original creative output.

## Star History

<a href="https://www.star-history.com/?repos=notnotype%2Fneuro-book&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left" />
 </picture>
</a>
