import type {
  PullRequest,
  Repository,
  RepositoryBaseStatus,
  SafetyResult,
  Worktree,
  WorktreeStatus,
} from '@worktree/contracts'
import { worktreeSafetyReasons } from '@worktree/contracts'
import {
  countUnpushed,
  getAheadBehind,
  getBehindCommits,
  getCurrentBranch,
  getHeadCommit,
  getStatusFiles,
  getStatusPorcelain,
  getUnpushedCommits,
  hasRemote,
  isMerged,
} from './git.js'
import type { BaseBranchSnapshot } from './base.js'
import { lookupPullRequest } from './providers.js'

export interface StatusOptions {
  worktree: Worktree
  repository: Repository
  pullRequest?: PullRequest | null
  /** One repository-level ref snapshot shared by all of its worktrees. */
  baseSnapshot?: BaseBranchSnapshot
}

export async function getWorktreeStatus(options: StatusOptions): Promise<WorktreeStatus> {
  const { worktree, repository, pullRequest, baseSnapshot } = options
  const cwd = worktree.path
  const baseBranch = baseSnapshot?.baseBranch ?? repository.baseBranch ?? 'main'

  // A prunable worktree's directory is gone — running git in it throws (bad cwd).
  // Return a benign status so the row can render its "stale" state without crashing.
  if (worktree.prunable) {
    return {
      worktreeId: worktree.id,
      dirty: false,
      staged: false,
      ahead: 0,
      behind: 0,
      unpushed: 0,
      mergedIntoBase: false,
      baseBranch,
      hasOpenPR: false,
      branch: worktree.branch,
      detached: worktree.branch === 'HEAD',
      ...(worktree.headCommit ? { headCommit: worktree.headCommit } : {}),
    }
  }

  const resolvedBase = baseSnapshot?.baseBranch ?? baseBranch

  const [status, aheadBehind, merged, unpushed, branch, headCommit] = await Promise.all([
    getStatusPorcelain(cwd).catch(() => ({ dirty: false, staged: false, hasUntracked: false })),
    getAheadBehind(cwd).catch(() => ({ ahead: 0, behind: 0, hasUpstream: false })),
    isMerged(cwd, baseBranch, baseSnapshot?.mergeRef).catch(() => false),
    countUnpushed(cwd).catch(() => 0),
    getCurrentBranch(cwd).catch(() => 'HEAD'),
    getHeadCommit(cwd).catch(() => undefined),
  ])

  const hasRemoteConfigured = await hasRemote(cwd).catch(() => false)
  const detached = branch === 'HEAD'

  const worktreeStatus: WorktreeStatus = {
    worktreeId: worktree.id,
    dirty: status.dirty,
    staged: status.staged,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    unpushed: hasRemoteConfigured ? (aheadBehind.hasUpstream ? aheadBehind.ahead : unpushed) : 0,
    mergedIntoBase: merged,
    baseBranch: resolvedBase,
    // A failed fetch means `merged` was decided against a stale local ref (or no
    // ref at all), so the row has to say "unknown" rather than assert "unmerged".
    ...(baseSnapshot?.fetchError ? { baseFetchError: baseSnapshot.fetchError } : {}),
    hasOpenPR: pullRequest?.state === 'open' || pullRequest?.state === 'draft',
    branch,
    detached,
    ...(headCommit ? { headCommit } : {}),
    ...(pullRequest ? { pullRequest } : {}),
  }

  return worktreeStatus
}

/** Convert the internal ref snapshot into the renderer-safe repository status. */
export function toRepositoryBaseStatus(
  repository: Repository,
  snapshot: BaseBranchSnapshot
): RepositoryBaseStatus {
  return {
    repositoryId: repository.id,
    baseBranch: snapshot.baseBranch,
    state: snapshot.state,
    localExists: snapshot.localExists,
    remoteExists: snapshot.remoteExists,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    ...(snapshot.fetchedAt !== undefined ? { fetchedAt: snapshot.fetchedAt } : {}),
    ...(snapshot.fetchError ? { fetchError: snapshot.fetchError } : {}),
  }
}

export async function refreshPullRequest(
  worktree: Worktree,
  repository: Repository,
  globalTokens?: { github?: string; azure?: string }
): Promise<PullRequest | undefined> {
  if (!repository.provider) return undefined
  try {
    return await lookupPullRequest(worktree.branch, repository, globalTokens)
  } catch {
    return undefined
  }
}

export async function getWorktreeDetails(options: StatusOptions) {
  const { worktree, repository } = options
  const cwd = worktree.path
  const baseBranch = repository.baseBranch || 'main'

  const [files, unpushed, behind] = await Promise.all([
    getStatusFiles(cwd).catch(() => ({ dirty: [], staged: [], untracked: [] })),
    getUnpushedCommits(cwd).catch(() => []),
    getBehindCommits(cwd).catch(() => []),
  ])

  return {
    worktreeId: worktree.id,
    dirtyFiles: files.dirty,
    stagedFiles: files.staged,
    untrackedFiles: files.untracked,
    unpushedCommits: unpushed,
    behindCommits: behind,
    baseBranch,
  }
}

export function evaluateSafety(worktree: Worktree, status: WorktreeStatus): SafetyResult {
  // Shared with the renderer's badge/filter/grouping via contracts so the
  // confirmation dialog can never disagree with the "not safe to delete" badge.
  const reasons = worktreeSafetyReasons(worktree, status)
  return { worktreeId: worktree.id, safe: reasons.length === 0, reasons }
}
