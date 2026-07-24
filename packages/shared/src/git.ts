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

export async function getHeadCommit(cwd: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', '--short', 'HEAD'])
  if (exitCode !== 0) return undefined
  return stdout || undefined
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

export interface WorktreeEntry {
  path: string
  head?: string
  branch?: string
  detached: boolean
  locked?: boolean
  bare: boolean
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
    else if (key === 'prunable') current.locked = false // ignore value
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

export async function isMerged(cwd: string, baseBranch: string): Promise<boolean> {
  const resolvedBase = await resolveBaseBranch(cwd, baseBranch)
  if (!resolvedBase) return false
  const baseRef = resolvedBase.startsWith('origin/') ? resolvedBase : `refs/heads/${resolvedBase}`
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

export async function countUnpushed(cwd: string): Promise<number> {
  const { stdout } = await runGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  return parseInt(stdout || '0', 10) || 0
}

export async function getStatusPorcelain(cwd: string): Promise<{
  dirty: boolean
  staged: boolean
  hasUntracked: boolean
}> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain'], { raw: true })
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
      output: exitCode === 0 ? stdout || `Removed ${filePath}` : stderr || `Could not remove ${filePath}`,
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
    output: exitCode === 0 ? stdout || `Reverted ${filePath}` : stderr || `Could not revert ${filePath}`,
  }
}

export async function pullWorktree(cwd: string): Promise<GitActionResult> {
  const { stdout, stderr, exitCode } = await runGit(cwd, ['pull', '--ff-only'])
  return {
    success: exitCode === 0,
    output: exitCode === 0 ? stdout || 'Pulled' : stderr || 'Pull failed',
  }
}

export async function rebaseWorktree(cwd: string): Promise<GitActionResult> {
  const { stdout, stderr, exitCode } = await runGit(cwd, ['pull', '--rebase'])
  return {
    success: exitCode === 0,
    output: exitCode === 0 ? stdout || 'Rebased' : stderr || 'Rebase failed',
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

export async function updateBaseBranch(cwd: string, baseBranch: string): Promise<GitActionResult> {
  let base = baseBranch
  const localBaseExists = await refExists(cwd, `refs/heads/${base}`)
  const remoteBaseExists = await refExists(cwd, `refs/remotes/origin/${base}`)
  if (!localBaseExists && !remoteBaseExists) {
    const defaultBranch = await getDefaultBranch(cwd)
    if (!defaultBranch) {
      return { success: false, output: 'Could not determine a base branch to update' }
    }
    base = defaultBranch
  }

  const current = await getCurrentBranch(cwd)
  if (current === base) {
    return pullWorktree(cwd)
  }

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
