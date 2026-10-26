import { getWorktreeStatus } from '@worktree/shared'
import type { PullRequestLookup, Repository, Worktree } from '@worktree/contracts'

type StatusOptions = Parameters<typeof getWorktreeStatus>[0]

/** Re-read local Git after the potentially slow provider lookup, without a second request. */
export async function recheckRemovalStatus(options: {
  worktree: Worktree
  repository: Repository
  baseSnapshot?: NonNullable<StatusOptions['baseSnapshot']>
  resolvePullRequest: (branch: string) => Promise<PullRequestLookup>
}) {
  const fresh = await getWorktreeStatus(options)
  const rechecked = await getWorktreeStatus({
    ...options,
    resolvePullRequest: async () =>
      fresh.prLookup ?? {
        state: 'error',
        checkedAt: Date.now(),
        error: { kind: 'unknown', message: 'Provider lookup was unavailable.' },
      },
  })
  const stable =
    rechecked.branch === fresh.branch &&
    rechecked.headCommit === fresh.headCommit &&
    rechecked.dirty === fresh.dirty &&
    rechecked.staged === fresh.staged &&
    rechecked.hasUntracked === fresh.hasUntracked &&
    rechecked.ahead === fresh.ahead &&
    rechecked.behind === fresh.behind &&
    rechecked.unpushed === fresh.unpushed &&
    rechecked.upstreamRef === fresh.upstreamRef &&
    !rechecked.statusReadError
  return { status: rechecked, stable }
}
