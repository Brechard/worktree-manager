import type {
  PullRequestLookup,
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
  hasBranchCommitHistory,
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
  resolvePullRequest?: (branch: string) => Promise<PullRequestLookup>
  /** One repository-level ref snapshot shared by all of its worktrees. */
  baseSnapshot?: BaseBranchSnapshot
}

const lastKnownPr = new Map<
  string,
  { pullRequest: NonNullable<PullRequestLookup['pullRequest']>; lastSuccessAt: number }
>()
function prIdentity(repository: Repository, branch: string, headCommit?: string): string {
  const provider = repository.provider
  return JSON.stringify([
    repository.id,
    provider?.type,
    provider?.organization,
    provider?.project,
    provider?.repository,
    branch,
    headCommit,
  ])
}

export function clearPullRequestHistory(filter?: {
  repositoryIds?: Set<string>
  providerTypes?: Set<string>
}): void {
  if (!filter) return void lastKnownPr.clear()
  for (const key of lastKnownPr.keys()) {
    const [repositoryId, providerType] = JSON.parse(key) as [string, string | undefined]
    if (
      filter.repositoryIds?.has(repositoryId) ||
      (providerType && filter.providerTypes?.has(providerType))
    )
      lastKnownPr.delete(key)
  }
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
      hasMergedBranchHistory: false,
      hasRemote: false,
      hasUpstream: false,
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
  const baseFullRef =
    baseSnapshot?.mergeRef ?? (await resolveBaseRef(cwd, baseBranch).catch(() => undefined))

  let statusReadError: string | undefined
  const statusPromise = getStatusPorcelain(cwd).catch(() => {
    statusReadError = 'Could not read the Git working tree status.'
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
    getHeadCommit(cwd, true).catch(() => undefined),
    baseFullRef
      ? getRefAheadBehind(cwd, baseFullRef).catch(() => ({ ahead: 0, behind: 0 }))
      : Promise.resolve({ ahead: 0, behind: 0 }),
    baseFullRef ? countMergeCommits(cwd, baseFullRef).catch(() => 0) : Promise.resolve(0),
    getUpstreamRef(cwd).catch(() => undefined),
  ])

  const hasRemoteConfigured = await hasRemote(cwd).catch(() => false)
  const detached = branch === 'HEAD'
  const hasMergedBranchHistory =
    merged && !detached && branch !== resolvedBase && !baseSnapshot?.fetchError
      ? await hasBranchCommitHistory(cwd, branch).catch(() => false)
      : false

  // Keyed off the live branch, so checking out a different branch swaps the PR
  // (and dropping back onto the base drops it) on the very next refresh. It has
  // to run after the git reads rather than alongside them for that reason.
  const applicable = branchCanHavePullRequest(branch, resolvedBase)
  const identity = prIdentity(repository, branch, headCommit)
  const prLookup: PullRequestLookup = !applicable
    ? { state: 'not-applicable', checkedAt: Date.now(), credentialSource: 'none' }
    : resolvePullRequest
      ? await resolvePullRequest(branch).catch(() => ({
          state: 'error' as const,
          checkedAt: Date.now(),
          error: { kind: 'unknown' as const, message: 'Provider lookup failed.' },
        }))
      : { state: 'not-configured', checkedAt: Date.now(), credentialSource: 'none' }
  if (prLookup.state === 'found' && prLookup.pullRequest)
    lastKnownPr.set(identity, {
      pullRequest: prLookup.pullRequest,
      lastSuccessAt: prLookup.lastSuccessAt ?? prLookup.checkedAt,
    })
  if (prLookup.state === 'none') lastKnownPr.delete(identity)
  const retained = prLookup.state === 'error' ? lastKnownPr.get(identity) : undefined
  const pullRequest = prLookup.state === 'found' ? prLookup.pullRequest : retained?.pullRequest
  if (retained) prLookup.lastSuccessAt = retained.lastSuccessAt

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
    hasMergedBranchHistory,
    hasRemote: hasRemoteConfigured,
    hasUpstream: aheadBehind.hasUpstream,
    baseBranch: resolvedBase,
    // A failed fetch means `merged` was decided against a stale local ref (or no
    // ref at all), so the row has to say "unknown" rather than assert "unmerged".
    ...(baseSnapshot?.fetchError ? { baseFetchError: baseSnapshot.fetchError } : {}),
    hasOpenPR:
      prLookup.state === 'found' &&
      (pullRequest?.state === 'open' || pullRequest?.state === 'draft'),
    prLookup,
    providerConfigured: !!repository.provider,
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
  globalTokens?: { github?: string; azure?: string },
  credentialSource?: PullRequestLookup['credentialSource'],
  force = false
): Promise<PullRequestLookup> {
  if (!branchCanHavePullRequest(branch, repository.baseBranch || 'main'))
    return { state: 'not-applicable', checkedAt: Date.now(), credentialSource: 'none' }
  try {
    return await lookupPullRequest(branch, repository, globalTokens, credentialSource, force)
  } catch {
    return {
      state: 'error',
      checkedAt: Date.now(),
      error: { kind: 'unknown', message: 'Provider lookup failed.' },
    }
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
