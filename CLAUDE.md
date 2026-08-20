# Worktree Manager

Electron + React (renderer) monorepo. Packages: `@worktree/contracts` (zod schemas/types),
`@worktree/shared` (git + status logic, runs in the main process), `@worktree/desktop` (Electron app).

## Running & building

This environment exports `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary run as plain
Node — so `require('electron').app` is `undefined` and the app crashes with
`Cannot read properties of undefined (reading 'setName')`. Always launch Electron with that var
stripped: prefix commands with `env -u ELECTRON_RUN_AS_NODE`.

- Typecheck everything: `npm run typecheck`
- Build everything: `npm run build`
- Package macOS release (arm64 only): `cd apps/desktop && npm run dist`
- Dev (hot-reload renderer + main): `cd apps/desktop && env -u ELECTRON_RUN_AS_NODE npx electron-vite dev`
- Run the built app: `cd apps/desktop && env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron dist-electron/main/index.cjs`
- Launch the _installed_ app the same way — `open -a "Worktree Manager"` forwards
  `ELECTRON_RUN_AS_NODE` too, so it exits silently unless you use
  `env -u ELECTRON_RUN_AS_NODE open -a "Worktree Manager"`.
- Verify against a throwaway profile instead of the user's: add
  `--user-data-dir=/tmp/wt-verify` and seed `/tmp/wt-verify/config/{settings,repositories,worktrees}.json`
  (copy a couple of entries from the real config, minus tokens). Their live app can keep running.
- Screenshot the running app (macOS): focus its window, then `screencapture -o -x /tmp/shot.png`
- Drive the running app (agent-browser via CDP): launch with `--remote-debugging-port=9222`, then
  `agent-browser connect "$(curl -s localhost:9222/json/list | python3 -c "import sys,json;print(next(t['webSocketDebuggerUrl'] for t in json.load(sys.stdin) if t['type']=='page'))")"`.
  Connect to the **page** websocket, not the bare port (the port target is a blank page).
  `Page.captureScreenshot` with `captureBeyondViewport: true` does return real pixels (and beats
  `screencapture`, which catches whatever window is on top instead). Heads-up: if the user is testing the app at the same time,
  your clicks fight theirs — ask or hold off rather than driving it out from under them.

Gotcha: plain `npm run dev` (turbo → bun) inherits `ELECTRON_RUN_AS_NODE` and fails the same way —
use the `env -u` dev command above instead.

## Architecture notes

- Git/worktree logic lives in `packages/shared/src` (`git.ts`, `status.ts`, `worktree.ts`) and only
  runs in the **main** process. The renderer reaches it through IPC.
- Adding a main→renderer capability touches four places: `packages/shared` (logic) →
  `apps/desktop/src/main/index.ts` (`ipcMain.handle`) → `apps/desktop/src/preload/index.ts`
  (typed wrapper) → renderer call via `window.api` / `src/renderer/src/api.ts`.
- Worktree `branch`/`headCommit` are captured at scan time and persisted; live git state
  (branch, HEAD, detached) is refreshed per-load in `getWorktreeStatus` — prefer the status
  values in the UI so labels don't go stale.
- Colors are CSS variables in `src/renderer/src/index.css` (`--color-*`, per theme). Raw Tailwind
  palette colors (e.g. `fuchsia-500`, `amber-400`) are used directly where a semantic token
  doesn't exist.

When changes are done, reinstall the app (in mac the arm version)
