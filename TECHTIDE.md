# TechTide AI — Why This Fork Exists

## The Problem

Client teams running 5+ Claude agents in parallel need an IDE that understands worktrees and agent state. Terminal multiplexers don't track which agent is doing what, which branch each agent is on, or whether an agent needs human input. The overhead of managing parallel agent sessions manually kills the throughput gains.

## Why Anvil

Anvil gives operators a unified workspace for parallel agent work — lifecycle management, branch isolation via git worktrees, real-time status, and coordination. It's the control surface we needed for multi-agent deployments.

We use Anvil internally at TechTide as the primary interface for our agent orchestration workflows. When a project needs multiple Claude Code agents working in parallel across feature branches, Anvil is how the operator stays in control.

## What TechTide Uses This For

- **Multi-agent orchestration** — Running 4-8 Claude Code agents simultaneously with visual status tracking
- **Branch isolation** — Automatic worktree management so agents never collide on the same branch
- **Client demos** — Showing clients real-time agent progress during development sprints
- **Agent coordination** — Planning and spec distribution across parallel agents from a single interface

## Upstream Contributions

We contribute documentation and code improvements back to the upstream project:

| PR | Description |
|----|-------------|
| [#2](https://github.com/zdenham/anvil/pull/2) | Add CONTRIBUTING.md with setup, testing, and submission guide |
| [#3](https://github.com/zdenham/anvil/pull/3) | Add GitHub issue and PR templates |
| [#4](https://github.com/zdenham/anvil/pull/4) | Implement glob in TauriFSAdapter (resolves TODO) |

## Architecture Notes

Anvil is a Tauri 2 desktop application with:
- **Frontend** (`src/`): React 18 + TypeScript + Zustand + CodeMirror 6 + xterm.js
- **Backend** (`src-tauri/`): Rust (Tauri 2) with SQLite persistence
- **Core** (`core/`): Shared types, adapters, SDK, services
- **Sidecar** (`sidecar/`): Background process for agent management
- **Agents** (`agents/`): Agent workspace package

Key strengths:
- **Parallel-native**: Up to 4x3 grid layout for agent panels
- **Git-first**: Worktree integration for branch isolation
- **Desktop-native**: Tauri 2 with platform-specific optimizations (NSPanel on macOS)
- **204 test files**: Strong test coverage with Vitest + Playwright E2E

---

*This fork is maintained by [TechTide AI](https://github.com/TechTideOhio) as part of our agent orchestration infrastructure stack.*
