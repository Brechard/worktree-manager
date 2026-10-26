import { describe, expect, test } from 'bun:test'
import { dashboardShortcut } from './dashboardShortcut'

const key = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...overrides,
})

describe('dashboard shortcuts', () => {
  test('maps the three non-destructive dashboard actions', () => {
    expect(dashboardShortcut(key('n'), false, true)).toBe('new-worktree')
    expect(dashboardShortcut(key('F', { metaKey: false, ctrlKey: true }), false, false)).toBe(
      'search'
    )
    expect(dashboardShortcut(key(','), false, true)).toBe('settings')
  })

  test('does not handle a modal, composition, repeats, or extra modifiers', () => {
    expect(dashboardShortcut(key('n'), true, true)).toBeNull()
    expect(dashboardShortcut(key('n', { isComposing: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { repeat: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { shiftKey: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { altKey: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { defaultPrevented: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { metaKey: false }), false, true)).toBeNull()
    expect(dashboardShortcut(key('n', { metaKey: false, ctrlKey: true }), false, true)).toBeNull()
    expect(dashboardShortcut(key('x'), false, true)).toBeNull()
  })
})
