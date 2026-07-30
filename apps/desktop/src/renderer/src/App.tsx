import { useEffect, useState } from 'react'
import type { Repository, ScanProgress, Worktree } from '@worktree/contracts'
import { useAppStore } from './store'
import { api } from './api'
import { Onboarding } from './components/Onboarding'
import { Dashboard } from './components/Dashboard'
import { Loading } from './components/Loading'
import { Settings } from './components/Settings'
import { TitleBar } from './components/TitleBar'
import { applyTheme } from './lib/theme'

export default function App() {
  const { view, setView, setSettings, setRepositories, setWorktrees, setSelectedRepositoryId } =
    useAppStore()
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    let removeScanProgress: (() => void) | undefined
    async function init() {
      try {
        if (!window.api) {
          throw new Error('Electron API is not available. Restart the desktop app.')
        }
        const [settings, existingRepos, existingWorktrees] = await Promise.all([
          api.getSettings(),
          api.getRepositories(),
          api.getWorktrees(),
        ])
        if (cancelled) return
        applyTheme(settings.theme)
        setSettings(settings)

        let repositories = existingRepos
        let worktrees = existingWorktrees

        const roots = new Set<string>()
        for (const dir of settings?.watchedDirectories ?? []) {
          if (dir.trim().length > 0) roots.add(dir)
        }
        for (const r of existingRepos) {
          if (r.path.trim().length > 0) roots.add(r.path)
        }

        if (roots.size > 0) {
          removeScanProgress = api.onScanProgress((progress) => setScanProgress(progress))
          setScanning(true)
          try {
            const result = await api.discoverWorktrees({ roots: Array.from(roots), maxDepth: 5 })
            if (!result.cancelled) {
              const existingByPath = new Map(existingRepos.map((r) => [r.path, r]))
              const existingById = new Map(existingRepos.map((r) => [r.id, r]))
              const mergedRepos: Repository[] = []
              for (const r of result.repositories) {
                const prev = existingByPath.get(r.path) || existingById.get(r.id)
                if (!prev) {
                  mergedRepos.push(r)
                  continue
                }
                mergedRepos.push({
                  ...r,
                  favorite: prev.favorite ?? r.favorite,
                  preferredEditor: prev.preferredEditor ?? r.preferredEditor,
                  imageUrl: prev.imageUrl ?? r.imageUrl,
                  baseBranch: r.baseBranch || prev.baseBranch,
                  provider: prev.provider?.personalAccessToken
                    ? prev.provider
                    : (r.provider ?? prev.provider),
                })
              }

              const kept: Worktree[] = []
              for (const w of existingWorktrees) {
                if (!result.repositories.some((r) => r.id === w.repositoryId)) {
                  kept.push(w)
                }
              }

              repositories = mergedRepos
              worktrees = [...kept, ...result.worktrees]
              await Promise.all([api.setRepositories(repositories), api.setWorktrees(worktrees)])
            }
          } finally {
            setScanning(false)
            removeScanProgress?.()
            removeScanProgress = undefined
          }
        }

        setRepositories(repositories)
        setWorktrees(worktrees)

        if (repositories.length > 0) {
          const last = settings.lastSelectedRepositoryId
          const validLast = last && repositories.some((r) => r.id === last)
          const firstFavorite = [...repositories]
            .sort((a, b) => a.name.localeCompare(b.name))
            .find((r) => r.favorite)
          const selectedRepo = validLast
            ? repositories.find((r) => r.id === last)!
            : firstFavorite ?? repositories[0]!
          setSelectedRepositoryId(selectedRepo.id)
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
      {view === 'settings' && <Settings />}
    </div>
  )
}
