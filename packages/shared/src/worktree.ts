import { readdir, stat, readFile, readlink } from 'node:fs/promises'
import { basename, join, dirname, isAbsolute, resolve } from 'node:path'
import type { Repository, Worktree } from '@worktree/contracts'
import {
  getDefaultBranch,
  getDefaultRemoteUrl,
  getHeadCommit,
  getLastCommitTimestamp,
  getStatusFiles,
  getTopLevel,
  getWorktreeList,
  type WorktreeEntry,
} from './git.js'
import { parseProviderFromRemoteUrl } from './remote.js'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  'release',
  // Large, repo-less build/dependency trees — never contain repos we care about.
  'Pods',
  'Carthage',
  'DerivedData',
  '.build',
  '.dart_tool',
  '.gradle',
  'obj',
  'bin',
  'target',
  'venv',
  '.venv',
  '__pycache__',
  '.pub-cache',
  '.expo',
  '.cache',
])

export interface DiscoverOptions {
  roots: string[]
  maxDepth?: number
  onProgress?: (progress: {
    total: number
    current: number
    currentPath?: string
    found: number
  }) => void | Promise<void>
  shouldCancel?: () => boolean
}

export async function discoverRepositories(
  options: DiscoverOptions
): Promise<{ repositories: Repository[]; worktrees: Worktree[] }> {
  const { roots, maxDepth = 5, onProgress, shouldCancel } = options
  const foundDirs: string[] = []
  const mainRepoPaths = new Map<string, string>() // repo root -> one discovered path

  let scanned = 0
  let found = 0
  let lastReport = 0

  // Throttle progress: the renderer only needs a heartbeat, not one event per
  // directory (there can be thousands, and each is an IPC round-trip).
  const reportProgress = (currentPath?: string, force = false) => {
    if (!onProgress) return
    const now = Date.now()
    if (!force && now - lastReport < 80) return
    lastReport = now
    void onProgress({
      total: scanned,
      current: scanned,
      found,
      ...(currentPath ? { currentPath } : {}),
    })
  }

  // Bounded-concurrency traversal. We limit only the readdir I/O (never held
  // across recursion, so no deadlock) and track outstanding work with a
  // pending counter that resolves `done` once the whole tree is walked.
  const CONCURRENCY = 24
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = () =>
    new Promise<void>((res) => {
      if (active < CONCURRENCY) {
        active++
        res()
      } else {
        waiters.push(res)
      }
    })
  const release = () => {
    active--
    const next = waiters.shift()
    if (next) {
      active++
      next()
    }
  }

  let pending = 0
  let markDone: () => void
  const done = new Promise<void>((res) => {
    markDone = res
  })

  // A directory is a repo (main worktree or linked worktree) when it contains a
  // `.git` entry — detecting it from the directory's own readdir avoids an extra
  // stat per directory and lets us stop before descending into the repo.
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (shouldCancel?.() || depth > maxDepth) return
    await acquire()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      release()
      return
    }
    release()

    scanned++
    reportProgress(dir)

    if (entries.some((e) => e.name === '.git')) {
      found++
      foundDirs.push(dir)
      reportProgress(dir, true)
      return // don't recurse into a repo (skips submodules, worktrees, etc.)
    }

    for (const entry of entries) {
      if (shouldCancel?.()) return
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const name = entry.name
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

      let fullPath = join(dir, name)
      if (entry.isSymbolicLink()) {
        try {
          const target = await readlink(fullPath)
          const absoluteTarget = isAbsolute(target) ? target : resolve(dir, target)
          const s = await stat(absoluteTarget)
          if (!s.isDirectory()) continue
          fullPath = absoluteTarget
        } catch {
          continue
        }
      }
      schedule(fullPath, depth + 1)
    }
  }

  const schedule = (dir: string, depth: number) => {
    pending++
    void visit(dir, depth).finally(() => {
      pending--
      if (pending === 0) markDone()
    })
  }

  if (roots.length === 0) {
    markDone!()
  } else {
    for (const root of roots) schedule(root, 0)
  }
  await done

  // Resolve to main repo paths and de-duplicate
  for (const dir of foundDirs) {
    if (shouldCancel?.()) break
    const mainRepoPath = await resolveMainRepoPath(dir)
    if (!mainRepoPath) continue
    mainRepoPaths.set(mainRepoPath, dir)
  }

  const repositories: Repository[] = []
  const worktrees: Worktree[] = []

  // Build each repo's metadata in parallel — independent git calls per repo.
  const built = await Promise.all(
    Array.from(mainRepoPaths.keys()).map(async (repoPath) => {
      if (shouldCancel?.()) return null
      const entries = await getWorktreeList(repoPath).catch(() => [])
      if (entries.length === 0) return null

      const [remoteUrl, defaultBranch] = await Promise.all([
        getDefaultRemoteUrl(repoPath).catch(() => undefined),
        getDefaultBranch(repoPath).catch(() => undefined),
      ])
      const provider = remoteUrl ? parseProviderFromRemoteUrl(remoteUrl) : undefined
      const repo: Repository = {
        id: stableId(repoPath),
        name: basename(repoPath),
        path: repoPath,
        baseBranch: defaultBranch || 'main',
        remoteUrl,
        favorite: false,
        ...(provider ? { provider } : {}),
      }
      const repoWorktrees = await Promise.all(entries.map((entry) => buildWorktree(entry, repo.id)))
      return { repo, repoWorktrees }
    })
  )

  for (const item of built) {
    if (!item) continue
    repositories.push(item.repo)
    worktrees.push(...item.repoWorktrees)
  }

  return { repositories, worktrees }
}

async function buildWorktree(entry: WorktreeEntry, repoId: string): Promise<Worktree> {
  const [headCommit, activity] = await Promise.all([
    entry.head
      ? Promise.resolve(entry.head.slice(0, 7))
      : getHeadCommit(entry.path).catch(() => undefined),
    getWorktreeActivity(entry.path),
  ])
  const { lastModified, missing } = activity

  const branch = entry.detached ? 'HEAD' : (entry.branch ?? 'HEAD')
  const prunable = entry.prunable === true || missing
  const isMain =
    !prunable &&
    !entry.detached &&
    branch !== 'HEAD' &&
    !entry.bare &&
    (await isMainWorktree(entry.path))
  const prunableReason =
    entry.prunableReason ?? (missing ? 'Working tree directory is missing' : undefined)

  return {
    id: stableId(entry.path),
    repositoryId: repoId,
    path: entry.path,
    branch,
    headCommit,
    isMain,
    lastModified,
    prunable,
    ...(prunable && prunableReason ? { prunableReason } : {}),
  }
}

/**
 * Build a useful activity signal without walking every file in the repository.
 * The worktree directory catches checkouts and file additions; changed-file
 * mtimes catch edits inside nested folders; the latest commit covers clean trees.
 */
async function getWorktreeActivity(path: string): Promise<{
  lastModified?: number
  missing: boolean
}> {
  let latest: number | undefined
  try {
    latest = (await stat(path)).mtimeMs
  } catch {
    return { missing: true }
  }

  const [lastCommit, changedFiles] = await Promise.all([
    getLastCommitTimestamp(path).catch(() => undefined),
    getStatusFiles(path).catch(() => ({ dirty: [], staged: [], untracked: [] })),
  ])
  if (lastCommit !== undefined) latest = Math.max(latest, lastCommit)

  const changedPaths = new Set([
    ...changedFiles.dirty.map((file) => file.path),
    ...changedFiles.staged.map((file) => file.path),
    ...changedFiles.untracked.map((file) => file.path),
  ])
  for (const changedPath of changedPaths) {
    const absolutePath = resolve(path, changedPath)
    const fileMtime = await getMtime(absolutePath)
    const parentMtime = fileMtime === undefined ? await getMtime(dirname(absolutePath)) : undefined
    const candidate = fileMtime ?? parentMtime
    if (candidate !== undefined) latest = Math.max(latest, candidate)
  }

  return { lastModified: latest, missing: false }
}

async function getMtime(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

async function isMainWorktree(path: string): Promise<boolean> {
  try {
    const s = await stat(join(path, '.git'))
    return s.isDirectory()
  } catch {
    return false
  }
}

async function resolveMainRepoPath(dir: string): Promise<string | undefined> {
  const gitPath = join(dir, '.git')
  try {
    const s = await stat(gitPath)
    if (s.isDirectory()) {
      return getTopLevel(dir)
    }

    const content = await readFile(gitPath, 'utf-8')
    const gitdirLine = content.split('\n').find((line) => line.startsWith('gitdir:'))
    if (!gitdirLine) return getTopLevel(dir)

    const gitdir = gitdirLine.replace('gitdir:', '').trim()
    const absoluteGitdir = isAbsolute(gitdir) ? gitdir : resolve(dir, gitdir)

    // Linked worktree: gitdir points to <repoRoot>/.git/worktrees/<name>
    if (absoluteGitdir.includes('/.git/worktrees/')) {
      return dirname(dirname(dirname(absoluteGitdir)))
    }

    // Submodule: gitdir points to <parentRepo>/.git/modules/<sub>,
    // so the actual repository root is the current directory's top-level.
    return getTopLevel(dir)
  } catch {
    return undefined
  }
}

function stableId(input: string): string {
  // A simple stable hash good enough for local IDs.
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return `id_${Math.abs(hash).toString(36)}_${basename(input).slice(0, 20)}`
}
