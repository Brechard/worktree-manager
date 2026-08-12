import { existsSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { platform } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { ReclaimableEntry, ReclaimableKind } from '@worktree/contracts'
import { runCommand, runGit } from './exec.js'

/**
 * Generated directories a worktree can rebuild from source, keyed by their
 * exact name. Everything here has the same shape: git ignores it, a tool
 * recreates it (`pnpm install`, a build, a test run), and it costs hundreds of
 * megabytes per worktree — which is what makes ten branches of one project cost
 * ten copies of the same dependency tree.
 *
 * The list is a deliberate allow-list rather than "everything git ignores":
 * ignored also covers `.env` files, editor folders and local scripts, none of
 * which come back on their own. Anything not named here is measured but never
 * offered for deletion.
 */
const RECLAIMABLE_DIRS: Record<string, ReclaimableKind> = {
  // Dependencies — restored by the package manager, usually from a warm cache.
  node_modules: 'dependencies',
  bower_components: 'dependencies',
  Pods: 'dependencies',
  Carthage: 'dependencies',
  '.venv': 'dependencies',
  venv: 'dependencies',
  '.pub-cache': 'dependencies',
  '.terraform': 'dependencies',
  // Build output.
  dist: 'build',
  'dist-electron': 'build',
  build: 'build',
  out: 'build',
  '.output': 'build',
  // Packaged installers: hundreds of megabytes per release run, and every one
  // of them is reproducible from a build.
  release: 'build',
  '.next': 'build',
  '.nuxt': 'build',
  '.svelte-kit': 'build',
  '.astro': 'build',
  '.angular': 'build',
  '.expo': 'build',
  '.build': 'build',
  '.dart_tool': 'build',
  '.cxx': 'build',
  DerivedData: 'build',
  obj: 'build',
  bin: 'build',
  target: 'build',
  // Tool caches scoped to the worktree.
  '.turbo': 'cache',
  '.parcel-cache': 'cache',
  '.vite': 'cache',
  '.gradle': 'cache',
  '.mypy_cache': 'cache',
  '.ruff_cache': 'cache',
  '.pytest_cache': 'cache',
  __pycache__: 'cache',
  '.cache': 'cache',
  // Test/coverage output.
  coverage: 'test',
  '.nyc_output': 'test',
  'test-results': 'test',
  'playwright-report': 'test',
}

/** How much `du` we are willing to wait for on one worktree. */
const DU_TIMEOUT_MS = 180_000

export interface WorktreeDiskMeasurement {
  totalBytes: number
  reclaimableBytes: number
  entries: ReclaimableEntry[]
  error?: string
}

function kindFor(path: string): ReclaimableKind | undefined {
  return RECLAIMABLE_DIRS[basename(path)]
}

/**
 * Ignored directories git would not miss, relative to the worktree root.
 *
 * `--directory` collapses a fully-ignored directory to a single entry instead
 * of listing every file inside it, which is what keeps this cheap on a tree
 * with a 600 MB `node_modules`: git stops at the directory and never walks it.
 */
async function listIgnoredDirectories(worktreePath: string): Promise<string[]> {
  const { stdout, exitCode } = await runGit(
    worktreePath,
    ['ls-files', '-z', '--others', '--ignored', '--directory', '--exclude-standard'],
    { maxBuffer: 8 * 1024 * 1024, raw: true }
  )
  if (exitCode !== 0) return []
  return stdout
    .split('\0')
    .filter(Boolean)
    .filter((entry) => entry.endsWith('/'))
    .map((entry) => entry.replace(/\/+$/, ''))
}

/** Portable fallback for Windows, where `du` is not a system command. */
async function measurePathPortable(root: string): Promise<number> {
  let bytes = 0
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()!
    const info = await lstat(current)
    // A symlink's target is not owned by this worktree, so count the link itself
    // and never follow it outside the tree.
    if (!info.isDirectory() || info.isSymbolicLink()) {
      bytes += info.size
      continue
    }
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) pending.push(join(current, entry.name))
  }
  return bytes
}

/**
 * Size of each path. Unix uses one `du` per batch; Windows uses a Node walker.
 *
 * `du -x` keeps it on one filesystem (a mounted disk image inside a worktree is
 * not this worktree's cost) and one invocation counts a hardlinked file once,
 * which matters for package managers that hardlink out of a shared store.
 */
async function measurePaths(paths: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (platform() === 'win32') {
    for (const path of paths) sizes.set(path, await measurePathPortable(path))
    return sizes
  }

  const BATCH = 60
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const { stdout, stderr, exitCode } = await runCommand('du', ['-skx', ...batch], {
      timeout: DU_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (exitCode !== 0) throw new Error(stderr || `du exited with code ${exitCode}`)
    for (const line of stdout.split('\n')) {
      const tab = line.indexOf('\t')
      if (tab === -1) continue
      const kb = Number(line.slice(0, tab))
      const path = line.slice(tab + 1)
      if (!Number.isFinite(kb)) continue
      sizes.set(path, kb * 1024)
    }
    for (const path of batch) {
      if (!sizes.has(path)) throw new Error(`du returned no size for ${path}`)
    }
  }
  return sizes
}

/**
 * What one worktree costs on disk, and how much of that is regenerable.
 *
 * `du` reports blocks actually allocated, so a file shared through an APFS
 * clone or a hardlink is counted for whichever paths reference it — the total
 * is what this worktree occupies, not necessarily what deleting it frees.
 */
export async function measureWorktreeDisk(worktreePath: string): Promise<WorktreeDiskMeasurement> {
  if (!existsSync(worktreePath)) {
    return { totalBytes: 0, reclaimableBytes: 0, entries: [], error: 'Folder is missing' }
  }

  try {
    const ignored = await listIgnoredDirectories(worktreePath)
    const reclaimable = ignored
      .filter((relativePath) => kindFor(relativePath) !== undefined)
      // A nested `node_modules/.cache` is already inside the parent's total.
      .filter((relativePath, _i, all) =>
        all.every((other) => other === relativePath || !relativePath.startsWith(other + '/'))
      )
      .sort()

    const sizes = await measurePaths([
      worktreePath,
      ...reclaimable.map((relativePath) => join(worktreePath, relativePath)),
    ])

    const entries: ReclaimableEntry[] = []
    for (const relativePath of reclaimable) {
      const bytes = sizes.get(join(worktreePath, relativePath))
      if (bytes === undefined || bytes === 0) continue
      entries.push({ path: relativePath, kind: kindFor(relativePath)!, bytes })
    }
    entries.sort((a, b) => b.bytes - a.bytes)

    return {
      totalBytes: sizes.get(worktreePath) ?? 0,
      reclaimableBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      entries,
    }
  } catch (err) {
    return { totalBytes: 0, reclaimableBytes: 0, entries: [], error: String(err) }
  }
}

export interface ReclaimResult {
  freedBytes: number
  removed: string[]
  errors: string[]
}

/**
 * Delete regenerable directories from a worktree, permanently.
 *
 * Not the Trash, deliberately: trashing a 600 MB `node_modules` frees nothing
 * until the Trash is emptied, and the whole point of the operation is the free
 * space. Every path is re-checked here rather than trusted from the renderer —
 * it has to sit inside the worktree, carry a known generated-directory name,
 * and still be ignored by git at the moment of deletion, so a path that became
 * tracked since it was measured is refused instead of deleted.
 */
export async function reclaimWorktreeSpace(
  worktreePath: string,
  relativePaths: string[]
): Promise<ReclaimResult> {
  const result: ReclaimResult = { freedBytes: 0, removed: [], errors: [] }
  if (!existsSync(worktreePath)) {
    result.errors.push(`${worktreePath} no longer exists.`)
    return result
  }

  for (const relativePath of relativePaths) {
    const absolute = resolve(worktreePath, relativePath)
    const inside = relative(worktreePath, absolute)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      result.errors.push(`${relativePath}: outside the worktree.`)
      continue
    }
    if (kindFor(absolute) === undefined) {
      result.errors.push(`${relativePath}: not a known generated directory.`)
      continue
    }
    if (!existsSync(absolute)) continue

    const ignored = await runGit(worktreePath, ['check-ignore', '-q', '--', inside])
    if (ignored.exitCode !== 0) {
      result.errors.push(`${relativePath}: git does not ignore this, so it was kept.`)
      continue
    }
    // An ignored parent can still contain force-added tracked files. Removing
    // the directory would erase their local modifications along with generated
    // content, so reject the entire candidate if git names any descendant.
    const tracked = await runGit(worktreePath, ['ls-files', '-z', '--', `${inside}/`], {
      raw: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (tracked.exitCode !== 0) {
      result.errors.push(`${relativePath}: could not verify tracked files, so it was kept.`)
      continue
    }
    if (tracked.stdout.length > 0) {
      result.errors.push(`${relativePath}: contains tracked files, so it was kept.`)
      continue
    }

    const sizes = await measurePaths([absolute]).catch(() => new Map<string, number>())
    try {
      await rm(absolute, { recursive: true, force: true })
      result.removed.push(inside)
      result.freedBytes += sizes.get(absolute) ?? 0
    } catch (err) {
      result.errors.push(`${relativePath}: ${String(err)}`)
    }
  }

  return result
}
