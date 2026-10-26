import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PullRequestLookup, Repository, Worktree } from '@worktree/contracts'
import { recheckRemovalStatus } from './removal-status.js'

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

test('local edit during a deferred provider lookup invalidates deletion status without refetching', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-removal-race-'))
  try {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.name', 'Fixture')
    git(dir, 'config', 'user.email', 'fixture@example.test')
    await writeFile(join(dir, 'file'), 'original')
    git(dir, 'add', 'file')
    git(dir, 'commit', '-qm', 'initial')
    git(dir, 'checkout', '-qb', 'feature')
    const repository: Repository = {
      id: 'repo',
      name: 'repo',
      path: dir,
      baseBranch: 'main',
      favorite: false,
      actions: [],
      provider: { type: 'github', organization: 'synthetic', repository: 'synthetic' },
    }
    const worktree: Worktree = {
      id: 'worktree',
      repositoryId: 'repo',
      path: dir,
      branch: 'feature',
      isMain: false,
      prunable: false,
    }
    let requests = 0
    let releaseProvider!: (result: PullRequestLookup) => void
    const providerResult = new Promise<PullRequestLookup>((resolve) => {
      releaseProvider = resolve
    })
    let announceStarted!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      announceStarted = resolve
    })
    const check = recheckRemovalStatus({
      worktree,
      repository,
      resolvePullRequest: async () => {
        requests++
        announceStarted()
        return providerResult
      },
    })
    await providerStarted
    await writeFile(join(dir, 'file'), 'changed while provider was pending')
    releaseProvider({ state: 'none', checkedAt: Date.now(), lastSuccessAt: Date.now() })
    const result = await check
    assert.equal(result.stable, false)
    assert.equal(result.status.dirty, true)
    assert.equal(requests, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
