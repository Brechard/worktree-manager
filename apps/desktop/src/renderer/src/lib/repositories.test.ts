import { expect, test } from 'bun:test'
import type { Repository } from '@worktree/contracts'
import { mergeDiscoveredRepository } from './repositories'

const discovered: Repository = {
  id: 'project',
  name: 'Project',
  path: '/tmp/project',
  baseBranch: 'main',
  favorite: false,
  actions: [],
}

test('a rescan keeps the configured base and creation settings', () => {
  const saved: Repository = {
    ...discovered,
    baseBranch: 'dev',
    postCreateCommand: 'bun install',
    worktreeLocation: 'custom',
    worktreeCustomParent: '/tmp/workspaces',
  }
  expect(mergeDiscoveredRepository(discovered, saved)).toMatchObject({
    baseBranch: 'dev',
    postCreateCommand: 'bun install',
    worktreeLocation: 'custom',
    worktreeCustomParent: '/tmp/workspaces',
  })
  expect(mergeDiscoveredRepository(discovered, undefined).baseBranch).toBe('main')
})
