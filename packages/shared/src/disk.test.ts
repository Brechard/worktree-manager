import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { measureWorktreeDiskPortable, reclaimWorktreeSpace } from './disk.js'

async function withTemporaryRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'worktree-disk-test-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(cwd, 'isolated-gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `git exited with ${result.status}`)
}

describe('portable worktree disk measurement', () => {
  test('counts the tree and allowed ignored subtrees once without following symlinks', async () => {
    await withTemporaryRoot(async (temporaryRoot) => {
      const worktree = join(temporaryRoot, 'worktree')
      const outsideFile = join(temporaryRoot, 'outside.txt')
      const linkPath = join(worktree, 'node_modules', 'outside-link')
      await mkdir(join(worktree, 'node_modules', '.cache'), { recursive: true })
      await mkdir(join(worktree, 'src'), { recursive: true })
      await writeFile(join(worktree, 'src', 'source.txt'), 'source bytes')
      await writeFile(join(worktree, 'node_modules', 'package.txt'), 'dependency bytes')
      await writeFile(join(worktree, 'node_modules', '.cache', 'entry.txt'), 'cache bytes')
      await writeFile(outsideFile, 'outside the worktree and larger than the link')
      await symlink(outsideFile, linkPath)

      const linkBytes = (await lstat(linkPath)).size
      const sourceBytes = Buffer.byteLength('source bytes')
      const dependencyBytes = Buffer.byteLength('dependency bytes')
      const cacheBytes = Buffer.byteLength('cache bytes')
      const measurement = await measureWorktreeDiskPortable(worktree, [
        'node_modules',
        'node_modules/.cache',
        '../outside/node_modules',
        'src',
      ])

      expect(measurement.totalBytes).toBe(sourceBytes + dependencyBytes + cacheBytes + linkBytes)
      expect(measurement.reclaimableBytesByPath).toEqual(
        new Map([['node_modules', dependencyBytes + cacheBytes + linkBytes]])
      )
      expect(await lstat(outsideFile)).toBeDefined()
    })
  })
})

describe('worktree space reclamation safeguards', () => {
  test('keeps tracked and non-ignored descendants, rejects escapes, and unlinks without following symlinks', async () => {
    await withTemporaryRoot(async (temporaryRoot) => {
      const worktree = join(temporaryRoot, 'worktree')
      const outsideNodeModules = join(temporaryRoot, 'outside', 'node_modules')
      const outsideFile = join(temporaryRoot, 'outside', 'valuable.txt')
      const distLink = join(worktree, 'dist', 'outside-link')
      await mkdir(join(worktree, 'node_modules'), { recursive: true })
      await mkdir(join(worktree, 'dist'), { recursive: true })
      await mkdir(join(worktree, 'out'), { recursive: true })
      await mkdir(outsideNodeModules, { recursive: true })
      await writeFile(join(worktree, '.gitignore'), 'node_modules/\ndist/\n')
      await writeFile(join(worktree, 'node_modules', 'tracked.txt'), 'keep this tracked file')
      await writeFile(join(worktree, 'node_modules', 'generated.txt'), 'generated dependency')
      await writeFile(join(worktree, 'dist', 'bundle.js'), 'generated build')
      await writeFile(join(worktree, 'out', 'local.txt'), 'not ignored')
      await writeFile(outsideFile, 'outside data that must survive')
      await writeFile(join(outsideNodeModules, 'sentinel.txt'), 'outside candidate')
      await symlink(outsideFile, distLink)
      git(worktree, ['init', '--quiet'])
      git(worktree, ['add', '--force', '--', 'node_modules/tracked.txt'])

      const result = await reclaimWorktreeSpace(worktree, [
        '../outside/node_modules',
        'node_modules',
        'dist',
        'out',
      ])

      expect(result.removed).toEqual(['dist'])
      expect(result.errors).toContain('../outside/node_modules: outside the worktree.')
      expect(result.errors).toContain('node_modules: contains tracked files, so it was kept.')
      expect(result.errors).toContain('out: git does not ignore this, so it was kept.')
      expect(await Bun.file(join(worktree, 'node_modules', 'tracked.txt')).exists()).toBe(true)
      expect(await Bun.file(join(worktree, 'node_modules', 'generated.txt')).exists()).toBe(true)
      expect(await Bun.file(join(worktree, 'dist')).exists()).toBe(false)
      expect(await Bun.file(outsideFile).text()).toBe('outside data that must survive')
      expect(await Bun.file(join(outsideNodeModules, 'sentinel.txt')).text()).toBe(
        'outside candidate'
      )
    })
  })
})
