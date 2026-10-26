import { expect, test } from 'bun:test'
import type { Worktree } from '@worktree/contracts'
import { reconcileSelection, selectAllVisible } from './worktreeSelection'

const row = (id: string, options: Partial<Worktree> = {}) =>
  ({ id, repositoryId: 'project', path: `/tmp/${id}`, branch: id, ...options }) as Worktree

test('select visible excludes primary and missing-folder entries, including dirty work', () => {
  const visible = [
    row('dirty'),
    row('unmerged'),
    row('primary', { isMain: true }),
    row('stale', { prunable: true }),
    row('setup', { postCreateSetupState: 'running' }),
  ]
  expect([...selectAllVisible(visible)]).toEqual(['dirty', 'unmerged'])
})

test('filtered-out selections cannot survive a view change', () => {
  expect([...reconcileSelection(new Set(['dirty', 'other-project']), [row('dirty')])]).toEqual([
    'dirty',
  ])
  expect([...reconcileSelection(new Set(['dirty']), [])]).toEqual([])
})
