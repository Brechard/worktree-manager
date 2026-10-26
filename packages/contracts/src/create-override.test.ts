import { expect, test } from 'bun:test'
import { createWorktreeRequestSchema, worktreeSchema } from './index.js'

test('setup override distinguishes inheritance from an explicit empty command', () => {
  const request = { repositoryId: 'repo', mode: 'new', branch: 'feature' }
  expect(createWorktreeRequestSchema.parse(request).postCreateCommandOverride).toBeUndefined()
  expect(
    createWorktreeRequestSchema.parse({ ...request, postCreateCommandOverride: '' })
      .postCreateCommandOverride
  ).toBe('')
  expect(
    createWorktreeRequestSchema.parse({ ...request, postCreateCommandOverride: 'exit 7' })
      .postCreateCommandOverride
  ).toBe('exit 7')
  const worktree = {
    id: 'worktree',
    repositoryId: 'repo',
    path: '/synthetic/worktree',
    branch: 'feature',
    postCreateCommandOverride: '',
  }
  expect(worktreeSchema.parse(worktree).postCreateCommandOverride).toBe('')
})
