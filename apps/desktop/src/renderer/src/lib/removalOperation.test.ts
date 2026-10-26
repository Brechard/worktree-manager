import { describe, expect, test } from 'bun:test'
import { createRemovalVisibility } from './removalVisibility'
import { runRemovalOperation, type RemovalBackendResult } from './removalOperation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function operation() {
  const visibility = createRemovalVisibility()
  const events: string[] = []
  const list = ['fixture']
  let status = 'newer refresh'
  const hooks = deferred<boolean>()
  const backend = deferred<RemovalBackendResult>()
  const args = {
    id: 'fixture',
    visibility,
    cleanup: async () => {
      events.push('hook')
      return hooks.promise
    },
    remove: async () => {
      events.push('backend')
      return backend.promise
    },
    commit: () => {
      events.push('commit')
      list.splice(0, 1)
    },
    persist: async () => {
      events.push('persist')
    },
    refreshAfterFailure: () => {
      events.push('refresh')
      status = 'fresh status requested'
    },
    waitForSweep: async () => {
      events.push('sweep')
    },
  }
  return { visibility, events, list, hooks, backend, args, getStatus: () => status }
}

describe('confirmed async removal', () => {
  test('hook cancellation restores visibility, preserves latest data and never calls delete', async () => {
    const f = operation()
    const running = runRemovalOperation(f.args)
    expect(f.visibility.getSnapshot()).toEqual({ fixture: 'sweeping' })
    expect(f.visibility.begin('fixture')).toBe(false)
    f.hooks.resolve(false)
    expect(await running).toEqual({
      deleted: false,
      error: 'Removal cancelled after the cleanup command failed.',
    })
    expect(f.events).toEqual(['hook', 'refresh'])
    expect(f.list).toEqual(['fixture'])
    expect(f.getStatus()).toBe('fresh status requested')
    expect(f.visibility.getSnapshot()).toEqual({})
  })

  test('backend rejection preserves authoritative row and requests fresh status', async () => {
    const f = operation()
    const running = runRemovalOperation(f.args)
    f.hooks.resolve(true)
    await f.hooks.promise
    f.backend.resolve({ success: false, error: 'Permanent removal blocked' })
    expect(await running).toEqual({ deleted: false, error: 'Permanent removal blocked' })
    expect(f.events).toEqual(['hook', 'backend', 'refresh'])
    expect(f.list).toEqual(['fixture'])
  })

  test('branch warning follows successful removal without rollback', async () => {
    const f = operation()
    const running = runRemovalOperation(f.args)
    f.hooks.resolve(true)
    f.backend.resolve({ success: true, branchError: 'Branch kept' })
    expect(await running).toEqual({ deleted: true, error: 'Branch kept' })
    expect(f.events).toEqual(['hook', 'backend', 'sweep', 'commit', 'persist'])
    expect(f.list).toEqual([])
    expect(f.visibility.getSnapshot()).toEqual({})
  })

  test('persistence failure after successful backend removal does not restore a deleted row', async () => {
    const f = operation()
    const running = runRemovalOperation({
      ...f.args,
      persist: async () => {
        throw new Error('disk full')
      },
    })
    f.hooks.resolve(true)
    f.backend.resolve({ success: true })
    const result = await running
    expect(result.deleted).toBe(true)
    expect(result.error).toContain('list could not be saved')
    expect(f.list).toEqual([])
    expect(f.events).not.toContain('refresh')
  })
})

test('bulk preclaims every confirmed row, skips duplicate single clicks and restores only backend failures', async () => {
  const visibility = createRemovalVisibility()
  const authoritative = ['one', 'two', 'three']
  const claimed = authoritative.filter((id) => visibility.begin(id))
  expect(claimed).toEqual(['one', 'two', 'three'])
  let duplicateBackendCalls = 0
  expect(
    await runRemovalOperation({
      id: 'one',
      visibility,
      cleanup: async () => true,
      remove: async () => {
        duplicateBackendCalls++
        return { success: true }
      },
      commit: () => {},
      persist: async () => {},
      refreshAfterFailure: () => {},
    })
  ).toEqual({ deleted: false })
  expect(duplicateBackendCalls).toBe(0)
  for (const id of claimed) {
    const outcome = await runRemovalOperation({
      id,
      visibility,
      preclaimed: true,
      cleanup: async () => true,
      remove: async () =>
        id === 'two' ? { success: false, error: 'Rejected' } : { success: true },
      commit: () => {
        authoritative.splice(authoritative.indexOf(id), 1)
      },
      persist: async () => {},
      refreshAfterFailure: () => {},
    })
    expect(outcome.deleted).toBe(id !== 'two')
    if (id === 'one')
      expect(visibility.getSnapshot()).toEqual({ two: 'sweeping', three: 'sweeping' })
    if (id === 'two') expect(visibility.getSnapshot()).toEqual({ three: 'sweeping' })
  }
  expect(authoritative).toEqual(['two'])
  expect(visibility.getSnapshot()).toEqual({})
})
