import type { PullRequest, Repository, SafetyResult, Worktree, WorktreeStatus } from '@worktree/contracts'
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
  refExists,
} from './git.js'
import { lookupPullRequest } from './providers.js'

export interface StatusOptions {
  worktree: Worktree
  repository: Repository
  pullRequest?: PullRequest | null
}

export async function getWorktreeStatus(options: StatusOptions): Promise<WorktreeStatus> {
  const { worktree, repository, pullRequest } = options
  const cwd = worktree.path

  const baseBranch = repository.baseBranch || 'main'
  const resolvedBase = (await refExists(cwd, `refs/heads/${baseBranch}`))
    ? baseBranch
    : 'main'

  const [status, aheadBehind, merged, unpushed, branch, headCommit] = await Promise.all([
    getStatusPorcelain(cwd),
    getAheadBehind(cwd).catch(() => ({ ahead: 0, behind: 0, hasUpstream: false })),
    isMerged(cwd, baseBranch).catch(() => false),
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
    hasOpenPR: pullRequest?.state === 'open' || pullRequest?.state === 'draft',
    branch,
    detached,
    ...(headCommit ? { headCommit } : {}),
    ...(pullRequest ? { pullRequest } : {}),
  }

  return worktreeStatus
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
  const reasons: string[] = []
  let safe = true

  if (status.dirty || status.staged) {
    safe = false
    reasons.push('Has uncommitted changes')
  }
  if (status.ahead > 0 || status.unpushed > 0) {
    safe = false
    reasons.push(`${status.ahead > 0 ? status.ahead : status.unpushed} unpushed commit(s)`)
  }
  if (!status.mergedIntoBase && worktree.branch !== status.baseBranch && worktree.branch !== 'HEAD') {
    safe = false
    reasons.push(`Branch not merged into ${status.baseBranch}`)
  }
  if (status.hasOpenPR) {
    safe = false
    reasons.push('Has an open pull request')
  }

  return { worktreeId: worktree.id, safe, reasons }
}
