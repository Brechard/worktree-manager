import { expect, test } from 'bun:test'
import type { PullRequestLookup } from '@worktree/contracts'
import { providerHealthVisible } from './providerHealthVisibility'

test('dashboard provider banner is issue-only, with brief successful retry feedback', () => {
  const state = (value: PullRequestLookup['state']): PullRequestLookup => ({
    state: value,
    checkedAt: 1,
  })
  expect(providerHealthVisible(undefined, false)).toBe(false)
  expect(providerHealthVisible(state('not-applicable'), false)).toBe(false)
  expect(providerHealthVisible(state('none'), false)).toBe(false)
  expect(providerHealthVisible(state('found'), false)).toBe(false)
  expect(providerHealthVisible(state('found'), true)).toBe(true)
  expect(providerHealthVisible(state('error'), false)).toBe(true)
  expect(providerHealthVisible(state('not-configured'), false)).toBe(true)
})
