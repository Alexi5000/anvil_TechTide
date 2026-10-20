# Anvil

**Anvil** is a desktop IDE for parallel agent work: isolated worktrees, first-class planning, a full terminal and file-editing surface, and visibility into agent and sub-agent activity.

> More agents, less pain.

Anvil is designed for developers who want to run multiple agent sessions without losing track of repository state, approvals, plans, or worktree ownership.

## Why this fork exists

**What it does.** Anvil is a Tauri 2 desktop application (Rust shell in `src-tauri/`, React
frontend in `src/`) that runs several coding-agent sessions side by side, each in its own git
worktree, with a terminal, file editor, diff view, plan and approval state, and a sidecar process
(`sidecar/`) that manages agent lifecycle and reads Claude Code hook transcripts.

**Who it serves.** A developer or operator running more than one agent session on the same
repository who needs to see which agent owns which branch, what each one is doing, and when one
of them is waiting for human input.

**Why Alex forked it.** The fork was created on 2026-03-26 (GitHub API `created_at`). The
earliest fork-authored commit is `0c3dbaa` (2026-05-21, branch `techtide/build-out`, "docs: add
TechTide backstory and upstream contribution log"), which records the reason: "Client teams
running 5+ Claude agents in parallel need an IDE that understands worktrees and agent state.
Terminal multiplexers don't track which agent is doing what, which branch each agent is on, or
whether an agent needs human input." The same document calls Anvil "the control surface we
needed for multi-agent deployments." On 2026-06-23 the fork added a contributing guide, issue
and PR templates, and a `TauriFSAdapter.glob` implementation, submitted upstream as
zdenham/anvil PRs [#2](https://github.com/zdenham/anvil/pull/2),
[#3](https://github.com/zdenham/anvil/pull/3), and [#4](https://github.com/zdenham/anvil/pull/4)
(all still open upstream as of 2026-10-20). The first commits on this fork's `main`
(2026-08-16, `e77b669` through `2451f73`) added a verified quickstart, an application smoke
suite, and the CI quality workflow; 2026-10-18 to 10-20 added 16 merged security and test-isolation
PRs (#1 to #16; see Upstream below).

**Real-world use case (2025-2026 evidence).** **Proposed use case.** A maintainer opens one
repository in Anvil, starts three agent threads on three worktrees (a bug fix, a refactor, and a
test backfill), and uses the thread list and plan state to decide which diff to review next and
which agent is blocked on a question. The desktop shell is built on Tauri 2, whose 2.12 release
(September 2026) raised the minimum Rust version to 1.90 and added a webview permission request
handler; this repository pins `tauri 2.12.4` in `src-tauri/Cargo.toml`[^1]. The human checkpoint
is the point: in the 2025 Stack Overflow Developer Survey, 84% of respondents use or plan to use
AI tools, but 46% distrust the accuracy of AI output and 76% do not plan to hand deployment and
monitoring to AI[^2]. Anthropic's 2025 engineering write-up on multi-agent systems makes the
same case from the builder's side, noting that coding tasks have fewer truly parallelizable
pieces than research and that agents "are not yet great at coordinating and delegating to other
agents in real time"[^3]. What this repository verifies today is narrower than the scenario:
the smoke suite, sidecar, agents, and gateway regression tests run in CI (`.github/workflows/quality.yml`).
No customer deployment, throughput figure, or demo outcome is claimed.

[^1]: Tauri team, "Announcing Tauri 2.12", v2.tauri.app, published 2026-09-26. https://v2.tauri.app/blog/tauri-2.12/
[^2]: Stack Overflow, "2025 Developer Survey: AI", published 2025. https://survey.stackoverflow.co/2025/ai
[^3]: Anthropic Engineering, "How we built our multi-agent research system", published 2025-06-13. https://www.anthropic.com/engineering/multi-agent-research-system

## Upstream

- Upstream: [zdenham/anvil](https://github.com/zdenham/anvil), licensed MIT. This fork keeps the
  same license; the `LICENSE` file is unchanged and the fork is not relicensed.
- Fork created: 2026-03-26.
- Divergence as of 2026-10-20: 20 commits ahead and 0 commits behind upstream `main`
  (`gh api repos/Alexi5000/anvil_TechTide/compare/zdenham:main...Alexi5000:main`); 254 files
  changed, +71,221 / -10,356 lines against the merge base (`git diff --stat upstream/main...origin/main`).

**What changed in this fork** (from `git log upstream/main..origin/main`):

- 2026-08-16: verified quickstart and quality-gate docs, application smoke tests
  (`pnpm test:smoke`), and the GitHub Actions quality workflow (4 commits).
- 2026-10-18 to 10-20: 16 merged security and test-isolation PRs (#1 to #16): dependency refresh with a validated macOS
  build, vendored and verified `node-forge` and `braces` archives under `vendor/` (see Security),
  patched `plist`, `flamegraph`, and Tauri plugin dependencies, confinement of sidecar thread and
  HTTP file-preview paths, atomic persistence of agent and runner state, authenticated gateway
  devices with signed webhook delivery, hook transcripts restricted to recorded Claude sessions,
  and isolated temporary directories for test fixtures.

Branches `pr/add-contributing-guide`, `pr/add-issue-templates`, and `pr/implement-tauri-fs-glob`
hold the upstream submissions listed above; `techtide/build-out` holds the backstory document.

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
pnpm lint:ci
pnpm typecheck
pnpm test:smoke
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

Claude TUI hook transcripts are read only from the launched CLI configuration directory: `CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects` when unset. Set an absolute `CLAUDE_CONFIG_DIR` on the sidecar before starting it when using a custom Claude configuration. TUI launch inherits that same environment. Hook session IDs must match the thread's recorded session and transcript filename; arbitrary files, final symlinks, nonregular files, and paths escaping the configured transcript root are rejected. General transcript parser APIs remain available for trusted callers.

The sidecar HTTP `/files` endpoint requires both authentication and a server-configured file allowlist. Before starting the sidecar, set `ANVIL_FILE_ROOTS` to a JSON array of absolute workspace directories and `ANVIL_SELECTED_FILES` to a JSON array of individual absolute file paths that may be previewed outside those workspaces. For example, `ANVIL_FILE_ROOTS='["/home/alex/projects/app"]'`. Restart the sidecar after changing either variable. Empty lists deny HTTP file previews by default. Use canonical paths; symlinks escaping the allowlist are denied. Native Tauri asset access and WebSocket filesystem commands are separate interfaces and are not restricted by these HTTP settings.

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
pnpm lint:ci           # deterministic ESLint gate for the CI smoke surface
pnpm typecheck         # strict TypeScript check
pnpm test:smoke        # focused Vitest application smoke suite
pnpm build:ci          # workspace/frontend build for CI
pnpm verify:web        # validate an existing dist-web build
pnpm test:e2e:critical # optional browser smoke tier; needs backend prerequisites
```

GitHub Actions runs the required build, lint, type-check, and smoke-test gates on pushes and pull requests. The broader existing `pnpm lint` and `pnpm test` commands remain available for local legacy-suite work; the CI baseline deliberately uses the deterministic smoke surface while existing repository-wide lint and test debt is addressed. The critical Playwright suite is intentionally documented as an optional local or dedicated environment check because its end-to-end agent flow requires the Rust WebSocket backend, a configured repository, and, for live responses, an `ANTHROPIC_API_KEY`.

## Security

Known upstream advisory with no fixed release as of 2026-10-20:

- **node-forge, [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)**
  (CVE-2026-85393, high: RSA PKCS#1 v1.5 signature verification accepts extra nested
  DigestAlgorithm elements). The advisory lists all versions up to and including 1.4.0 as
  affected and no patched version (published 2026-09-03, updated 2026-10-01). `node-forge` is a
  direct dependency of `agents/package.json`, so an `npm audit` override is not viable: there is
  no fixed version to resolve to. Existing mitigation in this repository: PR #3 (`2be24b6`,
  2026-10-18) replaced the registry package with `vendor/node-forge-1.4.0.tgz`, which is upstream
  1.4.0 plus the narrowly scoped fix proposed in digitalbazaar/forge#1152
  (`vendor/node-forge/upstream.patch`, `vendor/node-forge/integrity.json`), and
  `scripts/verify-forge.cjs` runs in `pnpm build:ci` and in the `agents` build to fail on any
  unpatched copy. Because the package name and version stay `node-forge@1.4.0`, GitHub still
  reports one open Dependabot alert on `agents/package-lock.json`; it is intentionally not
  dismissed and will be closed by moving to a released upstream fix.
- `braces` is handled the same way (`vendor/braces-3.0.3.tgz`, `scripts/verify-braces.cjs`);
  it has no open alert on this repository.

For sensitive security reports, use GitHub's private vulnerability reporting for this
repository when available. Do not publish API keys, private repository contents, customer data,
or production logs in issues.

## Support and contribution path

For a reproducible bug, open an issue with the operating system, Node and pnpm versions, the exact command, logs, and whether the issue reproduces in `pnpm test:smoke` or `pnpm build:ci`. For feature proposals, describe the developer workflow being improved and the smallest useful behavior.

General project discussion and product feedback can be routed through the [TechTide AI organization profile](https://github.com/TechTideOhio). See Security above for vulnerability reports.

## License

Anvil is distributed under the [MIT License](./LICENSE).
