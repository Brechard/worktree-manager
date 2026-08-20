import { runGit } from './exec.js'

export interface RemoteInfo {
  name: string
  url: string
}

export async function getRemotes(cwd: string): Promise<RemoteInfo[]> {
  const { stdout } = await runGit(cwd, ['remote', '-v'])
  const remotes: RemoteInfo[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    const [name, url, kind] = parts
    if (!name || !url || kind !== '(fetch)') continue
    if (seen.has(name)) continue
    seen.add(name)
    remotes.push({ name, url })
  }
  return remotes
}

export async function getDefaultRemoteUrl(cwd: string): Promise<string | undefined> {
  const remotes = await getRemotes(cwd)
  return remotes.find((r) => r.name === 'origin')?.url ?? remotes[0]?.url
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (exitCode !== 0) return 'HEAD'
  return stdout || 'HEAD'
}

/** Absolute path of the worktree's git dir — `.git/worktrees/<name>` for a
 *  linked worktree — which is where its own HEAD file lives. */
export async function getGitDir(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--absolute-git-dir'])
  if (exitCode !== 0) return undefined
  return stdout || undefined
}

export async function getHeadCommit(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--short', 'HEAD'])
  if (exitCode !== 0) return undefined
  return stdout || undefined
}

/** Return the timestamp of the most recent commit in milliseconds. */
export async function getLastCommitTimestamp(cwd: string): Promise<number | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['log', '-1', '--format=%ct'])
  if (exitCode !== 0) return undefined
  const seconds = Number(stdout.trim())
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

export async function getTopLevel(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (exitCode !== 0) return undefined
  return stdout || undefined
}

export async function getCommonGitDir(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--git-common-dir'])
  if (exitCode !== 0) return undefined
  return stdout || undefined
}

export async function getWorktreeList(cwd: string): Promise<WorktreeEntry[]> {
  const { stdout, exitCode } = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  if (exitCode !== 0) return []
  return parseWorktreeList(stdout)
}

/**
 * Deregister worktrees whose working tree is gone. `cwd` must be a live worktree
 * of the repo (typically the main repo path). Cleans every stale entry at once.
 */
export async function pruneWorktrees(cwd: string): Promise<{ success: boolean; output: string }> {
  const { stdout, stderr, exitCode } = await runGit(cwd, ['worktree', 'prune', '-v'])
  return { success: exitCode === 0, output: stdout || stderr }
}

/**
 * Remove a linked worktree via git (deletes its directory and deregisters it).
 * `cwd` must be a live worktree of the repo.
 */
export async function removeWorktree(
  cwd: string,
  worktreePath: string,
  force = false
): Promise<{ success: boolean; output: string }> {
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(worktreePath)
  const { stdout, stderr, exitCode } = await runGit(cwd, args)
  return { success: exitCode === 0, output: stdout || stderr }
}

/**
 * Delete a local branch. Callers only pass `deleteBranch: true` after already
 * confirming the branch is merged into the base (see `isMerged`), so this
 * force-deletes rather than trusting git's own `-d` safety check — that check
 * *also* requires the branch be merged into its configured remote-tracking
 * ref, which is routinely stale or gone once a PR lands (squash/rebase
 * merges, or the provider deleting the head branch), producing a false
 * "not fully merged" refusal even though it is merged to HEAD.
 */
export async function deleteLocalBranch(
  cwd: string,
  branch: string
): Promise<{ success: boolean; output: string }> {
  const { stdout, stderr, exitCode } = await runGit(cwd, ['branch', '-D', '--', branch])
  return { success: exitCode === 0, output: stdout || stderr }
}

export interface WorktreeEntry {
  path: string
  head?: string
  branch?: string
  detached: boolean
  locked?: boolean
  bare: boolean
  /** git reports the worktree as prunable (its working tree / gitdir is gone). */
  prunable?: boolean
  /** Human-readable reason git gave for prunability, when available. */
  prunableReason?: string
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> = {}
  const flush = () => {
    const path = current.path
    if (path) {
      const entry: WorktreeEntry = {
        path,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
      }
      if (current.head !== undefined) entry.head = current.head
      if (current.branch !== undefined) entry.branch = current.branch
      if (current.locked !== undefined) entry.locked = current.locked
      if (current.prunable !== undefined) entry.prunable = current.prunable
      if (current.prunableReason !== undefined) entry.prunableReason = current.prunableReason
      entries.push(entry)
    }
    current = {}
  }
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) {
      flush()
      continue
    }
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'worktree') current.path = value
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace('refs/heads/', '')
    else if (key === 'detached') current.detached = true
    else if (key === 'locked') current.locked = true
    else if (key === 'bare') current.bare = true
    else if (key === 'prunable') {
      // git marks an entry prunable when its working tree / gitdir is gone.
      current.prunable = true
      if (value) current.prunableReason = value
    }
  }
  flush()
  return entries
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const { exitCode } = await runGit(cwd, ['show-ref', '--verify', '--quiet', ref])
  return exitCode === 0
}

export async function getDefaultBranch(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (exitCode === 0 && stdout.startsWith('origin/')) return stdout.slice('origin/'.length)
  if (await refExists(cwd, 'refs/remotes/origin/main')) return 'main'
  if (await refExists(cwd, 'refs/remotes/origin/master')) return 'master'
  return undefined
}

export async function getBranches(cwd: string): Promise<string[]> {
  const { stdout, exitCode } = await runGit(cwd, ['branch', '--format=%(refname:short)'])
  const local =
    exitCode === 0
      ? stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  const { stdout: remoteOut, exitCode: remoteExit } = await runGit(cwd, [
    'branch',
    '-r',
    '--format=%(refname:short)',
  ])
  const remote =
    remoteExit === 0
      ? remoteOut
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('origin/') && !s.endsWith('/HEAD'))
          .map((s) => s.slice('origin/'.length))
      : []

  return Array.from(new Set([...local, ...remote])).sort((a, b) => a.localeCompare(b))
}

export async function resolveBaseBranch(
  cwd: string,
  preferred: string
): Promise<string | undefined> {
  const candidates = [preferred, 'main', 'master']
  for (const branch of candidates) {
    if (await refExists(cwd, `refs/heads/${branch}`)) return branch
    if (await refExists(cwd, `refs/remotes/origin/${branch}`)) return `origin/${branch}`
  }

  const defaultBranch = await getDefaultBranch(cwd)
  if (!defaultBranch) return undefined
  if (await refExists(cwd, `refs/heads/${defaultBranch}`)) return defaultBranch
  if (await refExists(cwd, `refs/remotes/origin/${defaultBranch}`)) return `origin/${defaultBranch}`
  return undefined
}

export async function isMerged(
  cwd: string,
  baseBranch: string,
  preferredRef?: string
): Promise<boolean> {
  const resolvedBase = preferredRef ?? (await resolveBaseBranch(cwd, baseBranch))
  if (!resolvedBase) return false
  const baseRef = resolvedBase.startsWith('refs/')
    ? resolvedBase
    : resolvedBase.startsWith('origin/')
      ? `refs/remotes/${resolvedBase}`
      : `refs/heads/${resolvedBase}`
  const { exitCode } = await runGit(cwd, ['merge-base', '--is-ancestor', 'HEAD', baseRef])
  return exitCode === 0
}

export async function getAheadBehind(
  cwd: string
): Promise<{ ahead: number; behind: number; hasUpstream: boolean }> {
  const { stdout, exitCode } = await runGit(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...@{upstream}',
  ])
  if (exitCode !== 0 || !stdout) return { ahead: 0, behind: 0, hasUpstream: false }
  const parts = stdout.split(/\s+/)
  const [aheadStr, behindStr] = parts
  const ahead = parseInt(aheadStr ?? '0', 10) || 0
  const behind = parseInt(behindStr ?? '0', 10) || 0
  return { ahead, behind, hasUpstream: true }
}

export interface UpstreamRef {
  /** Remote the branch tracks, practically always `origin`. */
  remote: string
  /** Branch name on that remote, which need not match the local one. */
  remoteBranch: string
  /** Full ref, e.g. `refs/remotes/origin/feature`. */
  ref: string
  /** Display form, e.g. `origin/feature`. */
  short: string
}

/** Display form of the current branch's upstream, or undefined when it has none. */
export async function getUpstreamRef(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, [
    'rev-parse',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (exitCode !== 0 || !stdout) return undefined
  return shortRefName(stdout)
}

/**
 * Everything needed to *fetch* the current branch's upstream, not just name it.
 * The remote and the branch name on it come from the branch's own config rather
 * than from splitting `origin/feature`, which guesses wrong whenever the local
 * and remote names differ.
 */
export async function getUpstream(cwd: string): Promise<UpstreamRef | undefined> {
  const { stdout: ref, exitCode } = await runGit(cwd, [
    'rev-parse',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (exitCode !== 0 || !ref) return undefined
  const branch = await getCurrentBranch(cwd)
  const [remoteResult, mergeResult] = await Promise.all([
    runGit(cwd, ['config', '--get', `branch.${branch}.remote`]),
    runGit(cwd, ['config', '--get', `branch.${branch}.merge`]),
  ])
  const remote = remoteResult.stdout || 'origin'
  const short = shortRefName(ref)
  const remoteBranch =
    mergeResult.stdout.replace(/^refs\/heads\//, '') ||
    (short.startsWith(`${remote}/`) ? short.slice(remote.length + 1) : short)
  return { remote, remoteBranch, ref, short }
}

/**
 * Compare HEAD with an arbitrary ref. `behind` is what the ref has that HEAD
 * does not — for a base ref that is exactly "commits not integrated yet".
 */
export async function getRefAheadBehind(
  cwd: string,
  ref: string
): Promise<{ ahead: number; behind: number }> {
  const { stdout, exitCode } = await runGit(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    `HEAD...${ref}`,
  ])
  if (exitCode !== 0 || !stdout) return { ahead: 0, behind: 0 }
  const [aheadStr, behindStr] = stdout.split(/\s+/)
  return {
    ahead: Number.parseInt(aheadStr ?? '0', 10) || 0,
    behind: Number.parseInt(behindStr ?? '0', 10) || 0,
  }
}

/** Turn `refs/remotes/origin/main` into `origin/main` for display. */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/remotes\//, '').replace(/^refs\/heads\//, '')
}

/**
 * The base ref to compare against, preferring the remote-tracking ref because a
 * local base branch in a worktree checkout is usually days stale. Does not fetch.
 */
export async function resolveBaseRef(cwd: string, baseBranch: string): Promise<string | undefined> {
  const base = baseBranch.replace(/^refs\/heads\//, '').replace(/^origin\//, '') || 'main'
  if (await refExists(cwd, `refs/remotes/origin/${base}`)) return `refs/remotes/origin/${base}`
  if (await refExists(cwd, `refs/heads/${base}`)) return `refs/heads/${base}`
  const fallback = await getDefaultBranch(cwd)
  if (!fallback) return undefined
  if (await refExists(cwd, `refs/remotes/origin/${fallback}`))
    return `refs/remotes/origin/${fallback}`
  if (await refExists(cwd, `refs/heads/${fallback}`)) return `refs/heads/${fallback}`
  return undefined
}

/** Merge commits reachable from HEAD but not from `ref`. */
export async function countMergeCommits(cwd: string, ref: string): Promise<number> {
  const { stdout, exitCode } = await runGit(cwd, [
    'rev-list',
    '--count',
    '--merges',
    `${ref}..HEAD`,
  ])
  if (exitCode !== 0) return 0
  return Number.parseInt(stdout || '0', 10) || 0
}

/**
 * Would merging `ref` into HEAD apply cleanly? Answered by an in-memory merge:
 * it writes objects but touches neither the index, the working tree nor any ref,
 * so it is safe to ask right after a rebase has just been rolled back.
 *
 * `undefined` when git cannot answer (the flag needs git 2.38+).
 */
export async function mergeWouldBeClean(cwd: string, ref: string): Promise<boolean | undefined> {
  const { exitCode } = await runGit(cwd, ['merge-tree', '--write-tree', 'HEAD', ref], {
    maxBuffer: 8 * 1024 * 1024,
  })
  if (exitCode === 0) return true
  if (exitCode === 1) return false
  return undefined
}

/** Files left with conflict markers by an in-progress merge/rebase. */
export async function getConflictedFiles(cwd: string): Promise<string[]> {
  const { stdout, exitCode } = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U'])
  if (exitCode !== 0) return []
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function countUnpushed(cwd: string): Promise<number> {
  const { stdout } = await runGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  return parseInt(stdout || '0', 10) || 0
}

export async function getStatusPorcelain(cwd: string): Promise<{
  dirty: boolean
  staged: boolean
  hasUntracked: boolean
}> {
  // Force untracked reporting instead of inheriting status.showUntrackedFiles;
  // cleanup safety cannot let a user config hide the only copy of a file.
  const { stdout, stderr, exitCode } = await runGit(
    cwd,
    ['status', '--porcelain', '--untracked-files=all'],
    { raw: true }
  )
  if (exitCode !== 0) throw new Error(stderr || 'git status failed')
  let dirty = false
  let staged = false
  let hasUntracked = false
  for (const line of stdout.split('\n')) {
    if (line.length < 2) continue
    const index = line[0]
    const worktree = line[1]
    if (index === '?') {
      hasUntracked = true
      continue
    }
    if (index !== ' ' && index !== '?') staged = true
    if (worktree !== ' ') dirty = true
  }
  return { dirty, staged, hasUntracked }
}

export async function hasRemote(cwd: string): Promise<boolean> {
  const { stdout } = await runGit(cwd, ['remote'])
  return stdout.trim().length > 0
}

export interface StatusFile {
  path: string
  status: string
}

export async function getStatusFiles(cwd: string): Promise<{
  dirty: StatusFile[]
  staged: StatusFile[]
  untracked: StatusFile[]
}> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain', '-uall'], { raw: true })
  const dirty: StatusFile[] = []
  const staged: StatusFile[] = []
  const untracked: StatusFile[] = []

  for (const raw of stdout.split('\n')) {
    if (raw.length < 2) continue
    const status = raw.slice(0, 2)
    // Take the last path token; rename lines contain " -> ".
    const path = raw.slice(3).split(' -> ').pop() ?? raw.slice(3)
    if (status === '??') {
      untracked.push({ path: path.trim(), status })
      continue
    }
    if (status[0] !== ' ' && status[0] !== '?') staged.push({ path: path.trim(), status })
    if (status[1] !== ' ' && status[1] !== '?') dirty.push({ path: path.trim(), status })
  }

  return { dirty, staged, untracked }
}

export interface CommitInfo {
  sha: string
  subject: string
  author: string
  date: string
}

const COMMIT_LOG_FORMAT = '%H%n%s%n%an%n%aI%x00'

function parseCommitLog(stdout: string): CommitInfo[] {
  return stdout
    .split('\0')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [sha, subject, author, date] = block.split('\n')
      return {
        sha: sha?.slice(0, 7) ?? '',
        subject: subject?.trim() ?? '',
        author: author?.trim() ?? '',
        date: date?.trim() ?? '',
      }
    })
    .filter((c) => c.sha)
}

export async function getUnpushedCommits(cwd: string, max = 20): Promise<CommitInfo[]> {
  const { stdout, exitCode } = await runGit(cwd, [
    'log',
    'HEAD',
    '--not',
    '--remotes',
    `--max-count=${max}`,
    `--format=${COMMIT_LOG_FORMAT}`,
  ])
  if (exitCode !== 0) return []
  return parseCommitLog(stdout)
}

/** Commits reachable from `ref` but not from HEAD — i.e. what a sync would bring in. */
export async function getIncomingCommits(
  cwd: string,
  ref: string,
  max = 20
): Promise<CommitInfo[]> {
  const { stdout, exitCode } = await runGit(cwd, [
    'log',
    `HEAD..${ref}`,
    `--max-count=${max}`,
    `--format=${COMMIT_LOG_FORMAT}`,
  ])
  if (exitCode !== 0) return []
  return parseCommitLog(stdout)
}

export async function getBehindCommits(cwd: string, max = 20): Promise<CommitInfo[]> {
  const { stdout, exitCode } = await runGit(cwd, [
    'log',
    'HEAD..@{upstream}',
    `--max-count=${max}`,
    `--format=${COMMIT_LOG_FORMAT}`,
  ])
  if (exitCode !== 0) return []
  return parseCommitLog(stdout)
}

export interface GitActionResult {
  success: boolean
  output: string
}

export async function getFileDiff(
  cwd: string,
  filePath: string,
  staged = false,
  untracked = false,
  fullContext = false
): Promise<string> {
  const contextArgs = fullContext ? ['-U99999'] : []
  if (untracked) {
    // git diff --no-index exits with 1 when files differ, which is expected for new files.
    const { stdout, stderr, exitCode } = await runGit(
      cwd,
      ['diff', '--no-color', '--no-index', '-p', ...contextArgs, '--', '/dev/null', filePath],
      { raw: true }
    )
    if (exitCode !== 0 && exitCode !== 1)
      throw new Error(stderr || `Could not load diff for ${filePath}`)
    return stdout
  }
  // Use --submodule=short so submodule changes show the two commit hashes.
  const args = staged
    ? ['diff', '--no-color', '--submodule=short', '--cached', ...contextArgs, '--', filePath]
    : ['diff', '--no-color', '--submodule=short', ...contextArgs, '--', filePath]
  const { stdout, exitCode, stderr } = await runGit(cwd, args, { raw: true })
  if (exitCode !== 0) throw new Error(stderr || `Could not load diff for ${filePath}`)
  return stdout
}

/**
 * Roll a single file back to its committed state. For a tracked file this
 * restores both the index and the working tree to HEAD (discarding staged and
 * unstaged changes). For an untracked file it removes the newly-added file.
 */
export async function discardFile(
  cwd: string,
  filePath: string,
  untracked = false
): Promise<GitActionResult> {
  if (untracked) {
    const { stdout, stderr, exitCode } = await runGit(cwd, ['clean', '-f', '--', filePath])
    return {
      success: exitCode === 0,
      output:
        exitCode === 0 ? stdout || `Removed ${filePath}` : stderr || `Could not remove ${filePath}`,
    }
  }
  const { stdout, stderr, exitCode } = await runGit(cwd, [
    'restore',
    '--source=HEAD',
    '--staged',
    '--worktree',
    '--',
    filePath,
  ])
  return {
    success: exitCode === 0,
    output:
      exitCode === 0 ? stdout || `Reverted ${filePath}` : stderr || `Could not revert ${filePath}`,
  }
}

export async function pushWorktree(cwd: string): Promise<GitActionResult> {
  const current = await getCurrentBranch(cwd)
  const { stdout, stderr, exitCode } = await runGit(cwd, ['push', '-u', 'origin', current])
  return {
    success: exitCode === 0,
    output: exitCode === 0 ? stdout || 'Pushed' : stderr || 'Push failed',
  }
}

export async function commitWorktree(
  cwd: string,
  message: string,
  all = false
): Promise<GitActionResult> {
  const args = all ? ['commit', '-am', message] : ['commit', '-m', message]
  const { stdout, stderr, exitCode } = await runGit(cwd, args)
  return {
    success: exitCode === 0,
    output: exitCode === 0 ? stdout || 'Committed' : stderr || 'Commit failed',
  }
}

export async function checkoutBranch(cwd: string, branch: string): Promise<GitActionResult> {
  // `git checkout <branch>` DWIMs a remote-only branch into a tracking branch.
  const { stdout, stderr, exitCode } = await runGit(cwd, ['checkout', branch])
  return {
    success: exitCode === 0,
    // git prints "Switched to branch" to stderr on success.
    output:
      exitCode === 0 ? stderr || stdout || `Checked out ${branch}` : stderr || `Checkout failed`,
  }
}

export type MergeMode = 'merge' | 'no-ff' | 'squash' | 'rebase'

export async function mergeBranch(
  cwd: string,
  branch: string,
  mode: MergeMode = 'merge'
): Promise<GitActionResult> {
  let args: string[]
  if (mode === 'rebase') args = ['rebase', branch]
  else if (mode === 'squash') args = ['merge', '--squash', branch]
  else if (mode === 'no-ff') args = ['merge', '--no-ff', branch]
  else args = ['merge', branch]

  const { stdout, stderr, exitCode } = await runGit(cwd, args)
  const verb = mode === 'rebase' ? 'Rebased onto' : mode === 'squash' ? 'Squash-merged' : 'Merged'
  return {
    success: exitCode === 0,
    output: exitCode === 0 ? stdout || `${verb} ${branch}` : stderr || stdout || `${mode} failed`,
  }
}

/**
 * Bring the local base branch up to origin *without* touching this worktree —
 * a plain ref update, which git allows only when it fast-forwards. The caller
 * (`updateBaseBranch`) handles the case where the base is checked out here,
 * because that one moves a working tree and needs the sync engine's safety net.
 */
export async function fetchBaseBranch(cwd: string, base: string): Promise<GitActionResult> {
  const { exitCode } = await runGit(cwd, ['fetch', 'origin', `${base}:${base}`])
  if (exitCode === 0) {
    return { success: true, output: `Updated ${base} from origin` }
  }

  const { stderr, exitCode: fallbackExitCode } = await runGit(cwd, ['fetch', 'origin', base])
  return {
    success: fallbackExitCode === 0,
    output:
      fallbackExitCode === 0
        ? `Updated origin/${base} (local ${base} left unchanged — it may be checked out elsewhere or diverged)`
        : stderr || `Failed to update ${base}`,
  }
}
