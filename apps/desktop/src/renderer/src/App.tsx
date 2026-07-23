import { useEffect, useState } from 'react'
import { useAppStore } from './store'
import { api } from './api'
import { Onboarding } from './components/Onboarding'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { TitleBar } from './components/TitleBar'

export default function App() {
  const { view, setView, setSettings, setRepositories, setWorktrees, setSelectedRepositoryId } =
    useAppStore()
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        if (!window.api) {
          throw new Error('Electron API is not available. Restart the desktop app.')
        }
        const [settings, repositories, worktrees] = await Promise.all([
          api.getSettings(),
          api.getRepositories(),
          api.getWorktrees(),
        ])
        if (cancelled) return
        setSettings(settings)
        setRepositories(repositories)
        setWorktrees(worktrees)

        if (repositories.length > 0) {
          setSelectedRepositoryId(repositories[0]!.id)
          setView('dashboard')
        } else {
          setView('onboarding')
        }
        setReady(true)
      } catch (err) {
        if (!cancelled) setBootError(String(err))
      }
    }
    init()
    return () => {
      cancelled = true
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
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {view === 'onboarding' && <Onboarding />}
      {view === 'dashboard' && <Dashboard />}
      {view === 'settings' && <Settings />}
    </div>
  )
}
