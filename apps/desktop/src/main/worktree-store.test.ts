import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Worktree } from '@worktree/contracts'
import { createWorktreeStore } from './worktree-store.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const row = (id: string): Worktree => ({
  id,
  repositoryId: 'repo',
  path: `/synthetic/${id}`,
  branch: id,
  isMain: false,
  prunable: false,
})

test('stale renderer saves retain created setup state but never revive removed rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-store-review-'))
  roots.push(root)
  const store = createWorktreeStore(join(root, 'config', 'worktrees.json'))
  const original = row('main')
  const created = { ...row('new'), postCreateSetupState: 'running' as const }
  await store.saveSnapshot([original])
  await store.upsertCreated(created)
  const staleRunning = (await store.read()).find((item) => item.id === created.id)!
  await store.update(created.id, {
    postCreateSetupState: undefined,
    postCreateSetup: { success: false, output: 'exit 7' },
  })
  await store.saveSnapshot([original])
  expect((await store.read()).find((item) => item.id === created.id)?.postCreateSetup).toEqual({
    success: false,
    output: 'exit 7',
  })
  expect(
    (await store.read()).find((item) => item.id === created.id)?.postCreateSetupState
  ).toBeUndefined()
  const staleFailure = (await store.read()).find((item) => item.id === created.id)!
  await store.update(created.id, { postCreateSetup: { success: true, output: 'ready' } })
  await store.saveSnapshot([original, staleRunning])
  await store.saveSnapshot([original, staleFailure])
  expect((await store.read()).find((item) => item.id === created.id)?.postCreateSetup).toEqual({
    success: true,
    output: 'ready',
  })
  expect(
    (await store.read()).find((item) => item.id === created.id)?.postCreateSetupState
  ).toBeUndefined()
  await store.remove(created.id)
  await store.saveSnapshot([original, created])
  expect((await store.read()).map((item) => item.id)).toEqual(['main'])
  await store.upsertCreated({ ...created, postCreateSetupState: undefined })
  expect((await store.read()).map((item) => item.id)).toEqual(['main', 'new'])
})

test('concurrent creations serialize and retain both rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-store-review-'))
  roots.push(root)
  const store = createWorktreeStore(join(root, 'worktrees.json'))
  await Promise.all([store.upsertCreated(row('one')), store.upsertCreated(row('two'))])
  expect(new Set((await store.read()).map((item) => item.id))).toEqual(new Set(['one', 'two']))
  const stale = await store.read()
  await Promise.all([store.upsertCreated(row('three')), store.saveSnapshot(stale)])
  expect(new Set((await store.read()).map((item) => item.id))).toEqual(
    new Set(['one', 'two', 'three'])
  )
})
