import { useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw,
  Settings as SettingsIcon,
  Plus,
  Search,
  FolderGit2,
  SlidersHorizontal,
  Star,
  ChevronDown,
  Loader2,
  ArrowDownUp,
  Clock3,
  ShieldCheck,
} from 'lucide-react'
import type {
  Repository,
  Worktree,
  WorktreeSort,
  WorktreeSortDirection,
} from '@worktree/contracts'
import { useAppStore } from '../store'
import { api } from '../api'
import { WorktreeRow } from './WorktreeRow'
import { ProjectConfigModal } from './ProjectConfigModal'
import { TitleBar } from './TitleBar'
import { cn } from '../lib/utils'
import { EDITOR_OPTIONS, editorLabel, shortenPath } from '../lib/paths'
import { groupWorktrees, isSafeToDelete, sortWorktrees } from '../lib/worktreeSorting'
import type { RepositoryBaseStatus } from '@worktree/contracts'
import { BaseBranchStatus } from './BaseBranchStatus'

const SORT_MODES: { value: WorktreeSort; label: string }[] = [
  { value: 'activity', label: 'Recent activity' },
  { value: 'name', label: 'Branch name' },
  { value: 'safety', label: 'Cleanup readiness' },
]

function defaultDirectionFor(sort: WorktreeSort): WorktreeSortDirection {
  return sort === 'name' ? 'asc' : sort === 'activity' ? 'desc' : 'asc'
}

function directionLabel(sort: WorktreeSort, direction: WorktreeSortDirection): string {
  if (sort === 'activity') return direction === 'desc' ? 'Newest first' : 'Oldest first'
  if (sort === 'name') return direction === 'asc' ? 'A–Z' : 'Z–A'
  return direction === 'asc' ? 'Cleanup first' : 'Active first'
}

export function Dashboard() {
  const {
    repositories,
    worktrees,
    statuses,
    scanProgress,
    selectedRepositoryId,
    settings,
    setStatuses,
    setStatus,
    applyBranchChange,
    setSettings,
    setView,
    setRepositories,
    setWorktrees,
    setSelectedRepositoryId,
    setScanProgress,
  } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'>('all')
  const [search, setSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [statusProgress, setStatusProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const refreshSeq = useRef(new Map<string, number>())
  const [baseStatuses, setBaseStatuses] = useState<Record<string, RepositoryBaseStatus>>({})
  const [baseUpdating, setBaseUpdating] = useState(false)

  const loadStatuses = async () => {
    if (worktrees.length === 0) return
    setLoading(true)
    try {
      const result = await api.getWorktreeStatuses({ worktrees, repositories })
      setStatuses(result.statuses)
      setBaseStatuses(
        result.baseStatuses.reduce(
          (acc, status) => {
            acc[status.repositoryId] = status
            return acc
          },
          {} as Record<string, RepositoryBaseStatus>
        )
      )
    } finally {
      setLoading(false)
      setStatusProgress(null)
    }
  }

  // Refresh just one worktree's status (git + PR for that worktree only) and
  // swap it in — used after a git action instead of the full loadStatuses,
  // which re-scans every worktree in every repo and does a PR lookup per row.
  const refreshWorktreeStatus = async (worktree: Worktree) => {
    // Read through the store rather than the render closure: the branch poll
    // below holds onto this function across renders.
    const repo = useAppStore
      .getState()
      .repositories.find((r) => r.id === worktree.repositoryId)
    if (!repo) return

    // One refresh takes seconds (it fetches the base ref), so two branch
    // switches in quick succession overlap — and the first response, describing
    // a branch we have already left, would land last and win. Only the newest
    // request for a row may write to it.
    const request = (refreshSeq.current.get(worktree.id) ?? 0) + 1
    refreshSeq.current.set(worktree.id, request)
    const isCurrent = () => refreshSeq.current.get(worktree.id) === request

    setRefreshingIds((ids) => new Set(ids).add(worktree.id))
    try {
      const status = await api.getWorktreeStatus({ worktree, repository: repo })
      if (isCurrent()) setStatus(worktree.id, status)
    } finally {
      if (isCurrent()) {
        setRefreshingIds((ids) => {
          const next = new Set(ids)
          next.delete(worktree.id)
          return next
        })
      }
    }
  }

  // Branches also change outside the app — a checkout in a terminal — and the
  // PR badge is derived from the live branch, so a stale row shows the wrong
  // PR (or none). The main process watches each visible worktree's HEAD and
  // reports switches as they happen; the timer is only a backstop for paths a
  // watcher can't cover, which is why it can run this slowly. Either way only
  // rows that actually moved pay for a full re-sync (git + PR lookup).
  const watchedWorktreeIds = useMemo(
    () =>
      worktrees
        .filter((w) => w.repositoryId === selectedRepositoryId && !w.prunable)
        .map((w) => w.id)
        .join(','),
    [worktrees, selectedRepositoryId]
  )

  useEffect(() => {
    if (!selectedRepositoryId) return
    let cancelled = false

    const resync = (worktreeId: string, branch: string) => {
      const state = useAppStore.getState()
      const worktree = state.worktrees.find((w) => w.id === worktreeId)
      const known = state.statuses[worktreeId]
      if (!worktree || !known) return
      // Show the new branch (and drop the old branch's PR) right away, then
      // let the refresh fill in the rest — the row spins meanwhile.
      if (known.branch !== branch) applyBranchChange(worktreeId, branch)
      void refreshWorktreeStatus(worktree)
    }

    const watched = useAppStore
      .getState()
      .worktrees.filter((w) => w.repositoryId === selectedRepositoryId && !w.prunable)
    void api.watchWorktreeHeads({ worktrees: watched }).catch(() => undefined)

    const removeHeadListener = api.onWorktreeHeadChanged(({ worktreeId, branch, headCommit }) => {
      if (cancelled) return
      const known = useAppStore.getState().statuses[worktreeId]
      // The app's own git actions move HEAD too, and they already refresh the
      // row — skip the echo.
      if (!known || (known.branch === branch && known.headCommit === headCommit)) return
      resync(worktreeId, branch)
    })

    const syncBranches = async () => {
      if (document.hidden || cancelled) return
      const state = useAppStore.getState()
      const watched = state.worktrees.filter(
        (w) => w.repositoryId === selectedRepositoryId && !w.prunable
      )
      if (watched.length === 0) return

      const current = await api.getWorktreeBranches({ worktrees: watched }).catch(() => [])
      if (cancelled) return

      for (const { worktreeId, branch } of current) {
        if (useAppStore.getState().statuses[worktreeId]?.branch === branch) continue
        resync(worktreeId, branch)
      }
    }

    const interval = window.setInterval(syncBranches, 60_000)
    window.addEventListener('focus', syncBranches)
    document.addEventListener('visibilitychange', syncBranches)
    void syncBranches()
    return () => {
      cancelled = true
      removeHeadListener()
      window.clearInterval(interval)
      window.removeEventListener('focus', syncBranches)
      document.removeEventListener('visibilitychange', syncBranches)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepositoryId, watchedWorktreeIds])

  useEffect(() => {
    const remove = api.onScanProgress((progress) => setScanProgress(progress))
    return remove
  }, [setScanProgress])

  useEffect(() => {
    const remove = api.onStatusProgress((progress) => setStatusProgress(progress))
    return remove
  }, [])

  const rescan = async () => {
    if (scanning || loading) return
    const roots = Array.from(
      new Set([...(settings?.watchedDirectories ?? []), ...repositories.map((r) => r.path)])
    ).filter((root) => root.trim().length > 0)
    if (roots.length === 0) return

    setScanning(true)
    setScanProgress({ total: roots.length, current: 0, found: 0 })
    setActionError(null)
    console.info('[worktree] rescan:start', { roots: roots.length })
    try {
      const result = await api.discoverWorktrees({ roots, maxDepth: 5 })
      if (result.cancelled) {
        console.info('[worktree] rescan:cancelled')
        return
      }

      const existingByPath = new Map(repositories.map((r) => [r.path, r]))
      const mergedRepos = result.repositories.map((r) => {
        const prev = existingByPath.get(r.path) || repositories.find((e) => e.id === r.id)
        if (!prev) return r
        return {
          ...r,
          favorite: prev.favorite ?? r.favorite,
          preferredEditor: prev.preferredEditor ?? r.preferredEditor,
          // Prefer the freshly detected default branch (e.g. `dev`) over a
          // previously stored guess (older scans defaulted every repo to `main`).
          baseBranch: r.baseBranch || prev.baseBranch,
          provider: prev.provider?.personalAccessToken
            ? prev.provider
            : (r.provider ?? prev.provider),
        }
      })

      const keptWorktrees = worktrees.filter(
        (w) => !result.repositories.some((r) => r.id === w.repositoryId)
      )
      const mergedWorktrees = [...keptWorktrees, ...result.worktrees]

      await Promise.all([api.setRepositories(mergedRepos), api.setWorktrees(mergedWorktrees)])
      setRepositories(mergedRepos)
      setWorktrees(mergedWorktrees)
      console.info('[worktree] rescan:done', {
        repositories: mergedRepos.length,
        worktrees: mergedWorktrees.length,
      })
    } catch (err) {
      console.error('[worktree] rescan:error', err)
      setActionError(String(err))
    } finally {
      setScanning(false)
      setScanProgress(null)
      setLoading(false)
    }
    await loadStatuses()
  }

  useEffect(() => {
    loadStatuses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktrees.length, repositories.length])

  const selectRepository = async (id: string) => {
    setSelectedRepositoryId(id)
    if (settings) {
      await api.setSettings({ ...settings, lastSelectedRepositoryId: id })
    }
  }

  useEffect(() => {
    if (repositories.length === 0) return
    if (selectedRepositoryId && repositories.some((r) => r.id === selectedRepositoryId)) return

    const last = settings?.lastSelectedRepositoryId
    const validLast = last && repositories.some((r) => r.id === last)
    const firstFavorite = [...repositories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .find((r) => r.favorite)
    const fallback = validLast
      ? repositories.find((r) => r.id === last)!
      : (firstFavorite ?? repositories[0]!)
    setSelectedRepositoryId(fallback.id)
  }, [repositories, selectedRepositoryId, setSelectedRepositoryId, settings])

  const persistRepos = async (next: Repository[]) => {
    setRepositories(next)
    await api.setRepositories(next)
  }

  const updateRepo = async (id: string, patch: Partial<Repository>) => {
    const next = repositories.map((r) => (r.id === id ? { ...r, ...patch } : r))
    await persistRepos(next)
  }

  const sortedRepos = useMemo(() => {
    return [...repositories]
      .filter((r) => {
        if (!projectSearch) return true
        const q = projectSearch.toLowerCase()
        return r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [repositories, projectSearch])

  const selectedRepo = repositories.find((r) => r.id === selectedRepositoryId) ?? null

  const updateSelectedBase = async () => {
    if (!selectedRepo || baseUpdating) return
    setBaseUpdating(true)
    setActionError(null)
    try {
      const result = await api.updateBaseBranch({
        path: selectedRepo.path,
        baseBranch: selectedRepo.baseBranch || 'main',
      })
      if (!result.success) setActionError(result.output)
      await loadStatuses()
    } catch (err) {
      setActionError(String(err))
    } finally {
      setBaseUpdating(false)
    }
  }

  const effectiveEditor = selectedRepo?.preferredEditor || settings?.defaultEditor || 'cursor'
  const sortMode = settings?.worktreeSort ?? 'activity'
  const sortDirection = settings?.worktreeSortDirection ?? defaultDirectionFor(sortMode)

  const updateWorktreeSort = async (
    nextSort: WorktreeSort,
    nextDirection: WorktreeSortDirection
  ) => {
    const current = useAppStore.getState().settings ?? settings
    if (!current) return
    const next = {
      ...current,
      worktreeSort: nextSort,
      worktreeSortDirection: nextDirection,
    }
    setSettings(next)
    try {
      await api.setSettings(next)
    } catch (err) {
      setActionError(`Could not save worktree ordering: ${String(err)}`)
    }
  }

  const repoWorktrees = useMemo(() => {
    if (!selectedRepo) return []
    const filtered = worktrees
      .filter((w) => w.repositoryId === selectedRepo.id)
      .filter((w) => {
        const status = statuses[w.id]
        const text = `${status?.branch ?? w.branch} ${w.path}`.toLowerCase()
        if (search && !text.includes(search.toLowerCase())) return false
        if (filter === 'dirty') return Boolean(status?.dirty || status?.staged)
        if (filter === 'unmerged')
          return Boolean(
            status &&
            !status.mergedIntoBase &&
            (status.branch ?? w.branch) !== status.baseBranch &&
            (status.branch ?? w.branch) !== 'HEAD'
          )
        if (filter === 'unpushed') return (status?.ahead ?? 0) > 0 || (status?.unpushed ?? 0) > 0
        if (filter === 'safe') return isSafeToDelete(w, status)
        return true
      })
    return sortWorktrees(filtered, statuses, sortMode, sortDirection)
  }, [selectedRepo, worktrees, statuses, filter, search, sortMode, sortDirection])

  const worktreeSections = useMemo(
    () => groupWorktrees(repoWorktrees, statuses, sortMode === 'safety'),
    [repoWorktrees, statuses, sortMode]
  )

  const worktreeCountByRepo = useMemo(() => {
    const map = new Map<string, number>()
    for (const w of worktrees) {
      map.set(w.repositoryId, (map.get(w.repositoryId) ?? 0) + 1)
    }
    return map
  }, [worktrees])

  const handleDelete = async (w: Worktree) => {
    if (w.isMain) {
      window.alert('The primary worktree cannot be deleted from here.')
      return
    }
    const repo = repositories.find((r) => r.id === w.repositoryId)
    if (!repo) return

    // Stale worktree: the folder is already gone — there's nothing to trash, we
    // just clear git's leftover record. Pruning removes every stale entry in the
    // repo at once, so drop them all from the list.
    if (w.prunable) {
      const ok = window.confirm(
        `This worktree's folder is already gone.\n\nRemove the stale entry from git?\n${shortenPath(w.path)}`
      )
      if (!ok) return
      const res = await window.api.removeWorktree({
        path: w.path,
        repoPath: repo.path,
        missing: true,
      })
      if (!res.success) {
        setActionError(res.error || 'Failed to prune worktree')
        return
      }
      const next = worktrees.filter((x) => !(x.repositoryId === repo.id && x.prunable))
      setWorktrees(next)
      await api.setWorktrees(next)
      return
    }

    const status = statuses[w.id]
    if (status) {
      const safety = await api.evaluateSafety({ worktree: w, status })
      if (!safety.safe) {
        const ok = window.confirm(
          `This worktree may not be safe to delete:\n${safety.reasons.join('\n')}\n\nMove it to Trash anyway? (Recoverable from Trash)`
        )
        if (!ok) return
      } else {
        const ok = window.confirm(
          `Move worktree to Trash?\n${shortenPath(w.path)}\n\nThis uses the system Trash and can be restored.`
        )
        if (!ok) return
      }
    } else {
      const ok = window.confirm(
        `Move worktree to Trash?\n${shortenPath(w.path)}\n\nThis uses the system Trash and can be restored.`
      )
      if (!ok) return
    }

    const res = await window.api.removeWorktree({ path: w.path, repoPath: repo.path })
    if (!res.success) {
      setActionError(res.error || 'Failed to remove worktree')
      return
    }
    const next = worktrees.filter((x) => x.path !== w.path)
    setWorktrees(next)
    await api.setWorktrees(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Worktree Manager"
        trailing={
          <>
            <button
              onClick={rescan}
              disabled={loading || scanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              title="Refresh worktrees and statuses"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (loading || scanning) && 'animate-spin')} />
              {scanning ? 'Scanning…' : 'Refresh'}
            </button>
            <button
              onClick={() => setView('settings')}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </button>
          </>
        }
      />

      {actionError && (
        <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span className="truncate">{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-3 shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Projects
              </span>
              <button
                onClick={() => setView('onboarding')}
                className="rounded-md p-1 text-muted hover:bg-accent hover:text-foreground"
                title="Add repositories"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Filter projects…"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {sortedRepos.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">No projects yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {sortedRepos.map((repo) => {
                  const active = repo.id === selectedRepositoryId
                  const count = worktreeCountByRepo.get(repo.id) ?? 0
                  return (
                    <li key={repo.id}>
                      <div
                        className={cn(
                          'group flex w-full items-start gap-1 rounded-lg pr-1 transition-colors',
                          active
                            ? 'bg-primary/15 text-foreground ring-1 ring-primary/30'
                            : 'text-foreground/80 hover:bg-accent'
                        )}
                      >
                        <button
                          onClick={() => selectRepository(repo.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left"
                        >
                          <FolderGit2
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              active ? 'text-primary' : 'text-muted'
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">
                              {repo.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {count} worktree{count === 1 ? '' : 's'}
                              {repo.preferredEditor
                                ? ` · ${editorLabel(repo.preferredEditor)}`
                                : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => updateRepo(repo.id, { favorite: !repo.favorite })}
                          className={cn(
                            'mt-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100',
                            repo.favorite
                              ? 'text-warning opacity-100'
                              : 'text-muted hover:text-warning'
                          )}
                          title={repo.favorite ? 'Remove favorite' : 'Add favorite'}
                        >
                          <Star className={cn('h-3.5 w-3.5', repo.favorite && 'fill-warning')} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col">
          {scanning && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card/95 px-3.5 py-2 text-xs text-muted shadow-lg backdrop-blur">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span className="truncate">
                  {scanProgress
                    ? `Scanning… ${scanProgress.found} found · ${scanProgress.current} folders${scanProgress.currentPath ? ` · ${shortenPath(scanProgress.currentPath)}` : ''}`
                    : 'Scanning folders…'}
                </span>
              </div>
            </div>
          )}
          {selectedRepo ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  {/* Name, provider and base freshness read as one line of
                      project metadata; they only wrap once the pane is too
                      narrow to hold them. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">
                      {selectedRepo.name}
                    </h2>
                    <button
                      onClick={() =>
                        updateRepo(selectedRepo.id, { favorite: !selectedRepo.favorite })
                      }
                      className={cn(
                        'rounded p-1',
                        selectedRepo.favorite ? 'text-warning' : 'text-muted hover:text-warning'
                      )}
                      title={selectedRepo.favorite ? 'Unfavorite' : 'Favorite'}
                    >
                      <Star className={cn('h-4 w-4', selectedRepo.favorite && 'fill-warning')} />
                    </button>
                    {selectedRepo.provider && (
                      <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {selectedRepo.provider.type === 'github' ? 'GitHub' : 'Azure'}
                        {selectedRepo.provider.source === 'remote' ? ' · auto' : ''}
                      </span>
                    )}
                    <BaseBranchStatus
                      status={baseStatuses[selectedRepo.id]}
                      busy={loading || baseUpdating}
                      onRefresh={loadStatuses}
                      onUpdate={updateSelectedBase}
                    />
                  </div>
                  <p
                    className="mt-1 truncate font-mono text-xs text-muted"
                    title={selectedRepo.path}
                  >
                    {shortenPath(selectedRepo.path)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Per-project editor — primary control on the main screen */}
                  <label className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                    <span className="text-muted">Open with</span>
                    <div className="relative">
                      <select
                        value={selectedRepo.preferredEditor || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRepo(selectedRepo.id, {
                            preferredEditor: v || undefined,
                          })
                        }}
                        className="appearance-none bg-transparent pr-5 font-medium outline-none"
                        title="Editor for this project"
                      >
                        <option value="">
                          App default ({editorLabel(settings?.defaultEditor)})
                        </option>
                        {EDITOR_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    </div>
                  </label>

                  <button
                    onClick={() => setConfigRepoId(selectedRepo.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Configure
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search branches or paths…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
                  {(['all', 'dirty', 'unmerged', 'unpushed', 'safe'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        'rounded px-2.5 py-1 text-[11px] font-medium capitalize',
                        filter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted hover:bg-accent hover:text-foreground'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs">
                  {sortMode === 'activity' ? (
                    <Clock3 className="h-3.5 w-3.5 text-primary" />
                  ) : sortMode === 'safety' ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <ArrowDownUp className="h-3.5 w-3.5 text-primary" />
                  )}
                  <span className="text-muted">Sort</span>
                  <div className="relative">
                    <select
                      aria-label="Sort worktrees by"
                      value={sortMode}
                      onChange={(e) => {
                        const nextSort = e.target.value as WorktreeSort
                        void updateWorktreeSort(nextSort, defaultDirectionFor(nextSort))
                      }}
                      className="appearance-none bg-transparent pr-4 font-medium outline-none"
                    >
                      {SORT_MODES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void updateWorktreeSort(sortMode, sortDirection === 'asc' ? 'desc' : 'asc')
                    }
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-accent hover:text-foreground"
                    title={`Reverse ordering (${directionLabel(sortMode, sortDirection)})`}
                    aria-label={`Reverse ordering, currently ${directionLabel(sortMode, sortDirection)}`}
                  >
                    <span>{directionLabel(sortMode, sortDirection)}</span>
                    <ArrowDownUp className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="relative flex-1 overflow-hidden">
                {loading && (
                  <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
                    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-warning/50 bg-warning/20 px-3.5 py-2 text-xs font-semibold text-warning shadow-lg backdrop-blur">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <span className="truncate">
                        {statusProgress && statusProgress.total > 0
                          ? `Fetching worktree statuses… ${statusProgress.current}/${statusProgress.total}`
                          : 'Fetching worktree statuses…'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="h-full overflow-auto p-4">
                  {repoWorktrees.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
                      <p className="text-sm">No worktrees match this filter.</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      {worktreeSections.map((section, sectionIndex) => (
                        <section
                          key={section.key}
                          className={cn(sectionIndex > 0 && 'border-t border-border')}
                        >
                          {section.label && (
                            <div className="flex items-center justify-between border-b border-border bg-accent/35 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                              <span className="inline-flex items-center gap-1.5">
                                {section.key === 'safe' ? (
                                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                                ) : (
                                  <ArrowDownUp className="h-3.5 w-3.5" />
                                )}
                                {section.label}
                              </span>
                              <span className="font-mono text-[10px] text-muted/80">
                                {section.worktrees.length}
                              </span>
                            </div>
                          )}
                          {section.worktrees.map((w) => (
                            <WorktreeRow
                              key={w.id}
                              worktree={w}
                              repository={selectedRepo}
                              status={statuses[w.id]}
                              refreshing={refreshingIds.has(w.id)}
                              editorId={effectiveEditor}
                              onDelete={handleDelete}
                              onActionError={setActionError}
                              onRefresh={loadStatuses}
                              onRefreshWorktree={refreshWorktreeStatus}
                              onBranchChange={applyBranchChange}
                            />
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
              <FolderGit2 className="h-10 w-10 opacity-40" />
              <p className="text-sm">Select a project on the left.</p>
              <button
                onClick={() => setView('onboarding')}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                Add repositories
              </button>
            </div>
          )}
        </main>
      </div>

      {configRepoId && (
        <ProjectConfigModal
          repository={repositories.find((r) => r.id === configRepoId)!}
          onClose={() => setConfigRepoId(null)}
          onSave={async (repo) => {
            const next = repositories.map((r) => (r.id === repo.id ? repo : r))
            await persistRepos(next)
            setConfigRepoId(null)
            loadStatuses()
          }}
        />
      )}
    </div>
  )
}
