export type DashboardShortcut = 'new-worktree' | 'search' | 'settings'

export function isMacPlatform(): boolean {
  return /Mac/i.test(navigator.platform)
}

export function shortcutLabel(key: string, mac: boolean): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`
}

export function dashboardShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'metaKey'
    | 'ctrlKey'
    | 'altKey'
    | 'shiftKey'
    | 'repeat'
    | 'isComposing'
    | 'defaultPrevented'
  >,
  blocked: boolean,
  mac: boolean
): DashboardShortcut | null {
  if (
    blocked ||
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.shiftKey ||
    (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) ||
    event.isComposing
  )
    return null

  switch (event.key.toLowerCase()) {
    case 'n':
      return 'new-worktree'
    case 'f':
      return 'search'
    case ',':
      return 'settings'
    default:
      return null
  }
}
