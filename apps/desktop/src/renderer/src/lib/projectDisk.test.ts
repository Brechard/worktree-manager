import { describe, expect, test } from 'bun:test'
import type { Worktree, WorktreeDiskUsage } from '@worktree/contracts'
import { summarizeProjectDisk } from './projectDisk'

const worktree = (id: string): Worktree => ({
  id,
  repositoryId: 'repo',
  path: `/synthetic/${id}`,
  branch: id,
  isMain: false,
  prunable: false,
})

const usage = (
  id: string,
  totalBytes: number,
  reclaimableBytes: number,
  error?: string
): WorktreeDiskUsage => ({
  worktreeId: id,
  path: `/synthetic/${id}`,
  totalBytes,
  reclaimableBytes,
  entries: [],
  measuredAt: 1,
  ...(error ? { error } : {}),
})

describe('project disk summary', () => {
  test('excludes failed measurements and reports partial totals', () => {
    expect(
      summarizeProjectDisk(
        [worktree('good'), worktree('failed'), worktree('pending')],
        { good: usage('good', 500, 300), failed: usage('failed', 0, 0, 'read failed') },
        new Set(['pending'])
      )
    ).toEqual({
      totalBytes: 500,
      reclaimableBytes: 300,
      worktreeCount: 3,
      measuredCount: 1,
      errorCount: 1,
      measuring: true,
    })
  })

  test('marks a cached total as refreshing', () => {
    expect(
      summarizeProjectDisk([worktree('one')], { one: usage('one', 500, 300) }, new Set(['one']))
    ).toMatchObject({
      totalBytes: 500,
      measuredCount: 1,
      measuring: true,
    })
  })

  test('keeps a newly added worktree unknown when no measurement is running', () => {
    expect(
      summarizeProjectDisk(
        [worktree('measured'), worktree('new')],
        { measured: usage('measured', 500, 300) },
        new Set()
      )
    ).toMatchObject({
      totalBytes: 500,
      measuredCount: 1,
      worktreeCount: 2,
      measuring: false,
    })
  })

  test('keeps pending and zero-generated states distinct', () => {
    expect(summarizeProjectDisk([worktree('one')], {}, new Set())).toMatchObject({
      measuredCount: 0,
      errorCount: 0,
      measuring: false,
    })
    expect(
      summarizeProjectDisk([worktree('one')], { one: usage('one', 500, 0) }, new Set())
    ).toMatchObject({
      totalBytes: 500,
      reclaimableBytes: 0,
      measuredCount: 1,
      measuring: false,
    })
  })
})
