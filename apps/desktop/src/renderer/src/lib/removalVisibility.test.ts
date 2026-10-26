import { describe, expect, test } from 'bun:test'
import { createRemovalVisibility } from './removalVisibility'

function fixture() {
  let nextId = 0
  const timers = new Map<number, () => void>()
  const clock = {
    setTimeout(callback: () => void) {
      const id = ++nextId
      timers.set(id, callback)
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
  } as unknown as Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>
  const visibility = createRemovalVisibility(clock)
  const advance = () => {
    const callbacks = [...timers.values()]
    timers.clear()
    callbacks.forEach((callback) => callback())
  }
  return { visibility, advance }
}

describe('removal state across Dashboard lifecycles', () => {
  test('stays hidden after a subscriber unmounts, then restores a failed row', () => {
    const { visibility, advance } = fixture()
    let seen = visibility.getSnapshot()
    const unsubscribe = visibility.subscribe(() => {
      seen = visibility.getSnapshot()
    })
    expect(visibility.begin('one')).toBe(true)
    unsubscribe() // navigate to Settings while backend work is pending
    advance()
    expect(visibility.getSnapshot()).toEqual({ one: 'hidden' })
    const remounted = visibility.subscribe(() => {
      seen = visibility.getSnapshot()
    })
    expect(visibility.getSnapshot()).toEqual({ one: 'hidden' })
    expect(visibility.begin('one')).toBe(false)
    visibility.fail({ worktreeId: 'one', repositoryId: 'repo', message: 'Hook failed' })
    expect(seen).toEqual({})
    expect(visibility.getFailure()?.message).toBe('Hook failed')
    remounted()
  })

  test('all confirmed bulk rows begin together and only failed ones return', () => {
    const { visibility, advance } = fixture()
    const confirmed = ['one', 'two', 'three'].filter((id) => visibility.begin(id))
    expect(confirmed).toEqual(['one', 'two', 'three'])
    advance()
    expect(visibility.getSnapshot()).toEqual({ one: 'hidden', two: 'hidden', three: 'hidden' })
    visibility.finish('one')
    visibility.fail({ worktreeId: 'two', repositoryId: 'repo', message: 'Delete rejected' })
    expect(visibility.getSnapshot()).toEqual({ three: 'hidden' })
    visibility.finish('three')
    expect(visibility.getSnapshot()).toEqual({})
  })
})
