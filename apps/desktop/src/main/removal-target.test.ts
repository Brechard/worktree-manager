import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Repository, Worktree } from '@worktree/contracts'
import { verifiedRemovalTarget } from './removal-target.js'

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

test('removal target must match persisted records and Git membership', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wt-removal-'))
  const repo = join(fixture, 'repo')
  const linked = join(fixture, 'linked')
  const other = join(fixture, 'other')
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(repo))
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Fixture')
    git(repo, 'config', 'user.email', 'fixture@example.test')
    await writeFile(join(repo, 'file'), 'fixture')
    git(repo, 'add', 'file')
    git(repo, 'commit', '-qm', 'initial')
    git(repo, 'worktree', 'add', '-qb', 'feature', linked)
    const repository: Repository = {
      id: 'repo',
      name: 'repo',
      path: repo,
      baseBranch: 'main',
      favorite: false,
      actions: [],
    }
    const worktree: Worktree = {
      id: 'linked',
      repositoryId: 'repo',
      path: linked,
      branch: 'feature',
      isMain: false,
      prunable: false,
    }
    assert.equal(
      (await verifiedRemovalTarget(linked, repo, [repository], [worktree]))?.worktree.id,
      'linked'
    )
    assert.equal(await verifiedRemovalTarget(other, repo, [repository], [worktree]), undefined)
    assert.equal(
      await verifiedRemovalTarget(linked, repo, [repository], [{ ...worktree, isMain: true }]),
      undefined
    )
    assert.equal(await verifiedRemovalTarget(linked, other, [repository], [worktree]), undefined)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
