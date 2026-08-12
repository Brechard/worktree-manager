/**
 * The whole-project catch-up offered on the primary worktree once the base has
 * moved on: go back to the base branch, pull it, then replay every other
 * worktree onto it. Only the primary row gets this — it is the one worktree
 * whose job is to sit on the base, and the sweep is a project-level operation.
 */
export interface ProjectCatchUp {
  /** The project's local base branch is behind (or diverged from) origin. */
  baseOutdated: boolean
  /** Worktrees, other than the primary, the sweep would sync. */
  worktreeCount: number
  /** The sweep is running right now. */
  running: boolean
  run: () => void
}

/**
 * How the catch-up presents itself, given where the primary worktree currently
 * sits. Shared so the row's button and the git menu's entry describe the same
 * operation in the same words.
 */
export function describeCatchUp(
  branch: string,
  baseBranch: string,
  worktreeCount: number
): { label: string; steps: string[] } {
  const onBase = branch === baseBranch
  return {
    label: onBase ? `Update ${baseBranch} & all worktrees` : `Back to ${baseBranch} & update all`,
    steps: [
      onBase ? undefined : `checkout ${baseBranch}`,
      'pull',
      worktreeCount > 0
        ? `sync ${worktreeCount} worktree${worktreeCount === 1 ? '' : 's'}`
        : undefined,
    ].filter((step): step is string => step !== undefined),
  }
}
