import { useEffect, useState } from 'react'
import { FolderPlus, Loader2, Search, X } from 'lucide-react'
import type { ScanResult, ScanProgress } from '@worktree/contracts'
import { api } from '../api'
import { useAppStore } from '../store'
import { cn } from '../lib/utils'
import { shortenPath } from '../lib/paths'
import { TitleBar } from './TitleBar'
import { Loading } from './Loading'

export function Onboarding() {
  const [roots, setRoots] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set())
  const { setScanProgress, scanProgress, setView, repositories } = useAppStore()

  useEffect(() => {
    const remove = api.onScanProgress((progress: ScanProgress) => {
      setScanProgress(progress)
    })
    return remove
  }, [setScanProgress])

  const addRoot = async () => {
    const dirs = await api.openDirectoryDialog()
    if (!dirs.length) return
    setRoots((prev) => Array.from(new Set([...prev, ...dirs])))
  }

  const removeRoot = (index: number) => {
    setRoots((prev) => prev.filter((_, i) => i !== index))
  }

  const startScan = async () => {
    setScanning(true)
    setScanResult(null)
    setSelectedRepoIds(new Set())
    try {
      const result = await api.discoverWorktrees({ roots, maxDepth: 5 })
      setScanResult(result)
      setSelectedRepoIds(new Set(result.repositories.map((r) => r.id)))
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  const toggleRepo = (id: string) => {
    setSelectedRepoIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const importSelected = async () => {
    if (!scanResult) return
    const existing = useAppStore.getState().repositories
    const existingByPath = new Map(existing.map((r) => [r.path, r]))
    const existingById = new Map(existing.map((r) => [r.id, r]))
    const settings = useAppStore.getState().settings

    // Preserve favorites / preferred editor / tokens when re-scanning
    const repos: typeof scanResult.repositories = []
    for (const r of scanResult.repositories) {
      if (!selectedRepoIds.has(r.id)) continue
      const prev = existingByPath.get(r.path) || existingById.get(r.id)
      if (!prev) {
        repos.push(r)
      } else {
        repos.push({
          ...r,
          favorite: prev.favorite ?? r.favorite,
          preferredEditor: prev.preferredEditor ?? r.preferredEditor,
          baseBranch: prev.baseBranch || r.baseBranch,
          provider: prev.provider?.personalAccessToken
            ? prev.provider
            : (r.provider ?? prev.provider),
        })
      }
    }
    const worktrees: typeof scanResult.worktrees = []
    for (const w of scanResult.worktrees) {
      if (repos.some((r) => r.id === w.repositoryId)) worktrees.push(w)
    }

    const nextSettings = {
      watchedDirectories: Array.from(new Set([...(settings?.watchedDirectories ?? []), ...roots])),
      excludedPaths: settings?.excludedPaths ?? [],
      defaultEditor: settings?.defaultEditor ?? 'cursor',
      theme: settings?.theme ?? 'system',
      ...(settings?.defaultTerminal ? { defaultTerminal: settings.defaultTerminal } : {}),
      ...(settings?.githubToken ? { githubToken: settings.githubToken } : {}),
      ...(settings?.azureToken ? { azureToken: settings.azureToken } : {}),
      worktreeSort: settings?.worktreeSort ?? 'activity',
      worktreeSortDirection: settings?.worktreeSortDirection ?? 'desc',
    }

    await Promise.all([
      api.setRepositories(repos),
      api.setWorktrees(worktrees),
      api.setSettings(nextSettings),
    ])

    useAppStore.getState().setRepositories(repos)
    useAppStore.getState().setWorktrees(worktrees)
    useAppStore.getState().setSettings(nextSettings)
    if (repos[0]) useAppStore.getState().setSelectedRepositoryId(repos[0].id)
    useAppStore.getState().setView('dashboard')
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Welcome"
        trailing={
          repositories.length > 0 ? (
            <button
              type="button"
              onClick={() => setView('dashboard')}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Back to dashboard
            </button>
          ) : null
        }
      />

      <div className="flex flex-1 items-start justify-center overflow-auto p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight">Find your repositories</h1>
          <p className="mb-6 text-sm text-muted">
            Pick folders to scan. We discover git repos and every linked worktree under them.
          </p>

          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Scan roots</h2>
              <button
                type="button"
                onClick={addRoot}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
              >
                <FolderPlus className="h-4 w-4" />
                Add folder
              </button>
            </div>

            {roots.length === 0 && <p className="text-sm text-muted">No folders selected yet.</p>}

            <ul className="space-y-2">
              {roots.map((root, i) => (
                <li
                  key={root}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <span className="truncate font-mono text-xs" title={root}>
                    {shortenPath(root)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRoot(i)}
                    aria-label="Remove root"
                    className="text-muted hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {scanning && scanProgress && (
            <div className="mb-6 flex justify-center">
              <Loading
                message="Scanning…"
                subMessage={`${scanProgress.found} found · ${scanProgress.current} folders`}
              />
            </div>
          )}

          {scanResult && (
            <div className="mb-6 rounded-md border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="select-all"
                  checked={
                    scanResult.repositories.length > 0 &&
                    selectedRepoIds.size === scanResult.repositories.length
                  }
                  onChange={(e) =>
                    setSelectedRepoIds(
                      e.target.checked
                        ? new Set(scanResult.repositories.map((r) => r.id))
                        : new Set()
                    )
                  }
                  className="h-4 w-4"
                />
                <label htmlFor="select-all" className="text-sm font-medium">
                  Select all ({scanResult.repositories.length} repos, {scanResult.worktrees.length}{' '}
                  worktrees)
                </label>
              </div>
              <ul className="max-h-60 space-y-2 overflow-auto pr-2">
                {scanResult.repositories.map((repo) => {
                  const repoWorktrees = scanResult.worktrees.filter(
                    (w) => w.repositoryId === repo.id
                  )
                  return (
                    <li
                      key={repo.id}
                      className="flex items-start gap-2 rounded-md border border-border p-2"
                    >
                      <input
                        id={`repo-${repo.id}`}
                        type="checkbox"
                        checked={selectedRepoIds.has(repo.id)}
                        onChange={() => toggleRepo(repo.id)}
                        aria-label={`Select ${repo.name}`}
                        className="mt-1 h-4 w-4"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">{repo.name}</p>
                        <p className="truncate font-mono text-xs text-muted" title={repo.path}>
                          {shortenPath(repo.path)}
                        </p>
                        <p className="text-xs text-muted">
                          {repoWorktrees.length} worktree{repoWorktrees.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={startScan}
              disabled={roots.length === 0 || scanning}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                roots.length === 0 || scanning
                  ? 'bg-muted text-foreground'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              )}
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Scan
                </>
              )}
            </button>

            {scanResult && (
              <button
                type="button"
                onClick={importSelected}
                disabled={selectedRepoIds.size === 0}
                className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Import {selectedRepoIds.size} repo{selectedRepoIds.size === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
