import type { AppSettings, WorktreeLocation } from '@worktree/contracts'
import type { Theme } from './theme'

export interface SettingsDraftFields {
  dirs: string[]
  excluded: string[]
  editor: string
  terminal: string
  theme: Theme
  githubToken: string
  azureToken: string
  defaultWorktreeLocation: WorktreeLocation
  defaultWorktreeCustomParent: string
  includeAgentWorktrees: boolean
}

export function buildSettingsDraft(
  settings: AppSettings | null,
  fields: SettingsDraftFields
): AppSettings {
  const next: AppSettings = {
    ...settings,
    watchedDirectories: fields.dirs,
    excludedPaths: fields.excluded,
    defaultEditor: fields.editor,
    defaultWorktreeLocation: fields.defaultWorktreeLocation,
    includeAgentWorktrees: fields.includeAgentWorktrees,
    theme: fields.theme,
    worktreeSort: settings?.worktreeSort ?? 'activity',
    worktreeSortDirection: settings?.worktreeSortDirection ?? 'desc',
  }
  // Clear only the fields actually edited here; keep selection and sort preferences.
  if (fields.terminal) next.defaultTerminal = fields.terminal
  else delete next.defaultTerminal
  if (fields.githubToken) next.githubToken = fields.githubToken
  else delete next.githubToken
  if (fields.azureToken) next.azureToken = fields.azureToken
  else delete next.azureToken
  if (fields.defaultWorktreeCustomParent.trim())
    next.defaultWorktreeCustomParent = fields.defaultWorktreeCustomParent.trim()
  else delete next.defaultWorktreeCustomParent
  return next
}

export function settingsDraftChanged(settings: AppSettings | null, next: AppSettings): boolean {
  const normalize = (value: AppSettings | null) => ({
    ...value,
    watchedDirectories: [...(value?.watchedDirectories ?? [])].sort(),
    excludedPaths: [...(value?.excludedPaths ?? [])].sort(),
    defaultEditor: value?.defaultEditor ?? 'cursor',
    defaultTerminal: value?.defaultTerminal ?? '',
    theme: value?.theme ?? 'system',
    githubToken: value?.githubToken ?? '',
    azureToken: value?.azureToken ?? '',
    defaultWorktreeLocation: value?.defaultWorktreeLocation ?? 'sibling',
    defaultWorktreeCustomParent: value?.defaultWorktreeCustomParent ?? '',
    includeAgentWorktrees: value?.includeAgentWorktrees ?? false,
    worktreeSort: value?.worktreeSort ?? 'activity',
    worktreeSortDirection: value?.worktreeSortDirection ?? 'desc',
  })
  return JSON.stringify(normalize(settings)) !== JSON.stringify(normalize(next))
}
