import type {
  PullRequest,
  Repository,
  RepositoryBaseStatus,
  SafetyResult,
  Worktree,
  WorktreeStatus,
} from '@worktree/contracts'
import { branchCanHavePullRequest, worktreeSafetyReasons } from '@worktree/contracts'
import {
  countMergeCommits,
  countUnpushed,
  getAheadBehind,
  getBehindCommits,
  getCurrentBranch,
  getHeadCommit,
  getIncomingCommits,
  getRefAheadBehind,
  getStatusFiles,
  getStatusPorcelain,
  getUnpushedCommits,
  getUpstreamRef,
  hasRemote,
  isMerged,
  resolveBaseRef,
  shortRefName,
} from './git.js'
import type { BaseBranchSnapshot } from './base.js'
import { lookupPullRequest } from './providers.js'

export interface StatusOptions {
  worktree: Worktree
  repository: Repository
  /** Looks up the PR for a branch. Called with the *live* branch resolved
   *  below rather than the one captured at scan time, and only when that
   *  branch can have a PR at all — see `branchCanHavePullRequest`. */
  resolvePullRequest?: (branch: string) => Promise<PullRequest | undefined>
  /** One repository-level ref snapshot shared by all of its worktrees. */
  baseSnapshot?: BaseBranchSnapshot
}

export async function getWorktreeStatus(options: StatusOptions): Promise<WorktreeStatus> {
  const { worktree, repository, resolvePullRequest, baseSnapshot } = options
  const cwd = worktree.path
  const baseBranch = baseSnapshot?.baseBranch ?? repository.baseBranch ?? 'main'

  // A prunable worktree's directory is gone — running git in it throws (bad cwd).
  // Return a benign status so the row can render its "stale" state without crashing.
  if (worktree.prunable) {
    return {
      worktreeId: worktree.id,
      dirty: false,
      staged: false,
      hasUntracked: false,
      ahead: 0,
      behind: 0,
      unpushed: 0,
      mergedIntoBase: false,
      baseBranch,
      hasOpenPR: false,
      behindBase: 0,
      aheadBase: 0,
      mergeCommits: 0,
      branch: worktree.branch,
      detached: worktree.branch === 'HEAD',
      ...(worktree.headCommit ? { headCommit: worktree.headCommit } : {}),
    }
  }

  const resolvedBase = baseSnapshot?.baseBranch ?? baseBranch

  // Comparisons against the base use the same freshly-fetched ref the merged
  // check does, so "3 behind main" and "unmerged" can never disagree.
  const baseFullRef = baseSnapshot?.mergeRef ?? (await resolveBaseRef(cwd, baseBranch).catch(() => undefined))

  let statusReadError: string | undefined
  const statusPromise = getStatusPorcelain(cwd).catch((error) => {
    statusReadError = String(error)
    return { dirty: false, staged: false, hasUntracked: false }
  })

  const [
    status,
    aheadBehind,
    merged,
    unpushed,
    branch,
    headCommit,
    baseAheadBehind,
    mergeCommits,
    upstreamRef,
  ] = await Promise.all([
    statusPromise,
    getAheadBehind(cwd).catch(() => ({ ahead: 0, behind: 0, hasUpstream: false })),
    isMerged(cwd, baseBranch, baseSnapshot?.mergeRef).catch(() => false),
    countUnpushed(cwd).catch(() => 0),
    getCurrentBranch(cwd).catch(() => 'HEAD'),
    getHeadCommit(cwd).catch(() => undefined),
    baseFullRef
      ? getRefAheadBehind(cwd, baseFullRef).catch(() => ({ ahead: 0, behind: 0 }))
      : Promise.resolve({ ahead: 0, behind: 0 }),
    baseFullRef ? countMergeCommits(cwd, baseFullRef).catch(() => 0) : Promise.resolve(0),
    getUpstreamRef(cwd).catch(() => undefined),
  ])

  const hasRemoteConfigured = await hasRemote(cwd).catch(() => false)
  const detached = branch === 'HEAD'

  // Keyed off the live branch, so checking out a different branch swaps the PR
  // (and dropping back onto the base drops it) on the very next refresh. It has
  // to run after the git reads rather than alongside them for that reason.
  const pullRequest = branchCanHavePullRequest(branch, resolvedBase)
    ? await resolvePullRequest?.(branch)
    : undefined

  const worktreeStatus: WorktreeStatus = {
    worktreeId: worktree.id,
    dirty: status.dirty,
    staged: status.staged,
    hasUntracked: status.hasUntracked,
    ...(statusReadError ? { statusReadError } : {}),
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    unpushed: hasRemoteConfigured ? (aheadBehind.hasUpstream ? aheadBehind.ahead : unpushed) : 0,
    mergedIntoBase: merged,
    baseBranch: resolvedBase,
    // A failed fetch means `merged` was decided against a stale local ref (or no
    // ref at all), so the row has to say "unknown" rather than assert "unmerged".
    ...(baseSnapshot?.fetchError ? { baseFetchError: baseSnapshot.fetchError } : {}),
    hasOpenPR: pullRequest?.state === 'open' || pullRequest?.state === 'draft',
    behindBase: baseAheadBehind.behind,
    aheadBase: baseAheadBehind.ahead,
    mergeCommits,
    ...(baseFullRef ? { baseRef: shortRefName(baseFullRef) } : {}),
    ...(upstreamRef ? { upstreamRef } : {}),
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
  branch: string,
  repository: Repository,
  globalTokens?: { github?: string; azure?: string }
): Promise<PullRequest | undefined> {
  if (!repository.provider) return undefined
  if (!branchCanHavePullRequest(branch, repository.baseBranch || 'main')) return undefined
  try {
    return await lookupPullRequest(branch, repository, globalTokens)
  } catch {
    return undefined
  }
}

export async function getWorktreeDetails(options: StatusOptions) {
  const { worktree, repository } = options
  const cwd = worktree.path
  const baseBranch = repository.baseBranch || 'main'

  // No fetch here: details load on expand and must stay snappy. The refs were
  // already fetched by the status refresh that populated the row.
  const baseFullRef = await resolveBaseRef(cwd, baseBranch).catch(() => undefined)

  const [files, unpushed, behind, baseBehind] = await Promise.all([
    getStatusFiles(cwd).catch(() => ({ dirty: [], staged: [], untracked: [] })),
    getUnpushedCommits(cwd).catch(() => []),
    getBehindCommits(cwd).catch(() => []),
    baseFullRef ? getIncomingCommits(cwd, baseFullRef).catch(() => []) : Promise.resolve([]),
  ])

  return {
    worktreeId: worktree.id,
    dirtyFiles: files.dirty,
    stagedFiles: files.staged,
    untrackedFiles: files.untracked,
    unpushedCommits: unpushed,
    behindCommits: behind,
    baseBehindCommits: baseBehind,
    baseBranch,
    ...(baseFullRef ? { baseRef: shortRefName(baseFullRef) } : {}),
  }
}

export function evaluateSafety(worktree: Worktree, status: WorktreeStatus): SafetyResult {
  // Shared with the renderer's badge/filter/grouping via contracts so the
  // confirmation dialog can never disagree with the "not safe to delete" badge.
  const reasons = worktreeSafetyReasons(worktree, status)
  return { worktreeId: worktree.id, safe: reasons.length === 0, reasons }
}
