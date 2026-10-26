import { useEffect } from 'react'
import { dashboardShortcut, isMacPlatform } from '../lib/dashboardShortcut'

/** Keyboard actions for the visible dashboard, leaving dialogs and text editing alone. */
export function useDashboardShortcuts({
  selectedRepositoryId,
  openNewWorktree,
  openSettings,
}: {
  selectedRepositoryId: string | null
  openNewWorktree: (repositoryId: string) => void
  openSettings: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const blocked = Boolean(document.querySelector('dialog[open]'))
      switch (dashboardShortcut(event, blocked, isMacPlatform())) {
        case 'new-worktree':
          if (!selectedRepositoryId) return
          event.preventDefault()
          openNewWorktree(selectedRepositoryId)
          break
        case 'search':
          event.preventDefault()
          document.getElementById('worktree-search')?.focus()
          break
        case 'settings':
          event.preventDefault()
          openSettings()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRepositoryId, openNewWorktree, openSettings])
}
