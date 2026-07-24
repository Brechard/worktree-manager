import type { BaseBranchSyncState } from '@worktree/contracts'
import { runGit } from './exec.js'
import { refExists } from './git.js'

/**
 * The refs used to answer base-branch questions for one status refresh.
 * `mergeRef` is intentionally kept internal to the shared package; the
 * renderer only needs the freshness fields below.
 */
export interface BaseBranchSnapshot {
  baseBranch: string
  state: BaseBranchSyncState
  localExists: boolean
  remoteExists: boolean
  ahead: number
  behind: number
  fetchedAt?: number
  fetchError?: string
  mergeRef?: string
}

function normaliseBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, '').replace(/^origin\//, '') || 'main'
}

function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const [aheadText, behindText] = output.split(/\s+/)
  return {
    ahead: Number.parseInt(aheadText ?? '0', 10) || 0,
    behind: Number.parseInt(behindText ?? '0', 10) || 0,
  }
}

function syncState(
  localExists: boolean,
  remoteExists: boolean,
  ahead: number,
  behind: number,
  fetchError?: string
): BaseBranchSyncState {
  if (fetchError) {
    if (localExists && !remoteExists) return 'local-only'
    if (!localExists && remoteExists) return 'remote-only'
    return 'unknown'
  }
  if (!localExists && remoteExists) return 'remote-only'
  if (localExists && !remoteExists) return 'local-only'
  if (!localExists && !remoteExists) return 'unknown'
  if (ahead === 0 && behind === 0) return 'current'
  if (ahead === 0) return 'behind'
  if (behind === 0) return 'ahead'
  return 'diverged'
}

/**
 * Fetch the configured base branch's remote-tracking ref and compare it with
 * the local branch. This never updates the local branch, so it is safe to run
 * once per repository when the dashboard refreshes.
 */
export async function refreshBaseBranch(
  cwd: string,
  preferredBranch: string
): Promise<BaseBranchSnapshot> {
  const baseBranch = normaliseBranch(preferredBranch)
  const localRef = `refs/heads/${baseBranch}`
  const remoteRef = `refs/remotes/origin/${baseBranch}`

  try {
    const fetchResult = await runGit(cwd, [
      'fetch',
      '--no-tags',
      'origin',
      `${baseBranch}:${remoteRef}`,
    ])
    const fetchError =
      fetchResult.exitCode === 0
        ? undefined
        : fetchResult.stderr || fetchResult.stdout || `Could not fetch origin/${baseBranch}`

    const [localExists, remoteExists] = await Promise.all([
      refExists(cwd, localRef),
      refExists(cwd, remoteRef),
    ])

    let ahead = 0
    let behind = 0
    if (localExists && remoteExists) {
      const comparison = await runGit(cwd, [
        'rev-list',
        '--left-right',
        '--count',
        `${localRef}...${remoteRef}`,
      ])
      if (comparison.exitCode === 0) ({ ahead, behind } = parseAheadBehind(comparison.stdout))
    }

    const effectiveMergeRef =
      !fetchError && remoteExists
        ? remoteRef
        : localExists
          ? localRef
          : remoteExists
            ? remoteRef
            : undefined

    return {
      baseBranch,
      state: syncState(localExists, remoteExists, ahead, behind, fetchError),
      localExists,
      remoteExists,
      ahead,
      behind,
      ...(fetchError ? { fetchError } : { fetchedAt: Date.now() }),
      ...(effectiveMergeRef ? { mergeRef: effectiveMergeRef } : {}),
    }
  } catch (error) {
    return {
      baseBranch,
      state: 'unknown',
      localExists: false,
      remoteExists: false,
      ahead: 0,
      behind: 0,
      fetchError: error instanceof Error ? error.message : String(error),
    }
  }
}
