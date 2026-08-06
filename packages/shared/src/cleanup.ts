import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Ten minutes: pulling down a Docker stack with volumes is not quick. */
const DEFAULT_TIMEOUT_SECONDS = 600

export interface CleanupContext {
  /** The worktree being deleted. Used as cwd when it still exists. */
  worktreePath: string
  branch?: string
  /** The repository's main checkout — the fallback cwd for a missing worktree. */
  repoPath: string
  repoName?: string
}

export interface CleanupOutcome {
  success: boolean
  output: string
  exitCode?: number
  timedOut?: boolean
}

/**
 * Run a project's pre-delete hook for one worktree.
 *
 * Runs through the user's login shell so the command can be written the way it
 * would be typed in a terminal — pipes, `$(…)`, and a PATH that actually has
 * `docker` on it. Electron apps launched from Finder inherit a bare PATH, so a
 * plain `docker compose …` would otherwise fail with "command not found" for
 * exactly the users who never start the app from a terminal.
 *
 * The worktree is still on disk when this runs, so a hook can read per-worktree
 * config (`docker/.env`) to find out what it needs to tear down.
 */
export async function runPreDeleteCommand(
  command: string,
  context: CleanupContext,
  timeoutSeconds?: number
): Promise<CleanupOutcome> {
  const trimmed = command.trim()
  if (!trimmed) return { success: true, output: '' }

  // A missing worktree (a prunable ghost) has no directory to run in; fall back
  // to the repo so a hook can still clean up by branch name.
  const cwd = existsSync(context.worktreePath) ? context.worktreePath : context.repoPath
  if (!existsSync(cwd)) {
    return { success: false, output: `Neither the worktree nor ${context.repoPath} exists.` }
  }

  const timeout = Math.max(1, timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const shell = process.env.SHELL || '/bin/sh'

  return new Promise<CleanupOutcome>((resolve) => {
    execFile(
      shell,
      ['-lc', trimmed],
      {
        cwd,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          WORKTREE_PATH: context.worktreePath,
          WORKTREE_BRANCH: context.branch ?? '',
          REPO_PATH: context.repoPath,
          REPO_NAME: context.repoName ?? '',
        },
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr].map((s) => (s ?? '').trim()).filter(Boolean).join('\n')
        if (!error) {
          resolve({ success: true, output, exitCode: 0 })
          return
        }
        const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true
        const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code
        resolve({
          success: false,
          output: output || error.message,
          ...(typeof exitCode === 'number' ? { exitCode } : {}),
          ...(killed ? { timedOut: true } : {}),
        })
      }
    )
  })
}
