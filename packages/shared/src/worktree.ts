import { readdir, stat, readFile, readlink } from 'node:fs/promises'
import { basename, join, dirname, isAbsolute, resolve } from 'node:path'
import type { Repository, Worktree } from '@worktree/contracts'
import {
  getDefaultRemoteUrl,
  getHeadCommit,
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

  let total = 0
  let current = 0
  let found = 0

  const reportProgress = async (currentPath?: string) => {
    if (onProgress) {
      await onProgress({ total, current, found, ...(currentPath ? { currentPath } : {}) })
    }
  }

  const scan = async (root: string, depth: number) => {
    if (shouldCancel?.()) return
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (shouldCancel?.()) return
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const name = entry.name
      if (name.startsWith('.') && name !== '.git') continue
      if (SKIP_DIRS.has(name)) continue

      let fullPath = join(root, name)
      if (entry.isSymbolicLink()) {
        let target: string
        try {
          target = await readlink(fullPath)
        } catch {
          continue
        }
        const absoluteTarget = isAbsolute(target) ? target : resolve(root, target)
        try {
          const s = await stat(absoluteTarget)
          if (!s.isDirectory()) continue
          fullPath = absoluteTarget
        } catch {
          continue
        }
      }

      current++
      await reportProgress(fullPath)

      let hasGit = false
      try {
        const gitPath = join(fullPath, '.git')
        await stat(gitPath)
        hasGit = true
      } catch {
        // continue
      }

      if (hasGit) {
        found++
        foundDirs.push(fullPath)
        await reportProgress(fullPath)
        // Don't recurse into a git repo to avoid submodules etc.
        continue
      }

      await scan(fullPath, depth + 1)
    }
  }

  total = roots.length
  for (const root of roots) {
    await scan(root, 0)
  }

  // Resolve to main repo paths and de-duplicate
  for (const dir of foundDirs) {
    if (shouldCancel?.()) break
    const mainRepoPath = await resolveMainRepoPath(dir)
    if (!mainRepoPath) continue
    mainRepoPaths.set(mainRepoPath, dir)
  }

  const repositories: Repository[] = []
  const worktrees: Worktree[] = []

  for (const [repoPath] of mainRepoPaths) {
    if (shouldCancel?.()) break
    const entries = await getWorktreeList(repoPath)
    if (entries.length === 0) continue

    const remoteUrl = await getDefaultRemoteUrl(repoPath).catch(() => undefined)
    const provider = remoteUrl ? parseProviderFromRemoteUrl(remoteUrl) : undefined
    const repo: Repository = {
      id: stableId(repoPath),
      name: basename(repoPath),
      path: repoPath,
      baseBranch: 'main',
      remoteUrl,
      favorite: false,
      ...(provider ? { provider } : {}),
    }
    repositories.push(repo)

    for (const entry of entries) {
      const worktree = await buildWorktree(entry, repo.id)
      worktrees.push(worktree)
    }
  }

  return { repositories, worktrees }
}

async function buildWorktree(entry: WorktreeEntry, repoId: string): Promise<Worktree> {
  const headCommit = entry.head ? entry.head.slice(0, 7) : await getHeadCommit(entry.path).catch(() => undefined)
  let lastModified: number | undefined
  try {
    const s = await stat(entry.path)
    lastModified = s.mtimeMs
  } catch {
    // ignore
  }

  const branch = entry.detached ? 'HEAD' : entry.branch ?? 'HEAD'
  const isMain = !entry.detached && branch !== 'HEAD' && !entry.bare && (await isMainWorktree(entry.path))

  return {
    id: stableId(entry.path),
    repositoryId: repoId,
    path: entry.path,
    branch,
    headCommit,
    isMain,
    lastModified,
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
