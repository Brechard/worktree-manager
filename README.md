# Worktree Manager

A cross-platform desktop app for managing git worktrees. Inspired by [t3code](https://github.com/pingdotgg/t3code/).

## Features

- Auto-discover git repositories and their linked worktrees.
- See at a glance which worktrees are dirty, ahead/behind, unmerged, or safe to delete.
- Open worktrees in your editor or terminal.
- Link GitHub / Azure DevOps pull requests to branches.
- Per-project base branch configuration.

## Tech Stack

- Bun workspaces + Turbo
- Electron + Vite + React + TypeScript
- Tailwind CSS
- `packages/shared` and `packages/contracts` monorepo layout

## Development

```bash
bun install
bun dev
```

## Build

```bash
bun run build
bun run dist
```

## License

MIT
