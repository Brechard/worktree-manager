import { existsSync } from 'node:fs'
import { commandEnv, runShellCommand, type CommandContext, type CommandOutcome } from './command.js'

export type CleanupContext = CommandContext
export type CleanupOutcome = CommandOutcome

/**
 * Run a project's pre-delete hook for one worktree.
 *
 * Runs through the user's login shell (see `runShellCommand`) with the worktree
 * as the working directory — the project's working subdirectory deliberately
 * does not apply here, so a hook written against `docker/.env` keeps finding it.
 *
 * The worktree is still on disk when this runs, so a hook can read per-worktree
 * config to find out what it needs to tear down.
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

  return runShellCommand(trimmed, {
    cwd,
    env: commandEnv(context),
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
  })
}
