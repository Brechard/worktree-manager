import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanupCandidacy,
  isSafeToDelete,
  worktreeSafetyReasons,
  type Worktree,
  type WorktreeStatus,
} from './index.js'

const worktree: Worktree = {
  id: 'w',
  repositoryId: 'r',
  path: '/fixture/feature',
  branch: 'feature',
  isMain: false,
  prunable: false,
}
const status: WorktreeStatus = {
  worktreeId: 'w',
  dirty: false,
  staged: false,
  hasUntracked: false,
  ahead: 0,
  behind: 0,
  unpushed: 0,
  mergedIntoBase: true,
  hasMergedBranchHistory: true,
  baseBranch: 'main',
  hasOpenPR: false,
  behindBase: 0,
  aheadBase: 0,
  mergeCommits: 0,
  branch: 'feature',
  headCommit: 'abcdef1',
  providerConfigured: true,
  prLookup: {
    state: 'error',
    checkedAt: 100,
    error: { kind: 'authentication', message: 'Auth failed' },
  },
}

test('configured provider error blocks safety and cleanup', () => {
  assert.match(worktreeSafetyReasons(worktree, status).join(' '), /Could not verify/)
  assert.equal(cleanupCandidacy(worktree, status), undefined)
})

test('no-provider workflow remains eligible', () => {
  const local = {
    ...status,
    providerConfigured: false,
    prLookup: { state: 'not-configured' as const, checkedAt: 100 },
  }
  assert.deepEqual(cleanupCandidacy(worktree, local), {
    kind: 'ready',
    branch: 'feature',
    reasons: [],
  })
})

test('a fresh branch at base is not completed work even when it has real source edits', () => {
  const fresh = {
    ...status,
    providerConfigured: false,
    prLookup: { state: 'not-configured' as const, checkedAt: 100 },
    hasMergedBranchHistory: false,
    dirty: true,
  }
  assert.equal(cleanupCandidacy(worktree, fresh), undefined)
  assert.match(worktreeSafetyReasons(worktree, fresh).join(' '), /uncommitted changes/)
  assert.match(
    worktreeSafetyReasons(worktree, { ...fresh, dirty: false }).join(' '),
    /completed branch work/
  )
  assert.equal(isSafeToDelete(worktree, { ...fresh, dirty: false }), false)
})

test('completed local branch with dirty contents remains a review candidate', () => {
  const completed = {
    ...status,
    providerConfigured: false,
    prLookup: { state: 'not-configured' as const, checkedAt: 100 },
    dirty: true,
  }
  assert.equal(cleanupCandidacy(worktree, completed)?.kind, 'review')
})

test('historical merged PR cannot prove a reused branch landed', () => {
  const old = {
    ...status,
    mergedIntoBase: false,
    prLookup: { state: 'found' as const, checkedAt: 100 },
    pullRequest: {
      id: 'pr',
      title: 'Old',
      url: 'https://example.com/pr',
      state: 'merged' as const,
      branch: 'feature',
      targetBranch: 'main',
      headCommit: '123456789',
    },
  }
  assert.equal(cleanupCandidacy(worktree, old), undefined)
})

test('an ambiguous short SHA cannot prove a squash merge', () => {
  const short = {
    ...status,
    mergedIntoBase: false,
    headCommit: 'abc1234',
    prLookup: { state: 'found' as const, checkedAt: 100 },
    pullRequest: {
      id: 'pr',
      title: 'Merged',
      url: 'https://example.com/pr',
      state: 'merged' as const,
      branch: 'feature',
      targetBranch: 'main',
      headCommit: 'abc1234fffffffffffffffffffffffffffffffff',
    },
  }
  assert.equal(cleanupCandidacy(worktree, short), undefined)
  assert.equal(
    cleanupCandidacy(worktree, { ...short, headCommit: short.pullRequest.headCommit })?.kind,
    'ready'
  )
  assert.equal(
    isSafeToDelete(worktree, { ...short, headCommit: short.pullRequest.headCommit }),
    true
  )
})

test('a found state without a matching PR is not clearance', () => {
  const malformed = { ...status, prLookup: { state: 'found' as const, checkedAt: 100 } }
  assert.match(worktreeSafetyReasons(worktree, malformed).join(' '), /Could not verify/)
  assert.equal(cleanupCandidacy(worktree, malformed), undefined)
})

test('safety does not clear an imported or stale merged PR for another branch', () => {
  const otherBranch = {
    ...status,
    mergedIntoBase: false,
    hasMergedBranchHistory: false,
    headCommit: 'a'.repeat(40),
    prLookup: { state: 'found' as const, checkedAt: 100 },
    pullRequest: {
      id: 'pr',
      title: 'Other branch',
      url: 'https://example.com/pr',
      state: 'merged' as const,
      branch: 'other',
      targetBranch: 'main',
      headCommit: 'a'.repeat(40),
    },
  }
  assert.equal(isSafeToDelete(worktree, otherBranch), false)
  assert.equal(cleanupCandidacy(worktree, otherBranch), undefined)
})

test('failed base fetch and base checkout are never safe for automatic removal', () => {
  assert.equal(isSafeToDelete(worktree, { ...status, baseFetchError: 'fetch failed' }), false)
  assert.equal(cleanupCandidacy(worktree, { ...status, baseFetchError: 'fetch failed' }), undefined)
  assert.equal(isSafeToDelete(worktree, { ...status, branch: 'main' }), false)
  assert.equal(cleanupCandidacy(worktree, { ...status, branch: 'main' }), undefined)
})
