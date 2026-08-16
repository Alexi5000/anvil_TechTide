# Anvil

**Anvil** is a desktop IDE for parallel agent work: isolated worktrees, first-class planning, a full terminal and file-editing surface, and visibility into agent and sub-agent activity.

> More agents, less pain.

Anvil is designed for developers who want to run multiple agent sessions without losing track of repository state, approvals, plans, or worktree ownership.

## Quickstart

The commands below are the verified repository workflow for installing dependencies, checking the codebase, running the application test suite, and building the web-capable frontend.

### Prerequisites

Use **Node.js 22 or newer**, **pnpm 11 or newer**, and Git. The desktop distribution also requires the native toolchain documented by [Tauri](https://tauri.app/start/prerequisites/), including Rust and the platform-specific desktop dependencies. A web build can be validated without launching the native desktop shell.

### Install and validate

```bash
git clone https://github.com/Alexi5000/anvil_TechTide.git
cd anvil_TechTide

corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build:ci
```

`pnpm build:ci` runs the frontend and workspace build path without invoking the macOS-only packaging step. For a full local desktop package on a supported platform, run `pnpm build` after installing the native prerequisites.

### Use the application

For web development and a browser-accessible preview:

```bash
pnpm web:dev
```

For the normal desktop development loop on a configured native machine:

```bash
pnpm dev
```

The application is intended to be used with an agent runtime and one or more repositories configured as worktrees. API credentials and private service configuration belong in local environment or secret management, never in commits. See [`.env.example`](./.env.example) for the documented variable names used by the repository.

## What Anvil provides

| Capability | Why it matters |
| --- | --- |
| Isolated workspaces | Run parallel agent tasks without forcing every session onto one branch or working directory. |
| Planning and lifecycle controls | Keep agent intent, progress, approvals, and completion state visible instead of relying on terminal history. |
| Full IDE surface | Combine terminal work, file editing, diffs, repository navigation, and agent output in one desktop workflow. |
| REPL and orchestration | Compose agent workflows and expose child-agent activity for inspectable multi-agent execution. |
| Flexible layout | Arrange multiple active threads and panels around the way a project is actually being debugged. |

## Repository map

The repository is a pnpm workspace with the desktop frontend at the root, reusable agent packages under `agents`, shared runtime code under `core`, a server under `server`, a sidecar under `sidecar`, and database migration tooling under `migrations`.

| Path | Role |
| --- | --- |
| `src/` | Desktop and web frontend application code. |
| `core/` | Shared state, services, adapters, SDK, and domain utilities. |
| `agents/` | Agent runners, hooks, orchestration, and agent-side tests. |
| `server/` | Optional server and migration entry points. |
| `sidecar/` | Local sidecar process used by the desktop workflow. |
| `e2e/` | Playwright critical, core, and comprehensive browser tests. |
| `scripts/` | Setup, build, web verification, and distribution helpers. |

## Quality gates

The repository exposes explicit checks for the main quality dimensions:

```bash
pnpm lint              # ESLint for src and core
pnpm typecheck         # strict TypeScript check
pnpm test              # Vitest unit and integration tests
pnpm build:ci          # workspace/frontend build for CI
pnpm verify:web        # validate an existing dist-web build
pnpm test:e2e:critical # optional browser smoke tier; needs backend prerequisites
```

GitHub Actions runs the required build, lint, type-check, and test gates on pushes and pull requests. The critical Playwright suite is intentionally documented as an optional local or dedicated environment check because its end-to-end agent flow requires the Rust WebSocket backend, a configured repository, and, for live responses, an `ANTHROPIC_API_KEY`.

## Support and contribution path

For a reproducible bug, open an issue with the operating system, Node and pnpm versions, the exact command, logs, and whether the issue reproduces in `pnpm test` or `pnpm build:ci`. For feature proposals, describe the developer workflow being improved and the smallest useful behavior.

Do not publish API keys, private repository contents, customer data, or production logs in issues. For sensitive security reports, use GitHub’s private vulnerability reporting for this repository when available. General project discussion and product feedback can be routed through the [TechTide AI organization profile](https://github.com/TechTideOhio).

## License

Anvil is distributed under the [MIT License](./LICENSE).
