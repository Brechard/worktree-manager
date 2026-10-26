import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import type { Repository, Worktree } from '@worktree/contracts'
import { cleanupCandidacy } from '@worktree/contracts'
import { clearPullRequestHistory, getWorktreeStatus } from './status.js'

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

test('last-known PR stays display-only for the exact repository, branch and head', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-pr-history-'))
  clearPullRequestHistory()
  try {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.name', 'Fixture')
    git(dir, 'config', 'user.email', 'fixture@example.test')
    await writeFile(join(dir, 'file'), 'fixture')
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
      provider: { type: 'github', organization: 'owner', repository: 'repo' },
    }
    const worktree: Worktree = {
      id: 'worktree',
      repositoryId: 'repo',
      path: dir,
      branch: 'feature',
      isMain: false,
      prunable: false,
    }
    const found = await getWorktreeStatus({
      worktree,
      repository,
      resolvePullRequest: async () => ({
        state: 'found',
        checkedAt: 100,
        lastSuccessAt: 100,
        pullRequest: {
          id: 'pr',
          title: 'Open',
          url: 'https://example.test/pr',
          state: 'open',
          branch: 'feature',
        },
      }),
    })
    assert.equal(found.hasOpenPR, true)
    assert.match(found.headCommit ?? '', /^[a-f0-9]{40}$/)
    clearPullRequestHistory({
      providerTypes: new Set(['azure']),
      repositoryIds: new Set(['other']),
    })
    const failed = await getWorktreeStatus({
      worktree,
      repository,
      resolvePullRequest: async () => ({
        state: 'error',
        checkedAt: 200,
        error: { kind: 'network', message: 'Unavailable' },
      }),
    })
    assert.equal(failed.pullRequest?.id, 'pr')
    assert.equal(failed.hasOpenPR, false)
    assert.equal(failed.prLookup?.lastSuccessAt, 100)
    clearPullRequestHistory({ repositoryIds: new Set(['repo']) })
    const invalidated = await getWorktreeStatus({
      worktree,
      repository,
      resolvePullRequest: async () => ({
        state: 'error',
        checkedAt: 201,
        error: { kind: 'network', message: 'Unavailable' },
      }),
    })
    assert.equal(invalidated.pullRequest, undefined)
    const other = await getWorktreeStatus({
      worktree: { ...worktree, repositoryId: 'other' },
      repository: { ...repository, id: 'other' },
      resolvePullRequest: async () => ({
        state: 'error',
        checkedAt: 200,
        error: { kind: 'network', message: 'Unavailable' },
      }),
    })
    assert.equal(other.pullRequest, undefined)
    git(dir, 'commit', '--allow-empty', '-qm', 'new head')
    const newHead = await getWorktreeStatus({
      worktree,
      repository,
      resolvePullRequest: async () => ({
        state: 'error',
        checkedAt: 300,
        error: { kind: 'network', message: 'Unavailable' },
      }),
    })
    assert.equal(newHead.pullRequest, undefined)
  } finally {
    clearPullRequestHistory()
    await rm(dir, { recursive: true, force: true })
  }
})

test('local completion evidence requires a branch commit, then a merge into base', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-completion-'))
  const repo = join(root, 'repo')
  const linked = join(root, 'feature')
  try {
    await mkdir(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Fixture')
    git(repo, 'config', 'user.email', 'fixture@example.test')
    await writeFile(join(repo, 'source.ts'), 'export const value = 1\n')
    git(repo, 'add', 'source.ts')
    git(repo, 'commit', '-qm', 'initial')
    git(repo, 'worktree', 'add', '-qb', 'feature', linked, 'main')
    const repository: Repository = {
      id: 'repo',
      name: 'repo',
      path: repo,
      baseBranch: 'main',
      favorite: false,
      actions: [],
    }
    const worktree: Worktree = {
      id: 'feature',
      repositoryId: 'repo',
      path: linked,
      branch: 'feature',
      isMain: false,
      prunable: false,
    }
    await writeFile(join(linked, 'source.ts'), 'export const value = 2\n')
    const fresh = await getWorktreeStatus({ worktree, repository })
    assert.equal(fresh.mergedIntoBase, true)
    assert.equal(fresh.dirty, true)
    assert.equal(fresh.hasMergedBranchHistory, false)
    assert.equal(fresh.hasRemote, false)
    assert.equal(fresh.hasUpstream, false)
    assert.equal(cleanupCandidacy(worktree, fresh), undefined)

    git(linked, 'add', 'source.ts')
    git(linked, 'commit', '-qm', 'feature work')
    git(repo, 'merge', '--ff-only', 'feature')
    await writeFile(join(linked, 'source.ts'), 'export const value = 3\n')
    const merged = await getWorktreeStatus({ worktree, repository })
    assert.equal(merged.mergedIntoBase, true)
    assert.equal(merged.hasMergedBranchHistory, true)
    assert.equal(cleanupCandidacy(worktree, merged)?.kind, 'review')

    const advanced = join(root, 'advanced')
    git(repo, 'worktree', 'add', '-qb', 'advanced', advanced, 'main')
    await writeFile(join(repo, 'base.txt'), 'new base work\n')
    git(repo, 'add', 'base.txt')
    git(repo, 'commit', '-qm', 'base advances')
    git(advanced, 'merge', '--ff-only', 'main')
    const advancedWorktree = { ...worktree, id: 'advanced', path: advanced, branch: 'advanced' }
    const fastForwarded = await getWorktreeStatus({ worktree: advancedWorktree, repository })
    assert.equal(fastForwarded.mergedIntoBase, true)
    assert.equal(fastForwarded.hasMergedBranchHistory, false)
    assert.equal(cleanupCandidacy(advancedWorktree, fastForwarded), undefined)

    const reset = join(root, 'reset')
    git(repo, 'worktree', 'add', '-qb', 'reset-only', reset, 'main')
    await writeFile(join(reset, 'reset.txt'), 'temporary branch commit\n')
    git(reset, 'add', 'reset.txt')
    git(reset, 'commit', '-qm', 'unmerged work')
    git(reset, 'reset', '--hard', 'main')
    const resetWorktree = { ...worktree, id: 'reset', path: reset, branch: 'reset-only' }
    const resetStatus = await getWorktreeStatus({ worktree: resetWorktree, repository })
    assert.equal(resetStatus.mergedIntoBase, true)
    assert.equal(resetStatus.hasMergedBranchHistory, false)
    assert.equal(cleanupCandidacy(resetWorktree, resetStatus), undefined)

    const remote = join(root, 'remote.git')
    await mkdir(remote)
    git(remote, 'init', '--bare', '-q')
    git(repo, 'remote', 'add', 'origin', remote)
    const configuredRemote = await getWorktreeStatus({ worktree: advancedWorktree, repository })
    assert.equal(configuredRemote.hasRemote, true)
    assert.equal(configuredRemote.hasUpstream, false)
    git(advanced, 'push', '-u', 'origin', 'advanced')
    const published = await getWorktreeStatus({ worktree: advancedWorktree, repository })
    assert.equal(published.hasRemote, true)
    assert.equal(published.hasUpstream, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
