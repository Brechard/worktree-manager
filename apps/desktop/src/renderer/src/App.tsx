import { useEffect, useState } from 'react'
import type { ScanProgress } from '@worktree/contracts'
import { useAppStore } from './store'
import { loadStartupData } from './lib/loadStartupData'
import { api } from './api'
import { Onboarding } from './components/Onboarding'
import { Dashboard } from './components/Dashboard'
import { Loading } from './components/Loading'
import { Settings } from './components/Settings'
import { TitleBar } from './components/TitleBar'
import { applyTheme } from './lib/theme'
import { removalVisibility, removedWorktreePaths } from './lib/removalVisibility'

export default function App() {
  const {
    view,
    settingsSection,
    setView,
    setSettings,
    setRepositories,
    setWorktrees,
    setSelectedRepositoryId,
  } = useAppStore()
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    // Main owns persistence; this subscription stays mounted when the create
    // dialog or dashboard closes, so a long-running setup remains visible.
    return api.onWorktreeCreationProgress((progress) => {
      const worktree = progress.worktree
      if (!worktree) return
      // A newly registered checkout may reuse a previously removed path.
      if (progress.stage === 'registered') removedWorktreePaths.delete(worktree.path)
      if (removedWorktreePaths.has(worktree.path) || removalVisibility.isPending(worktree.id))
        return
      useAppStore.getState().upsertWorktree(worktree)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let removeScanProgress: (() => void) | undefined
    void loadStartupData(
      (settings) => {
        if (cancelled) return
        applyTheme(settings.theme)
        setSettings(settings)
      },
      (value) => {
        if (!cancelled) setScanning(value)
      },
      () => {
        removeScanProgress = api.onScanProgress((progress) => {
          if (!cancelled) setScanProgress(progress)
        })
        return () => {
          removeScanProgress?.()
          removeScanProgress = undefined
        }
      },
      () => cancelled
    )
      .then((data) => {
        if (cancelled || !data) return
        const { settings, repositories, worktrees } = data
        setRepositories(repositories)
        setWorktrees(worktrees)
        if (repositories.length > 0) {
          const last = settings.lastSelectedRepositoryId
          const selectedRepo =
            (last && repositories.find((repo) => repo.id === last)) ||
            [...repositories]
              .sort((a, b) => a.name.localeCompare(b.name))
              .find((repo) => repo.favorite) ||
            repositories[0]!
          setSelectedRepositoryId(selectedRepo.id)
          setView('dashboard')
        } else {
          setView('onboarding')
        }
        setReady(true)
      })
      .catch((error) => {
        if (!cancelled) setBootError(String(error))
      })
    return () => {
      cancelled = true
      removeScanProgress?.()
    }
  }, [setSettings, setRepositories, setWorktrees, setView, setSelectedRepositoryId])

  if (bootError) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar title="Worktree Manager" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-destructive">Failed to start</p>
          <p className="max-w-md text-xs text-muted">{bootError}</p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar title="Worktree Manager" />
        <div className="flex flex-1 items-center justify-center">
          <Loading
            message={scanning ? 'Scanning…' : 'Loading…'}
            subMessage={
              scanning && scanProgress
                ? `${scanProgress.found} found · ${scanProgress.current} folders`
                : undefined
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {view === 'onboarding' && <Onboarding />}
      {view === 'dashboard' && <Dashboard />}
      {view === 'dashboard' && settingsSection && <Settings initialSection={settingsSection} />}
    </div>
  )
}
