import type { PullRequestLookup } from '@worktree/contracts'

/** A healthy lookup belongs in project details, not a persistent dashboard row. */
export function providerHealthVisible(
  result: PullRequestLookup | undefined,
  recoveryFeedback: boolean
): boolean {
  return result?.state === 'error' || result?.state === 'not-configured' || recoveryFeedback
}
