import { describe, expect, test } from 'bun:test'
import type { AppSettings } from '@worktree/contracts'
import { buildSettingsDraft, settingsDraftChanged } from './settingsDraft'

const saved: AppSettings = {
  watchedDirectories: ['/fixture'],
  excludedPaths: [],
  defaultEditor: 'cursor',
  defaultTerminal: 'Terminal',
  defaultWorktreeLocation: 'sibling',
  includeAgentWorktrees: false,
  theme: 'light',
  githubToken: 'old',
  azureToken: 'azure',
  lastSelectedRepositoryId: 'repo',
  worktreeSort: 'name',
  worktreeSortDirection: 'asc',
}
const fields = {
  dirs: ['/fixture'],
  excluded: [],
  editor: 'cursor',
  terminal: 'Terminal',
  theme: 'light' as const,
  githubToken: 'old',
  azureToken: 'azure',
  defaultWorktreeLocation: 'sibling' as const,
  defaultWorktreeCustomParent: '',
  includeAgentWorktrees: false,
}

describe('Settings save and Back comparison', () => {
  test('unchanged settings do not prompt when going Back', () => {
    expect(settingsDraftChanged(saved, buildSettingsDraft(saved, fields))).toBe(false)
  })
  test('replacement changes only the token and keeps selection', () => {
    const next = buildSettingsDraft(saved, { ...fields, githubToken: 'new' })
    expect(next.githubToken).toBe('new')
    expect(next.lastSelectedRepositoryId).toBe('repo')
    expect(settingsDraftChanged(saved, next)).toBe(true)
  })
  test('clearing optional tokens and terminal removes them and prompts on Back', () => {
    const next = buildSettingsDraft(saved, {
      ...fields,
      terminal: '',
      githubToken: '',
      azureToken: '',
    })
    expect(next).not.toHaveProperty('defaultTerminal')
    expect(next).not.toHaveProperty('githubToken')
    expect(next).not.toHaveProperty('azureToken')
    expect(next.lastSelectedRepositoryId).toBe('repo')
    expect(settingsDraftChanged(saved, next)).toBe(true)
  })
  test('persists scan opt-in and clears custom worktree parent', () => {
    const previous = {
      ...saved,
      defaultWorktreeLocation: 'custom' as const,
      defaultWorktreeCustomParent: '/tmp/old',
    }
    const next = buildSettingsDraft(previous, {
      ...fields,
      defaultWorktreeLocation: 'sibling',
      defaultWorktreeCustomParent: '',
      includeAgentWorktrees: true,
    })
    expect(next.includeAgentWorktrees).toBe(true)
    expect(next).not.toHaveProperty('defaultWorktreeCustomParent')
    expect(settingsDraftChanged(previous, next)).toBe(true)
  })
})
