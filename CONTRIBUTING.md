# Contributing

Thanks for taking a look. Issues, bug reports and pull requests are all welcome.

## Getting set up

Requires [Bun](https://bun.sh) 1.3+ and Node 22+.

```bash
bun install
```

```bash
bun dev
```

`bun dev` starts Electron with the renderer hot-reloading. Changes to
`packages/shared` or `packages/contracts` need those packages rebuilt — run
`bun run build` or leave `bun dev` running at the root, which watches them.

## Before opening a pull request

```bash
bun run typecheck && bun run format && bun run build
```

CI runs the same three (with `format:check` instead of `format`), so a green local run
means a green PR.

## How the code is laid out

| Package              | What lives there                               |
| -------------------- | ---------------------------------------------- |
| `packages/contracts` | Zod schemas and the types both processes share |
| `packages/shared`    | Git and worktree logic — **main process only** |
| `apps/desktop`       | Electron main, preload, and the React renderer |

Git logic never runs in the renderer. Adding a capability that reaches git touches four
places, in order:

1. `packages/shared/src/*.ts` — the logic itself
2. `apps/desktop/src/main/index.ts` — an `ipcMain.handle` for it
3. `apps/desktop/src/preload/index.ts` — a typed wrapper on the bridge
4. `apps/desktop/src/renderer/src/api.ts` — the renderer-side call

[CLAUDE.md](CLAUDE.md) has the fuller architecture notes and the environment gotchas
(notably: `ELECTRON_RUN_AS_NODE` will make Electron exit silently — see that file).

## Conventions

- Colors come from the CSS variables in `apps/desktop/src/renderer/src/index.css`.
  Add a `--color-*` token rather than hard-coding a hex value.
- Anything that decides "is this worktree safe to delete" belongs in
  `worktreeSafetyReasons` in `packages/contracts` — both processes read it, and it drifted
  badly when each kept its own copy.
- Safety checks fail closed. If git can't be read, or a fetch failed, the answer is "not
  safe", never "probably fine".

## Reporting a bug

Include your OS, the app version (Settings shows it), and what git reported for the
worktree if it's a status-accuracy issue. A screenshot of the row usually says more than
a paragraph.
